import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * uninstall.ps1 / status.ps1 / update.ps1 against throwaway folders in the temp dir. No Scheduled Task exists
 * for these names, so nothing is registered or stopped. BH_TEST_ELEVATED=1 only skips the Administrator check.
 */
const win = process.platform === "win32";
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const TASK = "BurgerHouseAgentUnitTestNoSuchTask";
const TOKEN = "bhst_" + "A1b2C3d4".repeat(5) + "xyz";

let tmp = "";
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bh-lifecycle-test-"));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function ps(script: string, args: string[], env: Record<string, string> = { BH_TEST_ELEVATED: "1" }) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(dir, script), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 90_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const cjs = (marker: string, exit: number) =>
  `const a=process.argv[2]; if(a==="--version"){console.log("0.0.0")} else {console.log(${JSON.stringify(marker)}); process.exit(${exit});}\n`;

/** A fake installation: print-agent.cjs prints `marker` for `check` and exits with `checkExit`. */
function fakeInstall(name: string, marker: string, checkExit: number) {
  const d = path.join(tmp, name);
  fs.mkdirSync(path.join(d, "data", "logs"), { recursive: true });
  fs.writeFileSync(path.join(d, "print-agent.cjs"), cjs(marker, checkExit));
  fs.writeFileSync(
    path.join(d, "config.json"),
    JSON.stringify({ SERVER_URL: "https://x.example.com", STATION_TOKEN: TOKEN, PRINTER_BACKEND: "file", OUTPUT_DIR: path.join(d, "out") }),
  );
  fs.writeFileSync(
    path.join(d, "data", "logs", "agent.log"),
    Array.from({ length: 30 }, (_, i) => `2026-10-15T10:00:${String(i).padStart(2, "0")}Z INFO  linea ${i + 1}`).join("\n") + "\n",
  );
  return d;
}

