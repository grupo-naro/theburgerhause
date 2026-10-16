import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import * as s from "../../src/db/schema";
import { createOrder } from "../../src/lib/orders/create-order";
import { unique, uniquePhone } from "./checkout";
import { db, findProduct, modifierIdByName } from "./db";

export type CajaOrderFixture = {
  id: number;
  number: number;
  token: string;
  total: number;
  name: string;
  whatsappDigits: string;
};

/**
 * A real web order through `createOrder`: two Ranchita (one "Sin cheddar", one "+ Dips de cheddar",
 * with a unit note) and a Melt, so cards have grouped lines and highlighted modifications.
 */
export async function placeCajaOrder(
  o: {
    fulfillment?: "delivery" | "takeaway";
    paymentMethod?: "cash" | "transfer";
    address?: string;
    crossStreets?: string;
    notes?: string;
    unitNote?: string;
    single?: boolean;
  } = {},
): Promise<CajaOrderFixture> {
  const fulfillment = o.fulfillment ?? "delivery";
  const ranchita = await findProduct("Ranchita simple");
  const melt = await findProduct("Melt simple");
  const name = `Caja ${unique("Cliente")}`;
  const phone = uniquePhone();
  const units = o.single
    ? [{ productId: ranchita.id, modifierIds: [await modifierIdByName("Sin cheddar")], note: o.unitNote ?? "" }]
    : [
        { productId: ranchita.id, modifierIds: [await modifierIdByName("Sin cheddar")], note: o.unitNote ?? "" },
        { productId: ranchita.id, modifierIds: [await modifierIdByName("+ Dips de cheddar")], note: "" },
        { productId: melt.id, modifierIds: [] as number[], note: "" },
      ];
  const r = await createOrder(db(), {
    idempotencyKey: randomUUID(),
    units,
    customer: { name, whatsapp: phone },
    fulfillment,
    delivery:
      fulfillment === "delivery"
        ? { address: o.address ?? "Av. Rivadavia 1234, 3B", crossStreets: o.crossStreets ?? "Mitre y Sarmiento", notes: o.notes ?? "Timbre roto" }
        : undefined,
    paymentMethod: o.paymentMethod ?? "cash",
    bh_ref: "",
  });
  if (!r.ok) throw new Error(`could not place the test order: ${r.code}`);
  const [row] = await db().select({ id: s.orders.id }).from(s.orders).where(eq(s.orders.publicToken, r.data.publicToken));
  return {
    id: row.id,
    number: r.data.number,
    token: r.data.publicToken,
    total: r.data.total,
    name,
    whatsappDigits: phone.replace(/\D/g, ""),
  };
}

/**
 * Cancels every order still waiting for approval (leftovers of other specs) so a spec starts from
 * an empty inbox. Other specs create their own orders and never rely on older ones.
 */
export async function parkPendingOrders(): Promise<void> {
  await db().update(s.orders).set({ status: "cancelado" }).where(eq(s.orders.status, "pendiente_aprobacion"));
}

export const printJobsOf = (orderId: number) =>
  db().select().from(s.printJobs).where(eq(s.printJobs.orderId, orderId)).orderBy(asc(s.printJobs.id));

export async function orderById(id: number) {
  const [row] = await db().select().from(s.orders).where(eq(s.orders.id, id));
  return row;
}

export const eventsOf = (orderId: number) =>
  db().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, orderId)).orderBy(asc(s.orderEvents.id));

/** Marks a print job as failed the way the print agent will, and pushes the realtime hint it would. */
export async function failPrintJob(jobId: number, error: string): Promise<void> {
  const [job] = await db()
    .update(s.printJobs)
    .set({ status: "failed", error, attempts: 3 })
    .where(eq(s.printJobs.id, jobId))
    .returning({ orderId: s.printJobs.orderId });
  const [order] = await db().select({ status: s.orders.status }).from(s.orders).where(eq(s.orders.id, job.orderId));
  const payload = JSON.stringify({ orderId: job.orderId, status: order.status, event: "updated" });
  await db().execute(sql`select pg_notify('orders_changed', ${payload})`);
}

/** Settles every print job of an order (test cleanup). */
export async function markJobsDone(orderId: number): Promise<void> {
  await db().update(s.printJobs).set({ status: "done" }).where(eq(s.printJobs.orderId, orderId));
}

/** Sets a station's agent heartbeat (null = never seen). */
export async function setStationSeen(name: string, at: Date | null): Promise<void> {
  await db().update(s.stations).set({ lastSeenAt: at }).where(eq(s.stations.name, name));
}

export const orderCard = (page: Page, number: number): Locator =>
  page.locator(`[data-testid="order-card"][data-order-number="${number}"]`);
export const recentRow = (page: Page, number: number): Locator =>
  page.locator(`[data-testid="recent-row"][data-order-number="${number}"]`);

/** A web TAKEAWAY order: what the counter sector (cashier, Retiro en local) handles. */
export const placeRetiroOrder = (o: Parameters<typeof placeCajaOrder>[0] = {}): Promise<CajaOrderFixture> =>
  placeCajaOrder({ fulfillment: "takeaway", ...o });

/** A web DELIVERY order: what the delivery sector (encargada, Gestión Delivery) handles. */
export const placeDeliveryOrder = (o: Parameters<typeof placeCajaOrder>[0] = {}): Promise<CajaOrderFixture> =>
  placeCajaOrder({ fulfillment: "delivery", ...o });

async function waitLive(page: Page): Promise<void> {
  await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
}

/** Cashier workspace: opens /retiro (Retiro en local) and waits for the live connection, so events created afterwards are not missed. */
export async function openRetiro(page: Page): Promise<void> {
  await page.goto("/retiro");
  await waitLive(page);
}

/** Delivery workspace: opens /delivery (optionally on a tab) and waits for the live connection. */
export async function openDelivery(page: Page, tab?: "pending" | "preparing" | "ready" | "enroute" | "recent"): Promise<void> {
  await page.goto(tab ? `/delivery?tab=${tab}` : "/delivery");
  await expect(page.getByTestId("workspace-tabs")).toBeVisible();
  await waitLive(page);
}

/** Admin general view (/caja): every sector's approvals and recents. */
export async function openCaja(page: Page): Promise<void> {
  await page.goto("/caja");
  await waitLive(page);
}

/** Counts connections to /api/events made by a context's pages. */
export function countEventSources(context: BrowserContext): { count: () => number } {
  let n = 0;
  context.on("request", (req) => {
    if (new URL(req.url()).pathname === "/api/events") n++;
  });
  return { count: () => n };
}

/** Replaces AudioContext with a stub that counts oscillator `start()` calls in `window.__beeps`. */
export async function stubAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __beeps: number; AudioContext: unknown };
    w.__beeps = 0;
    (w as unknown as { __ctxCount: number }).__ctxCount = 0;
    class FakeAudioContext {
      constructor() {
        (w as unknown as { __ctxCount: number }).__ctxCount++;
      }
      state = "running";
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      createOscillator() {
        return {
          type: "",
          frequency: { setValueAtTime() {} },
          connect() {},
          start() {
            w.__beeps++;
          },
          stop() {},
        };
      }
      createGain() {
        return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} };
      }
    }
    w.AudioContext = FakeAudioContext;
  });
}

export const audioContexts = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __ctxCount: number }).__ctxCount);

export const beeps = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __beeps: number }).__beeps);
