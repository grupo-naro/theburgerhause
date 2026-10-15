import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("@/test-support/next-mocks")).nextHeadersMock);
vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/session-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session-store")>();
  return { ...actual, revokeSession: vi.fn(actual.revokeSession) };
});

import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { createSession, revokeSession } from "@/lib/auth/session-store";
import { jar, redirectOf, resetNextMocks, seedFixtures } from "@/test-support/next-mocks";
import { logout } from "./actions";

beforeEach(async () => {
  await resetDb();
  resetNextMocks();
  const fx = await seedFixtures();
  const { token } = await createSession(testDb(), { userId: fx.cora });
  jar.set("bh_session", token);
});
afterAll(closeDb);

describe("logout", () => {
  it("deletes the session row, clears the cookie and redirects to /login", async () => {
    expect(await testDb().select().from(s.sessions)).toHaveLength(1);
    expect(await redirectOf(logout())).toBe("/login");
    expect(await testDb().select().from(s.sessions)).toHaveLength(0);
    expect(jar.has("bh_session")).toBe(false);
  });

  it("clears the cookie even when revoking the DB row fails", async () => {
    vi.mocked(revokeSession).mockRejectedValueOnce(new Error("db down"));
    await expect(logout()).rejects.toThrow("db down");
    expect(jar.has("bh_session")).toBe(false);
  });

  it("works without a session", async () => {
    jar.clear();
    expect(await redirectOf(logout())).toBe("/login");
  });
});
