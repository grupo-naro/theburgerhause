import { eq, inArray } from "drizzle-orm";
import { z } from "@/lib/zod";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { ORDERS_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import { adjustStockForOrder } from "@/lib/stock/sales";
import type { OrderUnitInput } from "@/lib/cart/types";
import { describeUnitIssues } from "@/lib/checkout/unit-issues";
import { outOfStock, pgErrorCode, type OutOfStockFailure } from "./create-order";
import { insertOrderItems, loadCatalog } from "./order-rows";
import { resolveUnits } from "./resolve-units";
import { decideSector, type Sector } from "./sector";
import { currentStateMessage, failure, UNEXPECTED_MESSAGE, type OrderResult } from "./transition";

/**
 * Cashier edit of an order still waiting for approval: remove items, add units. Existing items keep
 * their snapshot prices; the delivery fee is never recalculated. Stock moves by the NET change.
 * Removed order_items rows are deleted (allowed before approval: nothing was printed or cooked);
 * the audit trail is the order event. All-or-nothing in ONE transaction. No next/* imports.
 */

const id = z.number().int().positive().max(2_147_483_647);
const inputSchema = z.object({ orderId: id, userId: id, removeItemIds: z.array(id).max(200) });

const NOTE_MAX = 500;

export type EditPendingOrderInput = {
  orderId: number;
  userId: number;
  /** Sector of the acting station (null = admin, exempt). */
  sector: Sector | null;
  removeItemIds: number[];
  addUnits: OrderUnitInput[];
};
export type EditPendingOrderData = { orderId: number; subtotal: number; total: number; menuChanged: boolean };

function changeNote(removed: string[], added: string[]): string {
  const parts: string[] = [];
  if (removed.length > 0) parts.push(`Quitó: ${removed.join(", ")}`);
  if (added.length > 0) parts.push(`Agregó: ${added.join(", ")}`);
  const note = `Pedido editado. ${parts.join(". ")}`;
  return note.length <= NOTE_MAX ? note : `${note.slice(0, NOTE_MAX - 1)}…`;
}

export async function editPendingOrder(
  db: Db,
  raw: EditPendingOrderInput,
): Promise<OrderResult<EditPendingOrderData> | OutOfStockFailure> {
  const parsed = inputSchema.safeParse({ orderId: raw.orderId, userId: raw.userId, removeItemIds: raw.removeItemIds });
  if (!parsed.success || !Array.isArray(raw.addUnits)) return failure("VALIDATION", "Solicitud inválida");
  const { orderId, userId } = parsed.data;
  const removeIds = [...new Set(parsed.data.removeItemIds)];
  const addUnits = raw.addUnits;
  if (removeIds.length === 0 && addUnits.length === 0) return failure("VALIDATION", "No hay cambios para guardar");

  try {
    return await db.transaction(async (tx): Promise<OrderResult<EditPendingOrderData> | OutOfStockFailure> => {
      const [order] = await tx
        .select({ status: s.orders.status, fulfillment: s.orders.fulfillment, deliveryFee: s.orders.deliveryFee })
        .from(s.orders)
        .where(eq(s.orders.id, orderId))
        .for("update");
      if (!order) return failure("NOT_FOUND", "El pedido no existe");
      const sectorOk = decideSector(raw.sector, order.fulfillment);
      if (!sectorOk.ok) return failure("WRONG_SECTOR", sectorOk.message);
      if (order.status !== "pendiente_aprobacion") return failure("INVALID_STATE", currentStateMessage(order.status));

      const current = await tx
        .select({ id: s.orderItems.id, productId: s.orderItems.productId, name: s.orderItems.nameSnapshot })
        .from(s.orderItems)
        .where(eq(s.orderItems.orderId, orderId));
      const byId = new Map(current.map((i) => [i.id, i]));
      if (removeIds.some((rid) => !byId.has(rid))) return failure("VALIDATION", "Algún producto ya no es parte del pedido");
      if (current.length - removeIds.length + addUnits.length < 1) {
        return failure("VALIDATION", "El pedido no puede quedar sin productos. Rechazalo si no se va a hacer.");
      }

      let resolvedUnits: Awaited<ReturnType<typeof resolveUnits>> & { ok: true } = { ok: true, units: [] };
      if (addUnits.length > 0) {
        const catalog = await loadCatalog(tx, [...new Set(addUnits.map((u) => u.productId))]);
        const resolved = resolveUnits(addUnits, catalog);
        if (!resolved.ok) {
          const names = new Map([...catalog].map(([pid, p]) => [pid, p.name]));
          return failure("VALIDATION", describeUnitIssues(resolved.issues, addUnits, names).join(" "));
        }
        resolvedUnits = resolved;
      }

      const removed = removeIds.map((rid) => byId.get(rid)!);
      // Items whose product was deleted (null productId) move no stock.
      const stock = await adjustStockForOrder(tx, {
        orderId,
        add: resolvedUnits.units.map((u) => ({ productId: u.product.id })),
        remove: removed.flatMap((i) => (i.productId === null ? [] : [{ productId: i.productId }])),
        userId,
      });
      if (!stock.ok) return outOfStock(stock);

      if (removeIds.length > 0) await tx.delete(s.orderItems).where(inArray(s.orderItems.id, removeIds));
      if (resolvedUnits.units.length > 0) await insertOrderItems(tx, orderId, resolvedUnits.units);

      const rows = await tx
        .select({ id: s.orderItems.id, price: s.orderItems.unitPriceSnapshot })
        .from(s.orderItems)
        .where(eq(s.orderItems.orderId, orderId));
      const ids = rows.map((r) => r.id);
      const mods = ids.length === 0 ? [] : await tx.select({ delta: s.orderItemModifiers.priceDelta }).from(s.orderItemModifiers).where(inArray(s.orderItemModifiers.orderItemId, ids));
      const subtotal = rows.reduce((a, r) => a + r.price, 0) + mods.reduce((a, m) => a + m.delta, 0);
      const total = subtotal + order.deliveryFee;
      await tx.update(s.orders).set({ subtotal, total }).where(eq(s.orders.id, orderId));

      await tx.insert(s.orderEvents).values({
        orderId,
        fromStatus: order.status,
        toStatus: order.status,
        userId,
        note: changeNote(removed.map((i) => i.name), resolvedUnits.units.map((u) => u.product.name)),
      });
      await notifyInTx(tx, ORDERS_CHANNEL, { orderId, status: order.status, event: "updated" });

      return { ok: true, data: { orderId, subtotal, total, menuChanged: stock.pauseChanged } };
    });
  } catch (err) {
    console.error("[orders] editPendingOrder failed", pgErrorCode(err) ?? "");
    return failure("UNEXPECTED", UNEXPECTED_MESSAGE);
  }
}
