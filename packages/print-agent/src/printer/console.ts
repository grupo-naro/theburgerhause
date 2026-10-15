import type { PrinterBackend, PrintContext } from "./types";

/** ESC/POS bytes -> readable text: commands are dropped, text kept, a cut shows as [corte]. */
export function previewEscPos(bytes: Buffer): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x1b) {
      i += bytes[i + 1] === 0x40 ? 1 : 2; // ESC @ | ESC t/a/E/d/... n
    } else if (b === 0x1d) {
      const cmd = bytes[i + 1];
      if (cmd === 0x56) {
        out += "[corte]\n";
        i += bytes[i + 2] === 65 || bytes[i + 2] === 66 ? 3 : 2; // GS V m [n]
      } else i += 2; // GS ! n and friends
    } else if (b === 0x0a || (b >= 0x20 && b <= 0x7e)) out += String.fromCharCode(b);
    else if (b >= 0x80) out += "?";
  }
  return out;
}

/** Development backend: prints a text preview to the console instead of paper. */
export class ConsoleBackend implements PrinterBackend {
  constructor(private readonly write: (s: string) => void = (s) => void process.stdout.write(s)) {}

  async print(bytes: Buffer, ctx: PrintContext): Promise<void> {
    this.write(`----- job ${ctx.jobId} (${bytes.length} bytes) -----\n${previewEscPos(bytes)}\n`);
  }

  describe(): string {
    return "Consola (solo desarrollo)";
  }
}
