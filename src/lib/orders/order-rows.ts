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
      pcost: s.products.cost,
      patties: s.products.patties,
      pactive: s.products.active,
      cactive: s.categories.active,
      mid: s.modifiers.id,
      groupId: s.modifiers.groupId,
      mname: s.modifiers.name,
      kind: s.modifiers.kind,
      priceDelta: s.modifiers.priceDelta,
      mcost: s.modifiers.cost,
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
      p = { id: r.pid, name: r.pname, price: r.price, cost: r.pcost, patties: r.patties, active: r.pactive, categoryActive: r.cactive, modifiers: [] };
      catalog.set(r.pid, p);
    }
    if (r.mid !== null) {
      const m: CatalogModifier = {
        id: r.mid,
        groupId: r.groupId!,
        name: r.mname!,
        kind: r.kind!,
        priceDelta: r.priceDelta!,
        cost: r.mcost,
        kitchenLabel: r.kitchenLabel!,
        active: r.mactive!,
      };
      p.modifiers.push(m);
    }
  }

  // Combo contents (one query for every combo in the request), in the order the admin set them.
  const comboIds = [...catalog.keys()];
  if (comboIds.length > 0) {
    const parts = await tx
      .select({
        comboId: s.comboItems.comboId,
        productId: s.comboItems.productId,
        quantity: s.comboItems.quantity,
        sort: s.comboItems.sort,
        name: s.products.name,
        patties: s.products.patties,
        cost: s.products.cost,
        active: s.products.active,
        categoryActive: s.categories.active,
      })
      .from(s.comboItems)
      .innerJoin(s.products, eq(s.products.id, s.comboItems.productId))
      .innerJoin(s.categories, eq(s.categories.id, s.products.categoryId))
      .where(inArray(s.comboItems.comboId, comboIds))
      .orderBy(s.comboItems.comboId, s.comboItems.sort, s.comboItems.productId);
    for (const c of parts) {
      const p = catalog.get(c.comboId)!;
      (p.combo ??= []).push({
        productId: c.productId,
        name: c.name,
        quantity: c.quantity,
        patties: c.patties,
        cost: c.cost,
        active: c.active,
        categoryActive: c.categoryActive,
      });
    }
  }
  return catalog;
}

/** Patties of one sold unit: the product's own count, or (for a combo without one) the sum of its contents. */
function unitPatties(p: CatalogProduct): number {
  if ((p.patties ?? 0) > 0 || !p.combo?.length) return p.patties ?? 0;
  return p.combo.reduce((sum, c) => sum + c.patties * c.quantity, 0);
}

/** Cost of one sold unit: the product's own cost, or (for a combo without one) the sum of its contents when all are costed. */
function unitCost(p: CatalogProduct): number | null {
  if (p.cost != null || !p.combo?.length) return p.cost ?? null;
  return p.combo.every((c) => c.cost != null) ? p.combo.reduce((sum, c) => sum + c.cost! * c.quantity, 0) : null;
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
          unitCostSnapshot: unitCost(u.product),
          pattiesSnapshot: unitPatties(u.product),
          comboSnapshot: u.product.combo?.length ? u.product.combo.map((c) => ({ name: c.name, quantity: c.quantity })) : null,
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
      costSnapshot: m.cost ?? null,
    })),
  );
  if (modifierRows.length > 0) await tx.insert(s.orderItemModifiers).values(modifierRows);
}
