import { describe, expect, it } from "vitest";
import { canReprint, formatOrderTime, printChips, whatsappHref } from "./labels";

describe("printChips", () => {
  it("nothing queued yet shows nothing", () => {
    expect(printChips({ pending: 0, failed: 0, done: 0 })).toEqual([]);
  });
  it("pending jobs", () => {
    expect(printChips({ pending: 2, failed: 0, done: 0 })).toEqual([{ state: "pending", label: "Impresión: pendiente" }]);
  });
  it("all done is ok", () => {
    expect(printChips({ pending: 0, failed: 0, done: 2 })).toEqual([{ state: "ok", label: "Impresión: ok" }]);
  });
  it("failures come first and hide ok", () => {
    expect(printChips({ pending: 1, failed: 1, done: 1 }).map((c) => c.state)).toEqual(["failed", "pending"]);
  });
});

describe("canReprint", () => {
  it("approved orders only", () => {
    expect(canReprint("en_preparacion")).toBe(true);
    expect(canReprint("entregado")).toBe(true);
    expect(canReprint("pendiente_aprobacion")).toBe(false);
    expect(canReprint("cancelado")).toBe(false);
  });
});

describe("whatsappHref", () => {
  it("keeps digits only", () => {
    expect(whatsappHref("+54 9 11 5555-1234")).toBe("https://wa.me/5491155551234");
  });
  it("too short or empty is null", () => {
    expect(whatsappHref("123")).toBeNull();
    expect(whatsappHref(null)).toBeNull();
  });
});

describe("formatOrderTime", () => {
  it("uses Argentina time (UTC-3)", () => {
    expect(formatOrderTime("2026-10-15T15:41:00.000Z")).toBe("12:41");
  });
  it("midnight is 00:05, never 24:05", () => {
    expect(formatOrderTime("2026-10-15T03:05:00.000Z")).toBe("00:05");
  });
});
