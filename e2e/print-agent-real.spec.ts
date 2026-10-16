import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../src/db/schema";
import { startAgent, type AgentConfig, type AgentHandle } from "../packages/print-agent/src/index";
import { createLogger } from "../packages/print-agent/src/logger";
import { CaptureLog, FakeClock } from "../packages/print-agent/src/testing/support";
import { openRetiro, orderCard, parkPendingOrders, placeRetiroOrder, printJobsOf, recentRow } from "./helpers/caja";
import { freshStationToken, resetStationAgentState, settleStationJobs } from "./helpers/agent";
import { db } from "./helpers/db";
import { authFile } from "./helpers/users";

/**
 * The REAL print agent (packages/print-agent, started in-process through startAgent) against the real
 * production server, with the `file` backend writing to a temp dir and a real station token. The
 * cashier's UI is the other end. Waits are file/DB/event based, never fixed sleeps.
 */

const STATION = "Mostrador 1";
const rnd = () => Math.floor(Math.random() * 250) + 1;
const AGENT_IP = `10.${rnd()}.${rnd()}.${rnd()}`;

type Running = { agent: AgentHandle; log: CaptureLog; outDir: string; dataDir: string; clock?: FakeClock };
const running: Running[] = [];
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

/** Starts the real agent. `dataDir`/`outDir` can be reused to simulate a restart of the same PC. */
function launch(baseURL: string, token: string, dirs: { dataDir?: string; outDir?: string } = {}): Running {
  const dataDir = dirs.dataDir ?? tempDir("bh-agent-data-");
  const outDir = dirs.outDir ?? tempDir("bh-agent-out-");
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
  const agent = startAgent(config, {
    logger: createLogger({ level: "debug", sinks: [log.sink] }),
    // the server rate-limits per client IP: give this process its own, like the fake agent does
    fetch: (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), "x-forwarded-for": AGENT_IP } }),
  });
  const r = { agent, log, outDir, dataDir };
  running.push(r);
  return r;
}

const files = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith(".bin")).sort();
const readJob = (dir: string, id: number) => fs.readFileSync(path.join(dir, `job-${id}-1.bin`));
const latin = (b: Buffer) => b.toString("latin1");
const CUT = "1b64041d564203";

async function approveFromUi(page: Page, number: number) {
  const card = orderCard(page, number);
  await card.getByTestId("approve").click();
  await expect(card).toHaveCount(0);
}

