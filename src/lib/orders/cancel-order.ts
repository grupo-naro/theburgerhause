import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { pgErrorCode } from "./create-order";
import { rejectReasonSchema } from "./reject-order";
import type { Sector } from "./sector";
import { failure, isId, transitionOrder, UNEXPECTED_MESSAGE, type OrderResult } from "./transition";

/**
 * Cancel / void an order AFTER approval: en_preparacion | listo_despacho | para_retirar -> cancelado
 * (a failed delivery returned to dispatch is listo_despacho again). The reason is MANDATORY (event note).
 * Goes through the locked transition core (row lock, sector rule, audit event, realtime notify).
 * Money is untouched (`payment_status` stays as it was: refunding is a human act outside the app).
 * Print jobs that no agent claimed yet are failed so a ticket of a cancelled order never prints; the
 * Caja ignores failed jobs of cancelled orders. A counter sale frees its pager (the partial unique
 * index only covers the active statuses). An order en_camino cannot be cancelled: it has to come back
 * to dispatch first (the cadet is carrying it). No next/*.
 */

export const CANCELLABLE_STATUSES = ["en_preparacion", "listo_despacho", "para_retirar"] as const;
export const CANCELLED_BEFORE_PRINT_ERROR = "pedido cancelado";

export type CancelOrderInput = { orderId: number; userId: number; reason: string; sector: Sector | null };
export type CancelOrderData = { orderId: number; status: "cancelado" };

export async function cancelOrder(db: Db, raw: CancelOrderInput): Promise<OrderResult<CancelOrderData>> {
  if (!isId(raw.orderId) || !isId(raw.userId)) return failure("VALIDATION", "Solicitud inválida");
  const reason = rejectReasonSchema.safeParse(raw.reason);
  if (!reason.success) return failure("VALIDATION", reason.error.issues[0]?.message ?? "Motivo inválido");

  try {
    return await db.transaction(async (tx): Promise<OrderResult<CancelOrderData>> => {
      const moved = await transitionOrder(tx, {
        orderId: raw.orderId,
        to: "cancelado",
        userId: raw.userId,
        from: [...CANCELLABLE_STATUSES],
        sector: raw.sector,
        note: reason.data,
      });
      if (!moved.ok) return moved;
      await tx
        .update(s.printJobs)
        .set({ status: "failed", error: CANCELLED_BEFORE_PRINT_ERROR, updatedAt: new Date() })
        .where(and(eq(s.printJobs.orderId, raw.orderId), eq(s.printJobs.status, "pending")));
      return { ok: true, data: { orderId: raw.orderId, status: "cancelado" } };
    });
  } catch (err) {
    console.error("[orders] cancelOrder failed", pgErrorCode(err) ?? "");
    return failure("UNEXPECTED", UNEXPECTED_MESSAGE);
  }
}
