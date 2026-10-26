import { describe, expect, it } from "vitest";
import { isTvPath, shouldAutoReload, TV_RELOAD_INTERVAL_MS } from "./auto-reload";

describe("isTvPath", () => {
  it("is true for /pantalla and its sub paths only", () => {
    expect(isTvPath("/pantalla")).toBe(true);
    expect(isTvPath("/pantalla/")).toBe(true);
    expect(isTvPath("/pantalla/x")).toBe(true);
  });
  it("is false for everything else", () => {
    for (const p of ["/", "/mostrador", "/pantallas", "/admin/pantalla", "", null, undefined]) expect(isTvPath(p)).toBe(false);
  });
});

describe("shouldAutoReload", () => {
  it("reloads on the TV when online", () => expect(shouldAutoReload("/pantalla", true)).toBe(true));
  it("waits while offline", () => expect(shouldAutoReload("/pantalla", false)).toBe(false));
  it("never reloads other routes", () => expect(shouldAutoReload("/mostrador", true)).toBe(false));
  it("ticks every 15 s", () => expect(TV_RELOAD_INTERVAL_MS).toBe(15_000));
});
