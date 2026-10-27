import { asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { stockStatus, type Kind, type StockStatus, type Unit } from "./quantity";
import type { MovementKind } from "./movements";

/** Stock reads (server). Quantities are milli-units; format them with formatQuantity. */

type Conn = Db | DbTransaction;

export type StockItemRow = {
  id: number;
  name: string;
  kind: Kind;
  unit: Unit;
  minQty: number;
  quantity: number;
  active: boolean;
  status: StockStatus;
  /** Menu products linked to this item (0 or 1 for drinks). */
  linkedProducts: number;
  createdAt: Date;
};

/** Every item (active and not), drinks first, then by name. */
export async function listStockItems(db: Conn): Promise<StockItemRow[]> {
  const rows = await db
    .select({
      id: s.stockItems.id,
      name: s.stockItems.name,
      kind: s.stockItems.kind,
      unit: s.stockItems.unit,
      minQty: s.stockItems.minQty,
      quantity: s.stockItems.quantity,
      active: s.stockItems.active,
      createdAt: s.stockItems.createdAt,
      linkedProducts: count(s.products.id),
    })
    .from(s.stockItems)
    .leftJoin(s.products, eq(s.products.stockItemId, s.stockItems.id))
    .groupBy(s.stockItems.id)
    .orderBy(asc(s.stockItems.kind), asc(sql`lower(${s.stockItems.name})`), asc(s.stockItems.id));
  return rows.map((r) => ({ ...r, status: stockStatus(r.quantity, r.minQty) }));
}

export type MovementRow = {
  id: number;
  itemId: number;
  itemName: string;
  unit: Unit;
  kind: MovementKind;
  qtyDelta: number;
  businessDate: string;
  note: string | null;
  orderId: number | null;
  userName: string | null;
  supersededValue: number | null;
  editedByName: string | null;
  editedAt: Date | null;
  createdAt: Date;
  /** Every edit of this movement, oldest first (empty if never edited). */
  edits: MovementEdit[];
};

export type MovementEdit = { previousDelta: number; newDelta: number; editedByName: string | null; editedAt: Date };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** History, newest first; optionally of one item. */
export async function listMovements(db: Conn, opts: { itemId?: number; limit?: number } = {}): Promise<MovementRow[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const author = alias(s.users, "author");
  const editor = alias(s.users, "editor");
  const base = db
    .select({
      id: s.stockMovements.id,
      itemId: s.stockMovements.itemId,
      itemName: s.stockItems.name,
      unit: s.stockItems.unit,
      kind: s.stockMovements.kind,
      qtyDelta: s.stockMovements.qtyDelta,
      businessDate: s.stockMovements.businessDate,
      note: s.stockMovements.note,
      orderId: s.stockMovements.orderId,
      userName: author.name,
      supersededValue: s.stockMovements.supersededValue,
      editedByName: editor.name,
      editedAt: s.stockMovements.editedAt,
      createdAt: s.stockMovements.createdAt,
    })
    .from(s.stockMovements)
    .innerJoin(s.stockItems, eq(s.stockItems.id, s.stockMovements.itemId))
    .leftJoin(author, eq(author.id, s.stockMovements.userId))
    .leftJoin(editor, eq(editor.id, s.stockMovements.editedBy));
  const filtered = opts.itemId !== undefined ? base.where(eq(s.stockMovements.itemId, opts.itemId)) : base;
  const rows = await filtered.orderBy(desc(s.stockMovements.id)).limit(limit);

  const edited = rows.filter((r) => r.editedAt !== null).map((r) => r.id);
  const byMovement = new Map<number, MovementEdit[]>();
  if (edited.length > 0) {
    const edits = await db
      .select({
        movementId: s.stockMovementEdits.movementId,
        previousDelta: s.stockMovementEdits.previousDelta,
        newDelta: s.stockMovementEdits.newDelta,
        editedByName: s.users.name,
        editedAt: s.stockMovementEdits.editedAt,
      })
      .from(s.stockMovementEdits)
      .leftJoin(s.users, eq(s.users.id, s.stockMovementEdits.editedBy))
      .where(inArray(s.stockMovementEdits.movementId, edited))
      .orderBy(asc(s.stockMovementEdits.id));
    for (const { movementId, ...e } of edits) byMovement.set(movementId, [...(byMovement.get(movementId) ?? []), e]);
  }
  return rows.map((r) => ({ ...r, edits: byMovement.get(r.id) ?? [] }));
}

export type ShortageReason = "agotado" | "bajo_minimo";
export type Shortage = {
  itemId: number;
  name: string;
  kind: Kind;
  quantity: number;
  unit: Unit;
  minQty: number;
  /** When the item entered its current state (the oldest movement of the trailing in-state run); null without movements. */
  since: Date | null;
  reason: ShortageReason;
};

/**
 * Active items at or below zero ("agotado") or below their minimum ("bajo_minimo"), out-of-stock
 * first. `since` replays the running balance (sum of qty_delta by id, which edits keep consistent):
 * it is the created_at of the first movement after the last one that left the item OUT of its
 * current state.
 */
export async function listShortages(db: Conn): Promise<Shortage[]> {
  const result = await db.execute<{
    item_id: number;
    name: string;
    kind: Kind;
    quantity: number;
    unit: Unit;
    min_qty: number;
    since: Date | string | null;
  }>(sql`
    with short as (
      select id, name, kind, unit, quantity, min_qty, (quantity <= 0) as out_of_stock
      from stock_items
      where active and (quantity <= 0 or (min_qty > 0 and quantity < min_qty))
        and exists (select 1 from stock_movements m where m.item_id = stock_items.id)
    ),
    running as (
      select m.item_id, m.id, m.created_at,
             sum(m.qty_delta) over (partition by m.item_id order by m.id) as after
      from stock_movements m join short on short.id = m.item_id
    ),
    flagged as (
      select r.item_id, r.id, r.created_at,
             case when short.out_of_stock then r.after <= 0 else r.after < short.min_qty end as in_state
      from running r join short on short.id = r.item_id
    ),
    last_out as (
      select item_id, coalesce(max(id) filter (where not in_state), 0) as last_out_id
      from flagged group by item_id
    ),
    since as (
      select f.item_id, min(f.created_at) as since
      from flagged f join last_out l on l.item_id = f.item_id
      where f.id > l.last_out_id
      group by f.item_id
    )
    select short.id as item_id, short.name, short.kind, short.quantity, short.unit, short.min_qty, since.since
    from short left join since on since.item_id = short.id
    order by short.out_of_stock desc, lower(short.name), short.id
  `);
  return result.rows.map((r) => ({
    itemId: Number(r.item_id),
    name: r.name,
    kind: r.kind,
    quantity: Number(r.quantity),
    unit: r.unit,
    minQty: Number(r.min_qty),
    since: r.since === null ? null : new Date(r.since),
    reason: Number(r.quantity) <= 0 ? "agotado" : "bajo_minimo",
  }));
}

export type LinkableDrink = { id: number; name: string; inactive?: boolean };

/**
 * Drinks the product form can link to: active `bebida` items that no OTHER product uses. The item
 * already linked to `productId` always stays in the list, even when deactivated (flagged `inactive`),
 * so editing the product does not silently unlink it.
 */
export async function listLinkableDrinks(db: Conn, productId?: number): Promise<LinkableDrink[]> {
  const rows = await db
    .select({ id: s.stockItems.id, name: s.stockItems.name, active: s.stockItems.active, linkedTo: s.products.id })
    .from(s.stockItems)
    .leftJoin(s.products, eq(s.products.stockItemId, s.stockItems.id))
    .where(eq(s.stockItems.kind, "bebida"))
    .orderBy(asc(sql`lower(${s.stockItems.name})`), asc(s.stockItems.id));
  return rows
    .filter((r) => (r.linkedTo === null && r.active) || (productId !== undefined && r.linkedTo === productId))
    .map((r) => (r.active ? { id: r.id, name: r.name } : { id: r.id, name: r.name, inactive: true }));
}
