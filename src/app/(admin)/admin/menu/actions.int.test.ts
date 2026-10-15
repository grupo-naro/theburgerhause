import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/menu/cache", () => ({ MENU_CACHE_TAG: "menu", invalidateMenu: vi.fn() }));
vi.mock("@/lib/menu/admin", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/menu/admin")>();
  return {
    ...m,
    saveCategory: vi.fn(m.saveCategory),
    saveProduct: vi.fn(m.saveProduct),
    moveCategory: vi.fn(m.moveCategory),
    moveProduct: vi.fn(m.moveProduct),
    setCategoryActive: vi.fn(m.setCategoryActive),
    setProductActive: vi.fn(m.setProductActive),
    setProductFeatured: vi.fn(m.setProductFeatured),
  };
});

import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession } from "@/lib/auth/roles";
import * as core from "@/lib/menu/admin";
import { invalidateMenu } from "@/lib/menu/cache";
import { form, redirectOf } from "@/test-support/next-mocks";
import {
  moveCategoryAction,
  moveProductAction,
  saveCategoryAction,
  saveProductAction,
  toggleCategoryActiveAction,
  toggleProductActiveAction,
  toggleProductFeaturedAction,
} from "./actions";

const session = (role: "admin" | "cajera"): AuthSession => ({
  user: { id: 1, name: "U", username: "u", role },
  stationId: null,
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

async function seedProduct() {
  const c = await core.saveCategory(testDb(), { name: "Burgers", active: true });
  if (!c.ok) throw new Error("seed");
  const p = await core.saveProduct(testDb(), { categoryId: c.data.id, name: "Doble", priceArs: 100, active: true, featured: false });
  if (!p.ok) throw new Error("seed");
  vi.clearAllMocks();
  return { categoryId: c.data.id, productId: p.data.id };
}

describe("authorization", () => {
  const calls: [string, () => Promise<unknown>, () => unknown][] = [
    ["saveCategoryAction", () => saveCategoryAction(prev, form({ name: "X", active: "on" })), () => core.saveCategory],
    [
      "saveProductAction",
      () => saveProductAction(prev, form({ categoryId: "1", name: "X", priceArs: "10" })),
      () => core.saveProduct,
    ],
    ["moveCategoryAction", () => moveCategoryAction(prev, form({ id: "1", dir: "up" })), () => core.moveCategory],
    ["moveProductAction", () => moveProductAction(prev, form({ id: "1", dir: "up" })), () => core.moveProduct],
    [
      "toggleCategoryActiveAction",
      () => toggleCategoryActiveAction(prev, form({ id: "1", value: "false" })),
      () => core.setCategoryActive,
    ],
    [
      "toggleProductActiveAction",
      () => toggleProductActiveAction(prev, form({ id: "1", value: "false" })),
      () => core.setProductActive,
    ],
    [
      "toggleProductFeaturedAction",
      () => toggleProductFeaturedAction(prev, form({ id: "1", value: "true" })),
      () => core.setProductFeatured,
    ],
  ];

  it.each(calls)("%s: cajera gets an error and the core is never called", async (_n, run, spy) => {
    asCajera();
    const r = (await run()) as { error?: string };
    expect(r.error).toBeTruthy();
    expect(spy()).not.toHaveBeenCalled();
    expect(invalidateMenu).not.toHaveBeenCalled();
    expect(await testDb().select().from(s.categories)).toHaveLength(0);
  });

  it.each(calls)("%s: anonymous is sent to /login", async (_n, run, spy) => {
    anonymous();
    expect(await redirectOf(run())).toBe("/login");
    expect(spy()).not.toHaveBeenCalled();
    expect(invalidateMenu).not.toHaveBeenCalled();
  });
});

describe("saveCategoryAction", () => {
  it("creates, invalidates once and redirects to the menu", async () => {
    asAdmin();
    const url = await redirectOf(saveCategoryAction(prev, form({ name: "Papas", active: "on" })));
    expect(url).toBe("/admin/menu");
    expect(invalidateMenu).toHaveBeenCalledTimes(1);
    expect((await testDb().select().from(s.categories))[0]).toMatchObject({ name: "Papas", slug: "papas", active: true });
  });

  it("treats a missing checkbox as inactive and empty imagePath as null", async () => {
    asAdmin();
    await redirectOf(saveCategoryAction(prev, form({ name: "Papas", imagePath: "" })));
    expect((await testDb().select().from(s.categories))[0]).toMatchObject({ active: false, imagePath: null });
  });

  it("returns field errors and values, without invalidating, on invalid input", async () => {
    asAdmin();
    const r = await saveCategoryAction(prev, form({ name: "  ", active: "on" }));
    expect(r.fieldErrors?.name).toBeTruthy();
    expect(invalidateMenu).not.toHaveBeenCalled();
  });

  it("rejects a forged imagePath", async () => {
    asAdmin();
    const r = await saveCategoryAction(prev, form({ name: "X", imagePath: "../../etc/passwd" }));
    expect(r.fieldErrors?.imagePath).toBeTruthy();
    expect(core.saveCategory).toHaveBeenCalledTimes(1);
    expect(await testDb().select().from(s.categories)).toHaveLength(0);
  });
});

describe("saveProductAction", () => {
  it("creates a product (pesos -> cents), invalidates once and redirects", async () => {
    asAdmin();
    const c = await core.saveCategory(testDb(), { name: "Burgers", active: true });
    if (!c.ok) throw new Error("seed");
    const url = await redirectOf(
      saveProductAction(
        prev,
        form({ categoryId: String(c.data.id), name: "Doble", description: "Rica", priceArs: "14400", active: "on", featured: "on" }),
      ),
    );
    expect(url).toBe("/admin/menu");
    expect(invalidateMenu).toHaveBeenCalledTimes(1);
    expect((await testDb().select().from(s.products))[0]).toMatchObject({ price: 1_440_000, featured: true, active: true });
  });

  it.each([["-5"], ["10.5"], ["abc"], [""]])("rejects price %j without invalidating", async (priceArs) => {
    asAdmin();
    const r = await saveProductAction(prev, form({ categoryId: "1", name: "X", priceArs }));
    expect(r.fieldErrors?.priceArs).toBeTruthy();
    expect(invalidateMenu).not.toHaveBeenCalled();
  });

  it("returns the duplicate-name field error and does not invalidate", async () => {
    asAdmin();
    const { categoryId } = await seedProduct();
    const r = await saveProductAction(prev, form({ categoryId: String(categoryId), name: "Doble", priceArs: "1" }));
    expect(r.fieldErrors?.name).toMatch(/Ya existe/);
    expect(invalidateMenu).not.toHaveBeenCalled();
  });
});

describe("quick actions", () => {
  it("move / toggle succeed and invalidate exactly once each", async () => {
    asAdmin();
    const { categoryId, productId } = await seedProduct();
    const id = String(productId);
    expect(await toggleProductActiveAction(prev, form({ id, value: "false" }))).toEqual({});
    expect(invalidateMenu).toHaveBeenCalledTimes(1);
    await toggleProductFeaturedAction(prev, form({ id, value: "true" }));
    await moveProductAction(prev, form({ id, dir: "down" }));
    await toggleCategoryActiveAction(prev, form({ id: String(categoryId), value: "false" }));
    await moveCategoryAction(prev, form({ id: String(categoryId), dir: "up" }));
    expect(invalidateMenu).toHaveBeenCalledTimes(5);
    const [row] = await testDb().select().from(s.products).where(eq(s.products.id, productId));
    expect(row).toMatchObject({ active: false, featured: true });
  });

  it("rejects malformed ids, directions and values without touching the core", async () => {
    asAdmin();
    for (const r of [
      await moveProductAction(prev, form({ id: "abc", dir: "up" })),
      await moveProductAction(prev, form({ id: "1", dir: "sideways" })),
      await toggleProductActiveAction(prev, form({ id: "1.5", value: "true" })),
      await toggleProductActiveAction(prev, form({ id: "1", value: "maybe" })),
    ]) {
      expect(r.error).toBeTruthy();
    }
    expect(core.moveProduct).not.toHaveBeenCalled();
    expect(core.setProductActive).not.toHaveBeenCalled();
    expect(invalidateMenu).not.toHaveBeenCalled();
  });

  it("returns a generic error (and does not invalidate) when the core rejects", async () => {
    asAdmin();
    vi.mocked(core.setProductActive).mockRejectedValueOnce(new Error("connection terminated"));
    const r = await toggleProductActiveAction(prev, form({ id: "1", value: "true" }));
    expect(r).toEqual({ error: "No se pudo completar la acción. Probá de nuevo." });
    expect(invalidateMenu).not.toHaveBeenCalled();
  });

  it("does not invalidate when the item does not exist", async () => {
    asAdmin();
    const r = await toggleProductActiveAction(prev, form({ id: "9999", value: "true" }));
    expect(r.error).toBeTruthy();
    expect(invalidateMenu).not.toHaveBeenCalled();
  });
});