describe.skipIf(!win)("uninstall.ps1", () => {
  it("refuses without Administrator, exit 3", () => {
    const r = ps("uninstall.ps1", ["-TaskName", TASK, "-InstallDir", path.join(tmp, "nope")], { BH_TEST_ELEVATED: "0" });
    expect(r.code, r.out).toBe(3);
    expect(r.out).toContain("Abrí PowerShell como Administrador");
  });
  it("is idempotent when nothing is installed (exit 0)", () => {
    const r = ps("uninstall.ps1", ["-TaskName", TASK, "-InstallDir", path.join(tmp, "nope"), "-Yes"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("no estaba instalada");
  });
  it("dry-run lists what it would delete and deletes nothing", () => {
    const d = fakeInstall("un-dry", "x", 0);
    const r = ps("uninstall.ps1", ["-TaskName", TASK, "-InstallDir", d, "-RemoveData", "-DryRun"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("SIMULACIÓN");
    expect(fs.existsSync(path.join(d, "config.json"))).toBe(true);
  });
  it("without -RemoveData keeps config and data", () => {
    const d = fakeInstall("un-keep", "x", 0);
    const r = ps("uninstall.ps1", ["-TaskName", TASK, "-InstallDir", d, "-Yes"]);
    expect(r.code, r.out).toBe(0);
    expect(fs.existsSync(path.join(d, "config.json"))).toBe(true);
    expect(fs.existsSync(path.join(d, "data", "logs", "agent.log"))).toBe(true);
  });
  it("-RemoveData -Yes removes the whole folder; a second run is a no-op", () => {
    const d = fakeInstall("un-all", "x", 0);
    const r = ps("uninstall.ps1", ["-TaskName", TASK, "-InstallDir", d, "-RemoveData", "-Yes"]);
    expect(r.code, r.out).toBe(0);
    expect(fs.existsSync(d)).toBe(false);
    expect(ps("uninstall.ps1", ["-TaskName", TASK, "-InstallDir", d, "-RemoveData", "-Yes"]).code).toBe(0);
  });
  it("refuses to delete a folder that is not an agent install", () => {
    const d = path.join(tmp, "not-agent");
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "mis-fotos.txt"), "x");
    const r = ps("uninstall.ps1", ["-TaskName", TASK, "-InstallDir", d, "-RemoveData", "-Yes"]);
    expect(r.code, r.out).toBe(2);
    expect(fs.existsSync(path.join(d, "mis-fotos.txt"))).toBe(true);
  });
});

describe.skipIf(!win)("status.ps1", () => {
  it("exit 8 and a clear message when there is no installation", () => {
    const r = ps("status.ps1", ["-TaskName", TASK, "-InstallDir", path.join(tmp, "nope")]);
    expect(r.code, r.out).toBe(8);
    expect(r.out).toContain("No hay una instalación");
  });
  it("shows task state, the last 20 log lines and the check result without leaking the token", () => {
    const d = fakeInstall("st-ok", "CHECK-MARKER-OK", 0);
    const r = ps("status.ps1", ["-TaskName", TASK, "-InstallDir", d, "-NodeExe", process.execPath]);
    expect(r.out).toContain("linea 30");
    expect(r.out).toContain("linea 11");
    expect(r.out).not.toMatch(/linea 10\b/);
    expect(r.out).toContain("CHECK-MARKER-OK");
    expect(r.out).toContain("no está registrada");
    expect(r.out).not.toContain(TOKEN);
    expect(r.code, r.out).toBe(7);
  });
});

describe.skipIf(!win)("update.ps1", () => {
  const release = (name: string, marker: string, exit: number) => {
    const d = path.join(tmp, name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "print-agent.cjs"), cjs(marker, exit));
    return d;
  };
  it("refuses without Administrator, exit 3", () => {
    const r = ps("update.ps1", ["-InstallDir", path.join(tmp, "nope"), "-TaskName", TASK], { BH_TEST_ELEVATED: "0" });
    expect(r.code, r.out).toBe(3);
  });
  it("exit 8 when there is no installation", () => {
    const rel = release("rel-a", "new", 0);
    const r = ps("update.ps1", ["-InstallDir", path.join(tmp, "nope"), "-TaskName", TASK, "-ReleaseDir", rel, "-NodeExe", process.execPath]);
    expect(r.code, r.out).toBe(8);
    expect(r.out).toContain("install.ps1");
  });
  it("exit 2 when the release folder has no print-agent.cjs", () => {
    const d = fakeInstall("up-norel", "old", 0);
    const r = ps("update.ps1", ["-InstallDir", d, "-TaskName", TASK, "-ReleaseDir", path.join(tmp, "empty"), "-NodeExe", process.execPath]);
    expect(r.code, r.out).toBe(2);
  });
  it("replaces print-agent.cjs, keeps config/state, verifies with check", () => {
    const d = fakeInstall("up-ok", "old", 0);
    const before = fs.readFileSync(path.join(d, "config.json"), "utf8");
    const r = ps("update.ps1", ["-InstallDir", d, "-TaskName", TASK, "-ReleaseDir", release("rel-ok", "NEW-BUILD", 0), "-NodeExe", process.execPath]);
    expect(r.code, r.out).toBe(0);
    expect(fs.readFileSync(path.join(d, "print-agent.cjs"), "utf8")).toContain("NEW-BUILD");
    expect(fs.readFileSync(path.join(d, "config.json"), "utf8")).toBe(before);
    expect(fs.existsSync(path.join(d, "data", "logs", "agent.log"))).toBe(true);
    expect(r.out).not.toContain(TOKEN);
  });
  it("rolls back the old program when the new one fails check, exit 6", () => {
    const d = fakeInstall("up-bad", "OLD-BUILD", 0);
    const r = ps("update.ps1", ["-InstallDir", d, "-TaskName", TASK, "-ReleaseDir", release("rel-bad", "NEW-BROKEN", 1), "-NodeExe", process.execPath]);
    expect(r.code, r.out).toBe(6);
    expect(fs.readFileSync(path.join(d, "print-agent.cjs"), "utf8")).toContain("OLD-BUILD");
  });
  it("dry-run changes nothing", () => {
    const d = fakeInstall("up-dry", "OLD-BUILD", 0);
    const r = ps("update.ps1", ["-InstallDir", d, "-TaskName", TASK, "-ReleaseDir", release("rel-dry", "NEW", 0), "-NodeExe", process.execPath, "-DryRun"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("SIMULACIÓN");
    expect(fs.readFileSync(path.join(d, "print-agent.cjs"), "utf8")).toContain("OLD-BUILD");
  });
});
