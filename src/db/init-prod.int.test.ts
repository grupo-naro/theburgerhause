import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { DEFAULT_SETTINGS, getSettings } from "@/lib/settings";
import { initProd } from "./init-prod";

const db = () => testDb();
async function rowCounts() {
  const r = await db().execute(sql`
    select (select count(*) from categories)::int as categories, (select count(*) from products)::int as products,
           (select count(*) from users)::int as users, (select count(*) from stations)::int as stations,
           (select count(*) from cadets)::int as cadets, (select count(*) from modifier_groups)::int as modifier_groups,
           (select count(*) from settings)::int as settings`);
  return r.rows[0] as Record<string, number>;
}

beforeEach(resetDb);
afterAll(closeDb);

describe("db:init-prod", () => {
  it("creates only settings, closed for orders, and no demo data", async () => {
    await initProd(db());
    expect(await rowCounts()).toEqual({
      categories: 0, products: 0, users: 0, stations: 0, cadets: 0, modifier_groups: 0, settings: 9,
    });
    const st = await getSettings(db());
    expect(st.acceptingOrders).toBe(false);
    expect(st.deliveryFee).toBe(0);
    expect(st.storeName).toBe(DEFAULT_SETTINGS.storeName);
  });
  it("is idempotent", async () => {
    await initProd(db());
    const snap = async () => JSON.stringify(await db().select().from(s.settings).orderBy(s.settings.key));
    const first = await snap();
    await initProd(db());
    expect(await snap()).toBe(first);
  });
  it("never overwrites values the owner already set (e.g. accepting orders open)", async () => {
    await initProd(db());
    await db().update(s.settings).set({ value: true }).where(eq(s.settings.key, "accepting_orders"));
    await db().update(s.settings).set({ value: 250000 }).where(eq(s.settings.key, "delivery_fee"));
    await initProd(db());
    const st = await getSettings(db());
    expect(st.acceptingOrders).toBe(true);
    expect(st.deliveryFee).toBe(250000);
  });
});
