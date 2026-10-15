import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/password")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { authenticate } from "@/lib/auth/login";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

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
});
