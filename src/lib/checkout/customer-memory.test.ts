import { describe, expect, it, vi } from "vitest";
import {
  CUSTOMER_STORAGE_KEY,
  forgetCustomer,
  loadCustomer,
  parseCustomer,
  saveCustomer,
  serializeCustomer,
  type RememberedCustomer,
} from "./customer-memory";

const sample: RememberedCustomer = {
  name: "Juana Pérez",
  whatsapp: "11 5555-1234",
  address: "Calle Falsa 123",
  crossStreets: "Rivadavia y Mitre",
  notes: "Timbre roto",
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

describe("customer memory", () => {
  it("uses the documented storage key", () => {
    expect(CUSTOMER_STORAGE_KEY).toBe("bh_customer_v1");
  });

  it("round-trips a customer", () => {
    expect(parseCustomer(serializeCustomer(sample))).toEqual(sample);
  });

  it("never stores anything but the five remembered fields", () => {
    const raw = JSON.parse(
      serializeCustomer({ ...sample, paymentMethod: "transfer", cbu: "123" } as unknown as RememberedCustomer),
    );
    expect(Object.keys(raw).sort()).toEqual(["address", "crossStreets", "name", "notes", "v", "whatsapp"]);
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["not json", "{nope"],
    ["json null", "null"],
    ["an array", "[]"],
    ["a number", "42"],
    ["wrong version", JSON.stringify({ v: 2, ...sample })],
    ["missing version", JSON.stringify(sample)],
    ["a non-string field", JSON.stringify({ v: 1, ...sample, name: 5 })],
    ["a missing field", JSON.stringify({ v: 1, name: "Ana" })],
    ["an oversized field", JSON.stringify({ v: 1, ...sample, notes: "x".repeat(5000) })],
    ["an oversized payload", "x".repeat(50_000)],
  ])("returns null for %s", (_label, raw) => {
    expect(parseCustomer(raw as string | null)).toBeNull();
  });

  it("ignores unknown keys", () => {
    const parsed = parseCustomer(JSON.stringify({ v: 1, ...sample, paymentMethod: "cash", evil: "<script>" }));
    expect(parsed).toEqual(sample);
  });

  it("load/save/forget go through storage and never throw", () => {
    const s = memoryStorage();
    expect(loadCustomer(s)).toBeNull();
    saveCustomer(s, sample);
    expect(s.data.has(CUSTOMER_STORAGE_KEY)).toBe(true);
    expect(loadCustomer(s)).toEqual(sample);
    forgetCustomer(s);
    expect(loadCustomer(s)).toBeNull();

    const broken = {
      getItem: vi.fn(() => {
        throw new Error("denied");
      }),
      setItem: vi.fn(() => {
        throw new Error("quota");
      }),
      removeItem: vi.fn(() => {
        throw new Error("denied");
      }),
    };
    expect(loadCustomer(broken)).toBeNull();
    expect(() => saveCustomer(broken, sample)).not.toThrow();
    expect(() => forgetCustomer(broken)).not.toThrow();
    expect(loadCustomer(null)).toBeNull();
    expect(() => saveCustomer(null, sample)).not.toThrow();
    expect(() => forgetCustomer(undefined)).not.toThrow();
  });

  it("does not remember an entirely empty form", () => {
    const s = memoryStorage();
    saveCustomer(s, { name: " ", whatsapp: "", address: "", crossStreets: "", notes: "" });
    expect(s.data.size).toBe(0);
  });
});
