import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import type { Catalog, CatalogModifier, CatalogProduct, ResolvedUnit } from "./resolve-units";

/**
 * Pieces shared by every order-creating flow (web checkout, counter sale). No next/* imports.
 * They always run inside the caller's transaction.
 */

export const defaultToken = () => randomBytes(16).toString("hex");

/** SQLSTATE + constraint of a (possibly drizzle-wrapped) driver error. */
export function pgError(err: unknown): { code?: string; constraint?: string } {
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

/** ONE query: products + category flag + the modifiers of their LINKED groups. */
export async function loadCatalog(tx: DbTransaction, productIds: number[]): Promise<Catalog> {
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

/** One order_items row per UNIT plus each unit's order_item_modifiers snapshots. */
export async function insertOrderItems(
  tx: DbTransaction,
  orderId: number,
  units: ResolvedUnit[],
  opts: { addonId?: number } = {},
): Promise<void> {
  // Serial ids follow VALUES order, so sorting by id restores unit order.
  const items = (
    await tx
      .insert(s.orderItems)
      .values(
        units.map((u) => ({
          orderId,
          productId: u.product.id,
          nameSnapshot: u.product.name,
          unitPriceSnapshot: u.product.price,
          notes: u.note === "" ? null : u.note,
          ...(opts.addonId !== undefined ? { addonId: opts.addonId } : {}),
        })),
      )
      .returning({ id: s.orderItems.id })
  ).sort((a, b) => a.id - b.id);

  const modifierRows = units.flatMap((u, i) =>
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
}
