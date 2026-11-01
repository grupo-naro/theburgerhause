import { describe, expect, it } from "vitest";
import { isPromoRoute, isPromoShowing, parseBaInput, promoSeenKey, promoVersion, toBaInput } from "./window";

const T = (iso: string) => new Date(iso);
const base = { imagePath: "a.webp", active: true, startsAt: null, endsAt: null };
const now = T("2026-10-31T12:00:00Z");

describe("isPromoShowing", () => {
  it("is off without a promotion, when inactive or without an image", () => {
    expect(isPromoShowing(null, now)).toBe(false);
    expect(isPromoShowing({ ...base, active: false }, now)).toBe(false);
    expect(isPromoShowing({ ...base, imagePath: null }, now)).toBe(false);
  });
  it("with no dates it is always on while active", () => {
    expect(isPromoShowing(base, now)).toBe(true);
  });
  it("starts at the start instant (inclusive), not before", () => {
    const p = { ...base, startsAt: now };
    expect(isPromoShowing(p, T("2026-10-31T11:59:59.999Z"))).toBe(false);
    expect(isPromoShowing(p, now)).toBe(true);
  });
  it("stops at the end instant (exclusive)", () => {
    const p = { ...base, endsAt: now };
    expect(isPromoShowing(p, T("2026-10-31T11:59:59.999Z"))).toBe(true);
    expect(isPromoShowing(p, now)).toBe(false);
  });
  it("works with only one bound set", () => {
    expect(isPromoShowing({ ...base, startsAt: T("2026-11-01T00:00:00Z") }, now)).toBe(false);
    expect(isPromoShowing({ ...base, endsAt: T("2026-10-01T00:00:00Z") }, now)).toBe(false);
  });
});

describe("promoVersion / promoSeenKey", () => {
  const p = { updatedAt: T("2026-10-31T10:00:00Z"), imagePath: "a.webp", title: "Halloween" };
  it("is stable for the same promotion and changes with any edit", () => {
    expect(promoVersion(p)).toBe(promoVersion({ ...p }));
    expect(promoVersion({ ...p, updatedAt: T("2026-10-31T10:00:01Z") })).not.toBe(promoVersion(p));
    expect(promoVersion({ ...p, imagePath: "b.webp" })).not.toBe(promoVersion(p));
    expect(promoVersion({ ...p, title: null })).not.toBe(promoVersion(p));
  });
  it("keys the seen flag by version", () => {
    expect(promoSeenKey(promoVersion(p))).not.toBe(promoSeenKey(promoVersion({ ...p, title: "Otra" })));
    expect(promoSeenKey("v")).toContain("v");
  });
});

describe("isPromoRoute", () => {
  it("is the store home only", () => {
    expect(isPromoRoute("/")).toBe(true);
    for (const p of ["/carrito", "/checkout", "/pedido/abc", "/admin/promocion", "/login", "/caja"]) {
      expect(isPromoRoute(p)).toBe(false);
    }
  });
});

describe("Buenos Aires date-time inputs", () => {
  it("reads wall clock as UTC-3", () => {
    expect(parseBaInput("2026-10-31T20:00")?.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(parseBaInput("2026-10-31T22:30")?.toISOString()).toBe("2026-11-01T01:30:00.000Z");
  });
  it("rejects malformed and impossible values", () => {
    for (const v of ["", "abc", "2026-10-31", "2026-02-31T10:00", "2026-10-31T25:00"]) {
      expect(parseBaInput(v)).toBeNull();
    }
  });
  it("round-trips", () => {
    expect(toBaInput(parseBaInput("2026-10-31T20:00"))).toBe("2026-10-31T20:00");
    expect(toBaInput(null)).toBe("");
  });
});
