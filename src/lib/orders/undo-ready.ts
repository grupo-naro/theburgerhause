import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { canUndoReady } from "@/domain/order-status";
import { fail, fromTransition, STATE_LABEL, unexpected, type DispatchOrderData, type DispatchResult, type SectorInput } from "./dispatch";
import { orderIdInputSchema } from "./dispatch-schemas";
import { decideSector } from "./sector";
import { transitionOrder } from "./transition";

/**
 * Kitchen "Deshacer" / "Volver a preparación": listo_despacho -> en_preparacion, audited in order_events.
 * Allowed only while nobody acted on the ready order: once the pager was called (para_retirar) the customer
 * was told, with a cadet (en_camino) it left, and later states are history. Same shape as the other dispatch
 * operations: ONE transaction, state validated INSIDE it under the row lock, through the locked transition core.
 */

export const UNDO_READY_NOTE = "Deshacer listo (cocina)";

export async function undoReady(db: Db, raw: { orderId: number; userId: number } & SectorInput): Promise<DispatchResult<DispatchOrderData>> {
  const input = orderIdInputSchema.safeParse(raw);
  if (!input.success) return fail("VALIDATION", "Solicitud inválida");
  const { orderId, userId } = input.data;
  try {
    return await db.transaction(async (tx): Promise<DispatchResult<DispatchOrderData>> => {
      const [o] = await tx
        .select({ id: s.orders.id, number: s.orders.number, status: s.orders.status, fulfillment: s.orders.fulfillment, cadetId: s.orders.cadetId })
        .from(s.orders)
        .where(eq(s.orders.id, orderId))
        .for("update");
      if (!o) return fail("NOT_FOUND", "El pedido no existe");
      const sectorOk = decideSector(raw.sector, o.fulfillment);
      if (!sectorOk.ok) return fail("WRONG_SECTOR", sectorOk.message);
      if (o.status === "para_retirar") {
        return fail("INVALID_TRANSITION", `El pedido #${o.number} ya fue avisado para retirar: no se puede volver a preparación.`);
      }
      if (!canUndoReady(o.status) || o.cadetId !== null) {
        return fail("INVALID_TRANSITION", `El pedido #${o.number} está ${STATE_LABEL[o.status]}; ya no se puede volver a preparación.`);
      }
      const moved = await transitionOrder(tx, { sector: raw.sector, orderId, to: "en_preparacion", userId, note: UNDO_READY_NOTE, undo: true });
      if (!moved.ok) return fromTransition(moved);
      return { ok: true, data: { orderId, number: o.number, status: "en_preparacion", paymentStatus: moved.data.order.paymentStatus } };
    });
  } catch (err) {
    return unexpected("undoReady", err);
  }
}
