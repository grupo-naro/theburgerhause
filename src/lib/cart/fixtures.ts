import type { PublicMenu, PublicModifier, PublicModifierGroup, PublicProduct } from "@/lib/menu/public";

/** Test-only menu: two products, remove/add/swap modifiers, two swap groups. */
const mod = (id: number, name: string, kind: PublicModifier["kind"], priceDelta = 0): PublicModifier => ({
  id,
  name,
  kind,
  priceDelta,
});
const group = (id: number, name: string, modifiers: PublicModifier[]): PublicModifierGroup => ({
  id,
  name,
  modifiers,
});

const quitar = group(10, "Quitar", [mod(101, "Sin cheddar", "remove"), mod(102, "Sin lechuga", "remove")]);
const agregar = group(20, "Agregar", [mod(201, "Dips de cheddar", "add", 120000), mod(202, "Tomate", "add", 50000)]);
const papas = group(30, "Papas", [
  mod(301, "Papas grandes", "swap", 100000),
  mod(302, "Papas con cheddar", "swap", 150000),
]);
const bebida = group(31, "Bebida", [mod(311, "Gaseosa grande", "swap", 80000)]);

const product = (id: number, name: string, price: number, modifierGroups: PublicModifierGroup[]): PublicProduct => ({
  id,
  categoryId: 1,
  name,
  description: null,
  price,
  imagePath: null,
  imageUrl: null,
  thumbUrl: null,
  featured: false,
  modifierGroups,
});

export const ranchita = product(1, "Ranchita simple", 850000, [quitar, agregar, papas, bebida]);
export const papasFritas = product(2, "Papas fritas", 400000, [agregar]);

export const menuFixture: PublicMenu = {
  categories: [{ id: 1, name: "Hamburguesas", slug: "hamburguesas", imageUrl: null, products: [ranchita, papasFritas] }],
  featured: [],
};

/** Deterministic id generator: l1, l2, ... */
export function counterIds(prefix = "l") {
  let n = 0;
  return () => `${prefix}${++n}`;
}
