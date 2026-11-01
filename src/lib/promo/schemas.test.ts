import { describe, expect, it } from "vitest";
import { promoInputSchema } from "./schemas";

const IMG = "123e4567-e89b-12d3-a456-426614174000.webp";
const ok = (over: object = {}) => promoInputSchema.safeParse({ imagePath: IMG, title: "", active: true, startsAt: "", endsAt: "", ...over });

describe("promoInputSchema", () => {
  it("accepts a minimal promotion; blank title and dates become null", () => {
    const r = ok();
    expect(r.success && r.data).toMatchObject({ imagePath: IMG, title: null, active: true, startsAt: null, endsAt: null });
  });
  it("parses Buenos Aires dates", () => {
    const r = ok({ startsAt: "2026-10-31T20:00", endsAt: "2026-11-01T02:00" });
    expect(r.success && r.data.startsAt?.toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });
  it("requires the end after the start", () => {
    for (const endsAt of ["2026-10-31T20:00", "2026-10-31T19:00"]) {
      const r = ok({ startsAt: "2026-10-31T20:00", endsAt });
      expect(r.success).toBe(false);
      expect(!r.success && r.error.issues[0].path[0]).toBe("endsAt");
    }
  });
  it("caps the title at 120 characters and rejects bad image names and dates", () => {
    expect(ok({ title: "x".repeat(120) }).success).toBe(true);
    expect(ok({ title: "x".repeat(121) }).success).toBe(false);
    expect(ok({ imagePath: "../etc/passwd" }).success).toBe(false);
    expect(ok({ startsAt: "mañana" }).success).toBe(false);
  });
});
