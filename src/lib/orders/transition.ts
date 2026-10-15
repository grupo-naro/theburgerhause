import { eq } from "drizzle-orm";
import type { DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { canTransition, type Fulfillment, type OrderStatus } from "@/domain/order-status";
import { ORDERS_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";

/**
 * Generic, reusable order state transition. No next/* imports. MUST run inside the caller's
 * transaction: it locks the order row (FOR UPDATE), validates against the DOMAIN state machine,
 * updates status (+ whitelisted patch) in ONE statement, writes the audit event and queues the
 * realtime notification (delivered only if the caller's transaction commits).
 */

export type OrderFailureCode = "NOT_FOUND" | "INVALID_TRANSITION" | "VALIDATION" | "STATION_REQUIRED" | "UNEXPECTED";
export type OrderFailure = { ok: false; code: OrderFailureCode; message: string };
export type OrderResult<T> = { ok: true; data: T } | OrderFailure;

export const failure = (code: OrderFailureCode, message: string): OrderFailure => ({ ok: false, code, message });

export const UNEXPECTED_MESSAGE = "No se pudo completar la acción. Probá de nuevo.";
const INT4_MAX = 2_147_483_647;
export const isId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0 && (n as number) <= INT4_MAX;

const CURRENT_STATE_MESSAGE: Record<OrderStatus, string> = {
  pendiente_aprobacion: "Este pedido está pendiente de aprobación",
  en_preparacion: "Este pedido ya está en preparación",
  listo_despacho: "Este pedido ya está listo para despacho",
  en_camino: "Este pedido ya está en camino",
  para_retirar: "Este pedido ya está listo para retirar",
  entregado: "Este pedido ya fue entregado",
  cancelado: "Este pedido fue cancelado",
};
export const currentStateMessage = (status: OrderStatus): string => CURRENT_STATE_MESSAGE[status];

/** Only these columns may ride along with a transition (never status/number/totals...). */
export type TransitionPatch = Partial<
  Pick<
    typeof s.orders.$inferInsert,
    "paymentStatus" | "approvedBy" | "approvedAt" | "stationId" | "deliveredAt" | "cadetId"
  >
>;
const PATCH_KEYS = ["paymentStatus", "approvedBy", "approvedAt", "stationId", "deliveredAt", "cadetId"] as const;

export type TransitionInput = {
  orderId: number;
  to: OrderStatus;
  userId: number;
  note?: string | null;
  /** Extra allow-list on the CURRENT status, on top of the domain table. */
  from?: OrderStatus[];
  patch?: TransitionPatch;
};
export type TransitionedOrder = {
  id: number;
  status: OrderStatus;
  fulfillment: Fulfillment;
  paymentMethod: "cash" | "transfer";
  paymentStatus: "pending" | "paid";
};

export async function transitionOrder(
  tx: DbTransaction,
  input: TransitionInput,
): Promise<OrderResult<{ order: TransitionedOrder }>> {
  const { orderId, to, userId } = input;
  if (!isId(orderId)) return failure("VALIDATION", "Pedido inválido");

  const [current] = await tx
    .select({ status: s.orders.status, fulfillment: s.orders.fulfillment })
    .from(s.orders)
    .where(eq(s.orders.id, orderId))
    .for("update");
  if (!current) return failure("NOT_FOUND", "El pedido no existe");

  const allowed = canTransition(current.status, to, current.fulfillment) && (!input.from || input.from.includes(current.status));
  if (!allowed) return failure("INVALID_TRANSITION", currentStateMessage(current.status));

  const patch: TransitionPatch = {};
  for (const k of PATCH_KEYS) if (input.patch && input.patch[k] !== undefined) (patch as Record<string, unknown>)[k] = input.patch[k];

  const [updated] = await tx
    .update(s.orders)
    .set({ ...patch, status: to })
    .where(eq(s.orders.id, orderId))
    .returning({
      id: s.orders.id,
      status: s.orders.status,
      fulfillment: s.orders.fulfillment,
      paymentMethod: s.orders.paymentMethod,
      paymentStatus: s.orders.paymentStatus,
    });

  await tx.insert(s.orderEvents).values({
    orderId,
    fromStatus: current.status,
    toStatus: to,
    userId,
    note: input.note ?? null,
  });
  await notifyInTx(tx, ORDERS_CHANNEL, { orderId, status: to, event: "status" });

  return { ok: true, data: { order: updated } };
}
