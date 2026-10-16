import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("@/test-support/next-mocks")).nextHeadersMock);
vi.mock("next/server", async () => (await import("@/test-support/next-mocks")).nextServerMock);
vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);

import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { createSession } from "@/lib/auth/session-store";
import { form, jar, redirectOf, resetNextMocks, seedFixtures } from "@/test-support/next-mocks";
import { selectStation } from "./actions";

let fx: Awaited<ReturnType<typeof seedFixtures>>;
const stationOf = async () =>
  (await testDb().select().from(s.sessions).where(eq(s.sessions.userId, fx.cora)))[0].stationId;

beforeEach(async () => {
  await resetDb();
  resetNextMocks();
  fx = await seedFixtures();
  const { token } = await createSession(testDb(), { userId: fx.cora });
  jar.set("bh_session", token);
});
afterAll(closeDb);

describe("selectStation", () => {
  it("stores the station on the session and device cookie, then goes to the role home", async () => {
    expect(await redirectOf(selectStation(form({ stationId: String(fx.station) })))).toBe("/mostrador");
    expect(await stationOf()).toBe(fx.station);
    expect(jar.get("bh_station")).toBe(String(fx.station));
  });

  it("honours a safe next and ignores an unsafe one", async () => {
    expect(await redirectOf(selectStation(form({ stationId: String(fx.station), next: "/mostrador" })))).toBe("/mostrador");
    expect(await redirectOf(selectStation(form({ stationId: String(fx.station), next: "//evil.com" })))).toBe("/mostrador");
  });

  it.each(["99999", "abc", "-1", ""])("rejects station id %j without side effects", async (id) => {
    expect(await redirectOf(selectStation(form({ stationId: id })))).toBe("/estacion");
    expect(jar.has("bh_station")).toBe(false);
    expect(await stationOf()).toBeNull();
  });

  it("a cashier cannot sit at a Delivery station (unsupported combination): back to the picker with the reason, nothing stored", async () => {
    expect(await redirectOf(selectStation(form({ stationId: String(fx.deliveryStation), next: "/retiro" })))).toBe(
      "/estacion?next=%2Fretiro&motivo=sector",
    );
    expect(jar.has("bh_station")).toBe(false);
    expect(await stationOf()).toBeNull();
  });

  it("the delivery manager can sit at Delivery but not at Mostrador; admin anywhere", async () => {
    const { token } = await createSession(testDb(), { userId: fx.enca });
    jar.set("bh_session", token);
    expect(await redirectOf(selectStation(form({ stationId: String(fx.station) })))).toBe("/estacion?motivo=sector");
    expect(await redirectOf(selectStation(form({ stationId: String(fx.deliveryStation) })))).toBe("/delivery");
    const admin = await createSession(testDb(), { userId: fx.admin });
    jar.set("bh_session", admin.token);
    expect(await redirectOf(selectStation(form({ stationId: String(fx.deliveryStation) })))).toBe("/admin");
    expect(await redirectOf(selectStation(form({ stationId: String(fx.station) })))).toBe("/admin");
  });

  it("requires a session", async () => {
    jar.delete("bh_session");
    expect(await redirectOf(selectStation(form({ stationId: String(fx.station) })))).toBe("/login?next=%2Festacion");
    expect(jar.has("bh_station")).toBe(false);
  });
});
