import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { ORDERS_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import { STATION_REQUIRED_MESSAGE } from "./approve-order";
import { pgErrorCode } from "./create-order";
import { decideSector, type Sector } from "./sector";
import { enqueuePrintJobs, loadPrintableOrder } from "./print-jobs";
import { currentStateMessage, failure, isId, UNEXPECTED_MESSAGE, type OrderResult } from "./transition";

/**
 * Manual reprint of an already approved order at the CURRENT station. The status is kept
 * (no transition), but an audit event and an `updated` realtime hint are recorded. No next/*.
 */

const id = z.number().int().positive().max(2_147_483_647);
const inputSchema = z.object({ orderId: id, userId: id, which: z.enum(["kitchen", "ticket", "both"]) });

export type ReprintOrderInput = {
  orderId: number;
  userId: number;
  stationId: number | null;
  which: "kitchen" | "ticket" | "both";
  /** Sector of the acting station (null/undefined = admin, exempt). */
  sector?: Sector | null;
};
export type ReprintOrderData = { orderId: number; printJobIds: number[] };

export async function reprintOrder(db: Db, raw: ReprintOrderInput): Promise<OrderResult<ReprintOrderData>> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return failure("VALIDATION", "Solicitud inválida");
  const { orderId, userId, which } = parsed.data;
  if (!isId(raw.stationId)) return failure("STATION_REQUIRED", STATION_REQUIRED_MESSAGE);
  const stationId = raw.stationId;

  try {
    return await db.transaction(async (tx): Promise<OrderResult<ReprintOrderData>> => {
      const [station] = await tx.select({ id: s.stations.id }).from(s.stations).where(eq(s.stations.id, stationId));
      if (!station) return failure("STATION_REQUIRED", STATION_REQUIRED_MESSAGE);

      const [order] = await tx
        .select({ status: s.orders.status, fulfillment: s.orders.fulfillment })
        .from(s.orders)
        .where(eq(s.orders.id, orderId))
        .for("update");
      if (!order) return failure("NOT_FOUND", "El pedido no existe");
      const sectorOk = decideSector(raw.sector, order.fulfillment);
      if (!sectorOk.ok) return failure("WRONG_SECTOR", sectorOk.message);
      if (order.status === "pendiente_aprobacion" || order.status === "cancelado") {
        return failure(
          "INVALID_TRANSITION",
          order.status === "cancelado" ? currentStateMessage("cancelado") : "Primero aprobá el pedido para imprimirlo",
        );
      }

      const printable = await loadPrintableOrder(tx, orderId);
      if (!printable) throw new Error("order vanished inside transaction");
      const printJobIds = await enqueuePrintJobs(tx, { orderId, stationId, which, printable });

      await tx.insert(s.orderEvents).values({
        orderId,
        fromStatus: order.status,
        toStatus: order.status,
        userId,
        note: `Reimpresión (${which})`,
      });
      await notifyInTx(tx, ORDERS_CHANNEL, { orderId, status: order.status, event: "updated" });

      return { ok: true, data: { orderId, printJobIds } };
    });
  } catch (err) {
    console.error("[orders] reprintOrder failed", pgErrorCode(err) ?? "");
    return failure("UNEXPECTED", UNEXPECTED_MESSAGE);
  }
}
