import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { DbTransaction } from "@/db/client";
import { businessDateFor } from "@/db/order-number";
import * as s from "@/db/schema";
import { getBusinessDayCutoff } from "@/lib/settings";
import { MILLI_PER_UNIT } from "./quantity";
import { lockStockItems, recordMovement, type LockedStockItem } from "./movements";

/**
 * Automatic drink deduction for orders. No next/* imports; both functions run INSIDE the caller's
 * order transaction. Only units whose product is linked (`products.stock_item_id`) to an ACTIVE
 * item of kind `bebida` are controlled: one unit sold = 1 unit (1000 milli). Everything else sells
 * as before. A sale never leaves the stock below zero. At most one `venta` and one `devolucion`
 * per order/item (the partial unique index on (order_id, item_id, kind) is the backstop).
 */

export type OutOfStock = { ok: false; code: "OUT_OF_STOCK"; productIds: number[]; names: string[] };
export type ReserveStockResult = { ok: true; pauseChanged: boolean } | OutOfStock;

/** "Se agotó Coca-Cola. Sacala del pedido para continuar." / plural for several products. */
export function outOfStockMessage(names: readonly string[]): string {
  if (names.length <= 1) return `Se agotó ${names[0] ?? "un producto"}. Sacala del pedido para continuar.`;
  const list = `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  return `Se agotaron ${list}. Sacalas del pedido para continuar.`;
}

/**
 * Thrown by an order-creating flow inside its transaction when the reserve fails, so the order
 * rows already inserted (and the burned order number) roll back. The flow catches it outside
 * the transaction and returns the OUT_OF_STOCK failure.
 */
export class OutOfStockRollback extends Error {
  constructor(readonly failure: OutOfStock) {
    super("OUT_OF_STOCK");
    this.name = "OutOfStockRollback";
  }
}

const controlled =(item: LockedStockItem | undefined): item is LockedStockItem =>
  item !== undefined && item.active && item.kind === "bebida";

/**
 * Takes the order's controlled drinks off the stock (one `venta` movement per item). The order row
 * must already exist in `tx` (movements reference it). If any controlled product lacks stock,
 * NOTHING is written and OUT_OF_STOCK lists every short product (the caller must then roll back
 * its transaction so the order is not created). Locks every linked item in ONE call.
 */
export async function reserveStockForOrder(
  tx: DbTransaction,
  input: { orderId: number; units: { productId: number }[]; userId?: number | null },
): Promise<ReserveStockResult> {
  const productIds = [...new Set(input.units.map((u) => u.productId))];
  if (productIds.length === 0) return { ok: true, pauseChanged: false };
  const linked = await tx
    .select({ id: s.products.id, name: s.products.name, itemId: s.products.stockItemId })
    .from(s.products)
    .where(and(inArray(s.products.id, productIds), isNotNull(s.products.stockItemId)));
  if (linked.length === 0) return { ok: true, pauseChanged: false };

  const items = await lockStockItems(tx, linked.map((p) => p.itemId!));
  const need = new Map<number, number>();
  const productsOf = new Map<number, { id: number; name: string }[]>();
  const byProduct = new Map(linked.map((p) => [p.id, p]));
  for (const u of input.units) {
    const p = byProduct.get(u.productId);
    if (!p || !controlled(items.get(p.itemId!))) continue;
    need.set(p.itemId!, (need.get(p.itemId!) ?? 0) + MILLI_PER_UNIT);
    const list = productsOf.get(p.itemId!) ?? [];
    if (!list.some((x) => x.id === p.id)) list.push({ id: p.id, name: p.name });
    productsOf.set(p.itemId!, list);
  }
  if (need.size === 0) return { ok: true, pauseChanged: false };

  const short = [...need]
    .filter(([itemId, milli]) => items.get(itemId)!.quantity < milli)
    .flatMap(([itemId]) => productsOf.get(itemId)!)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  if (short.length > 0) {
    return { ok: false, code: "OUT_OF_STOCK", productIds: short.map((p) => p.id), names: short.map((p) => p.name) };
  }

  const [order] = await tx.select({ businessDate: s.orders.businessDate }).from(s.orders).where(eq(s.orders.id, input.orderId));
  if (!order) throw new Error("reserveStockForOrder: order not found in transaction");
  let pauseChanged = false;
  for (const [itemId, milli] of [...need].sort((a, b) => a[0] - b[0])) {
    const r = await recordMovement(tx, {
      item: items.get(itemId)!,
      kind: "venta",
      qtyDelta: -milli,
      businessDate: order.businessDate,
      userId: input.userId ?? null,
      orderId: input.orderId,
    });
    pauseChanged ||= r.pauseChanged;
  }
  return { ok: true, pauseChanged };
}

/**
 * Gives back everything the order took (one `devolucion` per item that has a `venta` and no
 * return yet), so calling it again for the same order is a no-op. Runs inside the rejection /
 * cancellation transaction, after the order row is locked. Returns whether a product's stock
 * pause flipped (the cached public menu must then be refreshed).
 */
export async function returnStockForOrder(
  tx: DbTransaction,
  input: { orderId: number; userId: number | null },
): Promise<{ pauseChanged: boolean }> {
  const sales = await tx
    .select({ itemId: s.stockMovements.itemId, qtyDelta: s.stockMovements.qtyDelta })
    .from(s.stockMovements)
    .where(and(eq(s.stockMovements.orderId, input.orderId), eq(s.stockMovements.kind, "venta")));
  if (sales.length === 0) return { pauseChanged: false };

  const items = await lockStockItems(tx, sales.map((m) => m.itemId));
  // Read AFTER the item locks: a concurrent return of the same order has committed by now.
  const returned = new Set(
    (
      await tx
        .select({ itemId: s.stockMovements.itemId })
        .from(s.stockMovements)
        .where(and(eq(s.stockMovements.orderId, input.orderId), eq(s.stockMovements.kind, "devolucion")))
    ).map((m) => m.itemId),
  );
  const pending = sales.filter((m) => !returned.has(m.itemId) && m.qtyDelta < 0).sort((a, b) => a.itemId - b.itemId);
  if (pending.length === 0) return { pauseChanged: false };

  const businessDate = businessDateFor(new Date(), await getBusinessDayCutoff(tx));
  let pauseChanged = false;
  for (const m of pending) {
    const item = items.get(m.itemId);
    if (!item) continue;
    const r = await recordMovement(tx, {
      item,
      kind: "devolucion",
      qtyDelta: -m.qtyDelta,
      businessDate,
      userId: input.userId,
      orderId: input.orderId,
    });
    pauseChanged ||= r.pauseChanged;
  }
  return { pauseChanged };
}
