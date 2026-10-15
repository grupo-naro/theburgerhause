import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { closeDb } from "@/db/client";
import { testDb } from "@/db/test-utils";
import { getEnv } from "@/lib/env";
import { ORDERS_CHANNEL, PRINT_CHANNEL } from "./channels";
import { MAX_NOTIFY_BYTES, notifyInTx } from "./notify";

const db = () => testDb();

async function listener(channel: string) {
  const client = new Client({ connectionString: getEnv().DATABASE_URL });
  await client.connect();
  const received: string[] = [];
  let wake: (() => void) | null = null;
  client.on("notification", (m) => {
    received.push(m.payload ?? "");
    wake?.();
  });
  await client.query(`LISTEN ${channel}`);
  const next = (timeoutMs = 3000) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout waiting for notification")), timeoutMs);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
  return { client, received, next };
}

/** Resolves true if nothing arrived on `received` after a round-trip barrier. */
async function barrier(client: Client) {
  await client.query("select 1");
}

const clients: Client[] = [];
afterAll(async () => {
  await db().execute(sql.raw(`DROP FUNCTION IF EXISTS boom_notify() CASCADE`));
  await closeDb();
});
afterEach(async () => {
  await db().execute(sql.raw(`DROP TABLE IF EXISTS notify_probe CASCADE; DROP FUNCTION IF EXISTS boom_notify() CASCADE`));
  await Promise.all(clients.splice(0).map((c) => c.end()));
});
beforeAll(async () => {
  await db().execute(sql`select 1`);
});

describe("notifyInTx", () => {
  it("delivers after COMMIT, with the JSON payload", async () => {
    const l = await listener(ORDERS_CHANNEL);
    clients.push(l.client);
    const got = l.next();
    await db().transaction(async (tx) => {
      await notifyInTx(tx, ORDERS_CHANNEL, { orderId: 5, status: "en_preparacion", event: "status" });
      await barrier(l.client);
      expect(l.received).toEqual([]); // not before commit
    });
    await got;
    expect(JSON.parse(l.received[0])).toEqual({ orderId: 5, status: "en_preparacion", event: "status" });
  });

  it("delivers print events on their own channel", async () => {
    const l = await listener(PRINT_CHANNEL);
    clients.push(l.client);
    const got = l.next();
    await db().transaction((tx) => notifyInTx(tx, PRINT_CHANNEL, { jobId: 2, stationId: 1 }));
    await got;
    expect(JSON.parse(l.received[0])).toEqual({ jobId: 2, stationId: 1 });
  });

  it("delivers NOTHING on rollback", async () => {
    const l = await listener(ORDERS_CHANNEL);
    clients.push(l.client);
    await expect(
      db().transaction(async (tx) => {
        await notifyInTx(tx, ORDERS_CHANNEL, { orderId: 1, status: "entregado", event: "status" });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    await barrier(l.client);
    expect(l.received).toEqual([]);
  });

  it("delivers NOTHING when COMMIT itself fails after pg_notify ran", async () => {
    await db().execute(
      sql.raw(`
        CREATE TABLE notify_probe (id int);
        CREATE FUNCTION boom_notify() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom at commit'; END $$ LANGUAGE plpgsql;
        CREATE CONSTRAINT TRIGGER boom_notify_trg AFTER INSERT ON notify_probe
          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION boom_notify();`),
    );
    const l = await listener(ORDERS_CHANNEL);
    clients.push(l.client);
    await expect(
      db().transaction(async (tx) => {
        await tx.execute(sql`insert into notify_probe values (1)`);
        await notifyInTx(tx, ORDERS_CHANNEL, { orderId: 1, status: "entregado", event: "status" });
      }),
    ).rejects.toThrow();
    await barrier(l.client);
    expect(l.received).toEqual([]);
  });

  it("throws a clear error at >= 7000 bytes and sends nothing", async () => {
    const l = await listener(ORDERS_CHANNEL);
    clients.push(l.client);
    const big = { orderId: 1, status: "entregado", event: "x".repeat(MAX_NOTIFY_BYTES) } as never;
    await expect(db().transaction((tx) => notifyInTx(tx, ORDERS_CHANNEL, big))).rejects.toThrow(/too large/i);
    await barrier(l.client);
    expect(l.received).toEqual([]);
  });

  it("is parameterized (quotes in the payload are inert)", async () => {
    const l = await listener(ORDERS_CHANNEL);
    clients.push(l.client);
    const got = l.next();
    await db().transaction((tx) =>
      notifyInTx(tx, ORDERS_CHANNEL, { orderId: 1, status: "entregado", event: "x');drop table orders;--" } as never),
    );
    await got;
    expect(l.received).toHaveLength(1);
  });
});
