import { randomBytes } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import { businessDateFor, nextOrderNumber } from "@/db/order-number";
import * as s from "@/db/schema";
import { orderTotals } from "@/domain/pricing";
import { ORDERS_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import { getAcceptingOrders, getSettings } from "@/lib/settings";
import { createOrderSchema, fieldErrorsOf, type CreateOrderInput } from "./schemas";
import {
  resolveUnits,
  type Catalog,
  type CatalogModifier,
  type CatalogProduct,
  type UnitIssue,
} from "./resolve-units";

/**
 * Customer checkout, server half. No next/* imports: the Server Action is the only
 * Next-aware piece. Everything that touches money or state happens in ONE transaction:
 * prices come from the DB only (client values are stripped by the zod schema).
 */

export type CreateOrderData = { publicToken: string; number: number; total: number; duplicate: boolean };
export type CreateOrderFailure = {
  ok: false;
  code: "STORE_CLOSED" | "VALIDATION" | "UNITS_INVALID" | "HONEYPOT";
  message: string;
  fieldErrors?: Record<string, string>;
  unitIssues?: UnitIssue[];
};
export type CreateOrderResult = { ok: true; data: CreateOrderData } | CreateOrderFailure;
export type CreateOrderContext = { now?: Date; newToken?: () => string };

export const MESSAGES = {
  STORE_CLOSED: "Por el momento no estamos tomando pedidos",
  VALIDATION: "Revisá los datos del pedido",
  UNITS_INVALID: "Algunos productos ya no están disponibles",
  HONEYPOT: "Recargá la página y probá de nuevo.",
} as const;

const fail = (code: CreateOrderFailure["code"], extra: Partial<CreateOrderFailure> = {}): CreateOrderFailure => ({
  ok: false,
  code,
  message: MESSAGES[code],
  ...extra,
});

const defaultToken = () => randomBytes(16).toString("hex");

function honeypotFilled(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const w = (raw as { bh_ref?: unknown }).bh_ref;
  return typeof w === "string" && w.trim() !== "";
}

/** SQLSTATE + constraint of a (possibly drizzle-wrapped) driver error. */
function pgError(err: unknown): { code?: string; constraint?: string } {
  let e: unknown = err;
  while (e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      const constraint = (e as { constraint?: unknown }).constraint;
      return { code, constraint: typeof constraint === "string" ? constraint : undefined };
    }
    e = (e as { cause?: unknown }).cause;
  }
  return {};
}

/** Just the SQLSTATE (safe to log) of a possibly drizzle-wrapped driver error. */
export function pgErrorCode(err: unknown): string | undefined {
  return pgError(err).code;
}

/** ONE query: products + category flag + the modifiers of their LINKED groups. */
async function loadCatalog(tx: DbTransaction, productIds: number[]): Promise<Catalog> {
  const rows = await tx
    .select({
      pid: s.products.id,
      pname: s.products.name,
      price: s.products.price,
      pactive: s.products.active,
      cactive: s.categories.active,
      mid: s.modifiers.id,
      groupId: s.modifiers.groupId,
      mname: s.modifiers.name,
      kind: s.modifiers.kind,
      priceDelta: s.modifiers.priceDelta,
      kitchenLabel: s.modifiers.kitchenLabel,
      mactive: s.modifiers.active,
    })
    .from(s.products)
    .innerJoin(s.categories, eq(s.categories.id, s.products.categoryId))
    .leftJoin(s.productModifierGroups, eq(s.productModifierGroups.productId, s.products.id))
    .leftJoin(s.modifiers, eq(s.modifiers.groupId, s.productModifierGroups.groupId))
    .where(inArray(s.products.id, productIds));

  const catalog = new Map<number, CatalogProduct>();
  for (const r of rows) {
    let p = catalog.get(r.pid);
    if (!p) {
      p = { id: r.pid, name: r.pname, price: r.price, active: r.pactive, categoryActive: r.cactive, modifiers: [] };
      catalog.set(r.pid, p);
    }
    if (r.mid !== null) {
      const m: CatalogModifier = {
        id: r.mid,
        groupId: r.groupId!,
        name: r.mname!,
        kind: r.kind!,
        priceDelta: r.priceDelta!,
        kitchenLabel: r.kitchenLabel!,
        active: r.mactive!,
      };
      p.modifiers.push(m);
    }
  }
  return catalog;
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
  const businessDate = businessDateFor(now);
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

  // One row per UNIT; serial ids follow VALUES order, so sorting by id restores unit order.
  const items = (
    await tx
      .insert(s.orderItems)
      .values(
        resolved.units.map((u) => ({
          orderId: order.id,
          productId: u.product.id,
          nameSnapshot: u.product.name,
          unitPriceSnapshot: u.product.price,
          notes: u.note === "" ? null : u.note,
        })),
      )
      .returning({ id: s.orderItems.id })
  ).sort((a, b) => a.id - b.id);

  const modifierRows = resolved.units.flatMap((u, i) =>
    u.modifiers.map((m) => ({
      orderItemId: items[i].id,
      modifierId: m.id,
      nameSnapshot: m.name,
      kitchenLabel: m.kitchenLabel,
      kind: m.kind,
      priceDelta: m.priceDelta,
    })),
  );
  if (modifierRows.length > 0) await tx.insert(s.orderItemModifiers).values(modifierRows);

  await tx.insert(s.orderEvents).values({
    orderId: order.id,
    fromStatus: null,
    toStatus: "pendiente_aprobacion",
    userId: null,
    note: "Pedido web",
  });

  // Delivered only if the transaction commits.
  await notifyInTx(tx, ORDERS_CHANNEL, { orderId: order.id, status: "pendiente_aprobacion", event: "created" });

  return { ok: true, data: { publicToken, number, total: totals.total, duplicate: false } };
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
    // Backstop: a same-key insert that raced past the advisory lock.
    const pg = pgError(err);
    if (pg.code === "23505" && pg.constraint === "orders_idempotency_key_unique") {
      const existing = await findByKey(db, input.idempotencyKey);
      if (existing) return { ok: true, data: existing };
    }
    throw err;
  }
}
