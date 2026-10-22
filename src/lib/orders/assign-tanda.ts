import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { OrderStatus } from "@/domain/order-status";
import { z } from "@/lib/zod";
import {
  assignAbortFailure,
  assignCadetInTx,
  fail,
  STATE_LABEL,
  unexpected,
  type AssignLockedOrder,
  type DispatchFailure,
  type DispatchFailureDetail,
} from "./dispatch";
import { assignCadetInputSchema, MAX_ASSIGN_ORDERS } from "./dispatch-schemas";
import { isWrongSector, type Sector } from "./sector";
import { parseTanda } from "./tanda";

/**
 * Sends a whole tanda out with one cadet. The client sends the EXPLICIT ids it saw ready in the tanda; the server
 * re-checks everything in ONE transaction (the same locks as `assignCadet`: cadet, then the orders by id), so nothing
 * can change between the check and the assignment. No next/*.
 */

export type AssignTandaInput = { tanda: number; orderIds: number[]; cadetId: number; userId: number; confirmPartial: boolean; sector: Sector | null };
export type AssignTandaData = {
  /** Ids sent out (ascending). */
  assigned: number[];
  /** Ids of the tanda's orders still in preparation, left behind (only with `confirmPartial`). */
  pending: number[];
  cadet: { id: number; name: string };
  /** Centavos of cash to collect in this trip. */
  cashToCollect: number;
};
/** A listed order changed tanda or state, or another ready order joined the tanda, since the screen was drawn. */
export type TandaChanged = { ok: false; code: "CHANGED"; message: string; details: DispatchFailureDetail[] };
/** The tanda has orders still in preparation and the person did not confirm sending the ready ones anyway. */
export type TandaIncomplete = { ok: false; code: "TANDA_INCOMPLETE"; message: string; ready: number; total: number };
export type AssignTandaResult = { ok: true; data: AssignTandaData } | DispatchFailure | TandaChanged | TandaIncomplete;

const ACTIVE: OrderStatus[] = ["en_preparacion", "listo_despacho"];

/** Why a listed order can no longer go out with its tanda, or null when it still can. */
export function tandaChangeReason(o: { tanda: number | null; status: OrderStatus }, tanda: number): string | null {
  if (o.tanda === null) return "Ya no tiene tanda";
  if (o.tanda !== tanda) return `Ahora es de la tanda ${o.tanda}`;
  if (o.status !== "listo_despacho") return `Ya no está listo: está ${STATE_LABEL[o.status]}`;
  return null;
}

const listos = (n: number) => (n === 1 ? "el 1 listo" : `los ${n} listos`);

export async function assignTanda(db: Db, raw: AssignTandaInput): Promise<AssignTandaResult> {
  const t = parseTanda(raw.tanda);
  if (!t.ok || t.tanda === null) return fail("VALIDATION", "Tanda inválida");
  const tanda = t.tanda;
  if (typeof raw.confirmPartial !== "boolean") return fail("VALIDATION", "Solicitud inválida");
  const input = assignCadetInputSchema.safeParse(raw);
  if (!input.success) return fail("VALIDATION", input.error.issues[0]?.message ?? "Solicitud inválida");
  const { orderIds, cadetId, userId } = input.data;
  const sector = raw.sector;
  let pending: number[] = [];

  try {
    return await db.transaction(async (tx): Promise<AssignTandaResult> => {
      const guard = async (rows: AssignLockedOrder[]): Promise<TandaChanged | TandaIncomplete | null> => {
        // A missing order, another sector's or a non-delivery one: the standard checks explain it better.
        if (rows.length !== orderIds.length || rows.some((o) => o.fulfillment !== "delivery" || isWrongSector(sector, o.fulfillment))) return null;

        const details: DispatchFailureDetail[] = [];
        for (const o of rows) {
          const reason = tandaChangeReason(o, tanda);
          if (reason) details.push({ orderId: o.id, orderNumber: o.number, reason });
        }
        // The tanda's orders that have not left yet (the same ones the summary counts).
        const listed = new Set(orderIds);
        const active = await tx
          .select({ id: s.orders.id, number: s.orders.number, status: s.orders.status })
          .from(s.orders)
          .where(and(eq(s.orders.fulfillment, "delivery"), eq(s.orders.tanda, tanda), inArray(s.orders.status, ACTIVE)))
          .orderBy(s.orders.id);
        for (const o of active) {
          if (o.status === "listo_despacho" && !listed.has(o.id)) {
            details.push({ orderId: o.id, orderNumber: o.number, reason: "Se sumó a la tanda y está listo" });
          }
        }
        if (details.length > 0) {
          return {
            ok: false,
            code: "CHANGED",
            message: `La tanda ${tanda} cambió mientras elegías: no se asignó ningún pedido. Revisala y volvé a intentar.`,
            details,
          };
        }
        pending = active.filter((o) => o.status !== "listo_despacho").map((o) => o.id);
        if (pending.length > 0 && !raw.confirmPartial) {
          const ready = rows.length;
          const total = active.length;
          return {
            ok: false,
            code: "TANDA_INCOMPLETE",
            message: `La tanda ${tanda} tiene ${ready} de ${total} listos. Confirmá para asignar igual ${listos(ready)}.`,
            ready,
            total,
          };
        }
        return null;
      };

      const r = await assignCadetInTx(tx, { orderIds, cadetId, userId, sector }, guard);
      if (!r.ok) return r;
      return {
        ok: true,
        data: { assigned: r.data.orders.map((o) => o.id), pending, cadet: r.data.cadet, cashToCollect: r.data.cashToCollect },
      };
    });
  } catch (err) {
    return assignAbortFailure(err) ?? unexpected("assignTanda", err);
  }
}

// ---------------------------------------------------------------- form parsing (Server Action payload)

const id = z.coerce.number().int().positive().max(2_147_483_647);
const formSchema = z.object({
  orderIds: z.array(id).min(1).max(MAX_ASSIGN_ORDERS),
  cadetId: id,
  confirmPartial: z.enum(["1", "0", "true", "false"]).optional(),
});

export type AssignTandaForm = { tanda: number; orderIds: number[]; cadetId: number; confirmPartial: boolean };

/** Reads `tanda`, every `orderId`, `cadetId` and the optional `confirmPartial` ("1"/"true") of the form. */
export function parseAssignTandaForm(form: FormData): { ok: true; data: AssignTandaForm } | { ok: false; message: string } {
  const rawTanda = form.get("tanda");
  const t = typeof rawTanda === "string" ? parseTanda(rawTanda) : null;
  if (!t || !t.ok || t.tanda === null) return { ok: false, message: "Tanda inválida" };
  const strings = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
  const ids = form.getAll("orderId").map((v) => (typeof v === "string" && /^\d+$/.test(v.trim()) ? v.trim() : "x"));
  const parsed = formSchema.safeParse({
    orderIds: ids,
    cadetId: /^\d+$/.test(strings(form.get("cadetId")) ?? "") ? strings(form.get("cadetId")) : "x",
    confirmPartial: strings(form.get("confirmPartial")),
  });
  if (!parsed.success) return { ok: false, message: "Solicitud inválida" };
  const c = parsed.data.confirmPartial;
  return {
    ok: true,
    data: { tanda: t.tanda, orderIds: parsed.data.orderIds, cadetId: parsed.data.cadetId, confirmPartial: c === "1" || c === "true" },
  };
}
