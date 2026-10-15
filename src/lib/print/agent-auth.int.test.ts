import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { createStation, rotateStationToken } from "@/lib/stations/admin";
import { authenticateStation, touchStationSeen } from "./agent-auth";

const db = () => testDb();
let token: string;
let stationId: number;

beforeEach(async () => {
  await resetDb();
  const r = await createStation(db(), { name: "Mostrador 1", kind: "mostrador" });
  if (!r.ok) throw new Error("fixture");
  token = r.data.token;
  stationId = r.data.station.id;
});
afterAll(closeDb);

const lastSeen = async () => (await db().select().from(s.stations).where(eq(s.stations.id, stationId)))[0].lastSeenAt;

describe("authenticateStation", () => {
  it("a valid token resolves to its station (no hash in the result)", async () => {
    const st = await authenticateStation(db(), `Bearer ${token}`);
    expect(st).toEqual({ id: stationId, name: "Mostrador 1", kind: "mostrador" });
  });

  it("wrong, malformed, empty and missing credentials all give null", async () => {
    const other = `bhst_${"Z".repeat(43)}`;
    for (const h of [`Bearer ${other}`, "Bearer garbage", "Bearer ", "", null, undefined, token, `Basic ${token}`]) {
      expect(await authenticateStation(db(), h)).toBeNull();
    }
  });

  it("a rotated (old) token fails immediately and the new one works", async () => {
    const rot = await rotateStationToken(db(), stationId);
    if (!rot.ok) throw new Error("fixture");
    expect(await authenticateStation(db(), `Bearer ${token}`)).toBeNull();
    expect(await authenticateStation(db(), `Bearer ${rot.data.token}`)).toMatchObject({ id: stationId });
  });

  it("a station without a token never matches", async () => {
    await db().insert(s.stations).values({ name: "Sin token", kind: "delivery" });
    expect(await authenticateStation(db(), `Bearer ${`bhst_${"A".repeat(43)}`}`)).toBeNull();
  });

  it("failed auth leaves last_seen_at untouched; the stored hash is never the plain token", async () => {
    await authenticateStation(db(), "Bearer nope");
    await authenticateStation(db(), `Bearer bhst_${"Q".repeat(43)}`);
    expect(await lastSeen()).toBeNull();
    const [row] = await db().select().from(s.stations).where(eq(s.stations.id, stationId));
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("successful auth alone does not touch last_seen_at either (touching is explicit)", async () => {
    await authenticateStation(db(), `Bearer ${token}`);
    expect(await lastSeen()).toBeNull();
  });
});

describe("touchStationSeen", () => {
  it("sets last_seen_at to the given time", async () => {
    const at = new Date("2026-10-15T12:00:00Z");
    await touchStationSeen(db(), stationId, at);
    expect((await lastSeen())?.toISOString()).toBe(at.toISOString());
  });
});
