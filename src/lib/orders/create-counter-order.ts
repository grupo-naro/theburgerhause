import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import { businessDateFor, nextOrderNumber } from "@/db/order-number";
import * as s from "@/db/schema";
import { orderTotals } from "@/domain/pricing";
import { ORDERS_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import { counterOrderSchema } from "./counter-schemas";
import { STATION_REQUIRED_MESSAGE } from "./approve-order";
import { defaultToken, insertOrderItems, loadCatalog, pgError } from "./order-rows";
import { ACTIVE_PAGER_STATUSES } from "./pagers";
import { enqueuePrintJobs, loadPrintableOrder } from "./print-jobs";
import { resolveUnits, type UnitIssue } from "./resolve-units";
import { fieldErrorsOf } from "./schemas";

/**
 * Over-the-counter sale, server half. No next/* imports. The cashier collects payment on the
 * spot, so the order is born `en_preparacion` + `paid` with a mandatory pager number, and both
 * tickets are queued for the cashier's station, all in ONE transaction. Prices come from the DB
 * only; `userId`/`stationId` are trusted fields filled by the Server Action from the session.
 * Counter sales deliberately ignore `accepting_orders` (that switch only closes the web store).
 */

export type CreateCounterOrderData = {
  orderId: number;
  number: number;
  pagerNumber: number;
  total: number;
  paymentMethod: "cash" | "transfer";
  printJobIds: number[];
  duplicate: boolean;
};
export type CreateCounterOrderFailure = {
  ok: false;
  code: "VALIDATION" | "STATION_REQUIRED" | "UNITS_INVALID" | "PAGER_IN_USE" | "UNEXPECTED";
  message: string;
  fieldErrors?: Record<string, string>;
  unitIssues?: UnitIssue[];
};
export type CreateCounterOrderResult = { ok: true; data: CreateCounterOrderData } | CreateCounterOrderFailure;
export type CreateCounterOrderContext = { now?: Date; newToken?: () => string };

export const COUNTER_MESSAGES = {
  VALIDATION: "Revisá los datos de la venta",
  STATION_REQUIRED: STATION_REQUIRED_MESSAGE,
  UNITS_INVALID: "Algunos productos ya no están disponibles",
  UNEXPECTED: "No se pudo completar la acción. Probá de nuevo.",
} as const;

const PAGER_INDEX = "orders_active_counter_pager_unique";
const KEY_INDEX = "orders_idempotency_key_unique";

const fail = (
  code: Exclude<CreateCounterOrderFailure["code"], "PAGER_IN_USE">,
  extra: Partial<CreateCounterOrderFailure> = {},
): CreateCounterOrderFailure => ({ ok: false, code, message: COUNTER_MESSAGES[code], ...extra });

const pagerInUse = (pager: number, holderNumber: number | null): CreateCounterOrderFailure => ({
  ok: false,
  code: "PAGER_IN_USE",
  message:
    holderNumber === null
      ? `El llamador ${pager} ya está en uso`
      : `El llamador ${pager} ya está en uso por el pedido #${holderNumber}`,
});

/** The ACTIVE counter order holding `pager` (same predicate as the partial unique index). */
async function activeHolder(conn: Db | DbTransaction, pager: number): Promise<{ number: number } | undefined> {
  const [row] = await conn
    .select({ number: s.orders.number })
    .from(s.orders)
    .where(
      and(
        eq(s.orders.channel, "counter"),
        eq(s.orders.pagerNumber, pager),
        inArray(s.orders.status, [...ACTIVE_PAGER_STATUSES]),
      ),
    );
  return row;
}

async function findByKey(conn: Db | DbTransaction, key: string): Promise<CreateCounterOrderData | null> {
  const [o] = await conn
    .select({
      orderId: s.orders.id,
      number: s.orders.number,
      pagerNumber: s.orders.pagerNumber,
      total: s.orders.total,
      paymentMethod: s.orders.paymentMethod,
    })
    .from(s.orders)
    .where(eq(s.orders.idempotencyKey, key));
  if (!o) return null;
  const jobs = await conn
    .select({ id: s.printJobs.id })
    .from(s.printJobs)
    .where(eq(s.printJobs.orderId, o.orderId))
    .orderBy(asc(s.printJobs.id));
  return { ...o, pagerNumber: o.pagerNumber ?? 0, printJobIds: jobs.map((j) => j.id), duplicate: true };
}

async function place(
  tx: DbTransaction,
  input: ReturnType<typeof counterOrderSchema.parse>,
  ctx: CreateCounterOrderContext,
): Promise<CreateCounterOrderResult> {
  // Serialize same-key submits: the loser waits for the winner's commit and then sees its row.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.idempotencyKey}))`);
  const existing = await findByKey(tx, input.idempotencyKey);
  if (existing) return { ok: true, data: existing };

  if (input.stationId === null) return fail("STATION_REQUIRED");
  const stationId = input.stationId;
  const [station] = await tx.select({ id: s.stations.id }).from(s.stations).where(eq(s.stations.id, stationId));
  if (!station) return fail("STATION_REQUIRED");

  const catalog = await loadCatalog(tx, [...new Set(input.units.map((u) => u.productId))]);
  const resolved = resolveUnits(input.units, catalog);
  if (!resolved.ok) return fail("UNITS_INVALID", { unitIssues: resolved.issues });

  // Serialize sales that want the same pager so exactly one wins and the rest get a clean
  // PAGER_IN_USE (the partial unique index stays the backstop). Lock order is always
  // key -> pager, so there is no deadlock cycle.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`counter-pager:${input.pagerNumber}`}))`);
  const holder = await activeHolder(tx, input.pagerNumber);
  if (holder) return pagerInUse(input.pagerNumber, holder.number);

  const totals = orderTotals(
    resolved.units.map((u) => ({ basePrice: u.product.price, modifiers: u.modifiers })),
    0,
  );
  const now = ctx.now ?? new Date();
  const businessDate = businessDateFor(now);
  const number = await nextOrderNumber(tx, businessDate);

  const [order] = await tx
    .insert(s.orders)
    .values({
      businessDate,
      number,
      publicToken: (ctx.newToken ?? defaultToken)(),
      idempotencyKey: input.idempotencyKey,
      channel: "counter",
      fulfillment: "takeaway",
      status: "en_preparacion",
      paymentMethod: input.paymentMethod,
      paymentStatus: "paid",
      customerName: input.customerName ?? null,
      whatsapp: null,
      address: null,
      crossStreets: null,
      addressNotes: null,
      pagerNumber: input.pagerNumber,
      subtotal: totals.subtotal,
      deliveryFee: 0,
      total: totals.total,
      approvedBy: input.userId,
      approvedAt: now,
      stationId,
      createdAt: now,
    })
    .returning({ id: s.orders.id });

  await insertOrderItems(tx, order.id, resolved.units);

  await tx.insert(s.orderEvents).values({
    orderId: order.id,
    fromStatus: null,
    toStatus: "en_preparacion",
    userId: input.userId,
    note: "Venta de mostrador",
  });

  // Tickets are rendered from the SNAPSHOT rows just written (never from the live catalog).
  const printable = await loadPrintableOrder(tx, order.id);
  if (!printable) throw new Error("order vanished inside transaction");
  const printJobIds = await enqueuePrintJobs(tx, { orderId: order.id, stationId, which: "both", printable });

  // Delivered only if the transaction commits.
  await notifyInTx(tx, ORDERS_CHANNEL, { orderId: order.id, status: "en_preparacion", event: "created" });

  return {
    ok: true,
    data: {
      orderId: order.id,
      number,
      pagerNumber: input.pagerNumber,
      total: totals.total,
      paymentMethod: input.paymentMethod,
      printJobIds,
      duplicate: false,
    },
  };
}

/**
 * Validates, re-prices from the DB and persists a paid counter order plus its two print jobs
 * atomically. Expected failures are returned as `{ ok: false }`; unexpected DB errors are thrown
 * (the Server Action maps them to a generic message).
 */
export async function createCounterOrder(
  db: Db,
  rawInput: unknown,
  ctx: CreateCounterOrderContext = {},
): Promise<CreateCounterOrderResult> {
  const parsed = counterOrderSchema.safeParse(rawInput);
  if (!parsed.success) return fail("VALIDATION", { fieldErrors: fieldErrorsOf(parsed.error) });
  const input = parsed.data;

  try {
    return await db.transaction((tx) => place(tx, input, ctx));
  } catch (err) {
    const pg = pgError(err);
    if (pg.code === "23505" && pg.constraint === PAGER_INDEX) {
      // Lost a race that slipped past the in-transaction check; the winner has committed by now.
      const holder = await activeHolder(db, input.pagerNumber);
      return pagerInUse(input.pagerNumber, holder?.number ?? null);
    }
    if (pg.code === "23505" && pg.constraint === KEY_INDEX) {
      const existing = await findByKey(db, input.idempotencyKey);
      if (existing) return { ok: true, data: existing };
    }
    throw err;
  }
}
