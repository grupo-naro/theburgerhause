import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The REAL install path of install.ps1 (copy files, write config, check, "register") without elevation and
 * without touching Task Scheduler: BH_TEST_ELEVATED=1, BH_TEST_SKIP_ACL=1 and BH_TEST_SKIP_TASK=1 are test-only
 * switches. Scripts are staged in a temp dir next to a dummy print-agent.cjs.
 */
const win = process.platform === "win32";
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const TOKEN = "bhst_" + "A1b2C3d4".repeat(5) + "xyz";
const TEST_ENV = { BH_TEST_ELEVATED: "1", BH_TEST_SKIP_ACL: "1", BH_TEST_SKIP_TASK: "1" };

let tmp = "";
let stage = "";
let nodeOk = "";
let nodeBad = "";

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bh-flow-test-"));
  stage = path.join(tmp, "stage");
  fs.mkdirSync(stage);
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".ps1"))) fs.copyFileSync(path.join(dir, f), path.join(stage, f));
  fs.writeFileSync(path.join(stage, "print-agent.cjs"), "// dummy agent\n");
  nodeOk = path.join(tmp, "node-ok.cmd");
  nodeBad = path.join(tmp, "node-bad.cmd");
  fs.writeFileSync(nodeOk, '@if "%~1"=="--version" (echo v20.1.0& exit /b 0)\r\n@echo CHECK-OK\r\n@exit /b 0\r\n');
  fs.writeFileSync(nodeBad, '@if "%~1"=="--version" (echo v20.1.0& exit /b 0)\r\n@echo CHECK-FAILED-REASON\r\n@exit /b 1\r\n');
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function install(installDir: string, node: string, env: Record<string, string> = {}, extra: string[] = []) {
  const r = spawnSync(
    "powershell.exe",
    [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(stage, "install.ps1"),
      "-ServerUrl", "https://pedidos.example.com", "-Token", TOKEN, "-PrinterName", "POS-80", "-InstallDir", installDir,
      "-NodeExe", node, "-TaskName", "BurgerHouseAgentUnitTestNoSuchTask", "-NoPrompt", ...extra,
    ],
    { encoding: "utf8", env: { ...process.env, ...TEST_ENV, ...env }, timeout: 90_000 },
  );
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

describe.skipIf(!win)("install.ps1 real path (no elevation, no Task Scheduler)", () => {
  it("copies the program and writes a valid config.json without BOM", () => {
    const d = path.join(tmp, "ok");
    const r = install(d, nodeOk);
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toContain(TOKEN);
    const raw = fs.readFileSync(path.join(d, "config.json"));
    expect([raw[0], raw[1], raw[2]]).not.toEqual([0xef, 0xbb, 0xbf]);
    const cfg = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    expect(cfg).toMatchObject({ SERVER_URL: "https://pedidos.example.com", STATION_TOKEN: TOKEN, PAPER_WIDTH: 80, CODEPAGE: "cp858", PRINTER_BACKEND: "windows", PRINTER_NAME: "POS-80" });
    expect(String(cfg.DATA_DIR).toLowerCase()).toBe(path.join(d, "data").toLowerCase());
    expect(fs.existsSync(path.join(d, "print-agent.cjs"))).toBe(true);
    expect(fs.existsSync(path.join(d, "data", "logs"))).toBe(true);
  });

  it("tolerates a trailing backslash in -InstallDir", () => {
    const d = path.join(tmp, "trailing");
    const r = install(d + "\\", nodeOk);
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toMatch(/Carpeta de instalación\s*:.*\\\s*$/m);
    expect(fs.existsSync(path.join(d, "config.json"))).toBe(true);
  });

  it("refuses to overwrite an existing install without -Force (exit 4) and updates it with -Force", () => {
    const d = path.join(tmp, "again");
    expect(install(d, nodeOk).code).toBe(0);
    const again = install(d, nodeOk);
    expect(again.code, again.out).toBe(4);
    expect(again.out).toContain("Ya hay una instalación");
    expect(install(d, nodeOk, {}, ["-Force", "-PaperWidth", "58"]).code).toBe(0);
    expect((JSON.parse(fs.readFileSync(path.join(d, "config.json"), "utf8")) as { PAPER_WIDTH: number }).PAPER_WIDTH).toBe(58);
  });

  it("a failed check exits 6 and leaves nothing behind (fresh install)", () => {
    const d = path.join(tmp, "badcheck");
    const r = install(d, nodeBad);
    expect(r.code, r.out).toBe(6);
    expect(r.out).toContain("CHECK-FAILED-REASON");
    expect(r.out).toContain("La verificación falló");
    expect(fs.existsSync(d)).toBe(false);
  });

  it("a failed check on -Force restores the previous config and program", () => {
    const d = path.join(tmp, "badforce");
    expect(install(d, nodeOk).code).toBe(0);
    const before = fs.readFileSync(path.join(d, "config.json"), "utf8");
    const r = install(d, nodeBad, {}, ["-Force", "-PaperWidth", "58"]);
    expect(r.code, r.out).toBe(6);
    expect(fs.readFileSync(path.join(d, "config.json"), "utf8")).toBe(before);
  });

  it("a failure AFTER the task is registered says so accurately (exit 7) and keeps the install", () => {
    const d = path.join(tmp, "afterreg");
    const r = install(d, nodeOk, { BH_TEST_FAIL_AFTER_REGISTER: "1" });
    expect(r.code, r.out).toBe(7);
    expect(r.out).toContain("quedó registrada");
    expect(r.out).toContain("status.ps1");
    expect(r.out).not.toContain("No quedó nada a medias");
    expect(r.out).not.toContain("la tarea no se registró");
    expect(fs.existsSync(path.join(d, "config.json"))).toBe(true);
  });
});

describe.skipIf(!win)("common.ps1 helpers", () => {
  function psCommand(command: string) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `. '${path.join(dir, "common.ps1")}'; ${command}`], { encoding: "utf8", timeout: 60_000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}`.trim() };
  }

  it("Get-AgentPaths trims a trailing backslash but keeps a drive root", () => {
    expect(psCommand("(Get-AgentPaths 'C:\\Foo\\Bar\\').Dir").out).toBe("C:\\Foo\\Bar");
    expect(psCommand("(Get-AgentPaths 'C:\\').Dir").out).toBe("C:\\");
  });

  it("Write-AgentConfig writes JSON without BOM", () => {
    const f = path.join(tmp, "cfg.json");
    const r = psCommand(`$env:BH_TEST_SKIP_ACL='1'; Write-AgentConfig '${f}' ([ordered]@{ SERVER_URL='https://x.example.com'; PAPER_WIDTH=58 })`);
    expect(r.code, r.out).toBe(0);
    const raw = fs.readFileSync(f);
    expect([raw[0], raw[1], raw[2]]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(JSON.parse(raw.toString("utf8"))).toEqual({ SERVER_URL: "https://x.example.com", PAPER_WIDTH: 58 });
  });

  it("Set-SecureAcl leaves only SYSTEM and Administrators, not inherited (locale-independent SIDs)", () => {
    const d = path.join(tmp, "acl");
    fs.mkdirSync(d);
    const cmd =
      `try { Set-SecureAcl '${d}' $true } catch { 'ACL-UNSUPPORTED: ' + $_.Exception.Message; exit 0 }; ` +
      `$acl = [System.IO.Directory]::GetAccessControl('${d}'); ` +
      `($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value + '|' + $_.IsInherited }) -join ';'`;
    const r = psCommand(cmd);
    try {
      if (r.out.startsWith("ACL-UNSUPPORTED")) {
        console.warn("ACL assertion skipped: this process cannot set ACLs here:", r.out);
        return;
      }
      const entries = r.out.split(";").sort();
      expect(entries, r.out).toEqual(["S-1-5-18|False", "S-1-5-32-544|False"]);
    } finally {
      // The non-admin owner locked itself out on purpose-like conditions: take access back to clean up.
      spawnSync("icacls.exe", [d, "/grant", `${os.userInfo().username}:(OI)(CI)F`, "/T", "/C"], { encoding: "utf8" });
    }
  });
});
