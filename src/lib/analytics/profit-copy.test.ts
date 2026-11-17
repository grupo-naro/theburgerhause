import { describe, expect, it } from "vitest";
import { formatARS } from "@/domain/money";
import { marginText, productProfitText, uncostedWarning } from "./profit-copy";

describe("profit copy", () => {
  it("product row: all costed, partial, none", () => {
    expect(productProfitText({ profit: 510_000_00, uncostedUnits: 0 })).toBe(`gana ${formatARS(510_000_00)}`);
    expect(productProfitText({ profit: 8400, uncostedUnits: 1 })).toBe(`gana ${formatARS(8400)} · 1 sin costo`);
    expect(productProfitText({ profit: null, uncostedUnits: 3 })).toBe("sin costo");
  });
  it("uncosted warning, singular and plural; none when zero", () => {
    expect(uncostedWarning(0)).toBeNull();
    expect(uncostedWarning(1)).toBe("1 unidad sin costo cargado: la ganancia está incompleta");
    expect(uncostedWarning(38)).toBe("38 unidades sin costo cargado: la ganancia está incompleta");
  });
  it("margin line", () => {
    expect(marginText(40)).toBe("margen 40%");
    expect(marginText(null)).toBe("margen —");
  });
});
