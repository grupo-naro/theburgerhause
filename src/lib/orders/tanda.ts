import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { OrderStatus } from "@/domain/order-status";
import { ORDERS_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import { pgErrorCode } from "./create-order";
import { decideSector, type Sector } from "./sector";
import { failure, isId, UNEXPECTED_MESSAGE, type OrderResult } from "./transition";
import { MAX_TANDA_ORDERS } from "./tanda-limits";

/**
 * Tanda: the free number (1-99) the delivery manager writes by hand on approved delivery orders to
 * group the 1-3 orders one cadet carries in one trip. It is never computed or suggested. No next/*.
 */

export { MAX_TANDA_ORDERS };
export const TANDA_MIN = 1;
export const TANDA_MAX = 99;
export const TANDA_INVALID_MESSAGE = "La tanda debe ser un número entero del 1 al 99.";

/** Statuses where the tanda can be edited, and the only ones the summary counts (after approval, before leaving). */
const EDITABLE_STATUSES: OrderStatus[] = ["en_preparacion", "listo_despacho"];

export type ParsedTanda = { ok: true; tanda: number | null } | { ok: false; message: string };

/** Empty / null clears the tanda; otherwise a plain integer 1-99 (surrounding spaces are fine). */
export function parseTanda(input: string | number | null): ParsedTanda {
  if (input === null) return { ok: true, tanda: null };
  if (typeof input === "number") {
    return Number.isInteger(input) && input >= TANDA_MIN && input <= TANDA_MAX
      ? { ok: true, tanda: input }
      : { ok: false, message: TANDA_INVALID_MESSAGE };
  }
  const text = input.trim();
  if (text === "") return { ok: true, tanda: null };
  if (!/^\d{1,3}$/.test(text)) return { ok: false, message: TANDA_INVALID_MESSAGE };
  const n = Number(text);
  return n >= TANDA_MIN && n <= TANDA_MAX ? { ok: true, tanda: n } : { ok: false, message: TANDA_INVALID_MESSAGE };
}

export type TandaCount = { tanda: number; count: number; overLimit: boolean };

/** Orders per tanda, counting only the ones that have not left yet; sorted by tanda number. */
export function tandaSummary(orders: { id: number; tanda: number | null; status: OrderStatus }[]): TandaCount[] {
  const counts = new Map<number, number>();
  for (const o of orders) {
    if (o.tanda === null || !EDITABLE_STATUSES.includes(o.status)) continue;
    counts.set(o.tanda, (counts.get(o.tanda) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tanda, count]) => ({ tanda, count, overLimit: count > MAX_TANDA_ORDERS }));
}

export type SetOrderTandaInput = { orderId: number; userId: number; tanda: number | null; sector: Sector | null };
export type SetOrderTandaData = { orderId: number; tanda: number | null };

const label = (t: number | null) => (t === null ? "ninguna" : String(t));

/**
 * Sets/changes/clears the tanda of a delivery order in en_preparacion or listo_despacho. Locks the order row
 * (concurrent edits serialize: the last one wins and each leaves its own event), applies the sector rule, writes
 * an order event (from = to = current status, note "Tanda: 2 (antes: 1)") and queues the realtime "updated".
 * Setting the value it already has is a successful no-op (no event, no notification).
 */
export async function setOrderTanda(db: Db, input: SetOrderTandaInput): Promise<OrderResult<SetOrderTandaData>> {
  const { orderId, userId, tanda, sector } = input;
  if (!isId(orderId)) return failure("VALIDATION", "Pedido inválido");
  const parsed = parseTanda(tanda);
  if (!parsed.ok) return failure("VALIDATION", parsed.message);

  try {
    return await db.transaction(async (tx): Promise<OrderResult<SetOrderTandaData>> => {
      const [current] = await tx
        .select({ status: s.orders.status, fulfillment: s.orders.fulfillment, tanda: s.orders.tanda })
        .from(s.orders)
        .where(eq(s.orders.id, orderId))
        .for("update");
      if (!current) return failure("NOT_FOUND", "El pedido no existe");
      const sectorOk = decideSector(sector, current.fulfillment);
      if (!sectorOk.ok) return failure("WRONG_SECTOR", sectorOk.message);
      if (current.fulfillment !== "delivery") return failure("VALIDATION", "Solo los pedidos de delivery tienen tanda.");
      if (!EDITABLE_STATUSES.includes(current.status)) {
        return failure("INVALID_STATE", "La tanda solo se puede cambiar mientras el pedido está en preparación o listo para despacho.");
      }
      if (current.tanda === parsed.tanda) return { ok: true, data: { orderId, tanda: parsed.tanda } };

      await tx.update(s.orders).set({ tanda: parsed.tanda }).where(eq(s.orders.id, orderId));
      await tx.insert(s.orderEvents).values({
        orderId,
        fromStatus: current.status,
        toStatus: current.status,
        userId,
        note: current.tanda === null ? `Tanda: ${label(parsed.tanda)}` : `Tanda: ${label(parsed.tanda)} (antes: ${label(current.tanda)})`,
      });
      await notifyInTx(tx, ORDERS_CHANNEL, { orderId, status: current.status, event: "updated" });
      return { ok: true, data: { orderId, tanda: parsed.tanda } };
    });
  } catch (e) {
    console.error("[tanda] setOrderTanda failed", pgErrorCode(e) ?? "");
    return failure("UNEXPECTED", UNEXPECTED_MESSAGE);
  }
}
