import { eq, sql } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import { businessDateFor, nextOrderNumber } from "@/db/order-number";
import * as s from "@/db/schema";
import { orderTotals } from "@/domain/pricing";
import { ORDERS_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import { getAcceptingOrders, getBusinessDayCutoff, getSettings } from "@/lib/settings";
import { outOfStockMessage, OutOfStockRollback, reserveStockForOrder } from "@/lib/stock/sales";
import { createOrderSchema, fieldErrorsOf, type CreateOrderInput } from "./schemas";
import { defaultToken, insertOrderItems, loadCatalog, pgError } from "./order-rows";
import { resolveUnits, type UnitIssue } from "./resolve-units";

/**
 * Customer checkout, server half. No next/* imports: the Server Action is the only
 * Next-aware piece. Everything that touches money or state happens in ONE transaction:
 * prices come from the DB only (client values are stripped by the zod schema).
 */

export type CreateOrderData = {
  publicToken: string;
  number: number;
  total: number;
  duplicate: boolean;
  /** Set when the sale flipped a drink's stock pause: the caller refreshes the cached menu. Server-side only. */
  menuChanged?: true;
};
export type CreateOrderFailure = {
  ok: false;
  code: "STORE_CLOSED" | "VALIDATION" | "UNITS_INVALID" | "HONEYPOT" | "OUT_OF_STOCK";
  message: string;
  fieldErrors?: Record<string, string>;
  unitIssues?: UnitIssue[];
  /** OUT_OF_STOCK: the products that ran out (and their names, used in `message`). */
  productIds?: number[];
  names?: string[];
};
/** A controlled drink lacks stock: nothing was written. `message` names the products. */
export type OutOfStockFailure = { ok: false; code: "OUT_OF_STOCK"; message: string; productIds: number[]; names: string[] };
export type CreateOrderResult = { ok: true; data: CreateOrderData } | CreateOrderFailure;
export type CreateOrderContext = { now?: Date; newToken?: () => string };

export const MESSAGES = {
  STORE_CLOSED: "Por el momento no estamos tomando pedidos",
  VALIDATION: "Revisá los datos del pedido",
  UNITS_INVALID: "Algunos productos ya no están disponibles",
  HONEYPOT: "Recargá la página y probá de nuevo.",
} as const;

const fail = (code: keyof typeof MESSAGES, extra: Partial<CreateOrderFailure> = {}): CreateOrderFailure => ({
  ok: false,
  code,
  message: MESSAGES[code],
  ...extra,
});

/** OUT_OF_STOCK as returned by every order-creating flow (web and counter). */
export function outOfStock(f: { productIds: number[]; names: string[] }): OutOfStockFailure {
  return { ok: false, code: "OUT_OF_STOCK", message: outOfStockMessage(f.names), productIds: f.productIds, names: f.names };
}

function honeypotFilled(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const w = (raw as { bh_ref?: unknown }).bh_ref;
  return typeof w === "string" && w.trim() !== "";
}

/** Just the SQLSTATE (safe to log) of a possibly drizzle-wrapped driver error. */
export function pgErrorCode(err: unknown): string | undefined {
  return pgError(err).code;
}

async function findByKey(conn: Db | DbTransaction, key: string): Promise<CreateOrderData | null> {
  const [row] = await conn
    .select({ publicToken: s.orders.publicToken, number: s.orders.number, total: s.orders.total })
    .from(s.orders)
    .where(eq(s.orders.idempotencyKey, key));
  return row ? { ...row, duplicate: true } : null;
}

/** Cheap indexed lookup: has an order with this idempotency key already been created? */
export async function orderKeyExists(db: Db, key: string): Promise<boolean> {
  return (await findByKey(db, key)) !== null;
}

async function place(
  tx: DbTransaction,
  input: CreateOrderInput,
  ctx: CreateOrderContext,
): Promise<CreateOrderResult> {
  // Serialize same-key submits: the loser waits for the winner's commit, then sees its row
  // (no burned order numbers, no unique-violation noise). The UNIQUE index stays the backstop.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.idempotencyKey}))`);

  // A retry of an order that already exists is answered with it whatever the store state is;
  // only NEW orders are refused when the store is closed.
  const existing = await findByKey(tx, input.idempotencyKey);
  if (existing) return { ok: true, data: existing };

  if (!(await getAcceptingOrders(tx))) return fail("STORE_CLOSED");

  const productIds = [...new Set(input.units.map((u) => u.productId))];
  const catalog = await loadCatalog(tx, productIds);
  const resolved = resolveUnits(input.units, catalog);
  if (!resolved.ok) return fail("UNITS_INVALID", { unitIssues: resolved.issues });

  const isDelivery = input.fulfillment === "delivery";
  const deliveryFee = isDelivery ? (await getSettings(tx)).deliveryFee : 0;
  const totals = orderTotals(
    resolved.units.map((u) => ({ basePrice: u.product.price, modifiers: u.modifiers })),
    deliveryFee,
  );

  const now = ctx.now ?? new Date();
  const businessDate = businessDateFor(now, await getBusinessDayCutoff(tx));
  const number = await nextOrderNumber(tx, businessDate);
  const publicToken = (ctx.newToken ?? defaultToken)();

  const [order] = await tx
    .insert(s.orders)
    .values({
      businessDate,
      number,
      publicToken,
      idempotencyKey: input.idempotencyKey,
      channel: "web",
      fulfillment: input.fulfillment,
      status: "pendiente_aprobacion",
      paymentMethod: input.paymentMethod,
      paymentStatus: "pending",
      customerName: input.customer.name,
      whatsapp: input.customer.whatsapp,
      address: isDelivery ? input.delivery!.address : null,
      crossStreets: isDelivery ? input.delivery!.crossStreets : null,
      addressNotes: isDelivery ? input.delivery!.notes || null : null,
      pagerNumber: null,
      subtotal: totals.subtotal,
      deliveryFee,
      total: totals.total,
      createdAt: now,
    })
    .returning({ id: s.orders.id });

  // Reserve the controlled drinks in the same transaction; a shortfall rolls the order back.
  const stock = await reserveStockForOrder(tx, { orderId: order.id, units: resolved.units.map((u) => ({ productId: u.product.id })) });
  if (!stock.ok) throw new OutOfStockRollback(stock);

  await insertOrderItems(tx, order.id, resolved.units);

  await tx.insert(s.orderEvents).values({
    orderId: order.id,
    fromStatus: null,
    toStatus: "pendiente_aprobacion",
    userId: null,
    note: "Pedido web",
  });

  // Delivered only if the transaction commits.
  await notifyInTx(tx, ORDERS_CHANNEL, { orderId: order.id, status: "pendiente_aprobacion", event: "created" });

  return {
    ok: true,
    data: { publicToken, number, total: totals.total, duplicate: false, ...(stock.pauseChanged ? { menuChanged: true as const } : {}) },
  };
}

/**
 * Validates, re-prices from the DB and persists a web order atomically. Expected failures
 * are returned as `{ ok: false }`; unexpected DB errors are thrown (the action maps them).
 */
export async function createOrder(db: Db, rawInput: unknown, ctx: CreateOrderContext = {}): Promise<CreateOrderResult> {
  if (honeypotFilled(rawInput)) return fail("HONEYPOT");

  const parsed = createOrderSchema.safeParse(rawInput);
  if (!parsed.success) return fail("VALIDATION", { fieldErrors: fieldErrorsOf(parsed.error) });
  const input = parsed.data;
  if (input.bh_ref.trim() !== "") return fail("HONEYPOT");

  try {
    return await db.transaction((tx) => place(tx, input, ctx));
  } catch (err) {
    if (err instanceof OutOfStockRollback) return outOfStock(err.failure);
    // Backstop: a same-key insert that raced past the advisory lock.
    const pg = pgError(err);
    if (pg.code === "23505" && pg.constraint === "orders_idempotency_key_unique") {
      const existing = await findByKey(db, input.idempotencyKey);
      if (existing) return { ok: true, data: existing };
    }
    throw err;
  }
}
