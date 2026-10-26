import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { expect, type Locator, type Page } from "@playwright/test";
import * as s from "../../src/db/schema";
import { approveOrder } from "../../src/lib/orders/approve-order";
import { assignCadet, markPickup, markReady } from "../../src/lib/orders/dispatch";
import { placeCajaOrder, type CajaOrderFixture } from "./caja";
import { db, findStation, findUser } from "./db";
import { seedCounterOrder } from "./pos";

export const tag = (): string => `${Date.now().toString(36)}${Math.floor(Math.random() * 100)}`;

/** Order card (any lane except "En camino" rows) by its daily number. */
export const dcard = (page: Page, number: number): Locator =>
  page.locator(`[data-testid="dispatch-card"][data-order-number="${number}"]`);
export const routeOrder = (page: Page, number: number): Locator =>
  page.locator(`[data-testid="route-order"][data-order-number="${number}"]`);
export const cadetGroup = (page: Page, cadetId: number): Locator => page.locator(`[data-testid="cadet-group"][data-cadet-id="${cadetId}"]`);
export const lane = (page: Page, id: string): Locator => page.getByTestId(`lane-${id}`);

/** Opens /despacho (admin general board, every lane) and waits for the live connection (events created afterwards are not missed). */
export async function openDespacho(page: Page): Promise<void> {
  await page.goto("/despacho");
  await expect(page.getByTestId("dispatch-board")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
}

/** Cashier workspace: opens /mostrador/pedidos (counter orders: Mostrador) and waits for the live connection. */
export async function openPedidos(page: Page): Promise<void> {
  await page.goto("/mostrador/pedidos");
  await expect(page.getByTestId("dispatch-board")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
}

const cleanups: Array<() => Promise<unknown>> = [];
/** Registers something to undo after the test (wire it with `test.afterEach(runCleanups)`: it runs on failure too). */
export const onCleanup = (fn: () => Promise<unknown>): void => void cleanups.push(fn);
export async function runCleanups(): Promise<void> {
  while (cleanups.length) {
    try {
      await cleanups.pop()!();
    } catch {
      // best effort: the next cleanup must still run
    }
  }
}

/** Creates an active cadet; it is deactivated again after the test so shared lists stay clean. */
export async function ensureCadet(name: string, phone: string | null = "11 5555-0000"): Promise<{ id: number; name: string }> {
  const [row] = await db().insert(s.cadets).values({ name, phone, active: true }).returning({ id: s.cadets.id, name: s.cadets.name });
  onCleanup(() => setCadetActive(row.id, false));
  return row;
}

export const setCadetActive = (id: number, active: boolean) => db().update(s.cadets).set({ active }).where(eq(s.cadets.id, id));

/** Moves when an order ENTERED a status (its latest event into it) and, optionally, its creation time. */
export async function setStatusClock(orderId: number, to: (typeof s.orderEvents.$inferSelect)["toStatus"], enteredAt: Date, createdAt?: Date): Promise<void> {
  const [ev] = await db().select({ id: s.orderEvents.id }).from(s.orderEvents).where(and(eq(s.orderEvents.orderId, orderId), eq(s.orderEvents.toStatus, to))).orderBy(desc(s.orderEvents.id)).limit(1);
  await db().update(s.orderEvents).set({ at: enteredAt }).where(eq(s.orderEvents.id, ev.id));
  if (createdAt) await db().update(s.orders).set({ createdAt }).where(eq(s.orders.id, orderId));
}

/** Clears the board: every order still on it is closed (no pager stays taken). */
export async function cleanBoard(): Promise<void> {
  await db()
    .update(s.orders)
    .set({ status: "entregado" })
    .where(inArray(s.orders.status, ["pendiente_aprobacion", "en_preparacion", "listo_despacho", "para_retirar", "en_camino"]));
}

/** Same hint the app pushes on a status change, so open boards refresh. */
export async function pingOrders(orderId: number): Promise<void> {
  const payload = JSON.stringify({ orderId, status: "listo_despacho", event: "updated" });
  await db().execute(sql`select pg_notify('orders_changed', ${payload})`);
}

async function actors() {
  const cajera = await findUser("cajera");
  const encargada = await findUser("encargada");
  const station = await findStation("Mostrador 1");
  const deliveryStation = await findStation("Delivery 1");
  return { cajera, encargada, station, deliveryStation };
}

/**
 * A web order approved the way the sectors work: delivery orders by the delivery manager at Delivery 1, takeaway
 * orders by the cashier at Mostrador 1 (so it sits in "En preparación" and its print jobs belong to that station).
 */
export async function placeApproved(o: Parameters<typeof placeCajaOrder>[0] = {}): Promise<CajaOrderFixture> {
  const fx = await placeCajaOrder({ single: true, ...o });
  const { cajera, encargada, station, deliveryStation } = await actors();
  const delivery = (o.fulfillment ?? "delivery") === "delivery";
  const r = await approveOrder(db(), { sector: null,
    orderId: fx.id,
    userId: delivery ? encargada.id : cajera.id,
    stationId: delivery ? deliveryStation.id : station.id,
    paymentVerified: (o.paymentMethod ?? "cash") === "transfer",
  });
  if (!r.ok) throw new Error(`approve failed: ${r.message}`);
  return fx;
}

export async function readyInDb(orderId: number): Promise<void> {
  const { encargada } = await actors();
  const r = await markReady(db(), { sector: null, orderId, userId: encargada.id });
  if (!r.ok) throw new Error(`markReady failed: ${r.message}`);
}

export async function pickupInDb(orderId: number): Promise<void> {
  const { encargada } = await actors();
  const r = await markPickup(db(), { sector: null, orderId, userId: encargada.id });
  if (!r.ok) throw new Error(`markPickup failed: ${r.message}`);
}

export async function assignInDb(orderIds: number[], cadetId: number): Promise<void> {
  const { encargada } = await actors();
  const r = await assignCadet(db(), { sector: null, orderIds, cadetId, userId: encargada.id });
  if (!r.ok) throw new Error(`assign failed: ${r.message}`);
}

/** Approved + ready web order. */
export async function placeReady(o: Parameters<typeof placeCajaOrder>[0] = {}): Promise<CajaOrderFixture> {
  const fx = await placeApproved(o);
  await readyInDb(fx.id);
  return fx;
}

let pagerSeq = 600 + (Date.now() % 300);
/** Wraps back to 600 after 999 (the pager limit): a late random start must not run out of numbers mid-file. */
export const nextPager = (): number => (pagerSeq = pagerSeq >= 999 ? 600 : pagerSeq + 1);

/** A counter sale (POS core) with its pager, in preparation. */
export const counterOrder = (pager = nextPager()) => seedCounterOrder(pager).then((r) => ({ ...r, pager }));

export type Populated = {
  cadet: { id: number; name: string };
  prep: number[];
  readyDelivery: CajaOrderFixture[];
  readyCounter: number[];
  pickup: number[];
  route: CajaOrderFixture[];
};

/** Every lane with something in it (for layout and screenshots). */
export async function populateBoard(label: string): Promise<Populated> {
  await cleanBoard();
  const cadet = await ensureCadet(`Nahuel ${label}`);
  const prepDelivery = await placeApproved({ fulfillment: "delivery", paymentMethod: "cash" });
  const prepCounter = await counterOrder();
  const readyDelivery = [
    await placeReady({ fulfillment: "delivery", paymentMethod: "cash", crossStreets: "Mitre y Sarmiento", notes: "Timbre roto, llamar al llegar" }),
    await placeReady({ fulfillment: "delivery", paymentMethod: "transfer", address: "San Martín 450, 2A" }),
    await placeReady({ fulfillment: "delivery", paymentMethod: "cash", address: "Belgrano 88" }),
  ];
  const readyTakeaway = await placeReady({ fulfillment: "takeaway", paymentMethod: "cash" });
  const readyPos = await counterOrder();
  await readyInDb(readyPos.orderId);
  const pickupWeb = await placeReady({ fulfillment: "takeaway", paymentMethod: "cash" });
  await pickupInDb(pickupWeb.id);
  const pickupPos = await counterOrder();
  await readyInDb(pickupPos.orderId);
  await pickupInDb(pickupPos.orderId);
  const route = [await placeReady({ fulfillment: "delivery", paymentMethod: "cash", address: "Alsina 1020" }), await placeReady({ fulfillment: "delivery", paymentMethod: "transfer", address: "Moreno 77" })];
  await assignInDb(route.map((r) => r.id), cadet.id);
  return {
    cadet,
    prep: [prepDelivery.number, prepCounter.number],
    readyDelivery,
    readyCounter: [readyTakeaway.number, readyPos.number],
    pickup: [pickupWeb.number, pickupPos.number],
    route,
  };
}
