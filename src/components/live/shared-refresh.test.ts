import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelRefresh, REFRESH_DEBOUNCE_MS, requestRefresh } from "./shared-refresh";

let online = true;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: number) => clearTimeout(h) });
  vi.stubGlobal("navigator", {
    get onLine() {
      return online;
    },
  });
  online = true;
});
afterEach(() => {
  cancelRefresh();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("requestRefresh", () => {
  it("coalesces a burst into one refresh after the debounce", () => {
    const router = { refresh: vi.fn() };
    requestRefresh(router);
    requestRefresh(router);
    requestRefresh(router);
    expect(router.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the browser is offline (a failed refresh would navigate to the browser's error page)", () => {
    const router = { refresh: vi.fn() };
    online = false;
    requestRefresh(router);
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 4);
    expect(router.refresh).not.toHaveBeenCalled();
    online = true;
    requestRefresh(router);
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("a refresh asked just before the connection drops is dropped too", () => {
    const router = { refresh: vi.fn() };
    requestRefresh(router);
    online = false;
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
