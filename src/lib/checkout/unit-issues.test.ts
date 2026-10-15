import { describe, expect, it } from "vitest";
import { describeUnitIssues } from "./unit-issues";

const units = [
  { productId: 1, modifierIds: [], note: "" },
  { productId: 2, modifierIds: [5], note: "" },
  { productId: 2, modifierIds: [], note: "" },
];
const names = new Map([
  [1, "Ranchita simple"],
  [2, "Melt simple"],
]);

describe("describeUnitIssues", () => {
  it("names the product of each failing unit and says why", () => {
    expect(
      describeUnitIssues(
        [
          { unitIndex: 0, code: "PRODUCT_UNAVAILABLE" },
          { unitIndex: 1, code: "MODIFIER_UNAVAILABLE" },
        ],
        units,
        names,
      ),
    ).toEqual([
      "«Ranchita simple» ya no está disponible.",
      "Alguna opción elegida para «Melt simple» ya no está disponible.",
    ]);
  });

  it("collapses repeated issues of the same product and reason, with a unit count", () => {
    expect(
      describeUnitIssues(
        [
          { unitIndex: 1, code: "PRODUCT_UNAVAILABLE" },
          { unitIndex: 2, code: "PRODUCT_UNAVAILABLE" },
        ],
        units,
        names,
      ),
    ).toEqual(["«Melt simple» ya no está disponible (2 unidades)."]);
  });

  it("falls back to a neutral name for unknown products / indexes", () => {
    expect(describeUnitIssues([{ unitIndex: 9, code: "PRODUCT_UNAVAILABLE" }], units, names)).toEqual([
      "Un producto ya no está disponible.",
    ]);
  });

  it("explains an invalid selection", () => {
    expect(describeUnitIssues([{ unitIndex: 0, code: "INVALID_SELECTION" }], units, names)).toEqual([
      "La combinación elegida para «Ranchita simple» no es válida.",
    ]);
  });
});
