import { describe, expect, it } from "vitest";
import { DEFAULT_BACKOFF, reconnectDelay } from "./backoff";

describe("reconnectDelay", () => {
  it("doubles from 1 s and caps at 30 s", () => {
    const seq = [0, 1, 2, 3, 4, 5, 6, 20].map((n) => reconnectDelay(n));
    expect(seq).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it("honours custom bounds", () => {
    expect(reconnectDelay(0, { minMs: 10, maxMs: 50 })).toBe(10);
    expect(reconnectDelay(2, { minMs: 10, maxMs: 50 })).toBe(40);
    expect(reconnectDelay(3, { minMs: 10, maxMs: 50 })).toBe(50);
  });

  it("treats negative / absurd attempts safely", () => {
    expect(reconnectDelay(-3)).toBe(DEFAULT_BACKOFF.minMs);
    expect(reconnectDelay(10_000)).toBe(DEFAULT_BACKOFF.maxMs);
    expect(reconnectDelay(Number.NaN)).toBe(DEFAULT_BACKOFF.minMs);
  });
});
