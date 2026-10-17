import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { pgErrorCode } from "./create-order";
import { decideSector, type Sector } from "./sector";
import { enqueuePrintJobs, loadPrintableOrder } from "./print-jobs";
import { defaultPrintKinds } from "./print-kinds";
import { failure, isId, transitionOrder, UNEXPECTED_MESSAGE, type OrderResult } from "./transition";

/**
 * Cashier approval: pendiente_aprobacion -> en_preparacion, payment rule, and the two print
 * jobs for the approving station (Delivery kind: delivery + customer ticket; Mostrador kind: customer ticket only), all in ONE transaction.
 * No next/* imports.
 */

const id = z.number().int().positive().max(2_147_483_647);
const inputSchema = z.object({ orderId: id, userId: id, paymentVerified: z.boolean() });

export const STATION_REQUIRED_MESSAGE = "Elegí tu estación para imprimir";
export const PAYMENT_NOT_VERIFIED_MESSAGE = "Confirmá que verificaste la acreditación del pago";

export type ApproveOrderInput = {
  orderId: number;
  userId: number;
  stationId: number | null;
  paymentVerified: boolean;
  /** Sector of the approving station (null/undefined = admin, exempt). */
  sector: Sector | null;
};
export type ApproveOrderData = {
  orderId: number;
  number: number;
  status: "en_preparacion";
  paymentStatus: "pending" | "paid";
  printJobIds: number[];
};

export async function approveOrder(db: Db, raw: ApproveOrderInput): Promise<OrderResult<ApproveOrderData>> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return failure("VALIDATION", "Solicitud inválida");
  const { orderId, userId, paymentVerified } = parsed.data;
  if (!isId(raw.stationId)) return failure("STATION_REQUIRED", STATION_REQUIRED_MESSAGE);
  const stationId = raw.stationId;

  try {
    return await db.transaction(async (tx): Promise<OrderResult<ApproveOrderData>> => {
      const [station] = await tx.select({ id: s.stations.id, kind: s.stations.kind }).from(s.stations).where(eq(s.stations.id, stationId));
      if (!station) return failure("STATION_REQUIRED", STATION_REQUIRED_MESSAGE);

      // Lock first: the payment rule depends on the method, and a double approve queues here.
      const [locked] = await tx
        .select({ status: s.orders.status, paymentMethod: s.orders.paymentMethod, fulfillment: s.orders.fulfillment })
        .from(s.orders)
        .where(eq(s.orders.id, orderId))
        .for("update");
      // Sector first: the wrong station must not even learn about (or be nagged for) the payment rule.
      if (locked) {
        const sectorOk = decideSector(raw.sector, locked.fulfillment);
        if (!sectorOk.ok) return failure("WRONG_SECTOR", sectorOk.message);
      }
      const isTransfer = locked?.paymentMethod === "transfer";
      if (locked?.status === "pendiente_aprobacion" && isTransfer && !paymentVerified) {
        return failure("VALIDATION", PAYMENT_NOT_VERIFIED_MESSAGE);
      }

      const moved = await transitionOrder(tx, { sector: raw.sector,
        orderId,
        to: "en_preparacion",
        userId,
        from: ["pendiente_aprobacion"],
        patch: {
          approvedBy: userId,
          approvedAt: new Date(),
          stationId,
          ...(isTransfer ? { paymentStatus: "paid" as const } : {}),
        },
      });
      if (!moved.ok) return moved;

      // Snapshot rows read AFTER the update so the ticket shows the final payment state.
      const printable = await loadPrintableOrder(tx, orderId);
      if (!printable) throw new Error("order vanished inside transaction");
      const printJobIds = await enqueuePrintJobs(tx, { orderId, stationId, kinds: defaultPrintKinds(station.kind, printable), printable });

      return {
        ok: true,
        data: {
          orderId,
          number: printable.number,
          status: "en_preparacion",
          paymentStatus: moved.data.order.paymentStatus,
          printJobIds,
        },
      };
    });
  } catch (err) {
    console.error("[orders] approveOrder failed", pgErrorCode(err) ?? "");
    return failure("UNEXPECTED", UNEXPECTED_MESSAGE);
  }
}
