import { describe, expect, it } from "vitest";
import { connectionState, ONLINE_WINDOW_MS, renameInputSchema, stationInputSchema } from "./schemas";

describe("stationInputSchema", () => {
  it("accepts a name and a kind and trims the name", () => {
    expect(stationInputSchema.parse({ name: "  Mostrador 2 ", kind: "mostrador" })).toEqual({
      name: "Mostrador 2",
      kind: "mostrador",
    });
    expect(stationInputSchema.parse({ name: "Delivery", kind: "delivery" }).kind).toBe("delivery");
  });
  it("rejects blank or long names and unknown kinds", () => {
    expect(stationInputSchema.safeParse({ name: " ", kind: "mostrador" }).success).toBe(false);
    expect(stationInputSchema.safeParse({ name: "x".repeat(61), kind: "mostrador" }).success).toBe(false);
    expect(stationInputSchema.safeParse({ name: "ok", kind: "cocina" }).success).toBe(false);
    expect(stationInputSchema.safeParse({ name: "ok" }).success).toBe(false);
  });
  it("rename needs a valid id and name", () => {
    expect(renameInputSchema.parse({ id: 2, name: " Nuevo " })).toEqual({ id: 2, name: "Nuevo" });
    expect(renameInputSchema.safeParse({ id: 0, name: "x" }).success).toBe(false);
  });
});

describe("connectionState", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  it("is never without a last_seen_at", () => {
    expect(connectionState(null, now)).toBe("never");
  });
  it("is online within 90 seconds (inclusive) and offline after", () => {
    expect(ONLINE_WINDOW_MS).toBe(90_000);
    expect(connectionState(new Date(now.getTime() - 5_000), now)).toBe("online");
    expect(connectionState(new Date(now.getTime() - 90_000), now)).toBe("online");
    expect(connectionState(new Date(now.getTime() - 90_001), now)).toBe("offline");
    expect(connectionState(new Date(now.getTime() - 3_600_000), now)).toBe("offline");
  });
  it("treats a slightly future timestamp (clock skew) as online", () => {
    expect(connectionState(new Date(now.getTime() + 2_000), now)).toBe("online");
  });
});
