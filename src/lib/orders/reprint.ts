import { and, eq } from "drizzle-orm";
import { z } from "@/lib/zod";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { ORDERS_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import { STATION_REQUIRED_MESSAGE } from "./approve-order";
import { pgErrorCode } from "./create-order";
import { decideSector, type Sector } from "./sector";
import { enqueueAddonPrintJobs, enqueuePrintJobs, loadPrintableOrder } from "./print-jobs";
import { resolvePrintKinds, type PrintWhich } from "./print-kinds";
import { currentStateMessage, failure, isId, UNEXPECTED_MESSAGE, type OrderResult } from "./transition";

/**
 * Manual reprint of an already approved order at the CURRENT station. The status is kept
 * (no transition), but an audit event and an `updated` realtime hint are recorded. No next/*.
 */

const id = z.number().int().positive().max(2_147_483_647);
const inputSchema = z.object({ orderId: id, userId: id, which: z.enum(["kitchen", "customer", "delivery", "both"]) });

export const NO_DELIVERY_TICKET_MESSAGE = "Este pedido no es un delivery: no tiene ticket de delivery";

export type ReprintOrderInput = {
  orderId: number;
  userId: number;
  stationId: number | null;
  which: PrintWhich;
  /** Sector of the acting station (null/undefined = admin, exempt). */
  sector: Sector | null;
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
      const [station] = await tx.select({ id: s.stations.id, kind: s.stations.kind }).from(s.stations).where(eq(s.stations.id, stationId));
      if (!station) return failure("STATION_REQUIRED", STATION_REQUIRED_MESSAGE);

      const [order] = await tx
        .select({ status: s.orders.status, fulfillment: s.orders.fulfillment, channel: s.orders.channel })
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

      const kinds = resolvePrintKinds(which, station.kind, order);
      if (!kinds) return failure("VALIDATION", NO_DELIVERY_TICKET_MESSAGE);

      const printable = await loadPrintableOrder(tx, orderId);
      if (!printable) throw new Error("order vanished inside transaction");
      const printJobIds = await enqueuePrintJobs(tx, { orderId, stationId, kinds, printable });

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

export type ReprintAddonInput = { orderId: number; addonSeq: number; userId: number; stationId: number | null; sector: Sector | null };
const addonInputSchema = z.object({ orderId: id, addonSeq: z.number().int().positive().max(32_767), userId: id });

/** Reprints the kitchen comanda of ONE confirmed add-on at the CURRENT station (never the delivery ticket). */
export async function reprintAddonTicket(db: Db, raw: ReprintAddonInput): Promise<OrderResult<ReprintOrderData>> {
  const parsed = addonInputSchema.safeParse(raw);
  if (!parsed.success) return failure("VALIDATION", "Solicitud inválida");
  const { orderId, addonSeq, userId } = parsed.data;
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

      const [addon] = await tx
        .select({ id: s.orderAddons.id })
        .from(s.orderAddons)
        .where(and(eq(s.orderAddons.orderId, orderId), eq(s.orderAddons.seq, addonSeq), eq(s.orderAddons.status, "confirmado")));
      if (!addon) return failure("NOT_FOUND", "El adicional no existe");

      const printJobIds = await enqueueAddonPrintJobs(tx, { orderId, addonId: addon.id, seq: addonSeq, stationId, withDelivery: false });
      await tx.insert(s.orderEvents).values({
        orderId,
        fromStatus: order.status,
        toStatus: order.status,
        userId,
        note: `Reimpresión (adicional ${addonSeq})`,
      });
      await notifyInTx(tx, ORDERS_CHANNEL, { orderId, status: order.status, event: "updated" });
      return { ok: true, data: { orderId, printJobIds } };
    });
  } catch (err) {
    console.error("[orders] reprintAddonTicket failed", pgErrorCode(err) ?? "");
    return failure("UNEXPECTED", UNEXPECTED_MESSAGE);
  }
}
