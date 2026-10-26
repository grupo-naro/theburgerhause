import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { resetDb, testDb } from "@/db/test-utils";
import { seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { activateDelay } from "./notices";
import { getPublicDelay } from "./public";

const db = () => testDb();
let fx: Fx;

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("getPublicDelay", () => {
  it("with no data gives the base ranges and is not delayed", async () => {
    expect(await getPublicDelay(db())).toEqual({
      takeaway: { low: 20, high: 30 },
      delivery: { low: 35, high: 45 },
      delayed: false,
    });
  });

  it("an active manual delay raises both ranges and flags delayed", async () => {
    await activateDelay(db(), fx.userId, { extraMinutes: 15, reason: "Se rompió la plancha" });
    expect(await getPublicDelay(db())).toEqual({
      takeaway: { low: 35, high: 45 },
      delivery: { low: 50, high: 60 },
      delayed: true,
    });
  });

  it("never serializes the reason, even when one is active", async () => {
    await activateDelay(db(), fx.userId, { extraMinutes: 15, reason: "Se rompió la plancha" });
    const json = JSON.stringify(await getPublicDelay(db()));
    expect(json).not.toContain("plancha");
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(["delayed", "delivery", "takeaway"]);
  });
});
