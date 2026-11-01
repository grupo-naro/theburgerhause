import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { getPromo, savePromo } from "./admin";
import { getPublicPromo } from "./public";

const A = "123e4567-e89b-12d3-a456-426614174000.webp";
const B = "223e4567-e89b-12d3-a456-426614174000.webp";
const input = (over: object = {}) => ({ imagePath: A, title: "Halloween", active: true, startsAt: "", endsAt: "", ...over });
const deps = { deleteImage: async () => {} };

beforeEach(resetDb);
afterAll(closeDb);

describe("savePromo", () => {
  it("creates the single row, then updates it in place", async () => {
    const deleteImage = vi.fn(async () => {});
    expect(await savePromo(testDb(), input(), { deleteImage })).toEqual({ ok: true, data: null });
    expect(await getPromo(testDb())).toMatchObject({ id: 1, imagePath: A, title: "Halloween", active: true, startsAt: null, endsAt: null });
    await savePromo(testDb(), input({ title: "Otra", startsAt: "2026-10-31T20:00", endsAt: "2026-11-01T02:00" }), { deleteImage });
    const rows = await testDb().select().from(s.storePromo);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Otra");
    expect(rows[0].startsAt?.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(rows[0].endsAt?.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(deleteImage).not.toHaveBeenCalled();
  });
  it("bumps updated_at on every save (the version the customers' seen flag keys on)", async () => {
    await savePromo(testDb(), input(), deps);
    const first = (await getPromo(testDb()))!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await savePromo(testDb(), input(), deps);
    expect((await getPromo(testDb()))!.updatedAt.getTime()).toBeGreaterThan(first.getTime());
  });
  it("replacing the image deletes the old files; removing it too", async () => {
    const deleteImage = vi.fn(async () => {});
    await savePromo(testDb(), input(), { deleteImage });
    await savePromo(testDb(), input({ imagePath: B }), { deleteImage });
    expect(deleteImage).toHaveBeenLastCalledWith(A);
    await savePromo(testDb(), input({ imagePath: null, active: false }), { deleteImage });
    expect(deleteImage).toHaveBeenLastCalledWith(B);
    expect((await getPromo(testDb()))!.imagePath).toBeNull();
  });
  it("a failure deleting the old file does not fail the save", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await savePromo(testDb(), input(), deps);
    const r = await savePromo(testDb(), input({ imagePath: B }), {
      deleteImage: async () => {
        throw new Error("disk");
      },
    });
    expect(r.ok).toBe(true);
  });
  it("validates: end after start, title length, image name, activation needs an image", async () => {
    const cases: [object, string][] = [
      [{ startsAt: "2026-10-31T20:00", endsAt: "2026-10-31T20:00" }, "endsAt"],
      [{ startsAt: "2026-10-31T20:00", endsAt: "2026-10-30T20:00" }, "endsAt"],
      [{ title: "x".repeat(121) }, "title"],
      [{ imagePath: "evil.png" }, "imagePath"],
      [{ imagePath: null, active: true }, "imagePath"],
      [{ startsAt: "nope" }, "startsAt"],
    ];
    for (const [over, field] of cases) {
      const r = await savePromo(testDb(), input(over), deps);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.fieldErrors?.[field]).toBeTruthy();
    }
    expect(await getPromo(testDb())).toBeNull();
  });
  it("the table itself refuses a second row and an inverted window", async () => {
    await expect(testDb().insert(s.storePromo).values({ id: 2 })).rejects.toThrow();
    await expect(
      testDb().insert(s.storePromo).values({ id: 1, startsAt: new Date(2000), endsAt: new Date(1000) }),
    ).rejects.toThrow();
  });
});

describe("getPublicPromo", () => {
  it("is null without a row, inactive, or without an image", async () => {
    expect(await getPublicPromo(testDb())).toBeNull();
    await savePromo(testDb(), input({ active: false }), deps);
    expect(await getPublicPromo(testDb())).toBeNull();
    await savePromo(testDb(), input({ imagePath: null, active: false }), deps);
    expect(await getPublicPromo(testDb())).toBeNull();
  });
  it("returns only what the storefront needs while showing", async () => {
    await savePromo(testDb(), input(), deps);
    expect(await getPublicPromo(testDb())).toEqual({ version: expect.any(String), imageUrl: `/uploads/${A}`, title: "Halloween" });
  });
  it("evaluates the window at the given time", async () => {
    await savePromo(testDb(), input({ startsAt: "2026-10-31T20:00", endsAt: "2026-11-01T02:00" }), deps);
    expect(await getPublicPromo(testDb(), new Date("2026-10-31T22:59:59Z"))).toBeNull();
    expect(await getPublicPromo(testDb(), new Date("2026-10-31T23:00:00Z"))).not.toBeNull();
    expect(await getPublicPromo(testDb(), new Date("2026-11-01T04:59:59Z"))).not.toBeNull();
    expect(await getPublicPromo(testDb(), new Date("2026-11-01T05:00:00Z"))).toBeNull();
  });
});
