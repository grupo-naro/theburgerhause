import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { checkOrdersOpen } from "./actions";

const setOpen = (value: boolean) =>
  testDb()
    .insert(s.settings)
    .values({ key: "accepting_orders", value })
    .onConflictDoUpdate({ target: s.settings.key, set: { value } });

beforeEach(resetDb);
afterAll(closeDb);

describe("checkOrdersOpen", () => {
  it("is open by default (no setting stored yet)", async () => {
    expect(await checkOrdersOpen()).toEqual({ open: true });
  });

  it("follows the switch immediately, in both directions (nothing cached)", async () => {
    await setOpen(false);
    expect(await checkOrdersOpen()).toEqual({ open: false });
    await setOpen(true);
    expect(await checkOrdersOpen()).toEqual({ open: true });
    await setOpen(false);
    expect(await checkOrdersOpen()).toEqual({ open: false });
  });

  it("needs no session", async () => {
    await setOpen(true);
    await expect(checkOrdersOpen()).resolves.toEqual({ open: true });
  });
});
