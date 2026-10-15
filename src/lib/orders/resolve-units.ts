import { unitTotal } from "@/domain/pricing";
import type { OrderUnitInput } from "@/lib/cart/types";

/**
 * Pure resolver: client units (ids only, never prices) + a catalog loaded from the
 * DB -> priced units or per-unit issues. No next/*, no DB access.
 */

export type ModifierKind = "remove" | "add" | "swap";

export type CatalogModifier = {
  id: number;
  groupId: number;
  name: string;
  kind: ModifierKind;
  priceDelta: number;
  kitchenLabel: string;
  active: boolean;
};

export type CatalogProduct = {
  id: number;
  name: string;
  price: number;
  active: boolean;
  categoryActive: boolean;
  /** Modifiers of the groups LINKED to this product (inactive ones may be present). */
  modifiers: CatalogModifier[];
};

export type Catalog = ReadonlyMap<number, CatalogProduct>;

export type UnitIssueCode = "PRODUCT_UNAVAILABLE" | "MODIFIER_UNAVAILABLE" | "INVALID_SELECTION";
export type UnitIssue = { unitIndex: number; code: UnitIssueCode };

export type ResolvedUnit = {
  product: CatalogProduct;
  modifiers: CatalogModifier[];
  note: string;
  /** Centavos, computed by the domain pricing from catalog values only. */
  unitTotal: number;
};

export type ResolveResult = { ok: true; units: ResolvedUnit[] } | { ok: false; issues: UnitIssue[] };

function resolveOne(unit: OrderUnitInput, catalog: Catalog): ResolvedUnit | UnitIssueCode {
  const product = catalog.get(unit.productId);
  if (!product || !product.active || !product.categoryActive) return "PRODUCT_UNAVAILABLE";

  const byId = new Map(product.modifiers.map((m) => [m.id, m]));
  const modifiers: CatalogModifier[] = [];
  for (const id of new Set(unit.modifierIds)) {
    const m = byId.get(id);
    if (!m || !m.active) return "MODIFIER_UNAVAILABLE";
    modifiers.push(m);
  }

  // The server enforces swap exclusivity itself: at most one swap per group.
  const swapGroups = new Set<number>();
  for (const m of modifiers) {
    if (m.kind !== "swap") continue;
    if (swapGroups.has(m.groupId)) return "INVALID_SELECTION";
    swapGroups.add(m.groupId);
  }

  return {
    product,
    modifiers,
    note: unit.note,
    unitTotal: unitTotal({ basePrice: product.price, modifiers }),
  };
}

export function resolveUnits(units: readonly OrderUnitInput[], catalog: Catalog): ResolveResult {
  const resolved: ResolvedUnit[] = [];
  const issues: UnitIssue[] = [];
  units.forEach((unit, unitIndex) => {
    const r = resolveOne(unit, catalog);
    if (typeof r === "string") issues.push({ unitIndex, code: r });
    else resolved.push(r);
  });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, units: resolved };
}
