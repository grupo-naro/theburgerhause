import { describe, expect, it } from "vitest";
import { CHARS_PER_LINE, MAX_OUTPUT_BYTES, toEscPos, wrapText } from "./escpos";
import type { Codepage } from "./codepages";
import type { PrintBlock, PrintDocument } from "./document";

const doc = (...blocks: PrintBlock[]): PrintDocument => ({ blocks });
const hex = (b: Buffer) => b.toString("hex");
const enc = (d: PrintDocument, paperWidth: 58 | 80 = 80, codepage: Codepage = "cp858") => toEscPos(d, { paperWidth, codepage });
const text = (t: string, o: Partial<Extract<PrintBlock, { type: "text" }>> = {}): PrintBlock => ({ type: "text", text: t, ...o });

const INIT = "1b40";
const CP858 = "1b7413";
// ESC a / ESC E / GS ! are emitted at the start of every block, and undone after it
const RESET = "1b4500" + "1d2100" + "1b6100";
const HEADER_BYTES = 2 + 3 + 3 + 3 + 3; // init + code page + align + bold + size
const RESET_BYTES = 9;

/** The encoded bytes of ONE text block's single line, without header/LF/reset. */
function body(s: string, cp: Codepage): number[] {
  const out = enc(doc(text(s)), 80, cp);
  return [...out.subarray(HEADER_BYTES, out.length - 1 - RESET_BYTES)];
}
const latin = (bytes: number[]) => Buffer.from(bytes).toString("latin1");

describe("escpos: framing", () => {
  it("an empty document is just initialize + code page", () => {
    expect(hex(enc(doc()))).toBe(INIT + CP858);
  });

  it("selects the code page with ESC t n", () => {
    expect(hex(enc(doc(), 80, "cp437"))).toBe(INIT + "1b7400");
    expect(hex(enc(doc(), 80, "cp850"))).toBe(INIT + "1b7402");
    expect(hex(enc(doc(), 80, "cp858"))).toBe(INIT + "1b7413");
    expect(hex(enc(doc(), 80, "wpc1252"))).toBe(INIT + "1b7410");
  });

  it("plain text: align left, no bold, size 1, then everything reset", () => {
    expect(hex(enc(doc(text("Hola"))))).toBe(INIT + CP858 + "1b6100" + "1b4500" + "1d2100" + "486f6c61" + "0a" + RESET);
  });

  it("bold + size 2 + center", () => {
    const out = hex(enc(doc(text("OK", { bold: true, size: 2, align: "center" }))));
    expect(out).toBe(INIT + CP858 + "1b6101" + "1b4501" + "1d2111" + "4f4b" + "0a" + RESET);
  });

  it("explicit size 1 and bold false equal the defaults", () => {
    expect(hex(enc(doc(text("a", { size: 1, bold: false, align: "left" }))))).toBe(hex(enc(doc(text("a")))));
  });

  it("styles never leak into the next block", () => {
    const out = hex(enc(doc(text("A", { bold: true, size: 2, align: "center" }), text("B"))));
    expect(out.split(RESET)[1]).toBe("1b6100" + "1b4500" + "1d2100" + "42" + "0a");
  });

  it("divider is a line of dashes as wide as the paper", () => {
    expect(hex(enc(doc({ type: "divider" }), 80))).toBe(INIT + CP858 + Buffer.from("-".repeat(48) + "\n").toString("hex"));
    expect(hex(enc(doc({ type: "divider" }), 58))).toBe(INIT + CP858 + Buffer.from("-".repeat(32) + "\n").toString("hex"));
  });

  it("cut is a 4-line feed then a partial cut", () => {
    expect(hex(enc(doc({ type: "cut" })))).toBe(INIT + CP858 + "1b6404" + "1d564203");
  });

  it("a document with a cut ends with the cut sequence", () => {
    const out = enc(doc(text("x"), { type: "divider" }, { type: "cut" }));
    expect(hex(out).endsWith("1b64041d564203")).toBe(true);
  });

  it("an empty text block prints a blank line", () => {
    expect(hex(enc(doc(text(""))))).toBe(INIT + CP858 + "1b6100" + "1b4500" + "1d2100" + "0a" + RESET);
  });
});

