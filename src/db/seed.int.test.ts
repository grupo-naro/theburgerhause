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
