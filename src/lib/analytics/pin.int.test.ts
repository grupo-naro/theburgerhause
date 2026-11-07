import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { hashPassword } from "@/lib/auth/password";
import { getSettings } from "@/lib/settings";
import { getAnalyticsUnlock, hasAnalyticsPin, lockAnalytics, PIN_BUSY_MESSAGE, setAnalyticsPin, UNLOCK_MS, unlockAnalytics } from "./pin";
import { resetPinRateLimit } from "./pin-rate-limit";

const db = () => testDb();
const NOW = new Date("2026-11-07T22:00:00-03:00");
let adminHash: string;
let adminId: number;

beforeAll(async () => {
  adminHash = await hashPassword("secreta");
});

beforeEach(async () => {
  await resetDb();
  resetPinRateLimit();
  const [u] = await db().insert(s.users).values({ name: "Dueño", username: "admin", passwordHash: adminHash, role: "admin" }).returning();
  adminId = u.id;
  const exp = new Date(NOW.getTime() + 3_600_000);
  await db().insert(s.sessions).values([
    { id: "s1", userId: adminId, expiresAt: exp },
    { id: "s2", userId: adminId, expiresAt: exp },
  ]);
});
afterAll(closeDb);

const setPin = (pin: string, password = "secreta") => setAnalyticsPin(db(), adminId, { pin, pinConfirm: pin, password });

describe("setAnalyticsPin", () => {
  it("set pin requires the admin password", async () => {
    const bad = await setPin("1234", "otra");
    expect(bad).toEqual({ ok: false, fieldErrors: { password: "Contraseña incorrecta" } });
    expect(await hasAnalyticsPin(db())).toBe(false);

    expect(await setPin("1234")).toEqual({ ok: true, data: null });
    expect(await hasAnalyticsPin(db())).toBe(true);
    const [row] = await db().select().from(s.settings).where(eq(s.settings.key, "analytics_pin_hash"));
    expect(String(row.value)).toMatch(/^scrypt\$/);
    expect(String(row.value)).not.toContain("1234");
  });

  it("rejects an invalid pin before checking the password", async () => {
    const r = await setPin("12");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.fieldErrors?.pin).toBe("El PIN tiene que tener de 4 a 6 números");
  });

  it("settings never expose the pin hash", async () => {
    await setPin("1234");
    const json = JSON.stringify(await getSettings(db()));
    expect(json).not.toContain("scrypt$");
    expect(json).not.toContain("analytics_pin_hash");
  });
});

describe("unlockAnalytics", () => {
  const unlock = (pin: string, sessionId = "s1", now = NOW) => unlockAnalytics(db(), { sessionId, userId: adminId, pin, now });

  it("unlock without pin", async () => {
    expect(await unlock("1234")).toEqual({ ok: false, error: "Configurá el PIN en Ajustes" });
  });

  it("unlock sets 15 min on that session only", async () => {
    await setPin("2468");
    expect(UNLOCK_MS).toBe(15 * 60 * 1000);
    expect(await unlock("2468")).toEqual({ ok: true, data: { until: new Date(NOW.getTime() + UNLOCK_MS) } });
    expect((await getAnalyticsUnlock(db(), "s1", NOW))?.toISOString()).toBe(new Date(NOW.getTime() + UNLOCK_MS).toISOString());
    expect(await getAnalyticsUnlock(db(), "s2", NOW)).toBeNull();
  });

  it("expired unlock", async () => {
    await setPin("2468");
    await unlock("2468");
    expect(await getAnalyticsUnlock(db(), "s1", new Date(NOW.getTime() + UNLOCK_MS + 1))).toBeNull();
  });

  it("wrong pin", async () => {
    await setPin("2468");
    expect(await unlock("1111")).toEqual({ ok: false, error: "PIN incorrecto" });
    expect(await getAnalyticsUnlock(db(), "s1", NOW)).toBeNull();
  });

  it("wrong pin 5 times blocks even the right pin", async () => {
    await setPin("2468");
    for (let i = 0; i < 5; i++) await unlock("1111");
    const r = await unlock("2468");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Demasiados intentos, probá en \d+ min$/);
    expect(await getAnalyticsUnlock(db(), "s1", NOW)).toBeNull();
  });

  it("parallel wrong pins cannot exceed the failure limit", async () => {
    await setPin("2468");
    const results = await Promise.all(Array.from({ length: 20 }, () => unlock("1111")));
    expect(results.filter((r) => !r.ok && r.error === "PIN incorrecto").length).toBeLessThanOrEqual(5);
    // The overlapping ones were turned away without trying the PIN.
    expect(results.every((r) => !r.ok && (r.error === "PIN incorrecto" || r.error === PIN_BUSY_MESSAGE))).toBe(true);
    // Sequential attempts are still allowed afterwards (the lock is released).
    expect((await unlock("2468")).ok).toBe(true);
  });

  it("parallel wrong passwords cannot exceed the failure limit", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => setPin("1234", "otra")));
    expect(results.filter((r) => !r.ok && r.fieldErrors?.password === "Contraseña incorrecta").length).toBeLessThanOrEqual(5);
  });

  it("lock clears it", async () => {
    await setPin("2468");
    await unlock("2468");
    await lockAnalytics(db(), "s1");
    expect(await getAnalyticsUnlock(db(), "s1", NOW)).toBeNull();
  });
});
