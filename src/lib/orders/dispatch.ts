import { eq, inArray } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { canTransition, type Fulfillment, type OrderStatus } from "@/domain/order-status";
import { formatARS } from "@/domain/money";
import { pgErrorCode } from "./create-order";
import {
  assignCadetInputSchema,
  markDeliveredInputSchema,
  orderIdInputSchema,
  returnToDispatchInputSchema,
} from "./dispatch-schemas";
import { decideSector, sectorOfFulfillment, type Sector } from "./sector";
import { transitionOrder, UNEXPECTED_MESSAGE, type OrderFailure } from "./transition";

/**
 * Dispatch operations (after the kitchen): ready, pickup, delivery, cadet assignment and
 * return to dispatch. No next/*. Every operation runs in ONE transaction, validates the state
 * INSIDE it under a row lock (never trusting the client's view) against the DOMAIN state
 * machine, and goes through the locked transition core (audit event + notification queued in
 * the transaction, delivered only on commit). `userId` is a trusted field filled from the session.
 */

export type DispatchFailureCode =
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "VALIDATION"
  | "CADET_INACTIVE"
  | "CADET_NOT_FOUND"
  | "NOT_DELIVERY"
  | "WRONG_SECTOR"
  | "UNEXPECTED";
export type DispatchFailureDetail = { orderId: number; orderNumber: number | null; reason: string };
export type DispatchFailure = {
  ok: false;
  code: DispatchFailureCode;
  message: string;
  /** One entry per offending order when an `assignCadet` batch is refused. */
  details?: DispatchFailureDetail[];
};
export type DispatchResult<T> = { ok: true; data: T } | DispatchFailure;
export type DispatchContext = { now?: Date };
/** Every operation takes the acting station's `sector` (null/undefined = admin, exempt): other sectors' orders are refused with WRONG_SECTOR before any write. */
export type SectorInput = { sector: Sector | null };

export type DispatchOrderData = {
  orderId: number;
  number: number;
  status: OrderStatus;
  paymentStatus: "pending" | "paid";
};

const fail = (code: DispatchFailureCode, message: string, details?: DispatchFailureDetail[]): DispatchFailure =>
  details ? { ok: false, code, message, details } : { ok: false, code, message };
const unexpected = (op: string, err: unknown): DispatchFailure => {
  console.error(`[dispatch] ${op} failed`, pgErrorCode(err) ?? "");
  return fail("UNEXPECTED", UNEXPECTED_MESSAGE);
};
const fromTransition = (f: OrderFailure): DispatchFailure =>
  fail(f.code === "STATION_REQUIRED" ? "UNEXPECTED" : f.code, f.message);

const STATE_LABEL: Record<OrderStatus, string> = {
  pendiente_aprobacion: "pendiente de aprobación",
  en_preparacion: "en preparación",
  listo_despacho: "listo para despacho",
  en_camino: "en camino",
  para_retirar: "listo para retirar",
  entregado: "entregado",
  cancelado: "cancelado",
};
const stateOf = (n: number, status: OrderStatus, action: string) =>
  `El pedido #${n} está ${STATE_LABEL[status]}; ${action}.`;

type LockedOrder = {
  id: number;
  number: number;
  status: OrderStatus;
  fulfillment: Fulfillment;
  paymentMethod: "cash" | "transfer";
  paymentStatus: "pending" | "paid";
  total: number;
};
const orderColumns = {
  id: s.orders.id,
  number: s.orders.number,
  status: s.orders.status,
  fulfillment: s.orders.fulfillment,
  paymentMethod: s.orders.paymentMethod,
  paymentStatus: s.orders.paymentStatus,
  total: s.orders.total,
};

async function lockOrder(tx: DbTransaction, orderId: number): Promise<LockedOrder | null> {
  const [row] = await tx.select(orderColumns).from(s.orders).where(eq(s.orders.id, orderId)).for("update");
  return row ?? null;
}

type Move = {
  op: string;
  to: OrderStatus;
  /** The only source state (the domain table also allows other sources for the same target). */
  from: OrderStatus | ((o: LockedOrder) => OrderStatus);
  /** Fulfillment rule checked BEFORE the state, for a message that explains the real reason. */
  pre?: (o: LockedOrder) => DispatchFailure | null;
  /** Message tail when the current state cannot make this move. */
  refusal: string;
  /** Extra per-order rule (fulfillment) on top of the domain table; returns a refusal message. */
  extra?: (o: LockedOrder) => DispatchFailure | null;
  note?: string;
  patch?: (o: LockedOrder) => Parameters<typeof transitionOrder>[1]["patch"];
};

