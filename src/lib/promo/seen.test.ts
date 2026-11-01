import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stubStorage(blocked = false) {
  const data = new Map<string, string>();
  vi.stubGlobal("window", {
    get sessionStorage() {
      if (blocked) throw new Error("blocked");
      return {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
      };
    },
  });
  return data;
}

describe("promo seen flag", () => {
  it("is per version and persists in sessionStorage", async () => {
    const data = stubStorage();
    const { hasSeenPromo, markPromoSeen } = await import("./seen");
    expect(hasSeenPromo("v1")).toBe(false);
    markPromoSeen("v1");
    expect(hasSeenPromo("v1")).toBe(true);
    expect(hasSeenPromo("v2")).toBe(false);
    expect([...data.keys()]).toHaveLength(1);
  });
  it("reads a flag stored by an earlier page of the session", async () => {
    stubStorage().set("bh:promo-seen:v1", "1");
    const { hasSeenPromo } = await import("./seen");
    expect(hasSeenPromo("v1")).toBe(true);
  });
  it("falls back to memory when storage is blocked", async () => {
    stubStorage(true);
    const { hasSeenPromo, markPromoSeen } = await import("./seen");
    expect(hasSeenPromo("v1")).toBe(false);
    markPromoSeen("v1");
    expect(hasSeenPromo("v1")).toBe(true);
    expect(hasSeenPromo("v2")).toBe(false);
  });
});
