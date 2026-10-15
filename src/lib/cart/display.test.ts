import { describe, expect, it } from "vitest";
import { formatARS } from "@/domain/money";
import { issueMessages, selectedModifiers } from "./display";
import { menuFixture, ranchita } from "./fixtures";
import { buildMenuIndex } from "./pricing";

const index = buildMenuIndex(menuFixture);

describe("selectedModifiers", () => {
  it("returns the chosen modifiers in display order, skipping unknown ids", () => {
    const names = selectedModifiers(ranchita, [311, 201, 102, 9999]).map((m) => m.name);
    expect(names).toEqual(["Sin lechuga", "Dips de cheddar", "Gaseosa grande"]);
  });
});

describe("issueMessages", () => {
  it("product_unavailable: with a name, and generic without", () => {
    expect(issueMessages([{ type: "product_unavailable", productId: 77, name: "Ranchita doble", quantity: 1 }], index)).toEqual([
      "«Ranchita doble» ya no está disponible y se quitó de tu pedido.",
    ]);
    expect(issueMessages([{ type: "product_unavailable", productId: 77, quantity: 2 }], index)).toEqual([
      "Un producto que ya no está disponible se quitó de tu pedido (2 unidades).",
    ]);
  });

  it("modifier_unavailable names the product and, when known, the option", () => {
    expect(issueMessages([{ type: "modifier_unavailable", productId: 1, modifierIds: [101], quantity: 1 }], index)).toEqual([
      "Se quitó «Sin cheddar» de «Ranchita simple».",
    ]);
    expect(issueMessages([{ type: "modifier_unavailable", productId: 1, modifierIds: [9999], quantity: 3 }], index)).toEqual([
      "Se quitaron opciones que ya no están disponibles de «Ranchita simple» (3 unidades).",
    ]);
  });

  it("price_changed shows both prices", () => {
    expect(issueMessages([{ type: "price_changed", productId: 1, from: 800000, to: 850000, quantity: 1 }], index)).toEqual([
      `El precio de «Ranchita simple» cambió de ${formatARS(800000)} a ${formatARS(850000)}.`,
    ]);
  });

  it("falls back to a generic product when the product is gone from the menu", () => {
    expect(issueMessages([{ type: "price_changed", productId: 5, from: 100, to: 200, quantity: 1 }], index)[0]).toContain(
      "un producto",
    );
  });
});
