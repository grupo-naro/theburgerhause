import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { saveCategory, saveProduct } from "@/lib/menu/admin";
import {
  getModifierForAdmin,
  listGroupsWithModifiers,
  listProductGroupIds,
  moveModifier,
  saveModifier,
  saveModifierGroup,
  setModifierActive,
  setProductModifierGroups,
} from "./admin";

const db = () => testDb();

async function group(name: string) {
  const r = await saveModifierGroup(db(), { name });
  if (!r.ok) throw new Error(`group failed: ${JSON.stringify(r)}`);
  return r.data.id;
}
async function mod(groupId: number, name: string, extra: Record<string, unknown> = {}) {
  const r = await saveModifier(db(), { groupId, name, kind: "add", priceArs: 0, active: true, ...extra });
  if (!r.ok) throw new Error(`modifier failed: ${JSON.stringify(r)}`);
  return r.data.id;
}
async function product(name = "Doble") {
  const c = await saveCategory(db(), { name: `Cat ${name}`, active: true });
  if (!c.ok) throw new Error("cat");
  const p = await saveProduct(db(), { categoryId: c.data.id, name, priceArs: 100, active: true, featured: false });
  if (!p.ok) throw new Error("prod");
  return p.data.id;
}
const order = async (groupId: number) =>
  (
    await db()
      .select()
      .from(s.modifiers)
      .where(eq(s.modifiers.groupId, groupId))
      .orderBy(asc(s.modifiers.sort), asc(s.modifiers.id))
  ).map((m) => m.name);
const sorts = async (groupId: number) =>
  (await db().select().from(s.modifiers).where(eq(s.modifiers.groupId, groupId)).orderBy(asc(s.modifiers.id))).map(
    (m) => m.sort,
  );

beforeEach(resetDb);
afterAll(closeDb);

describe("saveModifierGroup", () => {
  it("creates, edits and rejects duplicate names with a field error", async () => {
    const id = await group("Papas");
    expect(await saveModifierGroup(db(), { id, name: "Papas XL" })).toEqual({ ok: true, data: { id } });
    await group("Salsas");
    const dup = await saveModifierGroup(db(), { name: "Salsas" });
    expect(dup).toMatchObject({ ok: false, fieldErrors: { name: expect.stringMatching(/Ya existe/) } });
    expect(JSON.stringify(dup)).not.toMatch(/insert|violates|constraint/i);
  });
  it("validates and reports a missing group", async () => {
    expect(await saveModifierGroup(db(), { name: " " })).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.any(String) },
    });
    expect((await saveModifierGroup(db(), { id: 99, name: "X" })).ok).toBe(false);
  });
});

describe("saveModifier", () => {
  it("increments sort per group and stores cents and an uppercase label", async () => {
    const g1 = await group("A");
    const g2 = await group("B");
    await mod(g1, "Uno");
    const two = await mod(g1, "Dos", { priceArs: 1200, kitchenLabel: "extra dos" });
    await mod(g2, "Uno");
    expect(await sorts(g1)).toEqual([0, 1]);
    expect(await sorts(g2)).toEqual([0]);
    expect(await getModifierForAdmin(db(), two)).toMatchObject({ priceDelta: 120000, kitchenLabel: "EXTRA DOS" });
  });
  it("derives the label for removes", async () => {
    const g = await group("Q");
    const id = await mod(g, "Sin cheddar", { kind: "remove" });
    expect((await getModifierForAdmin(db(), id))?.kitchenLabel).toBe("SIN CHEDDAR");
  });
  it("rejects duplicate name in the same group but allows it in another", async () => {
    const g1 = await group("A");
    const g2 = await group("B");
    await mod(g1, "Bacon");
    expect(
      await saveModifier(db(), { groupId: g1, name: "Bacon", kind: "add", priceArs: 0, active: true }),
    ).toMatchObject({ ok: false, fieldErrors: { name: expect.stringMatching(/Ya existe/) } });
    await expect(mod(g2, "Bacon")).resolves.toBeGreaterThan(0);
  });
  it("rejects a remove with price at zod level and the DB CHECK also rejects it (23514)", async () => {
    const g = await group("Q");
    expect(
      await saveModifier(db(), { groupId: g, name: "Sin x", kind: "remove", priceArs: 10, active: true }),
    ).toMatchObject({ ok: false, fieldErrors: { priceArs: "Un quite no puede tener precio" } });
    const err = await db()
      .insert(s.modifiers)
      .values({ groupId: g, name: "Sin y", kind: "remove", priceDelta: 500, kitchenLabel: "SIN Y" })
      .then(
        () => null,
        (e: { cause?: { code?: string }; code?: string }) => e.cause?.code ?? e.code,
      );
    expect(err).toBe("23514");
    expect(await order(g)).toEqual([]);
  });
  it("maps an unknown group to a field error", async () => {
    expect(
      await saveModifier(db(), { groupId: 999, name: "X", kind: "add", priceArs: 0, active: true }),
    ).toMatchObject({ ok: false, fieldErrors: { groupId: expect.any(String) } });
  });
  it("edits in place keeping sort, and moves to another group at its end", async () => {
    const g1 = await group("A");
    const g2 = await group("B");
    await mod(g1, "A1");
    const a2 = await mod(g1, "A2");
    await mod(g2, "B1");
    await saveModifier(db(), { id: a2, groupId: g1, name: "A2b", kind: "swap", priceArs: 5, active: false });
    expect(await getModifierForAdmin(db(), a2)).toMatchObject({ name: "A2b", kind: "swap", active: false, sort: 1 });
    await saveModifier(db(), { id: a2, groupId: g2, name: "A2b", kind: "swap", priceArs: 5, active: false });
    expect(await order(g2)).toEqual(["B1", "A2b"]);
    const missing = await saveModifier(db(), { id: 999, groupId: g1, name: "Z", kind: "add", priceArs: 0, active: true });
    expect(missing.ok).toBe(false);
  });
});

