import { describe, expect, it, vi } from "vitest";
import { createFakeClock } from "./fake-clock";
import { createDebounce } from "./debounce";

describe("trailing debounce", () => {
  it("collapses a burst into one trailing call", () => {
    const clock = createFakeClock();
    const fn = vi.fn();
    const d = createDebounce(fn, 250, clock);
    d.call();
    clock.advance(100);
    d.call();
    clock.advance(100);
    d.call();
    clock.advance(249);
    expect(fn).not.toHaveBeenCalled();
    clock.advance(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fires again for a later burst", () => {
    const clock = createFakeClock();
    const fn = vi.fn();
    const d = createDebounce(fn, 250, clock);
    d.call();
    clock.advance(250);
    d.call();
    clock.advance(250);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel drops the pending call and leaves no timer", () => {
    const clock = createFakeClock();
    const fn = vi.fn();
    const d = createDebounce(fn, 250, clock);
    d.call();
    d.cancel();
    expect(clock.pending()).toBe(0);
    clock.advance(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});
