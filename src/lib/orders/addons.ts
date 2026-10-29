import { and, eq, sql } from "drizzle-orm";
import { z } from "@/lib/zod";
import type { Db, DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { formatARS } from "@/domain/money";
import type { OrderStatus } from "@/domain/order-status";
import { ORDERS_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import { adjustStockForOrder } from "@/lib/stock/sales";
import type { OrderUnitInput } from "@/lib/cart/types";
import { describeUnitIssues } from "@/lib/checkout/unit-issues";
import { outOfStock, pgErrorCode, type OutOfStockFailure } from "./create-order";
import { insertOrderItems, loadCatalog } from "./order-rows";
import { enqueueAddonPrintJobs } from "./print-jobs";
import { resolveUnits, type ResolvedUnit } from "./resolve-units";
import { decideSector, type Sector } from "./sector";
import { currentStateMessage, failure, UNEXPECTED_MESSAGE, type OrderResult } from "./transition";
import { PAYMENT_NOT_VERIFIED_MESSAGE } from "./approve-order";

/**
 * Add-ons: extra products added to an order that is already en_preparacion. Web transfer orders need the
 * cashier to verify the payment first (the add-on waits as `pendiente_pago`, touching nothing else); web cash
 * and counter orders are confirmed right away. Confirming inserts the items, raises subtotal/total, moves stock
 * by the add-on only and queues the additional ticket. Always ONE transaction under the order's row lock.
 * No next/* imports.
 */

const id = z.number().int().positive().max(2_147_483_647);
const NOTE_MAX = 500;

export type AddonStatus = "confirmado" | "pendiente_pago";

// Persisted snapshot of the priced units (what insertOrderItems needs), re-validated when read back.
const modifierSchema = z.object({
  id: z.number().int(),
  groupId: z.number().int(),
  name: z.string(),
  kind: z.enum(["remove", "add", "swap"]),
  priceDelta: z.number().int(),
  kitchenLabel: z.string(),
  active: z.boolean(),
});
const storedUnitsSchema = z.array(
  z.object({
    product: z.object({
      id: z.number().int(),
      name: z.string(),
      price: z.number().int(),
      active: z.boolean(),
      categoryActive: z.boolean(),
      modifiers: z.array(modifierSchema),
    }),
    modifiers: z.array(modifierSchema),
    note: z.string(),
    unitTotal: z.number().int(),
  }),
);

type LockedOrder = {
  status: OrderStatus;
  fulfillment: "delivery" | "takeaway";
  paymentMethod: "cash" | "transfer";
  channel: "web" | "counter";
  stationId: number | null;
  deliveryFee: number;
};

const orderCols = {
  status: s.orders.status,
  fulfillment: s.orders.fulfillment,
  paymentMethod: s.orders.paymentMethod,
  channel: s.orders.channel,
  stationId: s.orders.stationId,
  deliveryFee: s.orders.deliveryFee,
};

const clip = (note: string) => (note.length <= NOTE_MAX ? note : `${note.slice(0, NOTE_MAX - 1)}…`);

/**
 * Applies a confirmed add-on inside the caller's transaction (order already locked and validated): stock first
 * (writes nothing on shortage), then the add-on row via `persist`, items, totals, ticket, event and notify.
 */
async function applyConfirmed(
  tx: DbTransaction,
  args: {
    orderId: number;
    order: LockedOrder;
    userId: number;
    units: ResolvedUnit[];
    subtotal: number;
    seq: number;
    persist: () => Promise<number>;
  },
): Promise<{ ok: true; addonId: number; menuChanged: boolean } | OutOfStockFailure | { ok: false; code: "UNEXPECTED"; message: string }> {
  const { orderId, order, userId, units, subtotal, seq } = args;
  const stock = await adjustStockForOrder(tx, { orderId, add: units.map((u) => ({ productId: u.product.id })), remove: [], userId });
  if (!stock.ok) return outOfStock(stock);
  if (order.stationId === null) return { ok: false, code: "UNEXPECTED", message: UNEXPECTED_MESSAGE };

  const addonId = await args.persist();
  await insertOrderItems(tx, orderId, units, { addonId });
  // Totals first: the delivery ticket re-enqueued below reads orders.total.
  await tx
    .update(s.orders)
    .set({ subtotal: sql`${s.orders.subtotal} + ${subtotal}`, total: sql`${s.orders.total} + ${subtotal}` })
    .where(eq(s.orders.id, orderId));
  await enqueueAddonPrintJobs(tx, { orderId, addonId, seq, stationId: order.stationId });
  await tx.insert(s.orderEvents).values({
    orderId,
    fromStatus: order.status,
    toStatus: order.status,
    userId,
    note: clip(`Adicional ${seq} agregado (+${formatARS(subtotal)})`),
  });
  await notifyInTx(tx, ORDERS_CHANNEL, { orderId, status: order.status, event: "updated" });
  return { ok: true, addonId, menuChanged: stock.pauseChanged };
}

// ---------------------------------------------------------------- addOrderAddon

export type AddOrderAddonInput = {
  orderId: number;
  userId: number;
  /** Sector of the acting station (null = admin, exempt). */
  sector: Sector | null;
  units: OrderUnitInput[];
  idempotencyKey: string;
};
export type AddOrderAddonData = { addonId: number; seq: number; status: AddonStatus; subtotal: number; menuChanged: boolean };

export async function addOrderAddon(db: Db, raw: AddOrderAddonInput): Promise<OrderResult<AddOrderAddonData> | OutOfStockFailure> {
  const parsed = z.object({ orderId: id, userId: id, key: z.string().min(1).max(200) }).safeParse({ orderId: raw.orderId, userId: raw.userId, key: raw.idempotencyKey });
  if (!parsed.success || !Array.isArray(raw.units) || raw.units.length === 0) return failure("VALIDATION", "Solicitud inválida");
  const { orderId, userId, key } = parsed.data;
  const inputUnits = raw.units;

  try {
    return await db.transaction(async (tx): Promise<OrderResult<AddOrderAddonData> | OutOfStockFailure> => {
      const [order] = await tx.select(orderCols).from(s.orders).where(eq(s.orders.id, orderId)).for("update");
      if (!order) return failure("NOT_FOUND", "El pedido no existe");
      const sectorOk = decideSector(raw.sector, order.fulfillment);
      if (!sectorOk.ok) return failure("WRONG_SECTOR", sectorOk.message);

      // A retry with the same key returns the existing add-on (checked under the lock, before the state rule).
      const [dup] = await tx.select().from(s.orderAddons).where(eq(s.orderAddons.idempotencyKey, key));
      if (dup) {
        if (dup.orderId !== orderId) return failure("VALIDATION", "Solicitud inválida");
        return { ok: true, data: { addonId: dup.id, seq: dup.seq, status: dup.status as AddonStatus, subtotal: dup.subtotal, menuChanged: false } };
      }
      if (order.status !== "en_preparacion") return failure("INVALID_STATE", currentStateMessage(order.status));

      const catalog = await loadCatalog(tx, [...new Set(inputUnits.map((u) => u.productId))]);
      const resolved = resolveUnits(inputUnits, catalog);
      if (!resolved.ok) {
        const names = new Map([...catalog].map(([pid, p]) => [pid, p.name]));
        return failure("VALIDATION", describeUnitIssues(resolved.issues, inputUnits, names).join(" "));
      }
      const units = resolved.units;
      const subtotal = units.reduce((a, u) => a + u.unitTotal, 0);
      const [{ max }] = await tx
        .select({ max: sql<number>`coalesce(max(${s.orderAddons.seq}), 0)::int` })
        .from(s.orderAddons)
        .where(eq(s.orderAddons.orderId, orderId));
      const seq = max + 1;

      const needsConfirmation = order.paymentMethod === "transfer" && order.channel === "web";
      if (needsConfirmation) {
        const [row] = await tx
          .insert(s.orderAddons)
          .values({ orderId, seq, status: "pendiente_pago", units, subtotal, idempotencyKey: key, createdBy: userId })
          .returning({ id: s.orderAddons.id });
        await tx.insert(s.orderEvents).values({
          orderId,
          fromStatus: order.status,
          toStatus: order.status,
          userId,
          note: clip(`Adicional ${seq} pendiente de pago (+${formatARS(subtotal)})`),
        });
        await notifyInTx(tx, ORDERS_CHANNEL, { orderId, status: order.status, event: "updated" });
        return { ok: true, data: { addonId: row.id, seq, status: "pendiente_pago", subtotal, menuChanged: false } };
      }

      const applied = await applyConfirmed(tx, {
        orderId,
        order,
        userId,
        units,
        subtotal,
        seq,
        persist: async () => {
          const [row] = await tx
            .insert(s.orderAddons)
            .values({ orderId, seq, status: "confirmado", units, subtotal, idempotencyKey: key, createdBy: userId, confirmedBy: userId, confirmedAt: new Date() })
            .returning({ id: s.orderAddons.id });
          return row.id;
        },
      });
      if (!applied.ok) return applied;
      return { ok: true, data: { addonId: applied.addonId, seq, status: "confirmado", subtotal, menuChanged: applied.menuChanged } };
    });
  } catch (err) {
    console.error("[orders] addOrderAddon failed", pgErrorCode(err) ?? "");
    return failure("UNEXPECTED", UNEXPECTED_MESSAGE);
  }
}

// ---------------------------------------------------------------- confirmAddon

export type ConfirmAddonInput = { addonId: number; userId: number; sector: Sector | null; paymentVerified: boolean };
export type ConfirmAddonData = { addonId: number; seq: number; menuChanged: boolean };

export async function confirmAddon(db: Db, raw: ConfirmAddonInput): Promise<OrderResult<ConfirmAddonData> | OutOfStockFailure> {
  const parsed = z.object({ addonId: id, userId: id, paymentVerified: z.boolean() }).safeParse(raw);
  if (!parsed.success) return failure("VALIDATION", "Solicitud inválida");
  const { addonId, userId, paymentVerified } = parsed.data;

  try {
    return await db.transaction(async (tx): Promise<OrderResult<ConfirmAddonData> | OutOfStockFailure> => {
      const [probe] = await tx.select({ orderId: s.orderAddons.orderId }).from(s.orderAddons).where(eq(s.orderAddons.id, addonId));
      if (!probe) return failure("NOT_FOUND", "El adicional no existe");
      const orderId = probe.orderId;
      const [order] = await tx.select(orderCols).from(s.orders).where(eq(s.orders.id, orderId)).for("update");
      if (!order) return failure("NOT_FOUND", "El pedido no existe");
      const sectorOk = decideSector(raw.sector, order.fulfillment);
      if (!sectorOk.ok) return failure("WRONG_SECTOR", sectorOk.message);

      const [addon] = await tx.select().from(s.orderAddons).where(eq(s.orderAddons.id, addonId));
      if (!addon) return failure("NOT_FOUND", "El adicional no existe");
      if (addon.status !== "pendiente_pago") return failure("INVALID_STATE", "Este adicional ya no está pendiente de pago");
      if (order.status !== "en_preparacion") return failure("INVALID_STATE", currentStateMessage(order.status));
      if (!paymentVerified) return failure("VALIDATION", PAYMENT_NOT_VERIFIED_MESSAGE);

      const stored = storedUnitsSchema.safeParse(addon.units);
      if (!stored.success) {
        console.error("[orders] confirmAddon: stored units are invalid");
        return failure("UNEXPECTED", UNEXPECTED_MESSAGE);
      }
      const applied = await applyConfirmed(tx, {
        orderId,
        order,
        userId,
        units: stored.data,
        subtotal: addon.subtotal,
        seq: addon.seq,
        persist: async () => {
          await tx
            .update(s.orderAddons)
            .set({ status: "confirmado", confirmedBy: userId, confirmedAt: new Date() })
            .where(and(eq(s.orderAddons.id, addonId), eq(s.orderAddons.status, "pendiente_pago")));
          return addonId;
        },
      });
      if (!applied.ok) return applied;
      return { ok: true, data: { addonId, seq: addon.seq, menuChanged: applied.menuChanged } };
    });
  } catch (err) {
    console.error("[orders] confirmAddon failed", pgErrorCode(err) ?? "");
    return failure("UNEXPECTED", UNEXPECTED_MESSAGE);
  }
}

// ---------------------------------------------------------------- cancelAddon

export type CancelAddonInput = { addonId: number; userId: number; sector: Sector | null; reason: string | null };

export async function cancelAddon(db: Db, raw: CancelAddonInput): Promise<OrderResult<{ addonId: number }>> {
  const parsed = z.object({ addonId: id, userId: id, reason: z.string().trim().max(NOTE_MAX).nullable() }).safeParse({ addonId: raw.addonId, userId: raw.userId, reason: raw.reason });
  if (!parsed.success) return failure("VALIDATION", "Solicitud inválida");
  const { addonId, userId } = parsed.data;
  const reason = parsed.data.reason || null;

  try {
    return await db.transaction(async (tx): Promise<OrderResult<{ addonId: number }>> => {
      const [probe] = await tx.select({ orderId: s.orderAddons.orderId }).from(s.orderAddons).where(eq(s.orderAddons.id, addonId));
      if (!probe) return failure("NOT_FOUND", "El adicional no existe");
      const [order] = await tx.select(orderCols).from(s.orders).where(eq(s.orders.id, probe.orderId)).for("update");
      if (!order) return failure("NOT_FOUND", "El pedido no existe");
      const sectorOk = decideSector(raw.sector, order.fulfillment);
      if (!sectorOk.ok) return failure("WRONG_SECTOR", sectorOk.message);

      const [addon] = await tx.select().from(s.orderAddons).where(eq(s.orderAddons.id, addonId));
      if (!addon) return failure("NOT_FOUND", "El adicional no existe");
      if (addon.status !== "pendiente_pago") return failure("INVALID_STATE", "Este adicional ya no está pendiente de pago");

      await tx
        .update(s.orderAddons)
        .set({ status: "cancelado", cancelledBy: userId, cancelledAt: new Date(), cancelReason: reason })
        .where(eq(s.orderAddons.id, addonId));
      await tx.insert(s.orderEvents).values({
        orderId: probe.orderId,
        fromStatus: order.status,
        toStatus: order.status,
        userId,
        note: clip(`Adicional ${addon.seq} cancelado${reason ? `: ${reason}` : ""}`),
      });
      await notifyInTx(tx, ORDERS_CHANNEL, { orderId: probe.orderId, status: order.status, event: "updated" });
      return { ok: true, data: { addonId } };
    });
  } catch (err) {
    console.error("[orders] cancelAddon failed", pgErrorCode(err) ?? "");
    return failure("UNEXPECTED", UNEXPECTED_MESSAGE);
  }
}

// ---------------------------------------------------------------- cancelPendingAddons

/**
 * Cancels every `pendiente_pago` add-on of an order inside the caller's transaction (the order row is already
 * locked by the caller: ready / cancel). Pending add-ons never reserved stock or touched totals, so nothing else
 * to undo. Writes one audit event when something was cancelled (the caller's transition already notifies).
 */
export async function cancelPendingAddons(tx: DbTransaction, orderId: number, userId: number, note: string): Promise<number> {
  const cancelled = await tx
    .update(s.orderAddons)
    .set({ status: "cancelado", cancelledBy: userId, cancelledAt: new Date(), cancelReason: note })
    .where(and(eq(s.orderAddons.orderId, orderId), eq(s.orderAddons.status, "pendiente_pago")))
    .returning({ seq: s.orderAddons.seq });
  if (cancelled.length === 0) return 0;
  const [order] = await tx.select({ status: s.orders.status }).from(s.orders).where(eq(s.orders.id, orderId));
  if (order) {
    const seqs = cancelled.map((c) => c.seq).sort((a, b) => a - b).join(", ");
    await tx.insert(s.orderEvents).values({
      orderId,
      fromStatus: order.status,
      toStatus: order.status,
      userId,
      note: clip(`Adicional ${seqs} cancelado: ${note}`),
    });
  }
  return cancelled.length;
}
