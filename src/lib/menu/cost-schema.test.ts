import { describe, expect, it } from "vitest";
import { redactCost, withCostFor } from "./cost-schema";

describe("admin-only cost helpers", () => {
  it("withCostFor drops the cost for non-admins", () => {
    expect(withCostFor("admin", { costArs: 10 }).costArs).toBe(10);
    expect(withCostFor("encargado", { costArs: 10 }).costArs).toBeUndefined();
    expect(withCostFor("encargado", { costArs: null }).costArs).toBeUndefined();
  });
  it("redactCost removes the key for non-admins", () => {
    expect("cost" in redactCost({ id: 1, cost: 5 }, "encargado")).toBe(false);
    expect(redactCost({ id: 1, cost: 5 }, "admin")).toEqual({ id: 1, cost: 5 });
  });
});
