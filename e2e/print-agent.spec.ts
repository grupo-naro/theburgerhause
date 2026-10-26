import { expect, test, type Page } from "@playwright/test";
import { markJobsDone, openDelivery, openRetiro, orderCard, parkPendingOrders, placeDeliveryOrder, placeRetiroOrder, printJobsOf, recentRow } from "./helpers/caja";
import { agentFetch, FakeAgent, freshStationToken, resetStationAgentState, settleStationJobs } from "./helpers/agent";
import { findStation } from "./helpers/db";
import { authFile } from "./helpers/users";

/**
 * The server side of the Print Agent protocol, driven by a Node-side fake agent (streaming fetch, NOT
 * Playwright's request API) against the real production server, with the cashier's UI as the other end.
 */

const STATION = "Mostrador 1";
const DELIVERY_STATION = "Delivery 1";
const agents: FakeAgent[] = [];
const track = (a: FakeAgent) => (agents.push(a), a);

test.afterEach(async () => {
  await Promise.all(agents.splice(0).map((a) => a.stop()));
  await settleStationJobs(STATION);
  await settleStationJobs(DELIVERY_STATION);
});
test.afterAll(async () => {
  await resetStationAgentState(STATION);
  await resetStationAgentState(DELIVERY_STATION);
});

async function approveFromUi(page: Page, number: number) {
  const card = orderCard(page, number);
  await card.getByTestId("approve").click();
  await expect(card).toHaveCount(0);
}

const lastSeenMs = async () => (await findStation(STATION)).lastSeenAt?.getTime() ?? 0;

test.describe("cashier flows", () => {
  test.use({ storageState: authFile("cajera") });

  test("approving delivers the kitchen comanda first and then the customer ticket (logo + thanks) to the connected agent; acking done turns the chip ok live and the printer indicator online", async ({ page, baseURL }) => {
    await settleStationJobs(STATION);
    await parkPendingOrders();
    const token = await freshStationToken(STATION);
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    const agent = track(await FakeAgent.connect(baseURL!, token));
    await expect(page.getByTestId("printer-indicator")).toBeVisible();

    await approveFromUi(page, o.number);
    const [kitchen, ticket] = await agent.jobs(2, 2000);
    expect(kitchen.type).toBe("kitchen");
    expect(kitchen.attempts).toBe(1);
    const kitchenText = JSON.stringify(kitchen.document);
    expect(kitchenText).toContain(`PEDIDO #${o.number}`);
    expect(kitchenText).toContain("RETIRO");
    expect(kitchenText).toContain("SIN CHEDDAR");
    expect(kitchenText).not.toContain('"logo"');
    expect(ticket.type).toBe("customer");
    expect(ticket.attempts).toBe(1);
    const ticketText = JSON.stringify(ticket.document);
    expect(ticketText).toContain("Sin cheddar");
    expect(ticketText).toContain("+ Dips de cheddar");
    expect(ticketText).toContain("TOTAL");
    expect(ticketText).toContain('{"type":"logo"}');
    expect(ticketText).toContain("GRACIAS POR TU COMPRA");
    expect(await agent.reader.noEventWithin("job", 300)).toBe(true); // and nothing else (takeaway: no delivery ticket)
    const stored = await printJobsOf(o.id);
    expect(stored.map((j) => j.id)).toEqual([kitchen.id, ticket.id]);
    expect(stored.every((j) => j.status === "printing")).toBe(true);

    const row = recentRow(page, o.number);
    await expect(row.getByTestId("print-chip")).toHaveText("Impresión: pendiente");
    expect((await agent.ack(kitchen.id, "done")).status).toBe(200);
    await expect(row.getByTestId("print-chip")).toHaveText("Impresión: pendiente"); // the customer ticket is still printing
    const res = await agent.ack(ticket.id, "done");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "done" });
    await expect(row.getByTestId("print-chip")).toHaveText("Impresión: ok"); // live: no reload
    await expect(page.getByTestId("printer-indicator")).toHaveAttribute("data-online", "true");
    await expect(page.getByTestId("printer-indicator")).toContainText("Impresora lista");
    expect(Date.now() - (await lastSeenMs())).toBeLessThan(30_000);
  });

  test("three failed acks show the red alert live; Reimprimir queues a new job that the agent receives", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await settleStationJobs(STATION);
    await parkPendingOrders();
    const token = await freshStationToken(STATION);
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    const agent = track(await FakeAgent.connect(baseURL!, token));
    await approveFromUi(page, o.number);
    const [kitchenJob, job] = await agent.jobs(2, 2000); // the kitchen comanda prints fine; the customer ticket is the one that fails
    expect([kitchenJob.type, job.type]).toEqual(["kitchen", "customer"]);
    expect((await agent.ack(kitchenJob.id, "done")).status).toBe(200);

    await expect(page.getByTestId("failed-print-alert")).toHaveCount(0);
    // attempt 1 and 2: the job goes back to pending and the next tick re-delivers it (no alert yet)
    expect(await (await agent.ack(job.id, "failed", "Sin papel")).json()).toEqual({ ok: true, status: "pending" });
    const second = await agent.jobWhere((j) => j.id === job.id && j.attempts === 2, 15_000);
    expect(second.document).toEqual(job.document);
    expect(await (await agent.ack(job.id, "failed", "Sin papel")).json()).toEqual({ ok: true, status: "pending" });
    await agent.jobWhere((j) => j.id === job.id && j.attempts === 3, 15_000);
    await expect(page.getByTestId("failed-print-alert")).toHaveCount(0);

    // attempt 3 fails for good -> the alert appears live
    expect(await (await agent.ack(job.id, "failed", "Sin papel")).json()).toEqual({ ok: true, status: "failed" });
    const alert = page.getByTestId("failed-print-alert");
    await expect(alert).toBeVisible();
    await expect(alert.getByTestId("failed-print")).toContainText(`Pedido #${o.number}`);
    await expect(alert.getByTestId("failed-print")).toContainText("Ticket cliente: Sin papel");
    // a failed ack on a job that is no longer printing is refused
    expect((await agent.ack(job.id, "failed", "otra vez")).status).toBe(409);

    await alert.getByRole("button", { name: `Reimprimir pedido #${o.number}` }).click();
    await expect(alert).toHaveCount(0);
    const reprint = await agent.jobWhere((j) => j.id > job.id, 3000);
    expect(reprint.type).toBe("customer");
    expect(reprint.attempts).toBe(1);
    expect((await agent.ack(reprint.id, "done")).status).toBe(200);
    await markJobsDone(o.id);
  });

  test("with NO agent connected, approved jobs stay pending and are delivered exactly once, oldest first, when the agent connects", async ({ page, baseURL }) => {
    await settleStationJobs(STATION);
    await parkPendingOrders();
    const token = await freshStationToken(STATION);
    const o = await placeRetiroOrder({ paymentMethod: "cash" });
    const o2 = await placeRetiroOrder({ paymentMethod: "cash" });
    await openRetiro(page);
    await approveFromUi(page, o.number);
    await approveFromUi(page, o2.number);
    const pending = [...(await printJobsOf(o.id)), ...(await printJobsOf(o2.id))];
    expect(pending.map((j) => [j.type, j.status, j.attempts])).toEqual([
      ["kitchen", "pending", 0],
      ["customer", "pending", 0],
      ["kitchen", "pending", 0],
      ["customer", "pending", 0],
    ]);

    const agent = track(await FakeAgent.connect(baseURL!, token));
    const got = await agent.jobs(4, 2000);
    expect(got.map((j) => j.id)).toEqual(pending.map((j) => j.id)); // oldest first
    expect(await agent.reader.noEventWithin("job", 300)).toBe(true);
    for (const j of got) expect((await agent.ack(j.id, "done")).status).toBe(200);
    await expect(recentRow(page, o.number).getByTestId("print-chip")).toHaveText("Impresión: ok");
    await expect(recentRow(page, o2.number).getByTestId("print-chip")).toHaveText("Impresión: ok");

    // reconnecting does not redeliver what was acked
    await agent.stop();
    const again = track(await FakeAgent.connect(baseURL!, token));
    expect(await again.reader.noEventWithin("job", 400)).toBe(true);
    expect([...(await printJobsOf(o.id)), ...(await printJobsOf(o2.id))].every((j) => j.status === "done" && j.attempts === 1)).toBe(true);
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
    expect(got).toHaveLength(2); // kitchen + customer
    expect(first.reader.seen.filter((f) => f.event === "job")).toHaveLength(0);
    expect((await printJobsOf(o.id)).every((j) => j.attempts === 1)).toBe(true);
    for (const j of got) await second.ack(j.id, "done");
  });
});

