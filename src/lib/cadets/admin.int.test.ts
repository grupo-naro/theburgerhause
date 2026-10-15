import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { getCadetForAdmin, listCadets, saveCadet, setCadetActive } from "./admin";

const db = () => testDb();

async function cadet(name: string, extra: Record<string, unknown> = {}) {
  const r = await saveCadet(db(), { name, phone: "", active: true, ...extra });
  if (!r.ok) throw new Error(`cadet failed: ${JSON.stringify(r)}`);
  return r.data.id;
}

let n = 0;
async function orderFor(cadetId: number, status: (typeof s.orderStatus.enumValues)[number]) {
  n += 1;
  await db()
    .insert(s.orders)
    .values({
      businessDate: "2026-10-15",
      number: n,
      publicToken: `tok-${n}`,
      channel: "web",
      fulfillment: "delivery",
      status,
      paymentMethod: "cash",
      customerName: "Cliente",
      subtotal: 100,
      total: 100,
      cadetId,
    });
}

beforeEach(async () => {
  await resetDb();
  n = 0;
});
afterAll(closeDb);

describe("saveCadet", () => {
  it("creates and edits a cadet, normalizing the phone", async () => {
    const id = await cadet("Juan", { phone: " +54  11 5555-1234 " });
    expect(await getCadetForAdmin(db(), id)).toEqual({ id, name: "Juan", phone: "+54 11 5555-1234", active: true });
    expect(await saveCadet(db(), { id, name: "Juan P", phone: "", active: true })).toEqual({ ok: true, data: { id } });
    expect(await getCadetForAdmin(db(), id)).toMatchObject({ name: "Juan P", phone: null });
  });
  it("allows two cadets with the same name", async () => {
    await cadet("Pedro");
    await cadet("Pedro");
    expect(await db().select().from(s.cadets)).toHaveLength(2);
  });
  it("reports validation field errors and a missing cadet", async () => {
    expect(await saveCadet(db(), { name: " ", phone: "abc", active: true })).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.any(String) },
    });
    expect(await saveCadet(db(), { name: "x", phone: "abc", active: true })).toMatchObject({
      ok: false,
      fieldErrors: { phone: expect.any(String) },
    });
    expect((await saveCadet(db(), { id: 99, name: "X", phone: "", active: true })).ok).toBe(false);
  });
});

describe("setCadetActive", () => {
  it("toggles the flag and never deletes", async () => {
    const id = await cadet("Ana");
    expect((await setCadetActive(db(), id, false)).ok).toBe(true);
    expect((await getCadetForAdmin(db(), id))?.active).toBe(false);
    expect((await setCadetActive(db(), id, true)).ok).toBe(true);
    expect((await getCadetForAdmin(db(), id))?.active).toBe(true);
    expect((await setCadetActive(db(), 999, true)).ok).toBe(false);
    expect((await setCadetActive(db(), 1.5, true)).ok).toBe(false);
  });
  it("is blocked while the cadet has orders en_camino (also through saveCadet)", async () => {
    const id = await cadet("Ana");
    await orderFor(id, "en_camino");
    expect(await setCadetActive(db(), id, false)).toEqual({ ok: false, error: "El cadete tiene pedidos en camino" });
    expect(await saveCadet(db(), { id, name: "Ana", phone: "", active: false })).toEqual({
      ok: false,
      error: "El cadete tiene pedidos en camino",
    });
    expect((await getCadetForAdmin(db(), id))?.active).toBe(true);
    // editing other fields while staying active is fine
    expect((await saveCadet(db(), { id, name: "Ana B", phone: "", active: true })).ok).toBe(true);
  });
  it("is allowed when the other orders are already delivered", async () => {
    const id = await cadet("Ana");
    await orderFor(id, "entregado");
    expect((await setCadetActive(db(), id, false)).ok).toBe(true);
  });
});

describe("listCadets", () => {
  it("counts only en_camino orders per cadet and orders by name", async () => {
    const a = await cadet("Beto");
    const b = await cadet("Ana");
    await orderFor(a, "en_camino");
    await orderFor(a, "en_camino");
    await orderFor(a, "entregado");
    await orderFor(b, "listo_despacho");
    const rows = await listCadets(db());
    expect(rows.map((r) => [r.name, r.enCamino])).toEqual([
      ["Ana", 0],
      ["Beto", 2],
    ]);
    await db().update(s.cadets).set({ active: false }).where(eq(s.cadets.id, b));
    expect((await listCadets(db())).find((r) => r.id === b)?.active).toBe(false);
  });
});
