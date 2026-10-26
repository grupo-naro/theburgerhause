import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLivePoller } from "./live-poller";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(refresh: () => Promise<void>, visible = () => true) {
  return createLivePoller({
    intervalMs: 60_000,
    isVisible: visible,
    refresh,
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
}

describe("createLivePoller", () => {
  it("refreshes every interval while visible", async () => {
    const refresh = vi.fn(async () => {});
    make(refresh).start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stop() during an in-flight fetch leaves no timer and no further fetches", async () => {
    let release!: () => void;
    const refresh = vi.fn(() => new Promise<void>((r) => (release = r)));
    const p = make(refresh);
    p.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    p.stop();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stop() during an in-flight wake() fetch also leaves nothing behind", async () => {
    let release!: () => void;
    const refresh = vi.fn(() => new Promise<void>((r) => (release = r)));
    const p = make(refresh);
    p.wake();
    p.stop();
    release();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("wake() after stop() does nothing", async () => {
    const refresh = vi.fn(async () => {});
    const p = make(refresh);
    p.stop();
    p.wake();
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hidden tab: no timer; wake() while hidden clears it", async () => {
    let visible = true;
    const refresh = vi.fn(async () => {});
    const p = make(refresh, () => visible);
    p.start();
    visible = false;
    p.wake();
    expect(vi.getTimerCount()).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });
});
