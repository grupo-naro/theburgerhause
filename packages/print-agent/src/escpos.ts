import { CODEPAGE_ESC_T, encodeText, normalizeText, type Codepage } from "./codepages";
import type { PrintBlock, PrintDocument } from "./document";
import { LOGO_RASTERS, type LogoRaster } from "./logo-data";

export type PaperWidth = 58 | 80;
export type EscPosOptions = { paperWidth: PaperWidth; codepage: Codepage };

/** Characters per line at Font A. */
export const CHARS_PER_LINE: Record<PaperWidth, number> = { 58: 32, 80: 48 };
export const MAX_OUTPUT_BYTES = 256 * 1024;

const INIT = Buffer.from([0x1b, 0x40]); // ESC @
const FEED_AND_CUT = Buffer.from([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x03]); // ESC d 4, GS V 66 3 (partial cut)
const LF = Buffer.from([0x0a]);
const RESET_STYLE = Buffer.from([0x1b, 0x45, 0x00, 0x1d, 0x21, 0x00, 0x1b, 0x61, 0x00]); // bold off, size 1, align left

/** Brand name printed instead of the logo when the raster is unusable (large, bold, centered). */
export const LOGO_FALLBACK_TEXT = "THE BURGER HOUSE 828";

/** Max raster width in dots per paper width (printable area of the head). */
const MAX_LOGO_DOTS: Record<PaperWidth, number> = { 58: 384, 80: 512 };

/** ESC a 1 + GS v 0 m=0 xL xH yL yH + data + ESC a 0 + LF; null when the raster is not a valid bitmap for this paper. */
function logoRaster(paperWidth: PaperWidth, logos: Record<PaperWidth, LogoRaster> | null): Buffer | null {
  const logo = logos?.[paperWidth];
  if (!logo) return null;
  const { width, height } = logo;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width % 8 !== 0) return null;
  if (width > MAX_LOGO_DOTS[paperWidth] || height > 1_000) return null;
  const data = Buffer.from(logo.data, "base64");
  const bytesPerRow = width / 8;
  if (data.length !== bytesPerRow * height) return null;
  const head = Buffer.from([0x1b, 0x61, 0x01, 0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, height & 0xff, height >> 8]);
  return Buffer.concat([head, data, Buffer.from([0x1b, 0x61, 0x00]), LF]);
}

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
  return t === "divider" || t === "cut" || t === "logo" || (t === "text" && typeof (b as { text?: unknown }).text === "string");
}

/** PrintDocument -> ESC/POS bytes (Epson-compatible). Pure; never throws; output <= 256 KB. */
export function toEscPos(
  doc: PrintDocument,
  opts: EscPosOptions,
  deps: { logos: Record<PaperWidth, LogoRaster> | null } = { logos: LOGO_RASTERS },
): Buffer {
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
          : block.type === "logo"
            ? (logoRaster(opts.paperWidth, deps.logos) ??
              textBlock({ type: "text", text: LOGO_FALLBACK_TEXT, bold: true, size: 2, align: "center" }, opts))
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
