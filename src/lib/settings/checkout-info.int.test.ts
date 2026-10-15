import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { loadCheckoutInfo } from "./checkout-info";

beforeEach(resetDb);
afterAll(closeDb);

describe("loadCheckoutInfo", () => {
  it("exposes ONLY the seven checkout fields, never the store name or the accepting switch", async () => {
    await testDb()
      .insert(s.settings)
      .values([
        { key: "store_name", value: "Secret Name" },
        { key: "store_address", value: "Av. Siempreviva 742" },
        { key: "store_phone", value: "+54 11 5555-1234" },
        { key: "whatsapp", value: "5491155551234" },
        { key: "bank_alias", value: "burger.828" },
        { key: "bank_cbu", value: "0000003100012345678901" },
        { key: "delivery_fee", value: 150000 },
        { key: "accepting_orders", value: false },
        { key: "opening_hours_text", value: "Lun a Dom 20 a 00" },
      ]);
    const info = await loadCheckoutInfo(testDb());
    expect(info).toEqual({
      deliveryFee: 150000,
      bankAlias: "burger.828",
      bankCbu: "0000003100012345678901",
      storeAddress: "Av. Siempreviva 742",
      openingHoursText: "Lun a Dom 20 a 00",
      storePhone: "+54 11 5555-1234",
      whatsapp: "5491155551234",
    });
    expect(Object.keys(info).sort()).toEqual([
      "bankAlias",
      "bankCbu",
      "deliveryFee",
      "openingHoursText",
      "storeAddress",
      "storePhone",
      "whatsapp",
    ]);
  });

  it("falls back to the defaults on an empty table", async () => {
    expect(await loadCheckoutInfo(testDb())).toEqual({
      deliveryFee: 0,
      bankAlias: "",
      bankCbu: "",
      storeAddress: "",
      openingHoursText: "",
      storePhone: "",
      whatsapp: "",
    });
  });
});
