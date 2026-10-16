import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/menu/cache", () => ({ MENU_CACHE_TAG: "menu", invalidateMenu: vi.fn() }));
vi.mock("@/lib/modifiers/admin", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/modifiers/admin")>();
  return {
    ...m,
    saveModifierGroup: vi.fn(m.saveModifierGroup),
    saveModifier: vi.fn(m.saveModifier),
    moveModifier: vi.fn(m.moveModifier),
    setModifierActive: vi.fn(m.setModifierActive),
    setProductModifierGroups: vi.fn(m.setProductModifierGroups),
  };
});

import { asc } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession } from "@/lib/auth/roles";
import { saveCategory, saveProduct } from "@/lib/menu/admin";
import { invalidateMenu } from "@/lib/menu/cache";
import * as core from "@/lib/modifiers/admin";
import { form, redirectOf } from "@/test-support/next-mocks";
import { saveProductModifierGroupsAction } from "../menu/actions";
import {
  moveModifierAction,
  saveModifierAction,
  saveModifierGroupAction,
  toggleModifierActiveAction,
} from "./actions";

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

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});
afterAll(closeDb);

async function seed() {
  const g = await core.saveModifierGroup(testDb(), { name: "Agregados" });
  const c = await saveCategory(testDb(), { name: "Burgers", active: true });
  if (!g.ok || !c.ok) throw new Error("seed");
  const p = await saveProduct(testDb(), { categoryId: c.data.id, name: "Doble", priceArs: 100, active: true, featured: false });
  const m = await core.saveModifier(testDb(), { groupId: g.data.id, name: "Bacon", kind: "add", priceArs: 10, active: true });
  if (!p.ok || !m.ok) throw new Error("seed");
  vi.clearAllMocks();
  return { groupId: g.data.id, productId: p.data.id, modifierId: m.data.id };
}

describe("authorization", () => {
  const calls: [string, () => Promise<unknown>, () => unknown][] = [
    ["saveModifierGroupAction", () => saveModifierGroupAction(prev, form({ name: "X" })), () => core.saveModifierGroup],
    [
      "saveModifierAction",
      () => saveModifierAction(prev, form({ groupId: "1", name: "X", kind: "add", priceArs: "5" })),
      () => core.saveModifier,
    ],
    ["moveModifierAction", () => moveModifierAction(prev, form({ id: "1", dir: "up" })), () => core.moveModifier],
    [
      "toggleModifierActiveAction",
      () => toggleModifierActiveAction(prev, form({ id: "1", value: "false" })),
      () => core.setModifierActive,
    ],
    [
      "saveProductModifierGroupsAction",
      () => saveProductModifierGroupsAction(prev, form({ id: "1" })),
      () => core.setProductModifierGroups,
    ],
  ];

  it.each(calls)("%s: cajera gets an error and the core is never called", async (_n, run, spy) => {
    asCajera();
    const r = (await run()) as { error?: string };
    expect(r.error).toBeTruthy();
    expect(spy()).not.toHaveBeenCalled();
    expect(invalidateMenu).not.toHaveBeenCalled();
    expect(await testDb().select().from(s.modifierGroups)).toHaveLength(0);
  });

  it.each(calls)("%s: anonymous is sent to /login", async (_n, run, spy) => {
    anonymous();
    expect(await redirectOf(run())).toBe("/login");
    expect(spy()).not.toHaveBeenCalled();
    expect(invalidateMenu).not.toHaveBeenCalled();
  });
});

describe("saveModifierGroupAction", () => {
  it("creates, invalidates once and redirects", async () => {
    asAdmin();
    expect(await redirectOf(saveModifierGroupAction(prev, form({ name: "Papas" })))).toBe("/admin/modificadores");
    expect(invalidateMenu).toHaveBeenCalledTimes(1);
    expect((await testDb().select().from(s.modifierGroups))[0].name).toBe("Papas");
  });
  it("duplicate name: field error, values echoed, no invalidation", async () => {
    asAdmin();
    await redirectOf(saveModifierGroupAction(prev, form({ name: "Papas" })));
    vi.mocked(invalidateMenu).mockClear();
    const r = await saveModifierGroupAction(prev, form({ name: "Papas" }));
    expect(r.fieldErrors?.name).toMatch(/Ya existe/);
    expect(r.values?.name).toBe("Papas");
    expect(invalidateMenu).not.toHaveBeenCalled();
  });
});

