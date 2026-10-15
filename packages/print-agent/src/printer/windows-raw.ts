import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isValidPrinterName } from "./printer-name";
import { ATTR_BLOCK_MASK, STATUS_BLOCK_MASK, stateMessage } from "./printer-status";
import { PrintError, type PrinterBackend, type PrintContext } from "./types";
import { RAW_PRINT_SCRIPT, scriptHash } from "./windows-script";

export type SpawnLike = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

const POWERSHELL = "powershell.exe";
const FIXED_FLAGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];
const MAX_CAPTURE = 64 * 1024;

type RunResult = { code: number | null; stdout: string; stderr: string };

/** Runs a child process with a hard timeout; rejects with PrintError on spawn failure or timeout. */
function run(spawn: SpawnLike, args: string[], timeoutMs: number, timeoutMessage: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    let child: ChildProcess;
    try {
      child = spawn(POWERSHELL, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      reject(new PrintError("No se pudo ejecutar PowerShell en este equipo"));
      return;
    }
    const timer = setTimeout(() => {
      finish(() => {
        try {
          child.kill();
        } catch {
          // already gone
        }
        reject(new PrintError(timeoutMessage));
      });
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < MAX_CAPTURE) stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < MAX_CAPTURE) stderr += d.toString("utf8");
    });
    child.on("error", () => finish(() => reject(new PrintError("No se pudo ejecutar PowerShell en este equipo"))));
    child.on("close", (code) => finish(() => resolve({ code, stdout, stderr })));
  });
}

export type WindowsRawOptions = {
  printerName: string;
  dataDir: string;
  spawn?: SpawnLike;
  timeoutMs?: number;
};

/**
 * Prints RAW ESC/POS through the Windows spooler using the printer's normal driver (no WinUSB/Zadig).
 * No native modules: a constant PowerShell script P/Invokes winspool.drv. The printer name and the
 * data file path are passed as arguments (never interpolated), after validating the name.
 */
export class WindowsRawBackend implements PrinterBackend {
  private readonly spawn: SpawnLike;
  private readonly timeoutMs: number;
  private scriptPath: string | null = null;

  constructor(private readonly opts: WindowsRawOptions) {
    this.spawn = opts.spawn ?? nodeSpawn;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async print(bytes: Buffer, ctx: PrintContext): Promise<void> {
    const name = this.opts.printerName;
    if (!isValidPrinterName(name)) throw new PrintError("El nombre de la impresora no es válido (revisá PRINTER_NAME)");
    const script = this.ensureScript();
    const tmpDir = path.join(this.opts.dataDir, "tmp");
    const dataFile = path.join(tmpDir, `job-${ctx.jobId}-${randomBytes(6).toString("hex")}.bin`);
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(dataFile, bytes, { mode: 0o600 });
    } catch {
      throw new PrintError("No se pudo preparar el archivo temporal de impresión");
    }
    try {
      const args = [...FIXED_FLAGS, "-File", script, "-PrinterName", name, "-DataPath", dataFile, "-DocName", `BurgerHouse job ${ctx.jobId}`, "-StatusMask", String(STATUS_BLOCK_MASK), "-AttrMask", String(ATTR_BLOCK_MASK)];
      const r = await run(this.spawn, args, this.timeoutMs, "La impresora no respondió a tiempo");
      if (r.code === 0) return;
      if (r.code === 2) throw new PrintError(`No se encontró la impresora «${name}»`);
      if (r.code === 3) throw new PrintError("La impresora no responde");
      if (r.code === 6) {
        const m = /PRINTER_STATE (\d+) (\d+)/.exec(r.stderr);
        throw new PrintError(m ? stateMessage(Number(m[1]), Number(m[2])) : "La impresora no está lista");
      }
      if (r.code === 5) throw new PrintError("El servicio de impresión de Windows (Spooler) no está activo");
      throw new PrintError(`Falló la impresión en Windows (código ${r.code ?? "?"})`);
    } finally {
      try {
        fs.rmSync(dataFile, { force: true });
      } catch {
        // best effort; the tmp dir is swept on the next start
      }
    }
  }

  describe(): string {
    return `Windows RAW → «${this.opts.printerName}»`;
  }

  /** Writes the constant script once under DATA_DIR/scripts, named by its hash; rewrites it if altered. */
  private ensureScript(): string {
    if (this.scriptPath && this.scriptIsIntact(this.scriptPath)) return this.scriptPath;
    const dir = path.join(this.opts.dataDir, "scripts");
    const file = path.join(dir, `raw-print-${scriptHash().slice(0, 12)}.ps1`);
    if (!this.scriptIsIntact(file)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
        fs.writeFileSync(tmp, RAW_PRINT_SCRIPT, "utf8");
        fs.renameSync(tmp, file);
      } catch {
        throw new PrintError("No se pudo preparar el script de impresión");
      }
    }
    this.scriptPath = file;
    return file;
  }

  private scriptIsIntact(file: string): boolean {
    try {
      return scriptHash(fs.readFileSync(file, "utf8")) === scriptHash();
    } catch {
      return false;
    }
  }
}

export type InstalledPrinter = { name: string; driver: string; port: string };

/** Installed printers via Get-Printer (constant command, no input): helps pick PRINTER_NAME. */
export async function listPrinters(spawn: SpawnLike = nodeSpawn, timeoutMs = 20_000): Promise<InstalledPrinter[]> {
  const command = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Printer | Select-Object Name,DriverName,PortName | ConvertTo-Json -Compress";
  const r = await run(spawn, [...FIXED_FLAGS, "-Command", command], timeoutMs, "PowerShell no respondió al listar las impresoras");
  if (r.code !== 0) throw new PrintError("No se pudo listar las impresoras de Windows");
  const text = r.stdout.trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PrintError("No se pudo interpretar la lista de impresoras de Windows");
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .map((p) => ({ name: String(p.Name ?? ""), driver: String(p.DriverName ?? ""), port: String(p.PortName ?? "") }))
    .filter((p) => p.name !== "");
}
