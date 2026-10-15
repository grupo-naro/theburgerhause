import { describe, expect, it } from "vitest";
import { isValidPrinterName, PRINTER_NAME_PATTERN } from "./printer-name";

describe("printer name validation", () => {
  it.each(["Impresora Térmica 80mm", "EPSON TM-T20II Receipt", "\\\\PC\\POS", "\\\\SERVIDOR-1\\EPSON TM", "Ñandú-1", "POS-80 (Copy 1)", "Generic / Text Only", "A&B+C #2", "Cocina, 2", "Joe's printer"])("accepts %j", (name) => {
    expect(isValidPrinterName(name)).toBe(true);
  });

  it.each(['x"y', "-Verbose", "-x y", "a;b", "a|b", "a`b", "$(calc)", "a<b", "a>b", "a*b", "a?b", "50%", "a".repeat(101), "", " lead", "a\nb", "a\u0000b", "a\tb", "\\\\PC\\", "\\\\\\POS", "..\\x"])("rejects %j", (name) => {
    expect(isValidPrinterName(name)).toBe(false);
  });

  it("accepts exactly 100 characters, in one shared exported pattern", () => {
    expect(isValidPrinterName("a".repeat(100))).toBe(true);
    expect(PRINTER_NAME_PATTERN).toBeInstanceOf(RegExp);
  });
});
