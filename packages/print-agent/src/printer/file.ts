import fs from "node:fs";
import path from "node:path";
import { PrintError, type PrinterBackend, type PrintContext } from "./types";

/**
 * Writes every print to OUTPUT_DIR/job-<id>-<n>.bin (raw ESC/POS). Used for development, tests and
 * `test-print`. It never overwrites: a job printed twice leaves two files, so duplicates are visible.
 */
export class FileBackend implements PrinterBackend {
  constructor(private readonly dir: string) {}

  async print(bytes: Buffer, ctx: PrintContext): Promise<void> {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      for (let n = 1; ; n++) {
        const target = path.join(this.dir, `job-${ctx.jobId}-${n}.bin`);
        try {
          fs.writeFileSync(target, bytes, { flag: "wx" }); // fails if it exists: never overwrite
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
          throw err;
        }
        return;
      }
    } catch {
      throw new PrintError("No se pudo escribir el archivo de impresión");
    }
  }

  describe(): string {
    return `Archivo → ${this.dir}`;
  }
}
