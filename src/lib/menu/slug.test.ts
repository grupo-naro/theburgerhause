import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it.each([
    ["Hamburguesa simple + papa chica", "hamburguesa-simple-papa-chica"],
    ["Papas Fritas", "papas-fritas"],
    ["Ñoquis & Árboles", "noquis-arboles"],
    ["  --Combos!!  ", "combos"],
    ["Bebidas   sin   alcohol", "bebidas-sin-alcohol"],
    ["Café con Leche", "cafe-con-leche"],
    ["¡¿???!", ""],
  ])("%j -> %j", (input, out) => {
    expect(slugify(input)).toBe(out);
  });
});
