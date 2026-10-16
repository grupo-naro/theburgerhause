import { z } from "zod";
import type { Db } from "@/db/client";
import { pgErrorCode } from "./create-order";
import { cleanText } from "./schemas";
import type { Sector } from "./sector";
import { failure, transitionOrder, UNEXPECTED_MESSAGE, type OrderResult } from "./transition";

/** Cashier rejection: pendiente_aprobacion -> cancelado with a reason. No print jobs. No next/*. */

export const rejectReasonSchema = z
  .string({ error: "Indicá el motivo del rechazo" })
  .transform(cleanText)
  .pipe(
    z
      .string()
      .min(3, "El motivo es demasiado corto")
      .max(200, "El motivo es demasiado largo"),
  );

const id = z.number().int().positive().max(2_147_483_647);
const inputSchema = z.object({ orderId: id, userId: id });

export type RejectOrderInput = { orderId: number; userId: number; reason: string; sector?: Sector | null };
export type RejectOrderData = { orderId: number; status: "cancelado" };

export async function rejectOrder(db: Db, raw: RejectOrderInput): Promise<OrderResult<RejectOrderData>> {
  const ids = inputSchema.safeParse(raw);
  if (!ids.success) return failure("VALIDATION", "Solicitud inválida");
  const reason = rejectReasonSchema.safeParse(raw.reason);
  if (!reason.success) return failure("VALIDATION", reason.error.issues[0]?.message ?? "Motivo inválido");

  try {
    return await db.transaction(async (tx): Promise<OrderResult<RejectOrderData>> => {
      const moved = await transitionOrder(tx, {
        orderId: ids.data.orderId,
        to: "cancelado",
        userId: ids.data.userId,
        from: ["pendiente_aprobacion"],
        sector: raw.sector,
        note: reason.data,
      });
      if (!moved.ok) return moved;
      return { ok: true, data: { orderId: ids.data.orderId, status: "cancelado" } };
    });
  } catch (err) {
    console.error("[orders] rejectOrder failed", pgErrorCode(err) ?? "");
    return failure("UNEXPECTED", UNEXPECTED_MESSAGE);
  }
}