describe("escpos: wrapping", () => {
  it("knows the characters per line", () => {
    expect(CHARS_PER_LINE).toEqual({ 58: 32, 80: 48 });
  });

  it("wraps at the word boundary for 32 and 48 columns", () => {
    const t = "una hamburguesa doble con cheddar y panceta bien crocante";
    expect(wrapText(t, 32)).toEqual(["una hamburguesa doble con", "cheddar y panceta bien crocante"]);
    expect(wrapText(t, 48)).toEqual(["una hamburguesa doble con cheddar y panceta bien", "crocante"]);
  });

  it("hard-breaks a word longer than the line", () => {
    expect(wrapText("a " + "x".repeat(40) + " b", 16)).toEqual(["a", "x".repeat(16), "x".repeat(16), "xxxxxxxx b"]);
  });

  it("keeps explicit newlines and leading indentation", () => {
    expect(wrapText("uno\n   dos\n\ntres", 32)).toEqual(["uno", "   dos", "", "tres"]);
  });

  it("size 2 wraps at HALF the width (24 on 80 mm, 16 on 58 mm)", () => {
    expect(enc(doc(text("A".repeat(25), { size: 2 })), 80).toString("latin1")).toContain("A".repeat(24) + "\nA\n");
    expect(enc(doc(text("A".repeat(17), { size: 2 })), 58).toString("latin1")).toContain("A".repeat(16) + "\nA\n");
    expect(enc(doc(text("A".repeat(24), { size: 2 })), 80).toString("latin1")).not.toContain("A".repeat(24) + "\nA");
  });

  it("size 1 wraps at the full width (48 / 32)", () => {
    expect(enc(doc(text("A".repeat(49))), 80).toString("latin1")).toContain("A".repeat(48) + "\nA\n");
    expect(enc(doc(text("A".repeat(33))), 58).toString("latin1")).toContain("A".repeat(32) + "\nA\n");
  });
});

describe("escpos: encoding", () => {
  it("cp858 accents (IBM/Epson table)", () => {
    expect(body("áéíóúüñ", "cp858")).toEqual([0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0x81, 0xa4]);
    expect(body("ÁÉÍÓÚÜÑ", "cp858")).toEqual([0xb5, 0x90, 0xd6, 0xe0, 0xe9, 0x9a, 0xa5]);
    expect(body("¿¡°·€", "cp858")).toEqual([0xa8, 0xad, 0xf8, 0xfa, 0xd5]);
  });

  it("cp850 matches cp858 except for the euro sign", () => {
    expect(body("áÉñÑ¿¡", "cp850")).toEqual([0xa0, 0x90, 0xa4, 0xa5, 0xa8, 0xad]);
    expect(latin(body("€", "cp850"))).toBe("EUR");
  });

  it("cp437 maps the lowercase accents and Ñ É Ü; other capitals lose the accent", () => {
    expect(body("áéíóúüñÑÉÜ¿¡°", "cp437")).toEqual([0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0x81, 0xa4, 0xa5, 0x90, 0x9a, 0xa8, 0xad, 0xf8]);
    expect(latin(body("ÁÍÓÚ", "cp437"))).toBe("AIOU");
  });

  it("wpc1252 is Windows-1252", () => {
    expect(body("áéíóúüñÁÉÍÓÚÜÑ¿¡°€·", "wpc1252")).toEqual([
      0xe1, 0xe9, 0xed, 0xf3, 0xfa, 0xfc, 0xf1, 0xc1, 0xc9, 0xcd, 0xd3, 0xda, 0xdc, 0xd1, 0xbf, 0xa1, 0xb0, 0x80, 0xb7,
    ]);
    expect(body("–—“”‘’", "wpc1252")).toEqual([0x96, 0x97, 0x93, 0x94, 0x91, 0x92]);
  });

  it("typographic punctuation falls back to ASCII where the code page has no glyph", () => {
    expect(latin(body("–—“”‘’", "cp858"))).toBe("--\"\"''");
  });

  it("unmappable characters become ? and never multibyte UTF-8", () => {
    expect(latin(body("a😀b漢c", "cp858"))).toBe("a?b?c");
    const out = enc(doc(text("Ω ☃ 😀 \u{10FFFF}")), 80, "cp437");
    expect(latin(body("Ω ☃ 😀 \u{10FFFF}", "cp437"))).toBe("? ? ? ?");
    expect(out.toString("latin1")).not.toMatch(/[Ãâð]/);
  });

  it("strips control characters except newline (tab becomes a space)", () => {
    expect(latin(body("a\u0000b\u001bc\u0007d\te\u007ff", "cp858"))).toBe("abcd ef");
    const out = enc(doc(text("x\ry\r\nz")), 80);
    expect(out.toString("latin1")).toContain("x\ny\nz\n");
  });

  it("an ESC/GS sequence smuggled in the text is neutralised", () => {
    const out = enc(doc(text("\u001dV\u0000cut")), 80).toString("latin1");
    expect(out).not.toContain("\u001dV");
    expect(out).toContain("Vcut");
  });
});

describe("escpos: robustness", () => {
  it("never throws on garbage input", () => {
    const garbage = [null, undefined, {}, { blocks: null }, { blocks: [null, 5, "x", { type: "nope" }, { type: "text" }, { type: "text", text: 5 }] }] as unknown[];
    for (const g of garbage) expect(() => toEscPos(g as PrintDocument, { paperWidth: 80, codepage: "cp858" })).not.toThrow();
  });

  it("caps the output at 256 KB and still ends with the cut", () => {
    const blocks: PrintBlock[] = Array.from({ length: 500 }, () => text("x".repeat(2000)));
    blocks.push({ type: "cut" });
    const out = enc(doc(...blocks));
    expect(MAX_OUTPUT_BYTES).toBe(256 * 1024);
    expect(out.length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(hex(out).endsWith("1b64041d564203")).toBe(true);
  });
});