/** Lock -> validate with the domain table -> transition core, all in one transaction. */
async function move(db: Db, orderId: number, userId: number, sector: Sector | null, m: Move): Promise<DispatchResult<DispatchOrderData>> {
  try {
    return await db.transaction(async (tx): Promise<DispatchResult<DispatchOrderData>> => {
      const o = await lockOrder(tx, orderId);
      if (!o) return fail("NOT_FOUND", "El pedido no existe");
      const sectorOk = decideSector(sector, o.fulfillment);
      if (!sectorOk.ok) return fail("WRONG_SECTOR", sectorOk.message);
      const early = m.pre?.(o);
      if (early) return early;
      if (o.status !== (typeof m.from === "function" ? m.from(o) : m.from) || !canTransition(o.status, m.to, o.fulfillment)) return fail("INVALID_TRANSITION", stateOf(o.number, o.status, m.refusal));
      const refused = m.extra?.(o);
      if (refused) return refused;
      const moved = await transitionOrder(tx, { sector, orderId, to: m.to, userId, note: m.note, patch: m.patch?.(o) });
      if (!moved.ok) return fromTransition(moved);
      return {
        ok: true,
        data: { orderId, number: o.number, status: m.to, paymentStatus: moved.data.order.paymentStatus },
      };
    });
  } catch (err) {
    return unexpected(m.op, err);
  }
}

/** en_preparacion -> listo_despacho, web and counter orders alike. */
export async function markReady(db: Db, raw: { orderId: number; userId: number } & SectorInput): Promise<DispatchResult<DispatchOrderData>> {
  const input = orderIdInputSchema.safeParse(raw);
  if (!input.success) return fail("VALIDATION", "Solicitud inválida");
  return move(db, input.data.orderId, input.data.userId, raw.sector, {
    op: "markReady",
    from: "en_preparacion",
    to: "listo_despacho",
    refusal: "no se puede marcar como listo",
  });
}

/** listo_despacho -> para_retirar, takeaway orders only (delivery goes out with a cadet). */
export async function markPickup(db: Db, raw: { orderId: number; userId: number } & SectorInput): Promise<DispatchResult<DispatchOrderData>> {
  const input = orderIdInputSchema.safeParse(raw);
  if (!input.success) return fail("VALIDATION", "Solicitud inválida");
  return move(db, input.data.orderId, input.data.userId, raw.sector, {
    op: "markPickup",
    from: "listo_despacho",
    to: "para_retirar",
    refusal: "no se puede pasar a retirar",
    pre: (o) =>
      o.fulfillment === "delivery"
        ? fail("INVALID_TRANSITION", `El pedido #${o.number} es de delivery: sale con un cadete, no se retira en el local.`)
        : null,
  });
}

/**
 * para_retirar (takeaway) | en_camino (delivery) -> entregado, stamping `delivered_at`.
 * Payment rule: a takeaway order still `pending` (cash at pickup) REQUIRES `collected: true` and
 * becomes `paid` in the same update. Delivery orders never change payment status here: cash
 * stays pending until the cadet's rendicion.
 */
export async function markDelivered(
  db: Db,
  raw: { orderId: number; userId: number; collected?: boolean } & SectorInput,
  ctx: DispatchContext = {},
): Promise<DispatchResult<DispatchOrderData>> {
  const input = markDeliveredInputSchema.safeParse(raw);
  if (!input.success) return fail("VALIDATION", "Solicitud inválida");
  const { orderId, userId, collected } = input.data;
  const at = ctx.now ?? new Date();
  // A $0 order has nothing to collect: it is marked paid on delivery without a confirmation (and a cadet never owes $0:
  // a settlement needs amount > 0).
  const free = (o: LockedOrder) => o.total === 0 && o.paymentStatus === "pending";
  const collects = (o: LockedOrder) => o.fulfillment === "takeaway" && o.paymentStatus === "pending" && o.total > 0;
  return move(db, orderId, userId, raw.sector, {
    op: "markDelivered",
    // The domain table also allows para_retirar -> entregado for any order; a delivery order is
    // only delivered from en_camino and a takeaway one from para_retirar.
    from: (o) => (o.fulfillment === "delivery" ? "en_camino" : "para_retirar"),
    to: "entregado",
    refusal: "no se puede marcar como entregado",
    extra: (o) => {
      if (collects(o) && collected !== true) return fail("VALIDATION", `Confirmá que cobraste ${formatARS(o.total)}`);
      return null;
    },
    patch: (o) => ({ deliveredAt: at, ...(collects(o) || free(o) ? { paymentStatus: "paid" as const } : {}) }),
  });
}

/** en_camino -> listo_despacho (failed delivery): clears the cadet; the reason goes in the event note. */
export async function returnToDispatch(
  db: Db,
  raw: { orderId: number; userId: number; reason: string } & SectorInput,
): Promise<DispatchResult<DispatchOrderData>> {
  const input = returnToDispatchInputSchema.safeParse(raw);
  if (!input.success) return fail("VALIDATION", input.error.issues[0]?.message ?? "Solicitud inválida");
  return move(db, input.data.orderId, input.data.userId, raw.sector, {
    op: "returnToDispatch",
    from: "en_camino",
    to: "listo_despacho",
    refusal: "no se puede devolver a despacho",
    note: input.data.reason,
    patch: () => ({ cadetId: null }),
  });
}

// ---------------------------------------------------------------- assignCadet