test.describe("delivery manager flows", () => {
  test.use({ storageState: authFile("encargada") });

  test("approving a delivery order delivers the kitchen comanda, the customer ticket (logo + thanks) and the delivery ticket, in that order, to the Delivery agent; Mostrador gets nothing", async ({ page, baseURL }) => {
    await settleStationJobs(STATION);
    await settleStationJobs(DELIVERY_STATION);
    await parkPendingOrders();
    const token = await freshStationToken(DELIVERY_STATION);
    const mostradorToken = await freshStationToken(STATION);
    const o = await placeDeliveryOrder({ paymentMethod: "cash" });
    await openDelivery(page);
    const agent = track(await FakeAgent.connect(baseURL!, token));
    const mostrador = track(await FakeAgent.connect(baseURL!, mostradorToken));

    await approveFromUi(page, o.number);
    const [kitchen, customer, delivery] = await agent.jobs(3, 3000);
    expect([kitchen.type, customer.type, delivery.type]).toEqual(["kitchen", "customer", "delivery"]);
    const k = JSON.stringify(kitchen.document);
    expect(k).toContain("DELIVERY");
    expect(k).toContain("SIN CHEDDAR");
    expect(k).not.toContain("Efectivo: cobrar");
    const d = JSON.stringify(delivery.document);
    expect(d).toContain("DELIVERY");
    expect(d).toContain("Efectivo: cobrar");
    expect(d).not.toContain('"logo"');
    expect(d).not.toContain("GRACIAS");
    const c = JSON.stringify(customer.document);
    expect(c).toContain('{"type":"logo"}');
    expect(c).toContain("GRACIAS POR TU COMPRA");
    expect(await mostrador.reader.noEventWithin("job", 300)).toBe(true);
    for (const j of [kitchen, delivery, customer]) expect((await agent.ack(j.id, "done")).status).toBe(200);
    await page.getByTestId("tab-recent").click();
    await expect(recentRow(page, o.number).getByTestId("print-chip")).toHaveText("Impresión: ok");
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
