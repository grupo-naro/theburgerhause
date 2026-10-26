import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asc } from "drizzle-orm";
import { Client } from "pg";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { getEnv } from "@/lib/env";
import { DELAY_CHANNEL } from "@/lib/events/channels";
import { seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { activateDelay, deactivateDelay, getActiveDelay } from "./notices";

const db = () => testDb();
let fx: Fx;

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

const allRows = () => db().select().from(s.delayNotices).orderBy(asc(s.delayNotices.id));
const open = async () => (await allRows()).filter((r) => r.endedAt === null);

describe("manual delay notices", () => {
  it("activating creates one active row", async () => {
    const r = await activateDelay(db(), fx.userId, { extraMinutes: 15, reason: "  Se pinchó  " });
    expect(r.ok && r.data).toMatchObject({ extraMinutes: 15, reason: "Se pinchó" });
    expect(await open()).toHaveLength(1);
    expect(await getActiveDelay(db())).toMatchObject({ extraMinutes: 15, reason: "Se pinchó" });
  });

  it("rejects invalid input without touching the table", async () => {
    const r = await activateDelay(db(), fx.userId, { extraMinutes: 7, reason: "x" });
    expect(r.ok).toBe(false);
    expect(await allRows()).toHaveLength(0);
  });

  it("activating again closes the first with ended_by and leaves exactly one active", async () => {
    await activateDelay(db(), fx.userId, { extraMinutes: 10, reason: "a" });
    await activateDelay(db(), fx.userId, { extraMinutes: 20, reason: "b" });
    const rows = await allRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].endedAt).not.toBeNull();
    expect(rows[0].endedBy).toBe(fx.userId);
    expect(await open()).toHaveLength(1);
    expect((await getActiveDelay(db()))?.extraMinutes).toBe(20);
  });

  it("deactivating closes it and keeps the history", async () => {
    await activateDelay(db(), fx.userId, { extraMinutes: 10, reason: "a" });
    expect(await deactivateDelay(db(), fx.userId)).toEqual({ ok: true, data: { wasActive: true } });
    expect(await getActiveDelay(db())).toBeNull();
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].endedBy).toBe(fx.userId);
  });

  it("deactivating with none active reports wasActive false", async () => {
    expect(await deactivateDelay(db(), fx.userId)).toEqual({ ok: true, data: { wasActive: false } });
  });

  it("two concurrent activations leave exactly one active", async () => {
    const [a, b] = await Promise.all([
      activateDelay(db(), fx.userId, { extraMinutes: 10, reason: "a" }),
      activateDelay(db(), fx.userId, { extraMinutes: 25, reason: "b" }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(await open()).toHaveLength(1);
    expect(await allRows()).toHaveLength(2);
  });

  it("emits the delay channel on each change, after commit", async () => {
    const client = new Client({ connectionString: getEnv().DATABASE_URL });
    await client.connect();
    try {
      const got: string[] = [];
      client.on("notification", (m) => got.push(m.payload ?? ""));
      await client.query(`LISTEN ${DELAY_CHANNEL}`);
      await activateDelay(db(), fx.userId, { extraMinutes: 10, reason: "a" });
      await deactivateDelay(db(), fx.userId);
      await deactivateDelay(db(), fx.userId);
      for (let i = 0; i < 50 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
      expect(got.map((p) => JSON.parse(p))).toEqual([{ active: true }, { active: false }]);
    } finally {
      await client.end();
    }
  });
});
