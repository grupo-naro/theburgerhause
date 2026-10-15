import { unitTotal, type UnitInput } from "@/domain/pricing";
import type { PublicMenu, PublicModifier, PublicProduct } from "@/lib/menu/public";
import type { CartLine } from "./types";

export type MenuIndex = {
  products: Map<number, PublicProduct>;
  /** modifierId -> the modifier and the group it belongs to (swap exclusivity is per group). */
  modifiers: Map<number, { modifier: PublicModifier; groupId: number }>;
  /** productId -> modifier ids that product actually offers. */
  offered: Map<number, Set<number>>;
};

export function buildMenuIndex(menu: PublicMenu): MenuIndex {
  const products = new Map<number, PublicProduct>();
  const modifiers: MenuIndex["modifiers"] = new Map();
  const offered = new Map<number, Set<number>>();
  for (const category of menu.categories) {
    for (const product of category.products) {
      products.set(product.id, product);
      const ids = new Set<number>();
      for (const group of product.modifierGroups) {
        for (const modifier of group.modifiers) {
          ids.add(modifier.id);
          modifiers.set(modifier.id, { modifier, groupId: group.id });
        }
      }
      offered.set(product.id, ids);
    }
  }
  return { products, modifiers, offered };
}

/** The domain `UnitInput` of a cart line (null for an unknown product); modifiers the product does not offer are ignored. */
export function unitInputFor(line: Pick<CartLine, "productId" | "modifierIds">, index: MenuIndex): UnitInput | null {
  const product = index.products.get(line.productId);
  if (!product) return null;
  const offered = index.offered.get(product.id);
  const modifiers = line.modifierIds.flatMap((id) => {
    const entry = index.modifiers.get(id);
    return entry && offered?.has(id) ? [{ priceDelta: entry.modifier.priceDelta }] : [];
  });
  return { basePrice: product.price, modifiers };
}

/** Preview price of one unit with the DOMAIN `unitTotal`. Unknown product / modifier ids contribute 0. */
export function unitTotalFor(line: Pick<CartLine, "productId" | "modifierIds">, index: MenuIndex): number {
  const input = unitInputFor(line, index);
  return input ? unitTotal(input) : 0;
}

/** Display-only total (the server re-prices at checkout). */
export function cartPreviewTotal(
  lines: readonly CartLine[],
  index: MenuIndex,
): { subtotal: number; unitCount: number } {
  let subtotal = 0;
  for (const line of lines) subtotal += unitTotalFor(line, index);
  return { subtotal, unitCount: lines.length };
}

/** Line total of a cart group: the domain unit total times its quantity (display only). */
export function lineTotalFor(
  group: Pick<CartLine, "productId" | "modifierIds"> & { quantity: number },
  index: MenuIndex,
): number {
  return unitTotalFor(group, index) * group.quantity;
}