test.afterEach(async () => {
  await Promise.all(running.splice(0).map((r) => r.agent.stop()));
  await settleStationJobs(STATION);
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
test.afterAll(() => resetStationAgentState(STATION));

test.describe("real agent, cashier flows", () => {
  test.use({ storageState: authFile("cajera") });

  test("approving an order prints the kitchen and customer tickets through the real agent; chips turn ok live", async ({ page, baseURL }) => {
    await settleStationJobs(STATION);
    await parkPendingOrders();
    const token = await freshStationToken(STATION);
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    const a = launch(baseURL!, token);
    await a.log.waitFor("Agente conectado");
    await expect(page.getByTestId("printer-indicator")).toBeVisible();

    await approveFromUi(page, o.number);
    await expect.poll(() => files(a.outDir).length, { timeout: 10_000 }).toBe(2);

    const [kitchenJob, ticketJob] = await printJobsOf(o.id);
    expect([kitchenJob.type, ticketJob.type]).toEqual(["kitchen", "ticket"]);
    const kitchen = readJob(a.outDir, kitchenJob.id);
    const ticket = readJob(a.outDir, ticketJob.id);
    for (const bytes of [kitchen, ticket]) {
      expect(bytes.subarray(0, 5).toString("hex")).toBe("1b401b7413"); // ESC @, code page cp858
      expect(bytes.toString("hex").endsWith(CUT)).toBe(true);
    }
    const k = latin(kitchen);
    expect(k).toContain(`PEDIDO #${o.number}`);
    expect(k).toContain("SIN CHEDDAR");
    expect(k).toContain("+ DIPS CHEDDAR");
    expect(k).toContain("1) RANCHITA SIMPLE");
    const t = latin(ticket);
    expect(t).toContain("THE BURGER HOUSE 828");
    expect(t).toMatch(/TOTAL: \$ [\d.]+/);

    const row = recentRow(page, o.number);
    await expect(row.getByTestId("print-chip")).toHaveText("Impresión: ok"); // live, no reload
    await expect(page.getByTestId("printer-indicator")).toHaveAttribute("data-online", "true");
    const stored = await printJobsOf(o.id);
    expect(stored.every((j) => j.status === "done" && j.attempts === 1)).toBe(true);
    expect(fs.existsSync(path.join(a.outDir, `job-${kitchenJob.id}-2.bin`))).toBe(false); // printed exactly once
  });

  test("offline: jobs wait as pending; when the agent starts it prints exactly 2 files, once", async ({ page, baseURL }) => {
    await settleStationJobs(STATION);
    await parkPendingOrders();
    const token = await freshStationToken(STATION);
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    await approveFromUi(page, o.number);
    expect((await printJobsOf(o.id)).map((j) => [j.type, j.status, j.attempts])).toEqual([
      ["kitchen", "pending", 0],
      ["ticket", "pending", 0],
    ]);
    await expect(recentRow(page, o.number).getByTestId("print-chip")).not.toHaveText("Impresión: ok");

    const a = launch(baseURL!, token);
    await expect.poll(() => files(a.outDir).length, { timeout: 10_000 }).toBe(2);
    await expect(recentRow(page, o.number).getByTestId("print-chip")).toHaveText("Impresión: ok");
    // a graceful stop flushes everything; nothing else was printed meanwhile
    await a.agent.stop();
    expect(files(a.outDir)).toHaveLength(2);
    expect((await printJobsOf(o.id)).every((j) => j.status === "done" && j.attempts === 1)).toBe(true);
    expect(a.agent.status().pendingAcks).toBe(0);
  });

  test("a restart does not re-print: a job redelivered after a lost ack is only acked", async ({ page, baseURL }) => {
    await settleStationJobs(STATION);
    await parkPendingOrders();
    const token = await freshStationToken(STATION);
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    const first = launch(baseURL!, token);
    await first.log.waitFor("Agente conectado");
    await approveFromUi(page, o.number);
    await expect.poll(() => files(first.outDir).length, { timeout: 10_000 }).toBe(2);
    await expect.poll(async () => (await printJobsOf(o.id)).every((j) => j.status === "done"), { timeout: 10_000 }).toBe(true);
    await first.agent.stop();

    // as if the acks had been lost: the server believes the jobs were never confirmed and delivers them again
    await db().update(s.printJobs).set({ status: "pending", attempts: 0, printedAt: null }).where(eq(s.printJobs.orderId, o.id));
    const second = launch(baseURL!, token, { dataDir: first.dataDir, outDir: first.outDir });
    await second.log.waitFor("Trabajo repetido");
    await expect.poll(async () => (await printJobsOf(o.id)).every((j) => j.status === "done"), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => second.log.count("Trabajo repetido"), { timeout: 10_000 }).toBe(2);
    expect(files(first.outDir)).toHaveLength(2); // nothing printed again
    expect(second.log.has("Trabajo impreso")).toBe(false);
  });

  test("a second agent for the same station replaces the first: the first backs off for 60 s and only the new one prints", async ({ page, baseURL }) => {
    await settleStationJobs(STATION);
    await parkPendingOrders();
    const token = await freshStationToken(STATION);
    const first = launch(baseURL!, token);
    await first.log.waitFor("Agente conectado");
    const second = launch(baseURL!, token);
    await second.log.waitFor("Agente conectado");
    await first.log.waitFor("Otro agente se conectó");

    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    await approveFromUi(page, o.number);
    await expect.poll(() => files(second.outDir).length, { timeout: 10_000 }).toBe(2);
    expect(files(first.outDir)).toHaveLength(0);
  });
});

test("a wrong token: the agent logs the clear message, stays alive and keeps backing off (5 s, 10 s ...)", async ({ baseURL }) => {
  const wrong = `bhst_${"Q".repeat(43)}`;
  const dataDir = tempDir("bh-agent-data-");
  const outDir = tempDir("bh-agent-out-");
  const log = new CaptureLog();
  const clock = new FakeClock();
  const agent = startAgent(
    { serverUrl: baseURL!, stationToken: wrong, paperWidth: 80, codepage: "cp858", printerBackend: "file", printerPort: 9100, outputDir: outDir, dataDir, logLevel: "debug", allowInsecure: false },
    {
      clock,
      rng: () => 0,
      logger: createLogger({ level: "debug", sinks: [log.sink] }),
      fetch: (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), "x-forwarded-for": AGENT_IP } }),
    },
  );
  running.push({ agent, log, outDir, dataDir, clock });

  await log.waitFor("Token inválido o rotado: generá uno nuevo en Admin → Estaciones");
  await clock.waitForTimer("reconnect");
  expect(clock.pending("reconnect")[0].ms).toBe(5000);
  await clock.fire("reconnect");
  await expect.poll(() => log.count("Token inválido o rotado"), { timeout: 10_000 }).toBe(2);
  await clock.waitForTimer("reconnect");
  expect(clock.pending("reconnect")[0].ms).toBe(10_000);
  expect(agent.status().connected).toBe(false);
  expect(log.lines.join("\n")).not.toContain(wrong);
  expect(files(outDir)).toHaveLength(0);
});
