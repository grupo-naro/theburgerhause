import { expect, test, type Page } from "@playwright/test";
import { markJobsDone, openRetiro, orderCard, parkPendingOrders, placeRetiroOrder, printJobsOf, recentRow } from "./helpers/caja";
import { agentFetch, FakeAgent, freshStationToken, resetStationAgentState, settleStationJobs } from "./helpers/agent";
import { findStation } from "./helpers/db";
import { authFile } from "./helpers/users";

/**
 * The server side of the Print Agent protocol, driven by a Node-side fake agent (streaming fetch, NOT
 * Playwright's request API) against the real production server, with the cashier's UI as the other end.
 */

const STATION = "Mostrador 1";
const agents: FakeAgent[] = [];
const track = (a: FakeAgent) => (agents.push(a), a);

test.afterEach(async () => {
  await Promise.all(agents.splice(0).map((a) => a.stop()));
  await settleStationJobs(STATION);
});
test.afterAll(() => resetStationAgentState(STATION));

async function approveFromUi(page: Page, number: number) {
  const card = orderCard(page, number);
  await card.getByTestId("approve").click();
  await expect(card).toHaveCount(0);
}

const lastSeenMs = async () => (await findStation(STATION)).lastSeenAt?.getTime() ?? 0;

test.describe("cashier flows", () => {
  test.use({ storageState: authFile("cajera") });

  test("approving delivers kitchen + ticket to the connected agent; acking done turns the chip ok live and the printer indicator online", async ({ page, baseURL }) => {
    await settleStationJobs(STATION);
    await parkPendingOrders();
    const token = await freshStationToken(STATION);
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    const agent = track(await FakeAgent.connect(baseURL!, token));
    await expect(page.getByTestId("printer-indicator")).toBeVisible();

    await approveFromUi(page, o.number);
    const [kitchen, ticket] = await agent.jobs(2, 2000);
    expect([kitchen.type, ticket.type]).toEqual(["kitchen", "ticket"]);
    expect(kitchen.attempts).toBe(1);
    const kitchenText = JSON.stringify(kitchen.document);
    expect(kitchenText).toContain("SIN CHEDDAR");
    expect(kitchenText).toContain("+ DIPS CHEDDAR");
    expect(JSON.stringify(ticket.document)).toContain("TOTAL");
    const stored = await printJobsOf(o.id);
    expect(stored.map((j) => j.id)).toEqual([kitchen.id, ticket.id]);
    expect(stored.every((j) => j.status === "printing")).toBe(true);

    const row = recentRow(page, o.number);
    await expect(row.getByTestId("print-chip")).toHaveText("Impresión: pendiente");
    for (const j of [kitchen, ticket]) {
      const res = await agent.ack(j.id, "done");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, status: "done" });
    }
    await expect(row.getByTestId("print-chip")).toHaveText("Impresión: ok"); // live: no reload
    await expect(page.getByTestId("printer-indicator")).toHaveAttribute("data-online", "true");
    await expect(page.getByTestId("printer-indicator")).toContainText("Impresora lista");
    expect(Date.now() - (await lastSeenMs())).toBeLessThan(30_000);
  });

  test("three failed acks show the red alert live; Reimprimir queues new jobs that the agent receives", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await settleStationJobs(STATION);
    await parkPendingOrders();
    const token = await freshStationToken(STATION);
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    const agent = track(await FakeAgent.connect(baseURL!, token));
    await approveFromUi(page, o.number);
    const [kitchen, ticket] = await agent.jobs(2, 2000);
    expect((await agent.ack(ticket.id, "done")).status).toBe(200);

    await expect(page.getByTestId("failed-print-alert")).toHaveCount(0);
    // attempt 1 and 2: the job goes back to pending and the next tick re-delivers it (no alert yet)
    expect(await (await agent.ack(kitchen.id, "failed", "Sin papel")).json()).toEqual({ ok: true, status: "pending" });
    const second = await agent.jobWhere((j) => j.id === kitchen.id && j.attempts === 2, 15_000);
    expect(second.document).toEqual(kitchen.document);
    expect(await (await agent.ack(kitchen.id, "failed", "Sin papel")).json()).toEqual({ ok: true, status: "pending" });
    await agent.jobWhere((j) => j.id === kitchen.id && j.attempts === 3, 15_000);
    await expect(page.getByTestId("failed-print-alert")).toHaveCount(0);

    // attempt 3 fails for good -> the alert appears live
    expect(await (await agent.ack(kitchen.id, "failed", "Sin papel")).json()).toEqual({ ok: true, status: "failed" });
    const alert = page.getByTestId("failed-print-alert");
    await expect(alert).toBeVisible();
    await expect(alert.getByTestId("failed-print")).toContainText(`Pedido #${o.number}`);
    await expect(alert.getByTestId("failed-print")).toContainText("Cocina: Sin papel");
    // a failed ack on a job that is no longer printing is refused
    expect((await agent.ack(kitchen.id, "failed", "otra vez")).status).toBe(409);

    await alert.getByRole("button", { name: `Reimprimir pedido #${o.number}` }).click();
    await expect(alert).toHaveCount(0);
    const reprint = await agent.jobWhere((j) => j.id > ticket.id, 3000);
    expect(reprint.type).toBe("kitchen");
    expect(reprint.attempts).toBe(1);
    expect((await agent.ack(reprint.id, "done")).status).toBe(200);
    await markJobsDone(o.id);
  });

  test("with NO agent connected, approved jobs stay pending and are delivered exactly once, oldest first, when the agent connects", async ({ page, baseURL }) => {
    await settleStationJobs(STATION);
    await parkPendingOrders();
    const token = await freshStationToken(STATION);
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    await approveFromUi(page, o.number);
    const pending = await printJobsOf(o.id);
    expect(pending.map((j) => [j.type, j.status, j.attempts])).toEqual([
      ["kitchen", "pending", 0],
      ["ticket", "pending", 0],
    ]);

    const agent = track(await FakeAgent.connect(baseURL!, token));
    const got = await agent.jobs(2, 2000);
    expect(got.map((j) => j.id)).toEqual(pending.map((j) => j.id));
    expect(await agent.reader.noEventWithin("job", 300)).toBe(true);
    for (const j of got) expect((await agent.ack(j.id, "done")).status).toBe(200);
    await expect(recentRow(page, o.number).getByTestId("print-chip")).toHaveText("Impresión: ok");

    // reconnecting does not redeliver what was acked
    await agent.stop();
    const again = track(await FakeAgent.connect(baseURL!, token));
    expect(await again.reader.noEventWithin("job", 400)).toBe(true);
    expect((await printJobsOf(o.id)).every((j) => j.status === "done" && j.attempts === 1)).toBe(true);
  });

  test("a second connection for the same station replaces the first, and only the new one gets the jobs", async ({ page, baseURL }) => {
    await settleStationJobs(STATION);
    await parkPendingOrders();
    const token = await freshStationToken(STATION);
    const first = track(await FakeAgent.connect(baseURL!, token));
    const second = track(await FakeAgent.connect(baseURL!, token));
    await first.reader.event("replaced", 3000);
    expect(await first.reader.waitEnd(3000)).toBe(true);

    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    await approveFromUi(page, o.number);
    const got = await second.jobs(2, 2000);
    expect(got).toHaveLength(2);
    expect(first.reader.seen.filter((f) => f.event === "job")).toHaveLength(0);
    expect((await printJobsOf(o.id)).every((j) => j.attempts === 1)).toBe(true);
    for (const j of got) await second.ack(j.id, "done");
  });
});

