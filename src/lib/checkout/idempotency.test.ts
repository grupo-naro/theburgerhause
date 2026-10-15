import { describe, expect, it, vi } from "vitest";
import { cartSignature, CHECKOUT_KEY_STORAGE, createKeyHolder } from "./idempotency";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

const ids = (...list: string[]) => {
  let i = 0;
  return () => list[i++] ?? `fallback-${i}`;
};
const K1 = "11111111-1111-4111-8111-111111111111";
const K2 = "22222222-2222-4222-9222-222222222222";

describe("cartSignature", () => {
  const a = { productId: 1, modifierIds: [2, 3], note: "" };
  const b = { productId: 4, modifierIds: [], note: "sin sal" };

  it("is independent of line order", () => {
    expect(cartSignature([a, b])).toBe(cartSignature([b, a]));
  });
  it("changes when quantity, modifiers or notes change", () => {
    const base = cartSignature([a, b]);
    expect(cartSignature([a, b, b])).not.toBe(base);
    expect(cartSignature([{ ...a, modifierIds: [2] }, b])).not.toBe(base);
    expect(cartSignature([a, { ...b, note: "con sal" }])).not.toBe(base);
  });
});

describe("createKeyHolder", () => {
  it("creates one key and reuses it for the same cart (retries, double clicks, reloads)", () => {
    const s = memoryStorage();
    const holder = createKeyHolder(s, ids(K1, K2));
    expect(holder.get("sig")).toBe(K1);
    expect(holder.get("sig")).toBe(K1);
    // A reload builds a new holder over the same sessionStorage.
    expect(createKeyHolder(s, ids(K2)).get("sig")).toBe(K1);
  });

  it("regenerates when the cart contents change", () => {
    const s = memoryStorage();
    const holder = createKeyHolder(s, ids(K1, K2));
    expect(holder.get("sig-a")).toBe(K1);
    expect(holder.get("sig-b")).toBe(K2);
    expect(createKeyHolder(s, ids("x")).get("sig-b")).toBe(K2);
  });

  it("regenerates after clear (successful order)", () => {
    const s = memoryStorage();
    const holder = createKeyHolder(s, ids(K1, K2));
    expect(holder.get("sig")).toBe(K1);
    holder.clear();
    expect(s.data.has(CHECKOUT_KEY_STORAGE)).toBe(false);
    expect(holder.get("sig")).toBe(K2);
  });

  it("ignores a corrupt stored value", () => {
    const s = memoryStorage();
    s.setItem(CHECKOUT_KEY_STORAGE, "{broken");
    expect(createKeyHolder(s, ids(K1)).get("sig")).toBe(K1);
    s.setItem(CHECKOUT_KEY_STORAGE, JSON.stringify({ k: "not-a-uuid", s: "sig" }));
    expect(createKeyHolder(s, ids(K2)).get("sig")).toBe(K2);
  });

  it("stays stable in memory when storage is unavailable or throws", () => {
    const broken = {
      getItem: vi.fn(() => {
        throw new Error("denied");
      }),
      setItem: vi.fn(() => {
        throw new Error("denied");
      }),
      removeItem: vi.fn(() => {
        throw new Error("denied");
      }),
    };
    const holder = createKeyHolder(broken, ids(K1, K2));
    expect(holder.get("sig")).toBe(K1);
    expect(holder.get("sig")).toBe(K1);
    expect(() => holder.clear()).not.toThrow();
    expect(holder.get("sig")).toBe(K2);

    const none = createKeyHolder(null, ids(K1));
    expect(none.get("sig")).toBe(K1);
    expect(none.get("sig")).toBe(K1);
  });

  it("default generator produces uuid v4 keys", () => {
    expect(createKeyHolder(null).get("sig")).toMatch(UUID);
  });
});
