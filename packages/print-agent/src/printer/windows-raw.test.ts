import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrintError } from "./types";
import { listPrinters, WindowsRawBackend, type SpawnLike } from "./windows-raw";
import { RAW_PRINT_SCRIPT, scriptHash } from "./windows-script";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-winraw-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

type Call = { cmd: string; args: string[]; options: Record<string, unknown>; bytesAtSpawn: Buffer | null; killed: boolean };

/** A scripted stand-in for child_process.spawn: closes with the given exit code / stderr, or never. */
function fakeSpawn(behaviour: { code?: number; stderr?: string; stdout?: string; neverCloses?: boolean; spawnError?: Error }) {
  const calls: Call[] = [];
  const spawn: SpawnLike = (cmd, args, options) => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const dataArg = args[args.indexOf("-DataPath") + 1];
    const call: Call = { cmd, args, options: options as Record<string, unknown>, bytesAtSpawn: dataArg && fs.existsSync(dataArg) ? fs.readFileSync(dataArg) : null, killed: false };
    child.kill = () => {
      call.killed = true;
      setImmediate(() => child.emit("close", null));
      return true;
    };
    calls.push(call);
    setImmediate(() => {
      if (behaviour.spawnError) return void child.emit("error", behaviour.spawnError);
      if (behaviour.stdout) child.stdout.emit("data", Buffer.from(behaviour.stdout));
      if (behaviour.stderr) child.stderr.emit("data", Buffer.from(behaviour.stderr));
      if (!behaviour.neverCloses) child.emit("close", behaviour.code ?? 0);
    });
    return child as unknown as ReturnType<SpawnLike>;
  };
  return { spawn, calls };
}

const make = (spawn: SpawnLike, extra: Partial<ConstructorParameters<typeof WindowsRawBackend>[0]> = {}) =>
  new WindowsRawBackend({ printerName: "POS-80 (Copy 1)", dataDir: dir, spawn, ...extra });

describe("WindowsRawBackend: script construction", () => {
  it("spawns powershell.exe with fixed flags and the printer/bytes as separate arguments", async () => {
    const { spawn, calls } = fakeSpawn({});
    const bytes = Buffer.from([0x1b, 0x40, 0xa0, 0x0a]);
    await make(spawn).print(bytes, { jobId: 42 });
    expect(calls).toHaveLength(1);
    const { cmd, args } = calls[0];
    expect(cmd).toBe("powershell.exe");
    expect(args.slice(0, 6)).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", expect.stringMatching(/raw-print-[0-9a-f]{12}\.ps1$/)]);
    expect(args[args.indexOf("-PrinterName") + 1]).toBe("POS-80 (Copy 1)");
    expect(args[args.indexOf("-DocName") + 1]).toBe("BurgerHouse job 42");
    expect(calls[0].options).toMatchObject({ windowsHide: true, shell: false });
    expect(calls[0].bytesAtSpawn).toEqual(bytes); // the temp file existed, with the exact bytes, while the process ran
  });

  it("never interpolates config values into the script text", async () => {
    const { spawn } = fakeSpawn({});
    await make(spawn, { printerName: "Evil (1)" }).print(Buffer.from("x"), { jobId: 1 });
    const script = fs.readFileSync(path.join(dir, "scripts", fs.readdirSync(path.join(dir, "scripts"))[0]), "utf8");
    expect(script).toBe(RAW_PRINT_SCRIPT);
    expect(script).not.toContain("Evil");
    expect(script).toMatch(/OpenPrinterW/);
    expect(script).toMatch(/StartDocPrinterW/);
    expect(script).toMatch(/"RAW"/);
    for (const fn of ["StartPagePrinter", "WritePrinter", "EndPagePrinter", "EndDocPrinter", "ClosePrinter"]) expect(script).toContain(fn);
  });

  it("writes the script once (content-hash named) and rewrites it when it was tampered with", async () => {
    const { spawn } = fakeSpawn({});
    const b = make(spawn);
    await b.print(Buffer.from("a"), { jobId: 1 });
    const scriptsDir = path.join(dir, "scripts");
    const [name] = fs.readdirSync(scriptsDir);
    expect(name).toBe(`raw-print-${scriptHash().slice(0, 12)}.ps1`);
    const file = path.join(scriptsDir, name);
    const mtime = fs.statSync(file).mtimeMs;
    await b.print(Buffer.from("b"), { jobId: 2 });
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
    fs.writeFileSync(file, "Remove-Item C:\\ -Recurse"); // an attacker/AV changed it
    await b.print(Buffer.from("c"), { jobId: 3 });
    expect(fs.readFileSync(file, "utf8")).toBe(RAW_PRINT_SCRIPT);
  });

  it("deletes the temp file after success, after failure and after a timeout", async () => {
    const tmp = path.join(dir, "tmp");
    const left = () => (fs.existsSync(tmp) ? fs.readdirSync(tmp) : []);
    await make(fakeSpawn({}).spawn).print(Buffer.from("a"), { jobId: 1 });
    expect(left()).toEqual([]);
    await make(fakeSpawn({ code: 3, stderr: "boom" }).spawn).print(Buffer.from("a"), { jobId: 2 }).catch(() => undefined);
    expect(left()).toEqual([]);
    await make(fakeSpawn({ neverCloses: true }).spawn, { timeoutMs: 30 }).print(Buffer.from("a"), { jobId: 3 }).catch(() => undefined);
    expect(left()).toEqual([]);
  });
});

