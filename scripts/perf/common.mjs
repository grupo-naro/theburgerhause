import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Shared plumbing of `pnpm perf:lighthouse` and `pnpm loadtest`: the SAME production setup the e2e suite
 * uses (test database seeded by e2e/prepare-db-cli.ts, `next build`, `next start`), so the numbers describe
 * what ships, not the dev server. Nothing here touches the real (non-test) database.
 */

export const ROOT = path.resolve(import.meta.dirname, "../..");

const TEST_DB_NAME = "burgerhause_test";
/** Same server and credentials, pointing at the test database (mirrors src/db/test-database.ts). */
function testDatabaseUrl(serverUrl) {
  const url = new URL(serverUrl);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * The perf scripts WIPE the test database and spawn servers: refuse to run against anything but this machine
 * unless the operator says so explicitly (--allow-remote). Throws with a message that names the host.
 */
export function assertLocalDatabase(serverUrl, allowRemote = false) {
  let host;
  try {
    host = new URL(serverUrl).hostname.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  if (!allowRemote && !LOCAL_HOSTS.has(host)) {
    throw new Error(`refusing to run the perf scripts against the remote database host '${host}' (they wipe the test database). Pass --allow-remote if that is really intended.`);
  }
}

export const PERF_DIR = path.join(ROOT, "perf-reports");
export const SESSION_SECRET = "perf-only-session-secret-0123456789abcdef";

/** @returns {{serverUrl:string,testUrl:string,port:number,baseUrl:string,uploadDir:string}} */
export function loadEnv() {
  try {
    process.loadEnvFile(path.join(ROOT, ".env"));
  } catch {
    // no .env: rely on the environment
  }
  const serverUrl = process.env.E2E_SERVER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!serverUrl) throw new Error("DATABASE_URL is not set (needed to reach the Postgres server)");
  assertLocalDatabase(serverUrl, process.argv.includes("--allow-remote"));
  const port = Number(process.env.PERF_PORT ?? 3100);
  return {
    serverUrl,
    testUrl: testDatabaseUrl(serverUrl),
    port,
    baseUrl: `http://localhost:${port}`,
    uploadDir: path.join(ROOT, ".uploads-e2e"),
  };
}

/** Variables the spawned build/server needs from the operator's shell; everything else (tokens, cloud keys...) stays out. */
const PASSTHROUGH = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "LANG", "TZ"];

export const serverEnv = (env) => ({
  ...Object.fromEntries(PASSTHROUGH.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),
  NODE_ENV: "production",
  DATABASE_URL: env.testUrl,
  E2E_SERVER_DATABASE_URL: env.serverUrl,
  SESSION_SECRET,
  UPLOAD_DIR: env.uploadDir,
  PORT: String(env.port),
});

function run(label, args, env) {
  console.log(`> ${label}`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, env, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

const bin = (rel) => path.join(ROOT, "node_modules", rel);

/** Migrates, wipes and seeds the TEST database exactly like the e2e suite (menu, photos, users). Must run BEFORE the build. */
export function prepareDatabase(env) {
  run("seed test database", [bin("tsx/dist/cli.mjs"), "e2e/prepare-db-cli.ts"], { ...serverEnv(env), NODE_ENV: "development" });
}

export function build(env) {
  run("next build", [bin("next/dist/bin/next"), "build"], serverEnv(env));
}

/** `next start` on the perf port, resolved once /api/health answers. */
export async function startServer(env) {
  const free = await fetch(`${env.baseUrl}/api/health`).then(() => false, () => true);
  if (!free) throw new Error(`port ${env.port} is already in use: stop that server (or set PERF_PORT)`);
  const child = spawn(process.execPath, [bin("next/dist/bin/next"), "start", "-p", String(env.port)], {
    cwd: ROOT,
    env: serverEnv(env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const keep = (b) => {
    log = (log + b.toString()).slice(-20_000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`next start exited early:\n${log}`);
    try {
      const res = await fetch(`${env.baseUrl}/api/health`, { headers: { "x-forwarded-for": "127.0.0.1" } });
      if (res.status === 200) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`next start did not become healthy:\n${log}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  return {
    child,
    output: () => log,
    stop: async () => {
      if (child.exitCode !== null) return;
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
    },
  };
}

/** Resident memory (MB) of a process and its children (next start may fork a worker). Null when it cannot be read. */
export function treeRssMb(pid) {
  try {
    if (process.platform === "win32") {
      const script = `$ids=@(${pid}); $all=Get-CimInstance Win32_Process; $queue=@(${pid}); while($queue.Count){$p=$queue[0]; $queue=$queue[1..($queue.Count)]; foreach($c in $all | Where-Object {$_.ParentProcessId -eq $p}){ $ids+=$c.ProcessId; $queue+=$c.ProcessId }}; ($ids | ForEach-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).WorkingSet64 } | Measure-Object -Sum).Sum`;
      const r = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
      const bytes = Number(r.stdout.trim());
      return Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 1048576) : null;
    }
    const r = spawnSync("sh", ["-c", `ps -o rss= -p ${pid}; pgrep -P ${pid} | xargs -r -n1 ps -o rss= -p`], { encoding: "utf8" });
    const kb = r.stdout.split("\n").map((l) => Number(l.trim())).filter((n) => Number.isFinite(n) && n > 0);
    return kb.length ? Math.round(kb.reduce((a, b) => a + b, 0) / 1024) : null;
  } catch {
    return null;
  }
}

export function machineSpecs() {
  const cpu = os.cpus();
  return `${cpu[0]?.model.trim() ?? "unknown CPU"} x${cpu.length}, ${(os.totalmem() / 1073741824).toFixed(0)} GB RAM, ${os.platform()} ${os.release()}, Node ${process.version}`;
}

export function ensurePerfDir() {
  if (!existsSync(PERF_DIR)) mkdirSync(PERF_DIR, { recursive: true });
  return PERF_DIR;
}

export const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
export const flag = (name) => process.argv.includes(`--${name}`);
export const option = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
