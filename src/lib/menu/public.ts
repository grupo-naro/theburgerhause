import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { thumbUrl, uploadUrl } from "@/lib/uploads/storage";

/**
 * Public (customer-facing) menu read model. Pure over `db` (no next/*), so it
 * is unit-testable; `getMenu()` in queries.ts adds the cache directive.
 * Internal fields (kitchenLabel, active, sort) are deliberately NOT exposed.
 */

export type PublicModifier = {
  id: number;
  name: string;
  kind: "remove" | "add" | "swap";
  /** Centavos. */
  priceDelta: number;
};

export type PublicModifierGroup = { id: number; name: string; modifiers: PublicModifier[] };

export type PublicProduct = {
  id: number;
  categoryId: number;
  name: string;
  description: string | null;
  /** Centavos. */
  price: number;
  imagePath: string | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  featured: boolean;
  modifierGroups: PublicModifierGroup[];
};

export type PublicCategory = {
  id: number;
  name: string;
  slug: string;
  imageUrl: string | null;
  products: PublicProduct[];
};

export type PublicMenu = {
  categories: PublicCategory[];
  /** Active featured products, in menu order. */
  featured: PublicProduct[];
};

export async function loadMenu(db: Db): Promise<PublicMenu> {
  const [cats, prods, links, mods] = await Promise.all([
    db
      .select()
      .from(s.categories)
      .where(eq(s.categories.active, true))
      .orderBy(asc(s.categories.sort), asc(s.categories.id)),
    db
      .select()
      .from(s.products)
      .where(eq(s.products.active, true))
      .orderBy(asc(s.products.sort), asc(s.products.id)),
    db.select().from(s.productModifierGroups),
    db
      .select({
        id: s.modifiers.id,
        groupId: s.modifiers.groupId,
        name: s.modifiers.name,
        kind: s.modifiers.kind,
        priceDelta: s.modifiers.priceDelta,
        groupName: s.modifierGroups.name,
      })
      .from(s.modifiers)
      .innerJoin(s.modifierGroups, eq(s.modifierGroups.id, s.modifiers.groupId))
      .where(eq(s.modifiers.active, true))
      .orderBy(asc(s.modifiers.sort), asc(s.modifiers.id)),
  ]);

  // groupId -> group with its active modifiers (sorted); empty groups never appear.
  const groups = new Map<number, PublicModifierGroup>();
  for (const m of mods) {
    const g = groups.get(m.groupId) ?? { id: m.groupId, name: m.groupName, modifiers: [] };
    g.modifiers.push({ id: m.id, name: m.name, kind: m.kind, priceDelta: m.priceDelta });
    groups.set(m.groupId, g);
  }

  const groupsByProduct = new Map<number, PublicModifierGroup[]>();
  for (const l of links) {
    const g = groups.get(l.groupId);
    if (!g) continue;
    const list = groupsByProduct.get(l.productId) ?? [];
    list.push(g);
    groupsByProduct.set(l.productId, list);
  }

  const toPublic = (p: typeof s.products.$inferSelect): PublicProduct => ({
    id: p.id,
    categoryId: p.categoryId,
    name: p.name,
    description: p.description,
    price: p.price,
    imagePath: p.imagePath,
    imageUrl: p.imagePath ? uploadUrl(p.imagePath) : null,
    thumbUrl: p.imagePath ? thumbUrl(p.imagePath) : null,
    featured: p.featured,
    modifierGroups: (groupsByProduct.get(p.id) ?? []).slice().sort((a, b) => a.id - b.id),
  });

  const categories: PublicCategory[] = cats
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      imageUrl: c.imagePath ? uploadUrl(c.imagePath) : null,
      products: prods.filter((p) => p.categoryId === c.id).map(toPublic),
    }))
    .filter((c) => c.products.length > 0);

  return { categories, featured: categories.flatMap((c) => c.products).filter((p) => p.featured) };
}
