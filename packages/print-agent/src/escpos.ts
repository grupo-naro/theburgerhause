import { CODEPAGE_ESC_T, encodeText, normalizeText, type Codepage } from "./codepages";
import type { PrintBlock, PrintDocument } from "./document";

export type PaperWidth = 58 | 80;
export type EscPosOptions = { paperWidth: PaperWidth; codepage: Codepage };

/** Characters per line at Font A. */
export const CHARS_PER_LINE: Record<PaperWidth, number> = { 58: 32, 80: 48 };
export const MAX_OUTPUT_BYTES = 256 * 1024;

const INIT = Buffer.from([0x1b, 0x40]); // ESC @
const FEED_AND_CUT = Buffer.from([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x03]); // ESC d 4, GS V 66 3 (partial cut)
const LF = Buffer.from([0x0a]);
const RESET_STYLE = Buffer.from([0x1b, 0x45, 0x00, 0x1d, 0x21, 0x00, 0x1b, 0x61, 0x00]); // bold off, size 1, align left

/** Word-wraps to `width` columns: breaks on spaces, hard-breaks longer words, keeps "\n" and indentation. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length <= width) {
      lines.push(line);
      continue;
    }
    let cur: string | null = null;
    for (const word of line.split(" ")) {
      if (cur !== null && cur.length + 1 + word.length <= width) {
        cur += " " + word;
        continue;
      }
      if (cur !== null) lines.push(cur.trimEnd());
      let rest = word;
      while (rest.length > width) {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      cur = rest;
    }
    if (cur !== null) lines.push(cur.trimEnd());
  }
  return lines;
}

function textBlock(block: Extract<PrintBlock, { type: "text" }>, opts: EscPosOptions): Buffer {
  const size = block.size === 2 ? 2 : 1;
  const width = Math.floor(CHARS_PER_LINE[opts.paperWidth] / size);
  const style = Buffer.from([0x1b, 0x61, block.align === "center" ? 1 : 0, 0x1b, 0x45, block.bold ? 1 : 0, 0x1d, 0x21, size === 2 ? 0x11 : 0x00]);
  const lines = wrapText(normalizeText(block.text, opts.codepage), width).map((l) => Buffer.concat([encodeText(l, opts.codepage), LF]));
  return Buffer.concat([style, ...lines, RESET_STYLE]);
}

function isBlock(b: unknown): b is PrintBlock {
  if (typeof b !== "object" || b === null) return false;
  const t = (b as { type?: unknown }).type;
  return t === "divider" || t === "cut" || (t === "text" && typeof (b as { text?: unknown }).text === "string");
}

/** PrintDocument -> ESC/POS bytes (Epson-compatible). Pure; never throws; output <= 256 KB. */
export function toEscPos(doc: PrintDocument, opts: EscPosOptions): Buffer {
  const head = Buffer.concat([INIT, Buffer.from([0x1b, 0x74, CODEPAGE_ESC_T[opts.codepage] ?? 19])]);
  const blocks = Array.isArray((doc as { blocks?: unknown } | null)?.blocks) ? (doc.blocks as unknown[]).filter(isBlock) : [];
  const hasCut = blocks.some((b) => b.type === "cut");
  const reserve = hasCut ? FEED_AND_CUT.length : 0;
  const parts: Buffer[] = [head];
  let size = head.length;
  let truncated = false;
  for (const block of blocks) {
    const part =
      block.type === "cut"
        ? FEED_AND_CUT
        : block.type === "divider"
          ? Buffer.concat([Buffer.from("-".repeat(CHARS_PER_LINE[opts.paperWidth])), LF])
          : textBlock(block, opts);
    if (size + part.length > MAX_OUTPUT_BYTES - reserve) {
      truncated = true; // oversize: stop here, the tail below still cuts the paper
      break;
    }
    parts.push(part);
    size += part.length;
  }
  if (truncated && hasCut) parts.push(FEED_AND_CUT);
  return Buffer.concat(parts);
}
