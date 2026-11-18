import { describe, expect, it } from "vitest";
import { productIdsFromForm } from "./form-data";

const fd = (ids: string[]) => {
  const f = new FormData();
  for (const id of ids) f.append("productId", id);
  return f;
};

describe("productIdsFromForm", () => {
  it("reads repeated ids, none = [], anything else = null", () => {
    expect(productIdsFromForm(fd(["3", "7"]))).toEqual([3, 7]);
    expect(productIdsFromForm(fd([]))).toEqual([]);
    expect(productIdsFromForm(fd(["3", "x"]))).toBeNull();
    expect(productIdsFromForm(fd(["0"]))).toBeNull();
  });
});
