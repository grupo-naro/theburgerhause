import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import { businessDateFor } from "@/db/order-number";
import * as s from "@/db/schema";
import { STOCK_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import type { StockEventReason } from "@/lib/events/stock-reasons";
import { pgError } from "@/lib/orders/order-rows";
import { getBusinessDayCutoff } from "@/lib/settings";
import type { Kind, Unit } from "./quantity";
import {
  consumoSchema,
  editMovementSchema,
  fitsUnit,
  ingresoSchema,
  initialStockSchema,
  STOCK_MESSAGES,
  stockFailure,
  validationFailure,
  type Result,
  type StockNegative,
} from "./schemas";

/**
 * Stock ledger writes. No next/* imports. Every write locks the item row (SELECT ... FOR UPDATE),
 * inserts/edits the movement and updates `stock_items.quantity` in ONE transaction, syncs the
 * drink's stock pause and queues a STOCK_CHANNEL notification (delivered only on commit).
 * Same-key resubmits are serialized by an advisory lock and answered with the first result.
 */

export type StockContext = { now?: Date };
export type LockedStockItem = { id: number; name: string; kind: Kind; unit: Unit; quantity: number; active: boolean };
export type MovementKind = (typeof s.stockMovementKind.enumValues)[number];

const KEY_INDEX = "stock_movements_idempotency_key_unique";
const EDITABLE: readonly MovementKind[] = ["ajuste_inicial", "ingreso", "consumo"];
const REASON: Record<MovementKind, StockEventReason> = {
  ajuste_inicial: "ajuste",
  ingreso: "ingreso",
  consumo: "consumo",
  venta: "venta",
  devolucion: "devolucion",
};

/** Locks the given items in id order (no deadlock cycles between multi-item writers). */
export async function lockStockItems(tx: DbTransaction, ids: number[]): Promise<Map<number, LockedStockItem>> {
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({
      id: s.stockItems.id,
      name: s.stockItems.name,
      kind: s.stockItems.kind,
      unit: s.stockItems.unit,
      quantity: s.stockItems.quantity,
      active: s.stockItems.active,
    })
    .from(s.stockItems)
    .where(inArray(s.stockItems.id, unique))
    .orderBy(asc(s.stockItems.id))
    .for("update");
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * A drink linked to products is paused BY STOCK while its (active) item is at or below zero, and
 * unpaused otherwise. Only `products.stock_paused` is touched, never `active` (the manual pause).
 * Raw material never pauses anything.
 */
export async function syncStockPause(tx: DbTransaction, item: Pick<LockedStockItem, "id" | "kind" | "active">, quantity: number): Promise<void> {
  if (item.kind !== "bebida") return;
  const paused = item.active && quantity <= 0;
  await tx
    .update(s.products)
    .set({ stockPaused: paused })
    .where(and(eq(s.products.stockItemId, item.id), ne(s.products.stockPaused, paused)));
}

/** Sets the new balance of a LOCKED item, syncs the pause and queues the realtime hint. */
async function applyBalance(tx: DbTransaction, item: LockedStockItem, quantity: number, reason: StockEventReason): Promise<void> {
  await tx.update(s.stockItems).set({ quantity }).where(eq(s.stockItems.id, item.id));
  item.quantity = quantity;
  await syncStockPause(tx, item, quantity);
  await notifyInTx(tx, STOCK_CHANNEL, { itemId: item.id, reason });
}

export type RecordMovementInput = {
  item: LockedStockItem;
  kind: MovementKind;
  qtyDelta: number;
  businessDate: string;
  userId: number | null;
  orderId?: number | null;
  note?: string | null;
  idempotencyKey?: string | null;
};

/**
 * Inserts one movement for an item the caller ALREADY LOCKED (see lockStockItems) and moves its
 * balance by `qtyDelta`. Validation (signs, units, negatives) is the caller's job; the DB checks
 * signs and the venta/devolucion uniqueness as a backstop. Returns the new balance.
 */
export async function recordMovement(tx: DbTransaction, input: RecordMovementInput): Promise<{ movementId: number; quantity: number }> {
  const [m] = await tx
    .insert(s.stockMovements)
    .values({
      itemId: input.item.id,
      kind: input.kind,
      qtyDelta: input.qtyDelta,
      businessDate: input.businessDate,
      userId: input.userId,
      orderId: input.orderId ?? null,
      note: input.note ? input.note : null,
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .returning({ id: s.stockMovements.id });
  const quantity = input.item.quantity + input.qtyDelta;
  await applyBalance(tx, input.item, quantity, REASON[input.kind]);
  return { movementId: m.id, quantity };
}

async function businessDateNow(tx: DbTransaction, ctx: StockContext): Promise<string> {
  return businessDateFor(ctx.now ?? new Date(), await getBusinessDayCutoff(tx));
}

const lockKey = (tx: DbTransaction, key: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);

async function currentQuantity(conn: Db | DbTransaction, itemId: number): Promise<number> {
  const [row] = await conn.select({ q: s.stockItems.quantity }).from(s.stockItems).where(eq(s.stockItems.id, itemId));
  return row?.q ?? 0;
}

const isKeyRace = (err: unknown) => {
  const pg = pgError(err);
  return pg.code === "23505" && pg.constraint === KEY_INDEX;
};

// ---------------------------------------------------------------- initial stock

/** The item's starting balance, once per item (later corrections: editMovement on it). Zero is allowed. */
export async function setInitialStock(
  db: Db,
  rawInput: { itemId: number; userId: number; milli: number },
  ctx: StockContext = {},
): Promise<Result<void>> {
  const parsed = initialStockSchema.safeParse(rawInput);
  if (!parsed.success) return validationFailure(parsed.error);
  const input = parsed.data;
  try {
    return await db.transaction(async (tx): Promise<Result<void>> => {
      const item = (await lockStockItems(tx, [input.itemId])).get(input.itemId);
      if (!item) return stockFailure("NOT_FOUND", STOCK_MESSAGES.ITEM_NOT_FOUND);
      if (!item.active) return stockFailure("VALIDATION", STOCK_MESSAGES.ITEM_INACTIVE);
      if (!fitsUnit(input.milli, item.unit)) return stockFailure("VALIDATION", STOCK_MESSAGES.WHOLE_UNITS);
      const [done] = await tx
        .select({ id: s.stockMovements.id })
        .from(s.stockMovements)
        .where(and(eq(s.stockMovements.itemId, item.id), eq(s.stockMovements.kind, "ajuste_inicial")));
      if (done) return stockFailure("CONFLICT", STOCK_MESSAGES.INITIAL_DONE);
      await recordMovement(tx, {
        item,
        kind: "ajuste_inicial",
        qtyDelta: input.milli,
        businessDate: await businessDateNow(tx, ctx),
        userId: input.userId,
        note: "Stock inicial",
        idempotencyKey: `inicial:${item.id}`,
      });
      return { ok: true, data: undefined };
    });
  } catch (err) {
    if (isKeyRace(err)) return stockFailure("CONFLICT", STOCK_MESSAGES.INITIAL_DONE);
    throw err;
  }
}

// ---------------------------------------------------------------- ingreso

export async function registerIngreso(
  db: Db,
  rawInput: { itemId: number; userId: number; milli: number; note?: string; idempotencyKey: string },
  ctx: StockContext = {},
): Promise<Result<{ quantity: number }>> {
  const parsed = ingresoSchema.safeParse(rawInput);
  if (!parsed.success) return validationFailure(parsed.error);
  const input = parsed.data;
  const storedKey = `ingreso:${input.idempotencyKey}`;

  const duplicate = async (conn: Db | DbTransaction): Promise<Result<{ quantity: number }> | null> => {
    const [prev] = await conn
      .select({ itemId: s.stockMovements.itemId })
      .from(s.stockMovements)
      .where(eq(s.stockMovements.idempotencyKey, storedKey));
    return prev ? { ok: true, data: { quantity: await currentQuantity(conn, prev.itemId) } } : null;
  };

  try {
    return await db.transaction(async (tx): Promise<Result<{ quantity: number }>> => {
      await lockKey(tx, storedKey);
      const prev = await duplicate(tx);
      if (prev) return prev;
      const item = (await lockStockItems(tx, [input.itemId])).get(input.itemId);
      if (!item) return stockFailure("NOT_FOUND", STOCK_MESSAGES.ITEM_NOT_FOUND);
      if (!item.active) return stockFailure("VALIDATION", STOCK_MESSAGES.ITEM_INACTIVE);
      if (!fitsUnit(input.milli, item.unit)) return stockFailure("VALIDATION", STOCK_MESSAGES.WHOLE_UNITS, { fieldErrors: { milli: STOCK_MESSAGES.WHOLE_UNITS } });
      const { quantity } = await recordMovement(tx, {
        item,
        kind: "ingreso",
        qtyDelta: input.milli,
        businessDate: await businessDateNow(tx, ctx),
        userId: input.userId,
        note: input.note,
        idempotencyKey: storedKey,
      });
      return { ok: true, data: { quantity } };
    });
  } catch (err) {
    if (isKeyRace(err)) {
      const prev = await duplicate(db);
      if (prev) return prev;
    }
    throw err;
  }
}

// ---------------------------------------------------------------- consumo

/**
 * "Guardar consumo": one `consumo` movement per line with a quantity (zero lines are ignored),
 * all or nothing. A balance that would go below zero needs `confirmNegative: true`; otherwise
 * NEEDS_CONFIRMATION lists the affected items and nothing is written.
 */
export async function registerConsumo(
  db: Db,
  rawInput: {
    userId: number;
    businessDate: string;
    lines: { itemId: number; milli: number }[];
    idempotencyKey: string;
    confirmNegative?: boolean;
  },
): Promise<Result<void>> {
  const parsed = consumoSchema.safeParse(rawInput);
  if (!parsed.success) return validationFailure(parsed.error);
  const input = parsed.data;
  const lines = input.lines.filter((l) => l.milli > 0);
  if (lines.length === 0) return stockFailure("VALIDATION", STOCK_MESSAGES.NOTHING_TO_SAVE);
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) return stockFailure("VALIDATION", STOCK_MESSAGES.REPEATED_ITEM);

  const submitKey = `consumo:${input.idempotencyKey}`;
  const lineKey = (itemId: number) => `${submitKey}:${itemId}`;
  const alreadySaved = async (conn: Db | DbTransaction): Promise<boolean> => {
    const [prev] = await conn
      .select({ id: s.stockMovements.id })
      .from(s.stockMovements)
      .where(inArray(s.stockMovements.idempotencyKey, lines.map((l) => lineKey(l.itemId))))
      .limit(1);
    return prev !== undefined;
  };

  try {
    return await db.transaction(async (tx): Promise<Result<void>> => {
      await lockKey(tx, submitKey);
      if (await alreadySaved(tx)) return { ok: true, data: undefined };

      const items = await lockStockItems(tx, lines.map((l) => l.itemId));
      const negatives: StockNegative[] = [];
      for (const line of lines) {
        const item = items.get(line.itemId);
        if (!item) return stockFailure("NOT_FOUND", STOCK_MESSAGES.ITEM_NOT_FOUND);
        if (!item.active) return stockFailure("VALIDATION", `${STOCK_MESSAGES.ITEM_INACTIVE}: ${item.name}`);
        if (!fitsUnit(line.milli, item.unit)) return stockFailure("VALIDATION", `${STOCK_MESSAGES.WHOLE_UNITS}: ${item.name}`);
        const resultingQuantity = item.quantity - line.milli;
        if (resultingQuantity < 0) negatives.push({ itemId: item.id, name: item.name, resultingQuantity });
      }
      if (negatives.length > 0 && !input.confirmNegative) {
        return stockFailure("NEEDS_CONFIRMATION", STOCK_MESSAGES.NEGATIVE, { negatives });
      }

      for (const line of [...lines].sort((a, b) => a.itemId - b.itemId)) {
        await recordMovement(tx, {
          item: items.get(line.itemId)!,
          kind: "consumo",
          qtyDelta: -line.milli,
          businessDate: input.businessDate,
          userId: input.userId,
          idempotencyKey: lineKey(line.itemId),
        });
      }
      return { ok: true, data: undefined };
    });
  } catch (err) {
    if (isKeyRace(err) && (await alreadySaved(db))) return { ok: true, data: undefined };
    throw err;
  }
}

// ---------------------------------------------------------------- edit

export type EditMovementData = { quantity: number; needsConfirmation?: { resultingQuantity: number } };

/**
 * Corrects the amount of an ajuste_inicial / ingreso / consumo (`newMilli` is the corrected
 * amount, sign implied by the kind; 0 annuls it). Keeps the replaced value in `superseded_value`.
 * If the balance would drop below zero and `confirmNegative` is false, returns
 * `needsConfirmation` WITHOUT writing. Sales and returns are never editable.
 */
export async function editMovement(
  db: Db,
  rawInput: { movementId: number; userId: number; newMilli: number; confirmNegative: boolean },
  ctx: StockContext = {},
): Promise<Result<EditMovementData>> {
  const parsed = editMovementSchema.safeParse(rawInput);
  if (!parsed.success) return validationFailure(parsed.error);
  const input = parsed.data;

  return db.transaction(async (tx): Promise<Result<EditMovementData>> => {
    const [peek] = await tx
      .select({ itemId: s.stockMovements.itemId })
      .from(s.stockMovements)
      .where(eq(s.stockMovements.id, input.movementId));
    if (!peek) return stockFailure("NOT_FOUND", STOCK_MESSAGES.MOVEMENT_NOT_FOUND);
    // Lock order item -> movement, like every other writer (they all hold the item lock).
    const item = (await lockStockItems(tx, [peek.itemId])).get(peek.itemId);
    if (!item) return stockFailure("NOT_FOUND", STOCK_MESSAGES.ITEM_NOT_FOUND);
    const [m] = await tx
      .select({ kind: s.stockMovements.kind, qtyDelta: s.stockMovements.qtyDelta })
      .from(s.stockMovements)
      .where(eq(s.stockMovements.id, input.movementId))
      .for("update");
    if (!m) return stockFailure("NOT_FOUND", STOCK_MESSAGES.MOVEMENT_NOT_FOUND);
    if (!EDITABLE.includes(m.kind)) return stockFailure("NOT_EDITABLE", STOCK_MESSAGES.NOT_EDITABLE);
    if (!fitsUnit(input.newMilli, item.unit)) {
      return stockFailure("VALIDATION", STOCK_MESSAGES.WHOLE_UNITS, { fieldErrors: { newMilli: STOCK_MESSAGES.WHOLE_UNITS } });
    }

    const newDelta = m.kind === "consumo" ? -input.newMilli : input.newMilli;
    if (newDelta === m.qtyDelta) return { ok: true, data: { quantity: item.quantity } };
    const change = newDelta - m.qtyDelta;
    const resultingQuantity = item.quantity + change;
    if (resultingQuantity < 0 && change < 0 && !input.confirmNegative) {
      return { ok: true, data: { quantity: item.quantity, needsConfirmation: { resultingQuantity } } };
    }

    await tx
      .update(s.stockMovements)
      .set({ qtyDelta: newDelta, supersededValue: m.qtyDelta, editedBy: input.userId, editedAt: ctx.now ?? new Date() })
      .where(eq(s.stockMovements.id, input.movementId));
    await applyBalance(tx, item, resultingQuantity, "edicion");
    return { ok: true, data: { quantity: resultingQuantity } };
  });
}