export type AssignCadetData = {
  cadet: { id: number; name: string };
  orders: { id: number; number: number; total: number; paymentMethod: "cash" | "transfer"; paymentStatus: "pending" | "paid" }[];
  /** Centavos: sum of the totals of the cash + payment pending orders of THIS assignment. */
  cashToCollect: number;
  count: number;
};

/** Thrown inside the transaction to roll everything back with a ready-made failure. */
class AbortAssign extends Error {
  constructor(readonly failure: DispatchFailure) {
    super("abort-assign");
  }
}

/**
 * Assigns 1..50 listo_despacho DELIVERY orders to one active cadet, all or nothing.
 * Lock order (deadlock-free, and cadet deactivation cannot race with it):
 *   1. the cadet row FOR UPDATE (so `setCadetActive(false)` either runs first and we see
 *      `active = false`, or waits for our commit and then sees the en_camino orders);
 *   2. ALL orders in one `ORDER BY id FOR UPDATE` statement (a deterministic order, so two
 *      overlapping batches cannot lock in opposite orders).
 * If ANY order is invalid nothing changes and `details` lists every offender.
 */
export async function assignCadet(
  db: Db,
  raw: { orderIds: number[]; cadetId: number; userId: number } & SectorInput,
): Promise<DispatchResult<AssignCadetData>> {
  const input = assignCadetInputSchema.safeParse(raw);
  if (!input.success) return fail("VALIDATION", input.error.issues[0]?.message ?? "Solicitud inválida");
  const { orderIds, cadetId, userId } = input.data;

  try {
    return await db.transaction(async (tx): Promise<DispatchResult<AssignCadetData>> => {
      const [cadet] = await tx
        .select({ id: s.cadets.id, name: s.cadets.name, active: s.cadets.active })
        .from(s.cadets)
        .where(eq(s.cadets.id, cadetId))
        .for("update");
      if (!cadet) return fail("CADET_NOT_FOUND", "El cadete no existe");
      if (!cadet.active) return fail("CADET_INACTIVE", `El cadete ${cadet.name} está inactivo y no puede recibir pedidos`);

      const rows = await tx
        .select(orderColumns)
        .from(s.orders)
        .where(inArray(s.orders.id, orderIds))
        .orderBy(s.orders.id)
        .for("update");
      const byId = new Map(rows.map((r) => [r.id, r]));

      const details: DispatchFailureDetail[] = [];
      const codes = new Set<DispatchFailureCode>();
      for (const id of [...orderIds].sort((a, b) => a - b)) {
        const o = byId.get(id);
        if (!o) {
          codes.add("NOT_FOUND");
          details.push({ orderId: id, orderNumber: null, reason: "El pedido no existe" });
        } else if (raw.sector != null && sectorOfFulfillment(o.fulfillment) !== raw.sector) {
          codes.add("WRONG_SECTOR");
          details.push({ orderId: id, orderNumber: o.number, reason: "Es de otro sector: lo gestiona la otra estación" });
        } else if (o.fulfillment !== "delivery") {
          codes.add("NOT_DELIVERY");
          details.push({ orderId: id, orderNumber: o.number, reason: "Es un pedido para retirar: no lleva cadete" });
        } else if (!canTransition(o.status, "en_camino", o.fulfillment)) {
          codes.add("INVALID_TRANSITION");
          details.push({ orderId: id, orderNumber: o.number, reason: `Está ${STATE_LABEL[o.status]}; tiene que estar listo para despacho` });
        }
      }
      if (details.length > 0) {
        const code: DispatchFailureCode = codes.has("NOT_FOUND")
          ? "NOT_FOUND"
          : codes.has("WRONG_SECTOR")
            ? "WRONG_SECTOR"
            : codes.has("NOT_DELIVERY")
              ? "NOT_DELIVERY"
              : "INVALID_TRANSITION";
        const list = details.map((d) => `${d.orderNumber === null ? `#${d.orderId}` : `#${d.orderNumber}`} (${d.reason})`).join("; ");
        return fail(code, `No se asignó ningún pedido. ${list}`, details);
      }

      const ordered = rows; // already ORDER BY id (the lock order)
      for (const o of ordered) {
        const moved = await transitionOrder(tx, { sector: raw.sector,
          orderId: o.id,
          to: "en_camino",
          userId,
          note: `Asignado a ${cadet.name}`,
          event: "assigned",
          patch: { cadetId: cadet.id },
        });
        if (!moved.ok) throw new AbortAssign(fromTransition(moved));
      }

      const out = [...ordered]
        .sort((a, b) => a.id - b.id)
        .map((o) => ({ id: o.id, number: o.number, total: o.total, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus }));
      const cashToCollect = out
        .filter((o) => o.paymentMethod === "cash" && o.paymentStatus === "pending")
        .reduce((sum, o) => sum + o.total, 0);
      return { ok: true, data: { cadet: { id: cadet.id, name: cadet.name }, orders: out, cashToCollect, count: out.length } };
    });
  } catch (err) {
    if (err instanceof AbortAssign) return err.failure;
    return unexpected("assignCadet", err);
  }
}
