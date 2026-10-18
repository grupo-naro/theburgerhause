import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/password")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { authenticate } from "@/lib/auth/login";
import { scryptSync, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";

const db = () => testDb();

beforeEach(async () => {
  await resetDb();
  vi.mocked(verifyPassword).mockClear();
  await db().insert(s.users).values([
    { name: "Ana", username: "Ana", passwordHash: await hashPassword("secret-pass"), role: "cajera" },
    { name: "Baja", username: "baja", passwordHash: await hashPassword("secret-pass"), role: "cajera", active: false },
  ]);
});
afterAll(closeDb);

describe("authenticate", () => {
  it("returns the user for the right password", async () => {
    const user = await authenticate(db(), { username: "Ana", password: "secret-pass" });
    expect(user).toMatchObject({ name: "Ana", username: "Ana", role: "cajera" });
    expect(user).not.toHaveProperty("passwordHash");
    expect(verifyPassword).toHaveBeenCalledTimes(1);
  });

  it("is case-insensitive on username and trims it", async () => {
    expect(await authenticate(db(), { username: "  aNA ", password: "secret-pass" })).not.toBeNull();
  });

  it("returns null for a wrong password", async () => {
    expect(await authenticate(db(), { username: "ana", password: "nope" })).toBeNull();
    expect(verifyPassword).toHaveBeenCalledTimes(1);
  });

  it("returns null for an unknown user, still running one verify (dummy hash)", async () => {
    expect(await authenticate(db(), { username: "ghost", password: "secret-pass" })).toBeNull();
    expect(verifyPassword).toHaveBeenCalledTimes(1);
  });

  it("returns null for an inactive user even with the right password", async () => {
    expect(await authenticate(db(), { username: "baja", password: "secret-pass" })).toBeNull();
    expect(verifyPassword).toHaveBeenCalledTimes(1);
  });

  it("never throws on odd input", async () => {
    expect(await authenticate(db(), { username: "", password: "" })).toBeNull();
    expect(await authenticate(db(), { username: "%_'\"; --", password: "x".repeat(10_000) })).toBeNull();
  });

  it("upgrades a legacy-parameter hash to the current cost on a successful login (and only then)", async () => {
    const salt = randomBytes(16);
    const legacy = `scrypt$16384$8$1$${salt.toString("base64")}$${scryptSync("legacy-pass", salt, 64, { N: 16384, r: 8, p: 1 }).toString("base64")}`;
    await db().insert(s.users).values({ name: "Vieja", username: "vieja", passwordHash: legacy, role: "cajera" });
    const stored = async () => (await db().select().from(s.users).where(eq(s.users.username, "vieja")))[0].passwordHash;

    expect(await authenticate(db(), { username: "vieja", password: "wrong" })).toBeNull();
    expect(await stored()).toBe(legacy); // a failed login never rewrites

    expect(await authenticate(db(), { username: "vieja", password: "legacy-pass" })).not.toBeNull();
    const upgraded = await stored();
    expect(upgraded).not.toBe(legacy);
    expect(needsRehash(upgraded)).toBe(false);
    expect(upgraded.startsWith("scrypt$32768$8$3$")).toBe(true);

    // The same password keeps working with the new hash, and a current hash is not rewritten again.
    expect(await authenticate(db(), { username: "vieja", password: "legacy-pass" })).not.toBeNull();
    expect(await stored()).toBe(upgraded);
  });

  it("a failing hash upgrade never fails the login", async () => {
    const salt = randomBytes(16);
    const legacy = `scrypt$16384$8$1$${salt.toString("base64")}$${scryptSync("legacy-pass", salt, 64, { N: 16384, r: 8, p: 1 }).toString("base64")}`;
    await db().insert(s.users).values({ name: "Vieja", username: "vieja", passwordHash: legacy, role: "cajera" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const real = db();
    const noWrite = new Proxy(real, {
      get: (t, prop, recv) => (prop === "update" ? () => { throw new Error("db read only"); } : Reflect.get(t, prop, recv)),
    });
    expect(await authenticate(noWrite, { username: "vieja", password: "legacy-pass" })).not.toBeNull();
    expect(spy).toHaveBeenCalledWith("password hash upgrade failed");
    spy.mockRestore();
  });

  it("logs a fixed string and returns null on unexpected errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = Object.assign(new Error("secret-pass leaked in $2 params"), { code: "57P01" });
    const failing = { select: () => { throw boom; } } as unknown as Parameters<typeof authenticate>[0];
    expect(await authenticate(failing, { username: "ana", password: "secret-pass" })).toBeNull();
    expect(spy).toHaveBeenCalledWith("authenticate failed (code 57P01)");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-pass");
    spy.mockRestore();
  });
});