test.describe("tokens", () => {
  test.describe("admin rotation", () => {
    test.use({ storageState: authFile("admin") });

    test("rotating the token in the admin UI kills the old token at once (and its open stream); the new one works", async ({ page, baseURL }) => {
      test.setTimeout(60_000);
      const oldToken = await freshStationToken(STATION);
      const open = track(await FakeAgent.connect(baseURL!, oldToken));
      expect((await agentFetch(baseURL!, oldToken, "/api/agent/heartbeat", { method: "POST" })).status).toBe(200);

      await page.goto("/admin/estaciones");
      const card = page.locator(`div[aria-label="${STATION}"]`);
      await card.getByRole("button", { name: "Rotar token" }).click();
      await card.getByRole("button", { name: "Confirmar rotación" }).click();
      const newToken = await card.getByLabel("Token de la estación").inputValue();
      expect(newToken).toMatch(/^bhst_/);
      expect(newToken).not.toBe(oldToken);

      const old = await agentFetch(baseURL!, oldToken, "/api/agent/heartbeat", { method: "POST" });
      expect(old.status).toBe(401);
      expect(await old.json()).toEqual({ error: "unauthorized" });
      expect((await agentFetch(baseURL!, oldToken, "/api/agent/stream")).status).toBe(401);
      expect((await agentFetch(baseURL!, newToken, "/api/agent/heartbeat", { method: "POST" })).status).toBe(200);
      // the stream opened with the old token is cut at the server's next tick (10 s)
      expect(await open.reader.waitEnd(20_000)).toBe(true);
    });
  });

  test("a wrong, malformed or missing token is a uniform 401 on every agent endpoint", async ({ baseURL }) => {
    const wrong = `bhst_${"A".repeat(43)}`;
    const seen: [number, string][] = [];
    for (const token of [wrong, "bhst_short", null]) {
      for (const [path, init] of [
        ["/api/agent/stream", {}],
        ["/api/agent/heartbeat", { method: "POST" }],
        ["/api/agent/jobs/1/ack", { method: "POST", body: JSON.stringify({ status: "done" }) }],
      ] as const) {
        const res = await agentFetch(baseURL!, token, path, init);
        seen.push([res.status, await res.text()]);
      }
    }
    expect(seen).toEqual(Array(9).fill([401, '{"error":"unauthorized"}']));
  });
});
