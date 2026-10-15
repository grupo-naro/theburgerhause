import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createRateLimiter", () => {
  it("allows up to the limit then blocks", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: c.now });
    expect(rl.check("a").ok).toBe(true);
    expect(rl.check("a").ok).toBe(true);
    expect(rl.check("a").ok).toBe(true);
    expect(rl.check("a").ok).toBe(false);
  });

  it("reports retryAfterMs until the oldest hit leaves the window", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: c.now });
    rl.check("a");
    c.advance(300);
    rl.check("a");
    c.advance(100);
    const r = rl.check("a");
    expect(r).toEqual({ ok: false, retryAfterMs: 600 });
  });

  it("allows again after the window expires", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    expect(rl.check("a").ok).toBe(true);
    expect(rl.check("a").ok).toBe(false);
    c.advance(1000);
    expect(rl.check("a").ok).toBe(true);
  });

  it("blocked attempts do not extend the block", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    rl.check("a");
    c.advance(900);
    rl.check("a");
    c.advance(100);
    expect(rl.check("a").ok).toBe(true);
  });

  it("keeps keys independent", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    expect(rl.check("a").ok).toBe(true);
    expect(rl.check("b").ok).toBe(true);
    expect(rl.check("a").ok).toBe(false);
  });

  it("evicts expired keys so memory stays bounded", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    for (let i = 0; i < 50; i++) rl.check(`k${i}`);
    expect(rl.size()).toBe(50);
    c.advance(1001);
    rl.check("fresh");
    expect(rl.size()).toBe(1);
  });

  it("never exceeds maxKeys and treats an evicted key as fresh", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 10_000, now: c.now, maxKeys: 5 });
    for (let i = 0; i < 100; i++) {
      c.advance(1);
      rl.check(`k${i}`);
      expect(rl.size()).toBeLessThanOrEqual(5);
    }
    // k0 was evicted: it is allowed again although its window has not expired.
    expect(rl.check("k0").ok).toBe(true);
    // k99 is still tracked and blocked.
    expect(rl.check("k99").ok).toBe(false);
    expect(rl.size()).toBeLessThanOrEqual(5);
  });
});
