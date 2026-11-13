import { describe, expect, it } from "vitest";
import { originLabel } from "./origin";

describe("originLabel", () => {
  it("tells counter sales from app takeaway orders; delivery has no label", () => {
    expect(originLabel({ channel: "counter", fulfillment: "takeaway" })).toBe("MOSTRADOR");
    expect(originLabel({ channel: "web", fulfillment: "takeaway" })).toBe("APP · RETIRA EN LOCAL");
    expect(originLabel({ channel: "web", fulfillment: "delivery" })).toBeNull();
  });
});
