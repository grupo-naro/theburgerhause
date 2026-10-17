import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type Browser, type BrowserContext } from "@playwright/test";
import { startAgent, type AgentConfig, type AgentHandle, type PrinterBackend } from "../../packages/print-agent/src/index";
import { createLogger } from "../../packages/print-agent/src/logger";
import { CaptureLog } from "../../packages/print-agent/src/testing/support";
import { authFile, type UserKey } from "./users";

/** Helpers shared by the full-journey specs (e2e/journey-*.spec.ts). */

/** A staff context from a saved login (cashier at Mostrador 1, dispatcher at Delivery 1), desktop sized. */
export async function staffContext(browser: Browser, baseURL: string | undefined, who: UserKey): Promise<BrowserContext> {
  return browser.newContext({
    baseURL,
    storageState: authFile(who),
    extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
    viewport: { width: 1280, height: 800 },
  });
}

/** Anonymous visitor on a Pixel 7 sized phone context (used when the test itself runs in the desktop project). */
export async function customerContext(browser: Browser, baseURL: string | undefined): Promise<BrowserContext> {
  return browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
  });
}

// ------------------------------------------------------------------------------------------------
// The REAL print agent, in-process, with the file backend (or a wrapped one) and real temp dirs.

const rnd = () => Math.floor(Math.random() * 250) + 1;
/** The server rate-limits agent endpoints per client IP: this process gets its own, like a real PC. */
const AGENT_IP = `10.${rnd()}.${rnd()}.${rnd()}`;

export type RunningAgent = {
  agent: AgentHandle;
  log: CaptureLog;
  outDir: string;
  dataDir: string;
};

const running: RunningAgent[] = [];
const tempDirs: string[] = [];

export function tempDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

/**
 * Starts the real agent against the running server. `dirs` lets a second instance reuse the first
 * one's data/output dirs (a restart of the same PC); `backend` and `fetch` can wrap the real ones to
 * simulate a slow printer or a network that eats acks.
 */
export function launchAgent(
  baseURL: string,
  token: string,
  opts: { dataDir?: string; outDir?: string; backend?: PrinterBackend; fetch?: typeof fetch } = {},
): RunningAgent {
  const dataDir = opts.dataDir ?? tempDir("bh-journey-data-");
  const outDir = opts.outDir ?? tempDir("bh-journey-out-");
  const log = new CaptureLog();
  const config: AgentConfig = {
    serverUrl: baseURL,
    stationToken: token,
    paperWidth: 80,
    codepage: "cp858",
    printerBackend: "file",
    printerPort: 9100,
    outputDir: outDir,
    dataDir,
    logLevel: "debug",
    allowInsecure: false,
  };
  const inner = opts.fetch ?? fetch;
  const agent = startAgent(config, {
    backend: opts.backend,
    logger: createLogger({ level: "debug", sinks: [log.sink] }),
    fetch: (input, init) => inner(input, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), "x-forwarded-for": AGENT_IP } }),
  });
  const r = { agent, log, outDir, dataDir };
  running.push(r);
  return r;
}

/** Stops every agent started by `launchAgent` and deletes the temp dirs. Wire it in `finally`/afterEach. */
export async function cleanupAgents(): Promise<void> {
  await Promise.all(running.splice(0).map((r) => r.agent.stop().catch(() => undefined)));
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

// ------------------------------------------------------------------------------------------------
// What the "printer" wrote (raw ESC/POS files, one per print).

export const printedFiles = (dir: string): string[] => fs.readdirSync(dir).filter((f) => f.endsWith(".bin")).sort();
export const readPrinted = (dir: string, jobId: number, n = 1): Buffer => fs.readFileSync(path.join(dir, `job-${jobId}-${n}.bin`));
export const latin1 = (b: Buffer): string => b.toString("latin1");
/** ESC d 4 (feed) + GS V B 3 (partial cut): every document ends with it. */
export const CUT_HEX = "1b64041d564203";
/** ESC @ (init) + ESC t 19 (code page cp858): every document starts with it. */
export const INIT_HEX = "1b401b7413";
/** ESC/POS GS v 0: the logo raster command. */
export const GS_V_0 = Buffer.from([0x1d, 0x76, 0x30, 0x00]);
/** What follows every text block: bold off, size 1, align left. */
export const RESET_HEX = "1b45001d21001b6100";
/** The last bytes of every customer ticket: the thanks line, its LF, the style reset and the cut (nothing printed after). */
export const THANKS_TAIL_HEX = Buffer.from("GRACIAS POR TU COMPRA\n").toString("hex") + RESET_HEX + CUT_HEX;
