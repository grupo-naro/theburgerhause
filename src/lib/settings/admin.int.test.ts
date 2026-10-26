import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { DEFAULT_SETTINGS, getAcceptingOrders, getSettings } from "./index";
import { saveSettings, setAcceptingOrders } from "./admin";

const db = () => testDb();
const input = (over: Record<string, unknown> = {}) => ({
  storeName: "Burger Local",
  storeAddress: "Av. Siempreviva 742",
  storePhone: "+54 11 5555-1234",
  whatsapp: "5491155551234",
  bankAlias: "burger.828",
  bankCbu: "0123456789012345678901",
  deliveryFeePesos: 1500,
  acceptingOrders: true,
  openingHoursText: "Lun a Dom 20 a 00",
  businessDayCutoff: "06:00",
  basePrepMinutes: 30,
  deliveryTravelMinutes: 20,
  ...over,
});

beforeEach(resetDb);
afterAll(closeDb);

describe("getSettings", () => {
  it("returns the defaults on an empty table", async () => {
    expect(await getSettings(db())).toEqual(DEFAULT_SETTINGS);
    expect(await getAcceptingOrders(db())).toBe(true);
  });
  it("tolerates garbage jsonb in the table", async () => {
    await db()
      .insert(s.settings)
      .values([
        { key: "delivery_fee", value: "oops" },
        { key: "accepting_orders", value: 7 },
        { key: "store_name", value: { x: 1 } },
        { key: "bank_alias", value: "ok.alias" },
      ]);
    expect(await getSettings(db())).toEqual({ ...DEFAULT_SETTINGS, bankAlias: "ok.alias" });
    expect(await getAcceptingOrders(db())).toBe(true);
  });
});

describe("saveSettings", () => {
  it("round-trips every field and stores the fee in cents", async () => {
    expect(await saveSettings(db(), input())).toEqual({ ok: true, data: null });
    expect(await getSettings(db())).toEqual({
      storeName: "Burger Local",
      storeAddress: "Av. Siempreviva 742",
      storePhone: "+54 11 5555-1234",
      whatsapp: "5491155551234",
      bankAlias: "burger.828",
      bankCbu: "0123456789012345678901",
      deliveryFee: 150000,
      acceptingOrders: true,
      openingHoursText: "Lun a Dom 20 a 00",
      businessDayCutoff: "06:00",
      basePrepMinutes: 30,
      deliveryTravelMinutes: 20,
    });
    const [fee] = await db().select().from(s.settings).where(eq(s.settings.key, "delivery_fee"));
    expect(fee.value).toBe(150000);
  });
  it("overwrites on a second save (upsert, one row per key)", async () => {
    await saveSettings(db(), input());
    await saveSettings(db(), input({ deliveryFeePesos: 0, acceptingOrders: false, bankAlias: "" }));
    const got = await getSettings(db());
    expect(got).toMatchObject({ deliveryFee: 0, acceptingOrders: false, bankAlias: "" });
    expect(await db().select().from(s.settings)).toHaveLength(12);
  });
  it("rejects an invalid CBU / alias / fee with field errors and writes nothing", async () => {
    const r = await saveSettings(db(), input({ bankCbu: "123", bankAlias: "no valido", deliveryFeePesos: -5 }));
    expect(r).toMatchObject({
      ok: false,
      fieldErrors: { bankCbu: expect.any(String), bankAlias: expect.any(String), deliveryFeePesos: expect.any(String) },
    });
    expect(await db().select().from(s.settings)).toHaveLength(0);
  });
  it("rejects out-of-range minutes with field errors", async () => {
    expect(await saveSettings(db(), input({ basePrepMinutes: 4, deliveryTravelMinutes: 121 }))).toMatchObject({
      ok: false,
      fieldErrors: { basePrepMinutes: expect.any(String), deliveryTravelMinutes: expect.any(String) },
    });
  });
  it("rejects fractional pesos", async () => {
    expect(await saveSettings(db(), input({ deliveryFeePesos: 10.5 }))).toMatchObject({
      ok: false,
      fieldErrors: { deliveryFeePesos: expect.any(String) },
    });
  });
});

describe("setAcceptingOrders", () => {
  it("flips only that key and is read back immediately", async () => {
    await saveSettings(db(), input());
    expect((await setAcceptingOrders(db(), false)).ok).toBe(true);
    expect(await getAcceptingOrders(db())).toBe(false);
    expect(await getSettings(db())).toMatchObject({ acceptingOrders: false, storeName: "Burger Local", deliveryFee: 150000 });
    expect((await setAcceptingOrders(db(), true)).ok).toBe(true);
    expect(await getAcceptingOrders(db())).toBe(true);
  });
  it("works on an empty table", async () => {
    expect((await setAcceptingOrders(db(), false)).ok).toBe(true);
    expect(await getAcceptingOrders(db())).toBe(false);
    expect(await getSettings(db())).toEqual({ ...DEFAULT_SETTINGS, acceptingOrders: false });
  });
  it("rejects non-booleans", async () => {
    expect((await setAcceptingOrders(db(), "yes" as unknown as boolean)).ok).toBe(false);
  });
});

describe("numeric-looking strings", () => {
  it("a 22-digit CBU and a numeric WhatsApp come back as exact strings", async () => {
    await saveSettings(db(), input({ bankCbu: "0000003100012345678901", whatsapp: "5491155551234" }));
    expect(await getSettings(db())).toMatchObject({ bankCbu: "0000003100012345678901", whatsapp: "5491155551234" });
  });
});

describe("getBusinessDayCutoff", () => {
  it("defaults to 06:00, reads the saved value and ignores garbage", async () => {
    const { getBusinessDayCutoff } = await import("./index");
    expect(await getBusinessDayCutoff(db())).toBe("06:00");
    await saveSettings(db(), input({ businessDayCutoff: "04:30" }));
    expect(await getBusinessDayCutoff(db())).toBe("04:30");
    await db().update(s.settings).set({ value: "banana" }).where(eq(s.settings.key, "business_day_cutoff"));
    expect(await getBusinessDayCutoff(db())).toBe("06:00");
  });
});
