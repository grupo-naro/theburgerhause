import { describe, expect, it } from "vitest";
import { modifierFromForm } from "@/lib/modifiers/form-data";
import { productFromForm } from "./form-data";

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("cost from the form", () => {
  it("missing key = undefined (keep), empty = null (clear), number = number", () => {
    for (const from of [productFromForm, modifierFromForm]) {
      expect(from(fd({})).costArs).toBeUndefined();
      expect(from(fd({ costArs: "" })).costArs).toBeNull();
      expect(from(fd({ costArs: " 1500 " })).costArs).toBe(1500);
      expect(from(fd({ costArs: "abc" })).costArs).toBeNaN();
    }
  });
});

describe("patties from the form", () => {
  it("missing key = undefined (keep), a number = that number", () => {
    expect(productFromForm(fd({})).patties).toBeUndefined();
    expect(productFromForm(fd({ patties: "2" })).patties).toBe(2);
  });
});
