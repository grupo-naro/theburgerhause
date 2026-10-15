import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { createStation, listStationsForAdmin, renameStation, rotateStationToken } from "./admin";
import { hashStationToken, isWellFormedStationToken } from "./token";

const db = () => testDb();
const row = async (id: number) => (await db().select().from(s.stations).where(eq(s.stations.id, id)))[0];

async function create(name = "Mostrador 1", kind = "mostrador") {
  const r = await createStation(db(), { name, kind });
  if (!r.ok) throw new Error(`station failed: ${JSON.stringify(r)}`);
  return r.data;
}

beforeEach(resetDb);
afterAll(closeDb);

describe("createStation", () => {
  it("returns the plain token once and stores only its sha256", async () => {
    const { station, token } = await create();
    expect(isWellFormedStationToken(token)).toBe(true);
    const stored = await row(station.id);
    expect(stored.tokenHash).toBe(hashStationToken(token));
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // the plain token is in no column of any station row
    const dump = await db().execute(sql`select row_to_json(t)::text as j from stations t`);
    expect(JSON.stringify(dump.rows)).not.toContain(token);
    // and the returned station object carries no hash
    expect(Object.keys(station).sort()).toEqual(["id", "kind", "name"]);
    expect(JSON.stringify(station)).not.toContain(stored.tokenHash!);
  });
  it("gives every station a different token", async () => {
    const a = await create("A");
    const b = await create("B", "delivery");
    expect(a.token).not.toBe(b.token);
    expect((await row(b.station.id)).kind).toBe("delivery");
  });
  it("reports a duplicate name as a field error and creates nothing", async () => {
    await create("Mostrador 1");
    const dup = await createStation(db(), { name: "Mostrador 1", kind: "delivery" });
    expect(dup).toMatchObject({ ok: false, fieldErrors: { name: expect.stringMatching(/Ya existe/) } });
    expect(JSON.stringify(dup)).not.toMatch(/insert|violates|constraint|bhst_/i);
    expect(await db().select().from(s.stations)).toHaveLength(1);
  });
  it("validates the input", async () => {
    expect(await createStation(db(), { name: " ", kind: "x" })).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.any(String), kind: expect.any(String) },
    });
    expect(await db().select().from(s.stations)).toHaveLength(0);
  });
});

describe("rotateStationToken", () => {
  it("returns a new token, replaces the hash and the old token stops matching", async () => {
    const { station, token: oldToken } = await create();
    const r = await rotateStationToken(db(), station.id);
    if (!r.ok) throw new Error("rotate failed");
    const { token: newToken } = r.data;
    expect(newToken).not.toBe(oldToken);
    expect(isWellFormedStationToken(newToken)).toBe(true);
    const stored = await row(station.id);
    expect(stored.tokenHash).toBe(hashStationToken(newToken));
    const match = (t: string) => db().select().from(s.stations).where(eq(s.stations.tokenHash, hashStationToken(t)));
    expect(await match(oldToken)).toHaveLength(0);
    expect(await match(newToken)).toHaveLength(1);
  });
  it("generates a first token for a seeded station that has none", async () => {
    const [seeded] = await db().insert(s.stations).values({ name: "Seed", kind: "mostrador" }).returning();
    expect(seeded.tokenHash).toBeNull();
    const r = await rotateStationToken(db(), seeded.id);
    expect(r.ok).toBe(true);
    expect((await row(seeded.id)).tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("keeps the other stations' tokens and rejects unknown/invalid ids", async () => {
    const a = await create("A");
    const b = await create("B");
    await rotateStationToken(db(), a.station.id);
    expect((await row(b.station.id)).tokenHash).toBe(hashStationToken(b.token));
    expect((await rotateStationToken(db(), 999)).ok).toBe(false);
    expect((await rotateStationToken(db(), 1.5)).ok).toBe(false);
  });
});

describe("renameStation", () => {
  it("renames without touching the token and maps duplicates", async () => {
    const a = await create("A");
    await create("B");
    expect((await renameStation(db(), { id: a.station.id, name: "A2" })).ok).toBe(true);
    const stored = await row(a.station.id);
    expect(stored.name).toBe("A2");
    expect(stored.tokenHash).toBe(hashStationToken(a.token));
    expect(await renameStation(db(), { id: a.station.id, name: "B" })).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.any(String) },
    });
    expect((await renameStation(db(), { id: 999, name: "Z" })).ok).toBe(false);
  });
});

describe("listStationsForAdmin", () => {
  it("derives the connection state from last_seen_at with an injected now and flags token presence", async () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const a = await create("A online");
    const b = await create("B offline");
    const c = await create("C never");
    await db().insert(s.stations).values({ name: "D no token", kind: "delivery" });
    await db().update(s.stations).set({ lastSeenAt: new Date(now.getTime() - 30_000) }).where(eq(s.stations.id, a.station.id));
    await db().update(s.stations).set({ lastSeenAt: new Date(now.getTime() - 300_000) }).where(eq(s.stations.id, b.station.id));
    const rows = await listStationsForAdmin(db(), now);
    expect(rows.map((r) => [r.name, r.connection, r.hasToken])).toEqual([
      ["A online", "online", true],
      ["B offline", "offline", true],
      ["C never", "never", true],
      ["D no token", "never", false],
    ]);
    expect(c.station.id).toBeGreaterThan(0);
  });
  it("never exposes the token hash", async () => {
    await create();
    const rows = await listStationsForAdmin(db());
    expect(Object.keys(rows[0]).sort()).toEqual(["connection", "hasToken", "id", "kind", "lastSeenAt", "name"]);
    expect(JSON.stringify(rows)).not.toMatch(/[0-9a-f]{64}/);
  });
});
