import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/stations/cache", () => ({ invalidateStations: vi.fn() }));
vi.mock("@/lib/stations/admin", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/stations/admin")>();
  return {
    ...m,
    createStation: vi.fn(m.createStation),
    rotateStationToken: vi.fn(m.rotateStationToken),
    renameStation: vi.fn(m.renameStation),
  };
});

import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession } from "@/lib/auth/roles";
import * as core from "@/lib/stations/admin";
import { invalidateStations } from "@/lib/stations/cache";
import { hashStationToken, isWellFormedStationToken } from "@/lib/stations/token";
import { form, redirectOf } from "@/test-support/next-mocks";
import { createStationAction, renameStationAction, rotateStationTokenAction } from "./actions";

const session = (role: "admin" | "cajera"): AuthSession => ({
  user: { id: 1, name: "U", username: "u", role },
  stationId: null,
  stationKind: null,
  sessionId: "x",
});
const asAdmin = () => vi.mocked(requireRole).mockResolvedValue(session("admin"));
const asCajera = () => vi.mocked(requireRole).mockRejectedValue(new AuthError("FORBIDDEN"));
const anonymous = () => vi.mocked(requireRole).mockRejectedValue(new AuthError("UNAUTHENTICATED"));
const prev = {};

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});
afterAll(closeDb);

describe("authorization", () => {
  const calls: [string, () => Promise<unknown>, () => unknown][] = [
    ["createStationAction", () => createStationAction(prev, form({ name: "X", kind: "mostrador" })), () => core.createStation],
    ["rotateStationTokenAction", () => rotateStationTokenAction(prev, form({ id: "1" })), () => core.rotateStationToken],
    ["renameStationAction", () => renameStationAction(prev, form({ id: "1", name: "Y" })), () => core.renameStation],
  ];
  it.each(calls)("%s: cajera gets an error (no token) and the core is never called", async (_n, run, spy) => {
    asCajera();
    const r = (await run()) as { error?: string; token?: string };
    expect(r.error).toBeTruthy();
    expect(r.token).toBeUndefined();
    expect(spy()).not.toHaveBeenCalled();
    expect(invalidateStations).not.toHaveBeenCalled();
    expect(await testDb().select().from(s.stations)).toHaveLength(0);
  });
  it.each(calls)("%s: anonymous is sent to /login", async (_n, run, spy) => {
    anonymous();
    expect(await redirectOf(run())).toBe("/login");
    expect(spy()).not.toHaveBeenCalled();
    expect(invalidateStations).not.toHaveBeenCalled();
  });
});

describe("createStationAction", () => {
  it("returns the token in the state once, stores only its hash and invalidates once", async () => {
    asAdmin();
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    const r = await createStationAction(prev, form({ name: "Mostrador 2", kind: "mostrador" }));
    expect(isWellFormedStationToken(r.token)).toBe(true);
    expect(r.stationName).toBe("Mostrador 2");
    expect(invalidateStations).toHaveBeenCalledTimes(1);
    const [stored] = await testDb().select().from(s.stations);
    expect(stored.tokenHash).toBe(hashStationToken(r.token!));
    expect(JSON.stringify(stored)).not.toContain(r.token!);
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(r.token!);
    vi.restoreAllMocks();
  });
  it("duplicate name: field error, no token, no invalidation", async () => {
    asAdmin();
    await createStationAction(prev, form({ name: "Delivery", kind: "delivery" }));
    vi.mocked(invalidateStations).mockClear();
    const r = await createStationAction(prev, form({ name: "Delivery", kind: "delivery" }));
    expect(r.fieldErrors?.name).toMatch(/Ya existe/);
    expect(r.token).toBeUndefined();
    expect(r.values?.name).toBe("Delivery");
    expect(invalidateStations).not.toHaveBeenCalled();
  });
  it("validation failure creates nothing", async () => {
    asAdmin();
    const r = await createStationAction(prev, form({ name: "", kind: "cocina" }));
    expect(r.fieldErrors?.name).toBeTruthy();
    expect(r.fieldErrors?.kind).toBeTruthy();
    expect(invalidateStations).not.toHaveBeenCalled();
    expect(await testDb().select().from(s.stations)).toHaveLength(0);
  });
  it("an unexpected throw becomes a fixed generic message", async () => {
    asAdmin();
    vi.mocked(core.createStation).mockRejectedValueOnce(new Error("secret postgres://u:p@h"));
    const r = await createStationAction(prev, form({ name: "X", kind: "mostrador" }));
    expect(r).toEqual({ error: "No se pudo completar la acción. Probá de nuevo." });
  });
});

describe("rotateStationTokenAction", () => {
  it("returns a new token; the previous one stops matching", async () => {
    asAdmin();
    const created = await createStationAction(prev, form({ name: "M1", kind: "mostrador" }));
    const [{ id }] = await testDb().select().from(s.stations);
    vi.mocked(invalidateStations).mockClear();
    const r = await rotateStationTokenAction(prev, form({ id: String(id) }));
    expect(isWellFormedStationToken(r.token)).toBe(true);
    expect(r.token).not.toBe(created.token);
    expect(invalidateStations).toHaveBeenCalledTimes(1);
    const [stored] = await testDb().select().from(s.stations);
    expect(stored.tokenHash).toBe(hashStationToken(r.token!));
    expect(stored.tokenHash).not.toBe(hashStationToken(created.token!));
  });
  it("garbage and unknown ids return an error without invalidating or a token", async () => {
    asAdmin();
    const a = await rotateStationTokenAction(prev, form({ id: "abc" }));
    const b = await rotateStationTokenAction(prev, form({ id: "999" }));
    expect(a.error && b.error).toBeTruthy();
    expect(a.token ?? b.token).toBeUndefined();
    expect(invalidateStations).not.toHaveBeenCalled();
  });
});

describe("renameStationAction", () => {
  it("renames and invalidates once; duplicates do not invalidate", async () => {
    asAdmin();
    await createStationAction(prev, form({ name: "A", kind: "mostrador" }));
    await createStationAction(prev, form({ name: "B", kind: "mostrador" }));
    vi.mocked(invalidateStations).mockClear();
    const [a] = await testDb().select().from(s.stations);
    expect(await renameStationAction(prev, form({ id: String(a.id), name: "A2" }))).toEqual({ message: "Nombre guardado" });
    expect(invalidateStations).toHaveBeenCalledTimes(1);
    const dup = await renameStationAction(prev, form({ id: String(a.id), name: "B" }));
    expect(dup.fieldErrors?.name).toBeTruthy();
    expect(invalidateStations).toHaveBeenCalledTimes(1);
  });
});
