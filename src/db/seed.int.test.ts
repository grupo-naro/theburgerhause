import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { DEFAULT_SETTINGS, getSettings } from "@/lib/settings";
import { seed } from "./seed";

const db = () => testDb();
const setName = (value: string) =>
  db().update(s.settings).set({ value }).where(eq(s.settings.key, "store_name"));

beforeEach(resetDb);
afterAll(closeDb);

describe("demo seed refuses a production-marked database", () => {
  const mark = () => db().insert(s.settings).values({ key: "deployment", value: "production" });
  afterEach(() => {
    delete process.env.ALLOW_DEMO_SEED;
  });
  it("refuses with a loud Spanish message when the marker exists", async () => {
    await mark();
    await expect(seed(db())).rejects.toThrow(/NUNCA[\s\S]*producci/i);
    expect((await db().select().from(s.products)).length).toBe(0);
  });
  it("is allowed with ALLOW_DEMO_SEED=1", async () => {
    await mark();
    process.env.ALLOW_DEMO_SEED = "1";
    await expect(seed(db())).resolves.toBeUndefined();
  });
  it("is unaffected without the marker", async () => {
    await expect(seed(db())).resolves.toBeUndefined();
  });
});

describe("seed store name", () => {
  it("a fresh seed uses the settings default", async () => {
    await seed(db());
    expect((await getSettings(db())).storeName).toBe(DEFAULT_SETTINGS.storeName);
    expect(DEFAULT_SETTINGS.storeName).toBe("The Burger House 828");
  });
  it("corrects the old typo on re-seed", async () => {
    await seed(db());
    await setName("The Burger Hause");
    await seed(db());
    expect((await getSettings(db())).storeName).toBe("The Burger House 828");
  });
  it("leaves a custom name untouched", async () => {
    await seed(db());
    await setName("Mi Hamburguesería");
    await seed(db());
    expect((await getSettings(db())).storeName).toBe("Mi Hamburguesería");
  });
  it("stays idempotent", async () => {
    await seed(db());
    const snapshot = async () => JSON.stringify(await db().select().from(s.settings).orderBy(s.settings.key));
    const first = await snapshot();
    await seed(db());
    expect(await snapshot()).toBe(first);
  });
});

describe("seed demo costs", () => {
  it("products and paid extras get 40% of their price as cost; removals none", async () => {
    await seed(db());
    const prods = await db().select().from(s.products);
    expect(prods.length).toBeGreaterThan(0);
    for (const p of prods) expect(p.cost, p.name).toBe(Math.round((p.price * 0.4) / 100) * 100);
    const mods = await db().select().from(s.modifiers);
    for (const m of mods) {
      if (m.kind === "remove" || m.priceDelta === 0) expect(m.cost, m.name).toBeNull();
      else expect(m.cost, m.name).toBe(Math.round((m.priceDelta * 0.4) / 100) * 100);
    }
  });
  it("re-seeding never overwrites a cost an admin entered", async () => {
    await seed(db());
    const [p] = await db().select().from(s.products).limit(1);
    await db().update(s.products).set({ cost: 12300 }).where(eq(s.products.id, p.id));
    await seed(db());
    expect((await db().select().from(s.products).where(eq(s.products.id, p.id)))[0].cost).toBe(12300);
  });
  it("re-seeding an old database without costs fills them in", async () => {
    await seed(db());
    await db().update(s.products).set({ cost: null });
    await seed(db());
    for (const p of await db().select().from(s.products)) expect(p.cost, p.name).not.toBeNull();
  });
});

describe("seed patties", () => {
  it("simple burgers 1, double 2, everything else 0", async () => {
    await seed(db());
    const rows = await db()
      .select({ name: s.products.name, patties: s.products.patties, cat: s.categories.name })
      .from(s.products)
      .innerJoin(s.categories, eq(s.categories.id, s.products.categoryId));
    for (const r of rows) {
      const expected = r.cat === "Hamburguesa simple + papa chica" ? 1 : r.cat === "Hamburguesa doble + papa chica" ? 2 : 0;
      expect(r.patties, r.name).toBe(expected);
    }
    expect(rows.some((r) => r.patties === 2)).toBe(true);
  });
});
