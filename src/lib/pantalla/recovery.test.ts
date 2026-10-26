import { describe, expect, it, vi } from "vitest";
import { RECOVERY_FIRST_MS, RECOVERY_INTERVAL_MS, RELOAD_AFTER_RETRIES, recoveryStep, refreshIfHealthy } from "./recovery";

describe("recoveryStep (the TV's error screen keeps trying by itself)", () => {
  it("first retries in place soon, then every ~15 s", () => {
    expect(recoveryStep(1)).toEqual({ action: "retry", delayMs: RECOVERY_FIRST_MS });
    expect(recoveryStep(2)).toEqual({ action: "retry", delayMs: RECOVERY_INTERVAL_MS });
    expect(RECOVERY_FIRST_MS).toBeLessThanOrEqual(5_000);
    expect(RECOVERY_INTERVAL_MS).toBe(15_000);
  });

  it("if retrying in place keeps failing, it reloads the whole page (every ~15 s, forever)", () => {
    expect(recoveryStep(RELOAD_AFTER_RETRIES).action).toBe("retry");
    expect(recoveryStep(RELOAD_AFTER_RETRIES + 1)).toEqual({ action: "reload", delayMs: RECOVERY_INTERVAL_MS });
    expect(recoveryStep(1000)).toEqual({ action: "reload", delayMs: RECOVERY_INTERVAL_MS });
  });

  it("nonsense attempts count as the first one", () => {
    expect(recoveryStep(0)).toEqual(recoveryStep(1));
    expect(recoveryStep(Number.NaN)).toEqual(recoveryStep(1));
  });
});

describe("refreshIfHealthy", () => {
  it("refreshes only when /api/health answers ok", async () => {
    const refresh = vi.fn();
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await refreshIfHealthy(fetcher, refresh)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("/api/health", expect.objectContaining({ cache: "no-store" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([502, 503, 429, 500])("skips the refresh on %i (a failed refresh would leave the TV on an error page)", async (status) => {
    const refresh = vi.fn();
    expect(await refreshIfHealthy(async () => new Response("", { status }), refresh)).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("skips the refresh when the request itself fails (network down)", async () => {
    const refresh = vi.fn();
    expect(
      await refreshIfHealthy(async () => {
        throw new TypeError("Failed to fetch");
      }, refresh),
    ).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
