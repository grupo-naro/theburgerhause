/**
 * Small, explicit tables for the Latin subset used in Argentine Spanish. Everything else is either
 * transliterated to ASCII (typographic punctuation, accents the code page lacks) or becomes "?".
 * Byte values are the standard IBM PC code pages (cp437, cp850, cp858) and Windows-1252, as selected
 * on Epson-compatible printers with ESC t n.
 */
export const CODEPAGES = ["cp858", "cp437", "cp850", "wpc1252"] as const;
export type Codepage = (typeof CODEPAGES)[number];

/** Argument of ESC t n. */
export const CODEPAGE_ESC_T: Record<Codepage, number> = { cp437: 0, cp850: 2, cp858: 19, wpc1252: 16 };

const PC_COMMON: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ü: 0x81, ñ: 0xa4,
  Ñ: 0xa5, É: 0x90, Ü: 0x9a,
  "¿": 0xa8, "¡": 0xad, "°": 0xf8, "·": 0xfa,
};
const PC_850: Record<string, number> = { ...PC_COMMON, Á: 0xb5, Í: 0xd6, Ó: 0xe0, Ú: 0xe9 };

const TABLES: Record<Codepage, Record<string, number>> = {
  cp437: PC_COMMON,
  cp850: PC_850,
  cp858: { ...PC_850, "€": 0xd5 },
  wpc1252: {
    á: 0xe1, é: 0xe9, í: 0xed, ó: 0xf3, ú: 0xfa, ü: 0xfc, ñ: 0xf1,
    Á: 0xc1, É: 0xc9, Í: 0xcd, Ó: 0xd3, Ú: 0xda, Ü: 0xdc, Ñ: 0xd1,
    "¿": 0xbf, "¡": 0xa1, "°": 0xb0, "€": 0x80, "·": 0xb7,
    "–": 0x96, "—": 0x97, "“": 0x93, "”": 0x94, "‘": 0x91, "’": 0x92,
  },
};

const ASCII_FALLBACK: Record<string, string> = {
  "–": "-", "—": "-", "“": '"', "”": '"', "‘": "'", "’": "'", "€": "EUR", "…": "...", " ": " ", "·": ".",
};

/** One character -> the character to really print: itself, an ASCII stand-in, or "?". Never throws. */
function printable(ch: string, table: Record<string, number>): string {
  const code = ch.codePointAt(0)!;
  if (code >= 0x20 && code <= 0x7e) return ch;
  if (ch in table) return ch;
  const fallback = ASCII_FALLBACK[ch];
  if (fallback !== undefined) return fallback;
  const base = ch.normalize("NFD")[0];
  if (base !== ch && /^[A-Za-z]$/.test(base)) return base;
  return "?";
}

/**
 * Text -> text that contains only characters the printer can print in this code page (plus "\n").
 * Line breaks are normalised (CRLF/CR -> LF), tabs become spaces, other control characters are dropped.
 */
export function normalizeText(text: string, codepage: Codepage): string {
  const table = TABLES[codepage];
  let out = "";
  for (const ch of text.replace(/\r\n?/g, "\n")) {
    if (ch === "\n") out += ch;
    else if (ch === "\t") out += " ";
    else if (/[\u0000-\u001f\u007f-\u009f]/.test(ch)) continue;
    else out += printable(ch, table);
  }
  return out;
}

/** Maps text already passed through normalizeText to printer bytes. */
export function encodeText(text: string, codepage: Codepage): Buffer {
  const table = TABLES[codepage];
  const bytes: number[] = [];
  for (const ch of text) bytes.push(ch === "\n" ? 0x0a : (table[ch] ?? (ch.charCodeAt(0) <= 0x7e ? ch.charCodeAt(0) : 0x3f)));
  return Buffer.from(bytes);
}
