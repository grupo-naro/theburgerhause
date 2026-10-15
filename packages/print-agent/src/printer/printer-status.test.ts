import { describe, expect, it } from "vitest";
import { ATTR_BLOCK_MASK, describePrinterState, STATUS_BLOCK_MASK, STATUS_REASONS, stateMessage } from "./printer-status";

describe("printer status table", () => {
  it("blocks on the states where the paper cannot come out", () => {
    const expected: [number, string][] = [
      [0x2, "con error"],
      [0x8, "con papel atascado"],
      [0x10, "sin papel"],
      [0x40, "con problema de papel"],
      [0x80, "desconectada"],
      [0x1000, "no disponible"],
      [0x100000, "esperando intervención"],
      [0x400000, "con la tapa abierta"],
    ];
    for (const [bit, reason] of expected) expect(describePrinterState(bit, 0), `0x${bit.toString(16)}`).toEqual([reason]);
  });

  it("WORK_OFFLINE in the attributes means disconnected", () => {
    expect(describePrinterState(0, 0x400)).toEqual(["desconectada"]);
    expect(describePrinterState(0x80, 0x400)).toEqual(["desconectada"]); // reported once
  });

  it("does not block on harmless or unknown states", () => {
    for (const status of [0, 0x1000000 /* power save */, 0x200 /* busy */, 0x400 /* printing */, 0x100 /* io active */, 0x4000 /* processing */, 0x8000, 0x10000, 0x20000, 0x1]) {
      expect(describePrinterState(status, 0), `0x${status.toString(16)}`).toEqual([]);
    }
    expect(describePrinterState(0, 0x8 /* queued, harmless attribute */)).toEqual([]);
  });

  it("combines reasons, in a stable order", () => {
    expect(describePrinterState(0x10 | 0x80, 0)).toEqual(["desconectada", "sin papel"]);
  });

  it("exposes the masks passed to the script, derived from the same table", () => {
    expect(STATUS_BLOCK_MASK).toBe(STATUS_REASONS.reduce((m, r) => m | r.bit, 0));
    expect(STATUS_BLOCK_MASK & 0x1000000).toBe(0);
    expect(ATTR_BLOCK_MASK).toBe(0x400);
  });

  it("builds a short Spanish message", () => {
    expect(stateMessage(0x10, 0)).toBe("La impresora no está lista: sin papel");
    expect(stateMessage(0x80 | 0x10, 0)).toBe("La impresora no está lista: desconectada, sin papel");
    expect(stateMessage(0, 0)).toBe("La impresora no está lista");
  });
});