describe("WindowsRawBackend: validation", () => {
  it.each(["a;b", "x`y", "$(calc)", "a|b", "x'y", 'x"y', "a".repeat(101), "a\nb", "a<b", ""])("rejects the printer name %j without spawning anything", async (name) => {
    const { spawn, calls } = fakeSpawn({});
    await expect(new WindowsRawBackend({ printerName: name, dataDir: dir, spawn }).print(Buffer.from("x"), { jobId: 1 })).rejects.toBeInstanceOf(PrintError);
    expect(calls).toHaveLength(0);
  });

  it("accepts the usual names", async () => {
    const { spawn, calls } = fakeSpawn({});
    for (const name of ["POS-80", "EPSON TM-T20II Receipt", "XP-80C (copy 2)", "Generic / Text Only", "Ticketera #1", "A&B+C"]) {
      await new WindowsRawBackend({ printerName: name, dataDir: dir, spawn }).print(Buffer.from("x"), { jobId: 1 });
    }
    expect(calls).toHaveLength(6);
  });
});

describe("WindowsRawBackend: error mapping", () => {
  const run = (b: fakeBehaviour, opts: Partial<ConstructorParameters<typeof WindowsRawBackend>[0]> = {}) =>
    make(fakeSpawn(b).spawn, opts).print(Buffer.from("x"), { jobId: 1 }).then(
      () => null,
      (e: unknown) => e as PrintError,
    );
  type fakeBehaviour = Parameters<typeof fakeSpawn>[0];

  it("exit 2 = printer not found", async () => {
    const e = await run({ code: 2, stderr: "PRINTER_NOT_FOUND 1801" });
    expect(e).toBeInstanceOf(PrintError);
    expect(e?.message).toBe("No se encontró la impresora «POS-80 (Copy 1)»");
  });

  it("exit 5 = the Windows print spooler is not running", async () => {
    expect((await run({ code: 5, stderr: "SPOOLER_DOWN 1722" }))?.message).toBe("El servicio de impresión de Windows (Spooler) no está activo");
  });

  it("exit 3 = the printer did not accept the data", async () => {
    const e = await run({ code: 3, stderr: "WRITE_FAILED 5" });
    expect(e?.message).toBe("La impresora no responde");
  });

  it("any other failure becomes a short generic message without raw stderr or stack", async () => {
    const e = await run({ code: 1, stderr: "At line:1 char:5 + throw secret-stack-trace-C:\\Users\\x" });
    expect(e).toBeInstanceOf(PrintError);
    expect(e?.message).toBe("Falló la impresión en Windows (código 1)");
    expect(e?.message).not.toContain("secret");
  });

  it("a non-zero exit is an error even with empty stderr; exit 0 with stderr noise is success", async () => {
    expect((await run({ code: 7 }))?.message).toContain("código 7");
    expect(await run({ code: 0, stderr: "WARNING: something harmless" })).toBeNull();
  });

  it("a timeout kills the process and reports that the printer does not answer", async () => {
    const f = fakeSpawn({ neverCloses: true });
    const e = (await make(f.spawn, { timeoutMs: 40 }).print(Buffer.from("x"), { jobId: 1 }).catch((x: unknown) => x)) as PrintError;
    expect(e).toBeInstanceOf(PrintError);
    expect(e.message).toBe("La impresora no respondió a tiempo");
    expect(f.calls[0].killed).toBe(true);
  });

  it("powershell missing (spawn error) is a clear message", async () => {
    const e = await run({ spawnError: Object.assign(new Error("spawn powershell.exe ENOENT"), { code: "ENOENT" }) });
    expect(e?.message).toBe("No se pudo ejecutar PowerShell en este equipo");
  });

  it("describe() names the printer", () => {
    expect(make(fakeSpawn({}).spawn).describe()).toBe("Windows RAW → «POS-80 (Copy 1)»");
  });
});