describe("moveModifier", () => {
  it("swaps within the group and ignores edges", async () => {
    const g = await group("A");
    const a = await mod(g, "a");
    await mod(g, "b");
    const c = await mod(g, "c");
    await moveModifier(db(), c, "up");
    expect(await order(g)).toEqual(["a", "c", "b"]);
    await moveModifier(db(), a, "up");
    expect(await order(g)).toEqual(["a", "c", "b"]);
    await moveModifier(db(), a, "down");
    expect(await order(g)).toEqual(["c", "a", "b"]);
  });
  it("renormalizes gaps and duplicates without touching other groups", async () => {
    const g = await group("A");
    const other = await group("B");
    const a = await mod(g, "a");
    const b = await mod(g, "b");
    const c = await mod(g, "c");
    const o = await mod(other, "o");
    await db().update(s.modifiers).set({ sort: 7 }).where(eq(s.modifiers.id, a));
    await db().update(s.modifiers).set({ sort: 7 }).where(eq(s.modifiers.id, b));
    await db().update(s.modifiers).set({ sort: 20 }).where(eq(s.modifiers.id, c));
    await db().update(s.modifiers).set({ sort: 42 }).where(eq(s.modifiers.id, o));
    await moveModifier(db(), b, "up");
    expect(await order(g)).toEqual(["b", "a", "c"]);
    expect(new Set(await sorts(g))).toEqual(new Set([0, 1, 2]));
    expect((await getModifierForAdmin(db(), o))?.sort).toBe(42);
  });
  it("reports unknown ids", async () => {
    expect((await moveModifier(db(), 999, "up")).ok).toBe(false);
    expect((await moveModifier(db(), 1.5, "up")).ok).toBe(false);
  });
});

describe("setModifierActive", () => {
  it("toggles and reports a missing modifier", async () => {
    const g = await group("A");
    const m = await mod(g, "a");
    expect((await setModifierActive(db(), m, false)).ok).toBe(true);
    expect((await getModifierForAdmin(db(), m))?.active).toBe(false);
    await setModifierActive(db(), m, true);
    expect((await getModifierForAdmin(db(), m))?.active).toBe(true);
    expect((await setModifierActive(db(), 999, true)).ok).toBe(false);
  });
});

describe("setProductModifierGroups", () => {
  it("replaces, is idempotent, dedupes input and can clear", async () => {
    const p = await product();
    const [a, b, c] = [await group("A"), await group("B"), await group("C")];
    expect((await setProductModifierGroups(db(), p, [a, b, a])).ok).toBe(true);
    expect(await listProductGroupIds(db(), p)).toEqual([a, b]);
    await setProductModifierGroups(db(), p, [a, b]);
    expect(await listProductGroupIds(db(), p)).toEqual([a, b]);
    await setProductModifierGroups(db(), p, [c, a]);
    expect(await listProductGroupIds(db(), p)).toEqual([a, c]);
    await setProductModifierGroups(db(), p, []);
    expect(await listProductGroupIds(db(), p)).toEqual([]);
  });
  it("does not touch other products", async () => {
    const p1 = await product("P1");
    const p2 = await product("P2");
    const a = await group("A");
    await setProductModifierGroups(db(), p1, [a]);
    await setProductModifierGroups(db(), p2, [a]);
    await setProductModifierGroups(db(), p1, []);
    expect(await listProductGroupIds(db(), p2)).toEqual([a]);
  });
  it("rejects an unknown group without partial changes", async () => {
    const p = await product();
    const [a, b] = [await group("A"), await group("B")];
    await setProductModifierGroups(db(), p, [a]);
    const r = await setProductModifierGroups(db(), p, [b, 9999]);
    expect(r.ok).toBe(false);
    expect(await listProductGroupIds(db(), p)).toEqual([a]);
  });
  it("rejects an unknown product and invalid ids", async () => {
    const a = await group("A");
    expect((await setProductModifierGroups(db(), 999, [a])).ok).toBe(false);
    expect((await setProductModifierGroups(db(), 1, [-1])).ok).toBe(false);
    expect((await setProductModifierGroups(db(), 1.5, [])).ok).toBe(false);
    expect(await db().select().from(s.productModifierGroups)).toHaveLength(0);
  });
});

describe("listGroupsWithModifiers", () => {
  it("orders groups by id and modifiers by sort, including inactive", async () => {
    const g1 = await group("Z first");
    const g2 = await group("A second");
    const x = await mod(g1, "x");
    await mod(g1, "y", { active: false });
    await mod(g2, "z");
    await moveModifier(db(), x, "down");
    const list = await listGroupsWithModifiers(db());
    expect(list.map((g) => g.name)).toEqual(["Z first", "A second"]);
    expect(list[0].modifiers.map((m) => m.name)).toEqual(["y", "x"]);
    expect(list[0].modifiers[0].active).toBe(false);
    expect(list[1].modifiers).toHaveLength(1);
  });
});
