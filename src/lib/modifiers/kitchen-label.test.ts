import { describe, expect, it } from "vitest";
import { normalizeKitchenLabel as n } from "./kitchen-label";

describe("normalizeKitchenLabel", () => {
  it.each([
    ["Sin cheddar", "remove", "", "SIN CHEDDAR"],
    ["sin  Tomate", "remove", undefined, "SIN TOMATE"],
    ["Cebolla", "remove", null, "SIN CEBOLLA"],
    ["Sin ñoquis", "remove", "", "SIN ÑOQUIS"],
    ["+ Dips de cheddar", "add", "", "+ DIPS DE CHEDDAR"],
    ["+Dips", "add", "", "+ DIPS"],
    ["Panceta crocante", "add", "", "+ PANCETA CROCANTE"],
    ["Agregar tomate", "add", "", "AGREGAR TOMATE"],
    ["Extra queso", "add", "", "EXTRA QUESO"],
    ["Papas grandes", "swap", "", "PAPAS GRANDES"],
    ["Pan sin gluten", "swap", "   ", "PAN SIN GLUTEN"],
    ["Jamón  y   queso", "swap", "", "JAMÓN Y QUESO"],
    ["Lo que sea", "add", "  sin  cheddar ", "SIN CHEDDAR"],
    ["x", "add", "+ dips cheddar", "+ DIPS CHEDDAR"],
    ["x", "swap", "añejo ñandú", "AÑEJO ÑANDÚ"],
    ["   ", "add", "", ""],
  ] as const)("%j (%s, %j) -> %j", (name, kind, raw, expected) => {
    expect(n(name, kind, raw)).toBe(expected);
  });
});
