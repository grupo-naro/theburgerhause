import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/settings/cache", () => ({ SETTINGS_CACHE_TAG: "settings", invalidateSettings: vi.fn() }));
vi.mock("@/lib/settings/admin", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/settings/admin")>();
  return { ...m, saveSettings: vi.fn(m.saveSettings), setAcceptingOrders: vi.fn(m.setAcceptingOrders) };
});

import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession } from "@/lib/auth/roles";
import { getAcceptingOrders, getSettings } from "@/lib/settings";
import * as core from "@/lib/settings/admin";
import { invalidateSettings } from "@/lib/settings/cache";
import { form, redirectOf } from "@/test-support/next-mocks";
import { saveSettingsAction, toggleAcceptingOrdersAction } from "./actions";

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

const valid = (over: Record<string, string> = {}) =>
  form({
    storeName: "Burger Local",
    storeAddress: "Calle 1",
    storePhone: "11 5555-1234",
    whatsapp: "5491155551234",
    bankAlias: "burger.828",
    bankCbu: "0123456789012345678901",
    deliveryFeePesos: "1500",
    acceptingOrders: "on",
    openingHoursText: "Lun a Dom",
    ...over,
  });

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});
afterAll(closeDb);

describe("authorization", () => {
  const calls: [string, () => Promise<unknown>, () => unknown][] = [
    ["saveSettingsAction", () => saveSettingsAction(prev, valid()), () => core.saveSettings],
    [
      "toggleAcceptingOrdersAction",
      () => toggleAcceptingOrdersAction(prev, form({ value: "false" })),
      () => core.setAcceptingOrders,
    ],
  ];
  it.each(calls)("%s: cajera gets an error and the core is never called", async (_n, run, spy) => {
    asCajera();
    expect(((await run()) as { error?: string }).error).toBeTruthy();
    expect(spy()).not.toHaveBeenCalled();
    expect(invalidateSettings).not.toHaveBeenCalled();
    expect(await testDb().select().from(s.settings)).toHaveLength(0);
  });
  it.each(calls)("%s: anonymous is sent to /login", async (_n, run, spy) => {
    anonymous();
    expect(await redirectOf(run())).toBe("/login");
    expect(spy()).not.toHaveBeenCalled();
    expect(invalidateSettings).not.toHaveBeenCalled();
  });
});

describe("saveSettingsAction", () => {
  it("saves, converts pesos to cents, invalidates once and reports success", async () => {
    asAdmin();
    expect(await saveSettingsAction(prev, valid())).toEqual({ message: "Ajustes guardados" });
    expect(invalidateSettings).toHaveBeenCalledTimes(1);
    expect(await getSettings(testDb())).toMatchObject({
      bankAlias: "burger.828",
      bankCbu: "0123456789012345678901",
      deliveryFee: 150000,
      acceptingOrders: true,
    });
  });
  it("an unchecked box means not accepting orders", async () => {
    asAdmin();
    const fd = valid();
    fd.delete("acceptingOrders");
    await saveSettingsAction(prev, fd);
    expect(await getAcceptingOrders(testDb())).toBe(false);
  });
  it("validation failure: field errors, values echoed, nothing invalidated or stored", async () => {
    asAdmin();
    const r = await saveSettingsAction(prev, valid({ bankCbu: "123", deliveryFeePesos: "-1", storeName: "" }));
    expect(r.fieldErrors).toMatchObject({
      bankCbu: expect.any(String),
      deliveryFeePesos: expect.any(String),
      storeName: expect.any(String),
    });
    expect(r.values?.bankCbu).toBe("123");
    expect(invalidateSettings).not.toHaveBeenCalled();
    expect(await testDb().select().from(s.settings)).toHaveLength(0);
  });
  it("a blank fee is a validation error, not zero", async () => {
    asAdmin();
    const r = await saveSettingsAction(prev, valid({ deliveryFeePesos: "" }));
    expect(r.fieldErrors?.deliveryFeePesos).toBeTruthy();
  });
});

describe("toggleAcceptingOrdersAction", () => {
  it("flips the switch, strongly consistent, and invalidates once", async () => {
    asAdmin();
    expect(await toggleAcceptingOrdersAction(prev, form({ value: "false" }))).toEqual({});
    expect(invalidateSettings).toHaveBeenCalledTimes(1);
    expect(await getAcceptingOrders(testDb())).toBe(false);
    expect(await toggleAcceptingOrdersAction(prev, form({ value: "true" }))).toEqual({});
    expect(await getAcceptingOrders(testDb())).toBe(true);
  });
  it("garbage input returns an error without touching the core or invalidating", async () => {
    asAdmin();
    expect((await toggleAcceptingOrdersAction(prev, form({ value: "maybe" }))).error).toBeTruthy();
    expect(core.setAcceptingOrders).not.toHaveBeenCalled();
    expect(invalidateSettings).not.toHaveBeenCalled();
  });
});
