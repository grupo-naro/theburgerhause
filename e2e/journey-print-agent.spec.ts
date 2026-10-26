import { and, eq, inArray } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../src/db/schema";
import { FileBackend } from "../packages/print-agent/src/printer/file";
import { PrintError, type PrinterBackend, type PrintContext } from "../packages/print-agent/src/printer/types";
import { freshStationToken, resetStationAgentState, settleStationJobs } from "./helpers/agent";
import { openRetiro, orderCard, parkPendingOrders, placeRetiroOrder, printJobsOf, recentRow } from "./helpers/caja";
import { db } from "./helpers/db";
import { cleanBoard, runCleanups } from "./helpers/despacho";
import { cleanupAgents, latin1, launchAgent, printedFiles, readPrinted, tempDir } from "./helpers/journey";
import { authFile } from "./helpers/users";

const STATION = "Mostrador 1";

test.use({ storageState: authFile("cajera") });
test.afterEach(async () => {
  await cleanupAgents();
  await settleStationJobs(STATION);
  await runCleanups();
  await cleanBoard();
});
test.afterAll(() => resetStationAgentState(STATION));

async function approve(page: Page, number: number) {
  const card = orderCard(page, number);
  await card.getByTestId("approve").click();
  await expect(card).toHaveCount(0);
}

/** A network that eats the acks of some jobs (or all of them until `open()`), like a PC that lost its connection. */
function ackFilter(opts: { dropJobs?: Set<number>; gate?: Promise<void> }): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const m = /\/api\/agent\/jobs\/(\d+)\/ack$/.exec(url);
    if (m) {
      if (opts.dropJobs?.has(Number(m[1]))) throw new TypeError("network down");
      if (opts.gate) await opts.gate;
    }
    return fetch(input, init);
  };
}

/**
 * J4: a station whose print agent is missing, crashes and misbehaves. The cashier never loses an
 * order and the counter never gets a duplicate ticket.
 * (Mostrador station: a takeaway order prints ONE document, the customer ticket; the two-document delivery
 * flow is exercised by J1 and the print-agent specs.)
 */
