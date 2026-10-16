import { describe, expect, it } from "vitest";
import { CART_STORAGE_KEY } from "@/lib/cart/persistence";
import { POS_CART_KEY_PREFIX, posCartStorageKey } from "./storage-key";

describe("posCartStorageKey", () => {
  it("is versioned and per station", () => {
    expect(posCartStorageKey(3)).toBe("bh_pos_cart_v1:3");
    expect(posCartStorageKey(3)).not.toBe(posCartStorageKey(4));
  });
  it("never equals the customer cart key", () => {
    expect(posCartStorageKey(1)).not.toBe(CART_STORAGE_KEY);
    expect(posCartStorageKey(1).startsWith(POS_CART_KEY_PREFIX)).toBe(true);
  });
  it("admin without a station gets a dedicated key (never shared with a station)", () => {
    expect(posCartStorageKey(null)).toBe("bh_pos_cart_v1:none");
  });
});
