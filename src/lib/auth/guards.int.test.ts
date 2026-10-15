import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("@/test-support/next-mocks")).nextHeadersMock);
vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);

import { closeDb } from "@/db/client";
import { resetDb, testDb } from "@/db/test-utils";
import { requireSessionOrRedirect, requireStationOrRedirect } from "@/lib/auth/guards";
import { getSession } from "@/lib/auth/session";
import { createSession, setSessionStation } from "@/lib/auth/session-store";
import { jar, redirectOf, resetNextMocks, seedFixtures } from "@/test-support/next-mocks";

let fx: Awaited<ReturnType<typeof seedFixtures>>;
async function loginAs(userId: number, stationId?: number) {
  const { token } = await createSession(testDb(), { userId });
  if (stationId) await setSessionStation(testDb(), token, stationId);
  jar.set("bh_session", token);
}

beforeEach(async () => {
  await resetDb();
  resetNextMocks();
  fx = await seedFixtures();
});
afterAll(closeDb);

describe("requireSessionOrRedirect", () => {
  it("redirects to /login with next when there is no session", async () => {
    expect(await redirectOf(requireSessionOrRedirect(["admin"], "/admin"))).toBe("/login?next=%2Fadmin");
    expect(await redirectOf(requireSessionOrRedirect(["admin"]))).toBe("/login");
  });

  it("redirects an invalid token to /login", async () => {
    jar.set("bh_session", "bogus");
    expect(await redirectOf(requireSessionOrRedirect(["admin"], "/admin"))).toBe("/login?next=%2Fadmin");
  });

  it("redirects a wrong role to its own home", async () => {
    await loginAs(fx.cora);
    expect(await redirectOf(requireSessionOrRedirect(["admin"], "/admin"))).toBe("/caja");
    await loginAs(fx.enca);
    expect(await redirectOf(requireSessionOrRedirect(["admin", "cajera"]))).toBe("/despacho");
  });

  it("returns the session for an allowed role", async () => {
    await loginAs(fx.admin);
    expect((await requireSessionOrRedirect(["admin"])).user.role).toBe("admin");
  });
});

describe("requireStationOrRedirect", () => {
  it("redirects to /estacion when the session has no station", async () => {
    await loginAs(fx.cora);
    const session = (await getSession())!;
    expect(() => requireStationOrRedirect(session, "/caja")).toThrow("redirect:/estacion?next=%2Fcaja");
  });

  it("returns the station id when set", async () => {
    await loginAs(fx.cora, fx.station);
    expect(requireStationOrRedirect((await getSession())!)).toBe(fx.station);
  });
});