test("J4 station without agent: pending jobs, delivery once the agent starts, crash redelivery without duplicates, failed alert and reprint", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  await settleStationJobs(STATION);
  await resetStationAgentState(STATION);
  await parkPendingOrders();
  const token = await freshStationToken(STATION);

  await openRetiro(page);

  await test.step("with NO agent: approving leaves the kitchen and customer tickets pending and the indicator says 'Sin agente'", async () => {
    const a = await placeRetiroOrder({ paymentMethod: "cash", single: true });
    await expect(orderCard(page, a.number)).toBeVisible();
    await approve(page, a.number);
    expect((await printJobsOf(a.id)).map((j) => [j.type, j.status, j.attempts])).toEqual([
      ["kitchen", "pending", 0],
      ["customer", "pending", 0],
    ]);
    await expect(page.getByTestId("printer-indicator")).toHaveAttribute("data-online", "false");
    await expect(page.getByTestId("printer-indicator")).toContainText("Sin agente");
    await expect(recentRow(page, a.number).getByTestId("print-chip")).not.toHaveText("Impresión: ok");

    // the agent starts: exactly those two jobs print, once
    const agent = launchAgent(baseURL!, token);
    await expect.poll(() => printedFiles(agent.outDir).length, { timeout: 15_000 }).toBe(2);
    await expect(recentRow(page, a.number).getByTestId("print-chip")).toHaveText("Impresión: ok");
    await expect(page.getByTestId("printer-indicator")).toHaveAttribute("data-online", "true");
    await agent.agent.stop();
    expect(printedFiles(agent.outDir)).toHaveLength(2);
    expect((await printJobsOf(a.id)).every((j) => j.status === "done" && j.attempts === 1)).toBe(true);
  });

  await test.step("a crash after printing but before the ack: after the stuck timeout the job is re-delivered and NOT printed twice", async () => {
    const b = await placeRetiroOrder({ paymentMethod: "cash", single: true, unitNote: "sin sal" });
    await expect(orderCard(page, b.number)).toBeVisible();
    await approve(page, b.number); // no agent yet: the job waits
    const [kitchenJob, ticketJob] = await printJobsOf(b.id);
    const both = [kitchenJob.id, ticketJob.id];

    // PC 1 prints both tickets but its network eats the acks, then the process dies.
    const dataDir = tempDir("bh-journey-data-");
    const outDir = tempDir("bh-journey-out-");
    const first = launchAgent(baseURL!, token, { dataDir, outDir, fetch: ackFilter({ dropJobs: new Set(both) }) });
    await expect.poll(() => printedFiles(outDir).length, { timeout: 15_000 }).toBe(2);
    await expect.poll(async () => (await printJobsOf(b.id)).map((j) => j.status), { timeout: 15_000 }).toEqual(["printing", "printing"]);
    await first.agent.stop(); // the acks stay in state.json, never delivered
    expect(first.agent.status().pendingAcks).toBe(2);
    expect(await printJobsOf(b.id)).toMatchObject([
      { id: kitchenJob.id, type: "kitchen", status: "printing", attempts: 1 },
      { id: ticketJob.id, type: "customer", status: "printing", attempts: 1 },
    ]);

    // 31 s later (the server's stuck timeout is 30 s): move the claim time instead of sleeping
    await db()
      .update(s.printJobs)
      .set({ claimedAt: new Date(Date.now() - 31_000) })
      .where(and(inArray(s.printJobs.id, both), eq(s.printJobs.status, "printing")));

    // PC 1 restarts (same data dir). Acks are held back until the re-delivery shows up in its log.
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const second = launchAgent(baseURL!, token, { dataDir, outDir, fetch: ackFilter({ gate }) });
    await second.log.waitFor("Trabajo repetido: ya estaba impreso, solo se confirma");
    open();
    await expect.poll(async () => (await printJobsOf(b.id)).map((j) => j.status), { timeout: 15_000 }).toEqual(["done", "done"]);
    expect((await printJobsOf(b.id)).map((j) => j.attempts)).toEqual([2, 2]); // they WERE delivered again...
    expect(printedFiles(outDir)).toEqual(both.map((id) => `job-${id}-1.bin`).sort()); // ...but not printed again
    expect(second.log.has("Trabajo impreso")).toBe(false);
    await expect(recentRow(page, b.number).getByTestId("print-chip")).toHaveText("Impresión: ok");
    await second.agent.stop();
  });

  await test.step("a printer without paper: 3 failed attempts raise the red alert live; Reimprimir creates a new job that prints", async () => {
    const c = await placeRetiroOrder({ paymentMethod: "cash", single: true });
    await expect(orderCard(page, c.number)).toBeVisible();
    await approve(page, c.number);
    const [kitchenOfC, failingJob] = await printJobsOf(c.id); // the kitchen comanda prints; the customer ticket is the one that fails
    expect([kitchenOfC.type, failingJob.type]).toEqual(["kitchen", "customer"]);

    const outDir = tempDir("bh-journey-out-");
    const real = new FileBackend(outDir);
    let outOfPaper = true;
    let failedAttempts = 0;
    const printer: PrinterBackend = {
      describe: () => "papel agotado (test)",
      async print(bytes: Buffer, ctx: PrintContext) {
        if (outOfPaper && ctx.jobId === failingJob.id) {
          failedAttempts++;
          throw new PrintError("Sin papel");
        }
        return real.print(bytes, ctx);
      },
    };
    const agent = launchAgent(baseURL!, token, { outDir, backend: printer });
    // the server hands the job back at its next housekeeping tick (10 s) after each failed ack
    const alert = page.getByTestId("failed-print-alert");
    await expect(alert).toBeVisible({ timeout: 90_000 });
    expect(failedAttempts).toBe(3);
    await expect(alert.getByTestId("failed-print")).toContainText(`Pedido #${c.number}`);
    await expect(alert.getByTestId("failed-print")).toContainText("Ticket cliente: Sin papel");
    expect((await printJobsOf(c.id)).map((j) => [j.type, j.status, j.attempts])).toEqual([
      ["kitchen", "done", 1],
      ["customer", "failed", 3],
    ]);
    await expect(page.getByTestId("printer-indicator")).toContainText("impresión fallida");
    expect(printedFiles(outDir)).toHaveLength(1); // only the kitchen comanda came out of the printer

    // paper is back; the cashier reprints
    outOfPaper = false;
    await alert.getByRole("button", { name: `Reimprimir pedido #${c.number}` }).click();
    await expect(alert).toHaveCount(0);
    await expect.poll(() => printedFiles(outDir).length, { timeout: 15_000 }).toBe(2);
    const jobs = await printJobsOf(c.id);
    expect(jobs).toHaveLength(3); // kitchen + failed customer + the customer reprint (the kitchen comanda is not printed again)
    const reprint = jobs[2];
    expect(reprint).toMatchObject({ type: "customer", status: "done" });
    expect(reprint.id).toBeGreaterThan(jobs[1].id);
    expect(latin1(readPrinted(outDir, reprint.id))).toContain(`PEDIDO #${c.number}`);
    expect(latin1(readPrinted(outDir, reprint.id))).toContain("GRACIAS POR TU COMPRA");
    await agent.agent.stop();
  });
});
