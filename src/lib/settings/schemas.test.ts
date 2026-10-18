import { describe, expect, it } from "vitest";
import { settingsInputSchema } from "./schemas";

const base = {
  storeName: "The Burger House 828",
  storeAddress: "Calle 1",
  storePhone: "",
  whatsapp: "",
  bankAlias: "",
  bankCbu: "",
  deliveryFeePesos: 0,
  acceptingOrders: true,
  openingHoursText: "",
  businessDayCutoff: "06:00",
};

describe("settingsInputSchema", () => {
  it("accepts a full valid input and blank optional fields", () => {
    expect(settingsInputSchema.safeParse(base).success).toBe(true);
  });
  it("cbu: blank or exactly 22 digits", () => {
    expect(settingsInputSchema.safeParse({ ...base, bankCbu: "1".repeat(22) }).success).toBe(true);
    for (const bankCbu of ["1".repeat(21), "1".repeat(23), "12345678901234567890ab", "1234 5678 9012 3456 7890 12"]) {
      expect(settingsInputSchema.safeParse({ ...base, bankCbu }).success).toBe(false);
    }
  });
  it("alias: up to 40 of letters, digits, dot, underscore, dash", () => {
    expect(settingsInputSchema.safeParse({ ...base, bankAlias: "burger.house_828-x" }).success).toBe(true);
    expect(settingsInputSchema.safeParse({ ...base, bankAlias: "a".repeat(41) }).success).toBe(false);
    for (const bankAlias of ["con espacio", "ñandú", "a@b", "a/b"]) {
      expect(settingsInputSchema.safeParse({ ...base, bankAlias }).success).toBe(false);
    }
  });
  it("trims text and requires a store name", () => {
    expect(settingsInputSchema.parse({ ...base, storeName: "  Local  " }).storeName).toBe("Local");
    expect(settingsInputSchema.safeParse({ ...base, storeName: "  " }).success).toBe(false);
  });
  it("delivery fee: whole non-negative pesos", () => {
    expect(settingsInputSchema.safeParse({ ...base, deliveryFeePesos: 1500 }).success).toBe(true);
    for (const deliveryFeePesos of [-1, 1.5, Number.NaN, 100_000_001]) {
      expect(settingsInputSchema.safeParse({ ...base, deliveryFeePesos }).success).toBe(false);
    }
  });
  it("bounds the text lengths", () => {
    expect(settingsInputSchema.safeParse({ ...base, storeName: "x".repeat(81) }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ ...base, storeAddress: "x".repeat(201) }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ ...base, openingHoursText: "x".repeat(501) }).success).toBe(false);
  });
  it("phones allow digits, spaces, + - ( ) only", () => {
    expect(settingsInputSchema.safeParse({ ...base, storePhone: "+54 (11) 5555-1234", whatsapp: "5491155551234" }).success).toBe(
      true,
    );
    expect(settingsInputSchema.safeParse({ ...base, whatsapp: "wa me" }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ ...base, storePhone: "1".repeat(31) }).success).toBe(false);
  });
});

describe("businessDayCutoff", () => {
  it("accepts HH:MM", () => {
    for (const businessDayCutoff of ["00:00", "06:00", "23:59"]) expect(settingsInputSchema.safeParse({ ...base, businessDayCutoff }).success).toBe(true);
  });
  it("rejects anything else", () => {
    for (const businessDayCutoff of ["", "6:00", "24:00", "06:60", "06", "ab:cd"]) expect(settingsInputSchema.safeParse({ ...base, businessDayCutoff }).success).toBe(false);
  });
});
