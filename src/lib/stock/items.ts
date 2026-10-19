import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { STOCK_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import { pgError } from "@/lib/orders/order-rows";
import { lockStockItems, syncStockPause } from "./movements";
import {
  createStockItemSchema,
  fitsUnit,
  STOCK_MESSAGES,
  stockFailure,
  updateStockItemSchema,
  validationFailure,
  type CreateStockItemInput,
  type Result,
  type UpdateStockItemInput,
} from "./schemas";

/** Stock item catalog (server). New items start at quantity 0; the starting balance is setInitialStock. */

const NAME_INDEX = "stock_items_name_unique";
const isDuplicateName = (err: unknown) => {
  const pg = pgError(err);
  return pg.code === "23505" && pg.constraint === NAME_INDEX;
};

export async function createStockItem(db: Db, rawInput: CreateStockItemInput | Record<string, unknown>): Promise<Result<{ id: number }>> {
  const parsed = createStockItemSchema.safeParse(rawInput);
  if (!parsed.success) return validationFailure(parsed.error);
  const input = parsed.data;
  try {
    return await db.transaction(async (tx): Promise<Result<{ id: number }>> => {
      const [row] = await tx
        .insert(s.stockItems)
        .values({ name: input.name, kind: input.kind, unit: input.unit, minQty: input.minQty })
        .returning({ id: s.stockItems.id });
      await notifyInTx(tx, STOCK_CHANNEL, { itemId: row.id, reason: "ajuste" });
      return { ok: true, data: { id: row.id } };
    });
  } catch (err) {
    if (isDuplicateName(err)) return stockFailure("CONFLICT", STOCK_MESSAGES.DUPLICATE_NAME, { fieldErrors: { name: STOCK_MESSAGES.DUPLICATE_NAME } });
    throw err;
  }
}

/**
 * Renames, changes the "Poco" minimum or (de)activates an item. Kind and unit are fixed once
 * created (the ledger is in that unit). Deactivating a drink lifts its stock pause (an inactive
 * item does not control sales); reactivating it re-applies the pause if the balance is <= 0.
 */
export async function updateStockItem(db: Db, rawInput: UpdateStockItemInput | Record<string, unknown>): Promise<Result<void>> {
  const parsed = updateStockItemSchema.safeParse(rawInput);
  if (!parsed.success) return validationFailure(parsed.error);
  const input = parsed.data;
  try {
    return await db.transaction(async (tx): Promise<Result<void>> => {
      const item = (await lockStockItems(tx, [input.itemId])).get(input.itemId);
      if (!item) return stockFailure("NOT_FOUND", STOCK_MESSAGES.ITEM_NOT_FOUND);
      if (!fitsUnit(input.minQty, item.unit)) {
        return stockFailure("VALIDATION", STOCK_MESSAGES.WHOLE_UNITS, { fieldErrors: { minQty: STOCK_MESSAGES.WHOLE_UNITS } });
      }
      await tx
        .update(s.stockItems)
        .set({ name: input.name, minQty: input.minQty, active: input.active })
        .where(eq(s.stockItems.id, item.id));
      await syncStockPause(tx, { ...item, active: input.active }, item.quantity);
      await notifyInTx(tx, STOCK_CHANNEL, { itemId: item.id, reason: "edicion" });
      return { ok: true, data: undefined };
    });
  } catch (err) {
    if (isDuplicateName(err)) return stockFailure("CONFLICT", STOCK_MESSAGES.DUPLICATE_NAME, { fieldErrors: { name: STOCK_MESSAGES.DUPLICATE_NAME } });
    throw err;
  }
}