describe("saveModifierAction", () => {
  it("creates an add modifier with an uppercase kitchen label", async () => {
    asAdmin();
    const { groupId } = await seed();
    const url = await redirectOf(
      saveModifierAction(prev, form({ groupId: String(groupId), name: "Extra queso", kind: "add", priceArs: "1200", active: "on" })),
    );
    expect(url).toBe("/admin/modificadores");
    expect(invalidateMenu).toHaveBeenCalledTimes(1);
    const rows = await testDb().select().from(s.modifiers).orderBy(asc(s.modifiers.id));
    expect(rows[1]).toMatchObject({ name: "Extra queso", priceDelta: 120000, kitchenLabel: "EXTRA QUESO", active: true });
  });
  it("a remove without a price field (disabled in the UI) is stored free", async () => {
    asAdmin();
    const { groupId } = await seed();
    await redirectOf(saveModifierAction(prev, form({ groupId: String(groupId), name: "Sin cheddar", kind: "remove" })));
    const rows = await testDb().select().from(s.modifiers).orderBy(asc(s.modifiers.id));
    expect(rows[1]).toMatchObject({ kind: "remove", priceDelta: 0, kitchenLabel: "SIN CHEDDAR", active: false });
  });
  it("a remove with a price is rejected and does not invalidate", async () => {
    asAdmin();
    const { groupId } = await seed();
    const r = await saveModifierAction(prev, form({ groupId: String(groupId), name: "Sin x", kind: "remove", priceArs: "50" }));
    expect(r.fieldErrors?.priceArs).toBe("Un quite no puede tener precio");
    expect(invalidateMenu).not.toHaveBeenCalled();
    expect(await testDb().select().from(s.modifiers)).toHaveLength(1);
  });
  it("validation failure does not invalidate", async () => {
    asAdmin();
    const r = await saveModifierAction(prev, form({ groupId: "x", name: "", kind: "zzz" }));
    expect(r.fieldErrors).toBeTruthy();
    expect(invalidateMenu).not.toHaveBeenCalled();
  });
});

describe("quick actions", () => {
  it("move and toggle invalidate once each on success", async () => {
    asAdmin();
    const { modifierId } = await seed();
    expect(await moveModifierAction(prev, form({ id: String(modifierId), dir: "down" }))).toEqual({});
    expect(invalidateMenu).toHaveBeenCalledTimes(1);
    expect(await toggleModifierActiveAction(prev, form({ id: String(modifierId), value: "false" }))).toEqual({});
    expect(invalidateMenu).toHaveBeenCalledTimes(2);
    expect((await testDb().select().from(s.modifiers))[0].active).toBe(false);
  });
  it("garbage input returns an error without touching the core or invalidating", async () => {
    asAdmin();
    expect((await moveModifierAction(prev, form({ id: "abc", dir: "sideways" }))).error).toBeTruthy();
    expect((await toggleModifierActiveAction(prev, form({ id: "1", value: "maybe" }))).error).toBeTruthy();
    expect(core.moveModifier).not.toHaveBeenCalled();
    expect(core.setModifierActive).not.toHaveBeenCalled();
    expect(invalidateMenu).not.toHaveBeenCalled();
  });
  it("an unknown id is a generic error and does not invalidate", async () => {
    asAdmin();
    expect((await toggleModifierActiveAction(prev, form({ id: "999", value: "true" }))).error).toBeTruthy();
    expect(invalidateMenu).not.toHaveBeenCalled();
  });
});

describe("saveProductModifierGroupsAction", () => {
  const withGroups = (id: string, groups: string[]) => {
    const fd = form({ id });
    for (const g of groups) fd.append("groupId", g);
    return fd;
  };
  it("replaces the links and invalidates exactly once", async () => {
    asAdmin();
    const { productId, groupId } = await seed();
    const r = await saveProductModifierGroupsAction(prev, withGroups(String(productId), [String(groupId)]));
    expect(r).toEqual({ message: "Grupos guardados" });
    expect(invalidateMenu).toHaveBeenCalledTimes(1);
    expect(await core.listProductGroupIds(testDb(), productId)).toEqual([groupId]);
    await saveProductModifierGroupsAction(prev, withGroups(String(productId), []));
    expect(await core.listProductGroupIds(testDb(), productId)).toEqual([]);
    expect(invalidateMenu).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed ids and unknown groups without invalidating", async () => {
    asAdmin();
    const { productId, groupId } = await seed();
    await core.setProductModifierGroups(testDb(), productId, [groupId]);
    vi.clearAllMocks();
    expect((await saveProductModifierGroupsAction(prev, withGroups(String(productId), ["abc"]))).error).toBeTruthy();
    expect((await saveProductModifierGroupsAction(prev, withGroups("zzz", ["1"]))).error).toBeTruthy();
    expect((await saveProductModifierGroupsAction(prev, withGroups(String(productId), ["9999"]))).error).toBeTruthy();
    expect(invalidateMenu).not.toHaveBeenCalled();
    expect(await core.listProductGroupIds(testDb(), productId)).toEqual([groupId]);
  });
});
