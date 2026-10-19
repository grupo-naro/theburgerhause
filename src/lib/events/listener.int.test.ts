import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { testDb } from "@/db/test-utils";
import { ORDERS_CHANNEL, PRINT_CHANNEL, STOCK_CHANNEL, type OrdersEvent } from "./channels";
import { resetBus, subscribe } from "./bus";
import { LISTENER_APP_NAME, listenerStatus, startListener, stopListener } from "./listener";

const db = () => testDb();
const FAST = { minMs: 20, maxMs: 80 };

async function listenerPids(): Promise<number[]> {
  const rows = await db().execute(
    sql`select pid from pg_stat_activity where application_name = ${LISTENER_APP_NAME} and datname = current_database()`,
  );
  return rows.rows.map((r) => Number((r as { pid: number }).pid));
}

/** Resolves on the next event of a topic; rejects after a timeout (event-based, no sleeps). */
function once<T>(subscribeFn: (cb: (v: T) => void) => () => void, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const off = subscribeFn((v) => {
      clearTimeout(t);
      off();
      resolve(v);
    });
    const t = setTimeout(() => {
      off();
      reject(new Error("timed out waiting for bus event"));
    }, ms);
  });
}
const nextResync = () => once<undefined>((cb) => subscribe("resync", cb));
const nextOrders = () => once<OrdersEvent>((cb) => subscribe(ORDERS_CHANNEL, cb));

async function pollUntil(cond: () => Promise<boolean> | boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("pollUntil timed out");
}

async function startLive() {
  const live = nextResync();
  startListener({ backoff: FAST });
  await live;
}

beforeEach(async () => {
  await stopListener();
  resetBus();
});
afterEach(async () => {
  await stopListener();
  resetBus();
});
afterAll(async () => {
  await stopListener();
  await closeDb();
});

describe("pg listener", () => {
  it("connects, publishes resync, and ends up live", async () => {
    expect(listenerStatus()).toBe("down");
    await startLive();
    expect(listenerStatus()).toBe("live");
  });

  it("starting twice keeps ONE connection", async () => {
    await startLive();
    startListener({ backoff: FAST });
    startListener({ backoff: FAST });
    expect(await listenerPids()).toHaveLength(1);
  });

  it("receives notifications and publishes them to the bus", async () => {
    await startLive();
    const got = nextOrders();
    await db().transaction((tx) =>
      tx.execute(sql`select pg_notify(${ORDERS_CHANNEL}, ${JSON.stringify({ orderId: 9, status: "en_preparacion", event: "status" })})`),
    );
    expect(await got).toEqual({ orderId: 9, status: "en_preparacion", event: "status" });
  });

  it("publishes print events on the bus too", async () => {
    await startLive();
    const got = once<{ jobId: number }>((cb) => subscribe(PRINT_CHANNEL, cb));
    await db().execute(sql`select pg_notify(${PRINT_CHANNEL}, ${JSON.stringify({ jobId: 4, stationId: 2 })})`);
    expect(await got).toEqual({ jobId: 4, stationId: 2 });
  });

  it("publishes stock events on the bus too", async () => {
    await startLive();
    const got = once<{ itemId: number; reason: string }>((cb) => subscribe(STOCK_CHANNEL, cb));
    await db().execute(sql`select pg_notify(${STOCK_CHANNEL}, ${JSON.stringify({ itemId: 5, reason: "consumo" })})`);
    expect(await got).toEqual({ itemId: 5, reason: "consumo" });
  });

  it("ignores garbage payloads without crashing, and keeps working", async () => {
    await startLive();
    let seen = 0;
    subscribe(ORDERS_CHANNEL, () => seen++);
    await db().execute(sql`select pg_notify(${ORDERS_CHANNEL}, 'not json')`);
    await db().execute(sql`select pg_notify(${ORDERS_CHANNEL}, '{"orderId":"x"}')`);
    const good = nextOrders();
    await db().execute(sql`select pg_notify(${ORDERS_CHANNEL}, ${JSON.stringify({ orderId: 1, status: "entregado", event: "status" })})`);
    await good;
    expect(seen).toBe(1);
    expect(listenerStatus()).toBe("live");
  });

  it("reconnects after its backend is killed: down, then live, resync, and later notifies arrive", async () => {
    await startLive();
    const [pid] = await listenerPids();
    const statuses: string[] = [];
    const resync = nextResync();
    const poll = setInterval(() => statuses.push(listenerStatus()), 2);
    try {
      await db().execute(sql`select pg_terminate_backend(${pid})`);
      await resync;
    } finally {
      clearInterval(poll);
    }
    expect(statuses).toContain("down");
    await pollUntil(() => listenerStatus() === "live");
    const pids = await listenerPids();
    expect(pids).toHaveLength(1);
    expect(pids[0]).not.toBe(pid);

    const got = nextOrders();
    await db().execute(sql`select pg_notify(${ORDERS_CHANNEL}, ${JSON.stringify({ orderId: 3, status: "cancelado", event: "status" })})`);
    expect((await got).orderId).toBe(3);
  });

  it("survives repeated kills (backoff resets after each success)", async () => {
    await startLive();
    for (let i = 0; i < 3; i++) {
      const [pid] = await listenerPids();
      const resync = nextResync();
      await db().execute(sql`select pg_terminate_backend(${pid})`);
      await resync;
      expect(listenerStatus()).toBe("live");
    }
  });

  it("stopListener leaves zero connections and does not reconnect", async () => {
    await startLive();
    await stopListener();
    expect(listenerStatus()).toBe("down");
    await pollUntil(async () => (await listenerPids()).length === 0);
    let resyncs = 0;
    subscribe("resync", () => resyncs++);
    await new Promise((r) => setTimeout(r, 4 * FAST.maxMs)); // negative assertion: let any wrongly scheduled reconnect fire
    expect(resyncs).toBe(0);
    expect(await listenerPids()).toHaveLength(0);
  });

  it("stopping while a reconnect is pending cancels it", async () => {
    await startLive();
    const [pid] = await listenerPids();
    await db().execute(sql`select pg_terminate_backend(${pid})`);
    await pollUntil(() => listenerStatus() === "down");
    await stopListener();
    await new Promise((r) => setTimeout(r, 4 * FAST.maxMs));
    expect(await listenerPids()).toHaveLength(0);
  });

  it("reports down while the database is unreachable and stops cleanly", async () => {
    const bad = "postgres://nobody:x@127.0.0.1:1/none"; // nothing listens on port 1
    startListener({ connectionString: bad, backoff: FAST });
    await pollUntil(() => listenerStatus() === "down");
    await stopListener();
    expect(listenerStatus()).toBe("down");
  });
});
