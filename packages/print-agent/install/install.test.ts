import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Dry-run / parse tests for the PowerShell installer. They need Windows PowerShell (win32 only) and never
 * register a task, touch a printer or write outside a temp dir.
 */
const win = process.platform === "win32";
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const TOKEN = "bhst_" + "A1b2C3d4".repeat(5) + "xyz";

let tmp = "";
let node20 = "";
let node18 = "";

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bh-install-test-"));
  node20 = path.join(tmp, "node20.cmd");
  node18 = path.join(tmp, "node18.cmd");
  fs.writeFileSync(node20, "@echo v20.11.0\r\n");
  fs.writeFileSync(node18, "@echo v18.19.0\r\n");
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function ps(script: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(dir, script), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const base = (extra: string[] = []) => ["-ServerUrl", "https://pedidos.example.com", "-Token", TOKEN, "-PrinterName", "POS-80", "-InstallDir", path.join(tmp, "inst"), "-NodeExe", node20, ...extra];

describe.skipIf(!win)("install.ps1", () => {
  it("every .ps1 parses with zero errors and uses no PowerShell 7-only syntax", () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ps1"));
    expect(files).toEqual(expect.arrayContaining(["install.ps1", "uninstall.ps1", "status.ps1", "update.ps1", "common.ps1"]));
    for (const f of files) {
      const full = path.join(dir, f);
      const r = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${full}',[ref]$t,[ref]$e);$e|%{$_.Message};exit $e.Count`],
        { encoding: "utf8" },
      );
      expect(r.status, `${f}: ${r.stdout}`).toBe(0);
      const raw = fs.readFileSync(full);
      expect([raw[0], raw[1], raw[2]], `${f} must be UTF-8 with BOM`).toEqual([0xef, 0xbb, 0xbf]);
      const code = raw.toString("utf8").replace(/#.*$/gm, "").replace(/"[^"\n]*"|'[^'\n]*'/g, '""');
      expect(code, f).not.toMatch(/\?\?|&&|\|\||\)\s*\?\s|-Parallel/);
    }
  });

  it("dry-run prints the plan and the task XML, exits 0 and never shows the token", () => {
    const r = ps("install.ps1", base(["-DryRun"]));
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toContain(TOKEN);
    expect(r.out).toContain("<BootTrigger>");
    expect(r.out).toContain("<Delay>PT30S</Delay>");
    expect(r.out).toContain("<UserId>S-1-5-18</UserId>");
    expect(r.out).toContain("<RunLevel>HighestAvailable</RunLevel>");
    expect(r.out).toContain("<Count>999</Count>");
    // watchdog: a second trigger repeating every 5 minutes, forever (no <Duration>), harmless thanks to IgnoreNew
    expect(r.out).toContain("<TimeTrigger>");
    expect(r.out).toMatch(/<Repetition>\s*<Interval>PT5M<\/Interval>\s*<StopAtDurationEnd>false<\/StopAtDurationEnd>/);
    expect(r.out).not.toContain("<Duration>");
    expect(r.out).not.toContain("<EndBoundary>");
    expect((r.out.match(/<(BootTrigger|TimeTrigger)>/g) ?? []).length).toBe(2);
    expect(r.out).toContain("<Interval>PT1M</Interval>");
    expect(r.out).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(r.out).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(r.out).toContain("<Hidden>true</Hidden>");
    expect(r.out).toContain("print-agent.cjs");
    expect(r.out).toContain("<Arguments>");
    expect(r.out).toContain("icacls");
    expect(r.out).toContain("SIMULACIÓN");
    expect(r.out).toContain("BurgerHouseAgent");
    expect(fs.existsSync(path.join(tmp, "inst"))).toBe(false);
  });

  it("dry-run without -Token never prompts and uses a placeholder", () => {
    const r = ps("install.ps1", ["-DryRun", "-ServerUrl", "https://pedidos.example.com", "-PrinterName", "POS-80", "-InstallDir", path.join(tmp, "inst"), "-NodeExe", node20]);
    expect(r.code, r.out).toBe(0);
  });

  it("-TaskName and -PaperWidth 58 are reflected in the plan", () => {
    const r = ps("install.ps1", base(["-DryRun", "-TaskName", "BurgerHouseAgentTest", "-PaperWidth", "58", "-CodePage", "cp437"]));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("BurgerHouseAgentTest");
    expect(r.out).toMatch(/PAPER_WIDTH\s*[:=]\s*58/);
    expect(r.out).toMatch(/CODEPAGE\s*[:=]\s*cp437/);
  });

  it("refuses without elevation (real run) with the exact Spanish fix, exit 3", () => {
    const r = ps("install.ps1", base(), { BH_TEST_ELEVATED: "0" });
    expect(r.code, r.out).toBe(3);
    expect(r.out).toContain("Abrí PowerShell como Administrador");
    expect(r.out).not.toContain(TOKEN);
    expect(fs.existsSync(path.join(tmp, "inst"))).toBe(false);
  });

  it("rejects a token with the wrong shape, exit 2", () => {
    const r = ps("install.ps1", base(["-DryRun"]).map((a) => (a === TOKEN ? "bhst_corto" : a)));
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("El token no tiene el formato esperado");
    expect(r.out).not.toContain("bhst_corto");
  });

  it("rejects http:// unless localhost with -AllowInsecure, exit 2", () => {
    const remote = ps("install.ps1", ["-DryRun", "-ServerUrl", "http://pedidos.example.com", "-Token", TOKEN, "-PrinterName", "POS-80", "-InstallDir", path.join(tmp, "inst"), "-NodeExe", node20]);
    expect(remote.code, remote.out).toBe(2);
    expect(remote.out).toContain("https://");
    const local = ps("install.ps1", ["-DryRun", "-ServerUrl", "http://localhost:3000", "-Token", TOKEN, "-PrinterName", "POS-80", "-InstallDir", path.join(tmp, "inst"), "-NodeExe", node20]);
    expect(local.code, local.out).toBe(2);
    const ok = ps("install.ps1", ["-DryRun", "-AllowInsecure", "-ServerUrl", "http://localhost:3000", "-Token", TOKEN, "-PrinterName", "POS-80", "-InstallDir", path.join(tmp, "inst"), "-NodeExe", node20]);
    expect(ok.code, ok.out).toBe(0);
    const remoteAllow = ps("install.ps1", ["-DryRun", "-AllowInsecure", "-ServerUrl", "http://pedidos.example.com", "-Token", TOKEN, "-PrinterName", "POS-80", "-InstallDir", path.join(tmp, "inst"), "-NodeExe", node20]);
    expect(remoteAllow.code, remoteAllow.out).toBe(2);
  });

  it("rejects Node older than 20, exit 5", () => {
    const r = ps("install.ps1", base(["-DryRun"]).map((a) => (a === node20 ? node18 : a)));
    expect(r.code, r.out).toBe(5);
    expect(r.out).toContain("Node.js 20 o superior");
    expect(r.out).toContain("v18.19.0");
  });

  it("rejects an unknown paper width, exit 2", () => {
    const r = ps("install.ps1", base(["-DryRun", "-PaperWidth", "70"]));
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("58 o 80");
  });

  it("rejects an unsafe printer name, exit 2", () => {
    const r = ps("install.ps1", base(["-DryRun"]).map((a) => (a === "POS-80" ? "bad;name" : a)));
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("nombre de la impresora");
  });
});
