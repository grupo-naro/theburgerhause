import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./index";

describe("parseSettings", () => {
  it("returns the documented defaults for an empty table", () => {
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({
      storeName: "The Burger House 828",
      storeAddress: "",
      storePhone: "",
      whatsapp: "",
      bankAlias: "",
      bankCbu: "",
      deliveryFee: 0,
      acceptingOrders: true,
      openingHoursText: "",
      businessDayCutoff: "06:00",
      kdsWarnMinutes: 8,
      kdsLateMinutes: 15,
    });
  });
  it("reads known keys and merges the rest with defaults", () => {
    const s = parseSettings([
      { key: "store_name", value: "Mi local" },
      { key: "delivery_fee", value: 150000 },
      { key: "accepting_orders", value: false },
      { key: "bank_alias", value: "burger.828" },
    ]);
    expect(s).toMatchObject({
      storeName: "Mi local",
      deliveryFee: 150000,
      acceptingOrders: false,
      bankAlias: "burger.828",
      bankCbu: "",
    });
  });
  it("tolerates garbage values by falling back to the default of that key", () => {
    const s = parseSettings([
      { key: "store_name", value: 42 },
      { key: "store_address", value: null },
      { key: "bank_cbu", value: { a: 1 } },
      { key: "delivery_fee", value: "abc" },
      { key: "accepting_orders", value: "yes" },
      { key: "opening_hours_text", value: ["x"] },
    ]);
    expect(s).toEqual(DEFAULT_SETTINGS);
  });
  it("rejects negative, fractional and non-finite fees", () => {
    for (const v of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "100"]) {
      expect(parseSettings([{ key: "delivery_fee", value: v }]).deliveryFee).toBe(0);
    }
  });
  it("ignores unknown keys", () => {
    expect(parseSettings([{ key: "something_else", value: "x" }])).toEqual(DEFAULT_SETTINGS);
  });
});