describe("listPrinters", () => {
  it("parses Get-Printer JSON (array or single object) using a constant command", async () => {
    const json = JSON.stringify([
      { Name: "POS-80", DriverName: "Generic / Text Only", PortName: "USB001", PrinterStatus: 0 },
      { Name: "PDF", DriverName: "Microsoft Print To PDF", PortName: "PORTPROMPT:", PrinterStatus: 0 },
    ]);
    const f = fakeSpawn({ stdout: json });
    const list = await listPrinters(f.spawn);
    expect(list).toEqual([
      { name: "POS-80", driver: "Generic / Text Only", port: "USB001" },
      { name: "PDF", driver: "Microsoft Print To PDF", port: "PORTPROMPT:" },
    ]);
    expect(f.calls[0].cmd).toBe("powershell.exe");
    expect(f.calls[0].args).toContain("-Command");
    expect(f.calls[0].args.join(" ")).toContain("Get-Printer");
    const single = await listPrinters(fakeSpawn({ stdout: JSON.stringify({ Name: "Only", DriverName: "D", PortName: "P" }) }).spawn);
    expect(single).toEqual([{ name: "Only", driver: "D", port: "P" }]);
  });

  it("returns an empty list for empty output and rejects with a PrintError on failure", async () => {
    expect(await listPrinters(fakeSpawn({ stdout: "" }).spawn)).toEqual([]);
    await expect(listPrinters(fakeSpawn({ code: 1, stderr: "x" }).spawn)).rejects.toBeInstanceOf(PrintError);
  });
});

// Real Windows spooler. Skipped unless RAW_PRINTER_NAME names an installed printer (it WILL print a tiny ticket).
const real = process.platform === "win32" && process.env.RAW_PRINTER_NAME ? describe : describe.skip;
real("WindowsRawBackend on a real printer (RAW_PRINTER_NAME)", () => {
  it("prints through the Windows spooler", async () => {
    const b = new WindowsRawBackend({ printerName: process.env.RAW_PRINTER_NAME!, dataDir: dir });
    await b.print(Buffer.concat([Buffer.from([0x1b, 0x40]), Buffer.from("Burger Hause - prueba RAW\n\n\n"), Buffer.from([0x1d, 0x56, 0x42, 0x03])]), { jobId: 1 });
  }, 30_000);

});

// Needs only Windows + PowerShell (no printer): exercises the real script, the P/Invoke and the exit codes.
function spoolerRunning(): boolean {
  try {
    return /RUNNING/.test(execFileSync("sc.exe", ["query", "spooler"], { encoding: "utf8" }));
  } catch {
    return false;
  }
}
const onWindows = process.platform === "win32" ? describe : describe.skip;
onWindows("WindowsRawBackend with the real PowerShell script (Windows only, no printer needed)", () => {
  it("reports an unknown printer (or a stopped spooler) clearly", async () => {
    const b = new WindowsRawBackend({ printerName: "No Existe 12345", dataDir: dir });
    const expected = spoolerRunning() ? "No se encontró la impresora «No Existe 12345»" : "El servicio de impresión de Windows (Spooler) no está activo";
    await expect(b.print(Buffer.from("x"), { jobId: 1 })).rejects.toThrow(expected);
  }, 30_000);

  it("listPrinters runs Get-Printer for real (or fails cleanly with a stopped spooler)", async () => {
    if (spoolerRunning()) expect(Array.isArray(await listPrinters())).toBe(true);
    else await expect(listPrinters()).rejects.toBeInstanceOf(PrintError);
  }, 30_000);
});
