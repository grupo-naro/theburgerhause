import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("@/test-support/next-mocks")).nextHeadersMock);
vi.mock("next/server", async () => (await import("@/test-support/next-mocks")).nextServerMock);
vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);

import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { resetLoginRateLimit } from "@/lib/auth/login-rate-limit";
import { form, jar, PASSWORD, redirectOf, requestHeaders, resetNextMocks, seedFixtures } from "@/test-support/next-mocks";
import { login } from "./actions";

const GENERIC = "Usuario o contraseña incorrectos";
const RATE = "Demasiados intentos. Probá de nuevo en unos minutos.";
const prev = { error: null };
let fx: Awaited<ReturnType<typeof seedFixtures>>;

beforeEach(async () => {
  await resetDb();
  resetNextMocks();
  resetLoginRateLimit();
  fx = await seedFixtures();
});
afterAll(closeDb);

const sessions = () => testDb().select().from(s.sessions);

describe("login action", () => {
  it("returns the generic error and creates no session for bad credentials", async () => {
    expect(await login(prev, form({ username: "cora", password: "bad" }))).toEqual({ error: GENERIC });
    expect(await login(prev, form({ username: "ghost", password: "bad" }))).toEqual({ error: GENERIC });
    expect(await login(prev, form({ username: "cora", password: "x".repeat(257) }))).toEqual({ error: GENERIC });
    expect(await sessions()).toHaveLength(0);
    expect(jar.has("bh_session")).toBe(false);
  });

  it("sends a cajera with a valid station cookie to /mostrador and stores the station on the session", async () => {
    jar.set("bh_station", String(fx.station));
    expect(await redirectOf(login(prev, form({ username: "cora", password: PASSWORD })))).toBe("/mostrador");
    const rows = await sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0].stationId).toBe(fx.station);
    expect(jar.get("bh_session")).toBeTruthy();
  });

  it.each(["abc", "99999", ""])("sends a cajera with station cookie %j to /estacion", async (cookie) => {
    if (cookie) jar.set("bh_station", cookie);
    expect(await redirectOf(login(prev, form({ username: "cora", password: PASSWORD })))).toBe("/estacion");
    expect((await sessions())[0].stationId).toBeNull();
  });

  it("a cashier whose device cookie points at a Delivery station is sent to pick another one, no station stored", async () => {
    jar.set("bh_station", String(fx.deliveryStation));
    expect(await redirectOf(login(prev, form({ username: "cora", password: PASSWORD })))).toBe("/estacion?motivo=sector");
    expect((await sessions())[0].stationId).toBeNull();
  });

  it("the delivery manager with the Delivery cookie goes straight to Gestión Delivery", async () => {
    jar.set("bh_station", String(fx.deliveryStation));
    expect(await redirectOf(login(prev, form({ username: "enca", password: PASSWORD })))).toBe("/delivery");
    expect((await sessions())[0].stationId).toBe(fx.deliveryStation);
  });

  it("carries a safe next through /estacion", async () => {
    const url = await redirectOf(login(prev, form({ username: "cora", password: PASSWORD, next: "/mostrador" })));
    expect(url).toBe("/estacion?next=%2Fmostrador");
  });

  it("sends an admin to /admin or to a safe next, without forcing a station", async () => {
    expect(await redirectOf(login(prev, form({ username: "admin", password: PASSWORD })))).toBe("/admin");
    expect(await redirectOf(login(prev, form({ username: "admin", password: PASSWORD, next: "/admin/menu" })))).toBe(
      "/admin/menu",
    );
  });

  it.each(["//evil.com", "https://evil.com", "/login"])("ignores unsafe next %j", async (next) => {
    expect(await redirectOf(login(prev, form({ username: "admin", password: PASSWORD, next })))).toBe("/admin");
    jar.set("bh_station", String(fx.station));
    expect(await redirectOf(login(prev, form({ username: "cora", password: PASSWORD, next })))).toBe("/mostrador");
  });

  it("rate-limits the 6th attempt for the same ip|username", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await login(prev, form({ username: "cora", password: "bad" }))).toEqual({ error: GENERIC });
    }
    expect(await login(prev, form({ username: "cora", password: PASSWORD }))).toEqual({ error: RATE });
    expect(await sessions()).toHaveLength(0);
  });

  it("successful logins do not consume budget (nine PCs behind one IP)", async () => {
    for (let i = 0; i < 12; i++) {
      jar.set("bh_station", String(fx.station));
      expect(await redirectOf(login(prev, form({ username: "cora", password: PASSWORD })))).toBe("/mostrador");
    }
    expect(await login(prev, form({ username: "cora", password: "bad" }))).toEqual({ error: GENERIC });
  });

  it("a login sweeps expired sessions (and only them)", async () => {
    const [u] = await testDb().select({ id: s.users.id }).from(s.users).limit(1);
    await testDb().insert(s.sessions).values([
      { id: "expired-session-token", userId: u.id, expiresAt: new Date(Date.now() - 86_400_000) },
      { id: "live-session-token", userId: u.id, expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    jar.set("bh_station", String(fx.station));
    await redirectOf(login(prev, form({ username: "cora", password: PASSWORD })));
    const ids = (await sessions()).map((r) => r.id);
    expect(ids).toContain("live-session-token");
    expect(ids).not.toContain("expired-session-token");
    expect(ids).toHaveLength(2);
  });

  it("cannot dodge the limit by rotating the first X-Forwarded-For hop", async () => {
    for (let i = 0; i < 5; i++) {
      requestHeaders.value = new Headers({ "x-forwarded-for": `1.1.1.${i}, 10.0.0.1` });
      await login(prev, form({ username: "cora", password: "bad" }));
    }
    requestHeaders.value = new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" });
    expect(await login(prev, form({ username: "cora", password: PASSWORD }))).toEqual({ error: RATE });
  });
});
