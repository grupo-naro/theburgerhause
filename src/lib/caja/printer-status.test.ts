import { describe, expect, it } from "vitest";
import { derivePrinterStatus } from "./printer-status";

const now = new Date("2026-10-15T12:00:00.000Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString();

describe("derivePrinterStatus", () => {
  it("never seen: offline, Sin agente", () => {
    expect(derivePrinterStatus({ lastSeenAt: null, failedCount: 0, now })).toMatchObject({
      online: false,
      tone: "error",
      label: "Sin agente",
    });
  });
  it("seen within 90 s: online (boundary inclusive)", () => {
    expect(derivePrinterStatus({ lastSeenAt: ago(89), failedCount: 0, now })).toMatchObject({
      online: true,
      tone: "ok",
      label: "Impresora lista",
    });
    expect(derivePrinterStatus({ lastSeenAt: ago(90), failedCount: 0, now }).online).toBe(true);
  });
  it("seen 91 s ago: offline", () => {
    expect(derivePrinterStatus({ lastSeenAt: ago(91), failedCount: 0, now })).toMatchObject({
      online: false,
      label: "Sin agente",
    });
  });
  it("failed jobs make it an error even when online, with the count", () => {
    expect(derivePrinterStatus({ lastSeenAt: ago(5), failedCount: 2, now })).toMatchObject({
      online: true,
      tone: "error",
      label: "2 impresiones fallidas",
    });
    expect(derivePrinterStatus({ lastSeenAt: ago(5), failedCount: 1, now }).label).toBe("1 impresión fallida");
  });
  it("offline with failures mentions both", () => {
    expect(derivePrinterStatus({ lastSeenAt: null, failedCount: 3, now }).label).toBe("Sin agente · 3 fallidas");
  });
  it("a future lastSeen (clock skew) counts as online", () => {
    expect(derivePrinterStatus({ lastSeenAt: ago(-30), failedCount: 0, now }).online).toBe(true);
  });
});
