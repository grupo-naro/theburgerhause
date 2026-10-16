import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { closeDb, type Db } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { cadetBalance, type BalanceOrder } from "@/domain/cadet-balance";
import { getEnv } from "@/lib/env";
import { makeCadet } from "@/test-support/dispatch";
import { seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { deliveredOrder, enRouteOrder, sumTotals } from "@/test-support/settlements";
import { getCadetSettlementDetail, listCadetBalances, listSettlements } from "./queries";
import { settleCadet } from "./settle-cadet";

const db = () => testDb();
let fx: Fx;

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

const settle = async (cadetId: number, ids: number[], note?: string, userId = fx.userId) => {
  const r = await settleCadet(db(), { cadetId, expectedAmount: await sumTotals(ids), userId, ...(note ? { note } : {}) });
  if (!r.ok) throw new Error(`settle failed: ${r.code} ${r.message}`);
  return r.data;
};

describe("listCadetBalances", () => {
  it("lists active cadets and inactive ones with debt, ordered by owed desc then name", async () => {
    const zoe = await makeCadet("Zoe");
    const ana = await makeCadet("Ana");
    const beto = await makeCadet("Beto");
    const idle = await makeCadet("Inactivo sin deuda", { active: false });
    const debtor = await makeCadet("Inactivo con deuda");
    const cleared = await makeCadet("Rendido");
    const zoeOrders = [await deliveredOrder(fx, zoe.id, { units: "two" }), await deliveredOrder(fx, zoe.id)];
    const anaOrder = await deliveredOrder(fx, ana.id, { units: "one" });
    const debtorOrder = await deliveredOrder(fx, debtor.id, { units: "melt" });
    await db().update(s.cadets).set({ active: false }).where(eq(s.cadets.id, debtor.id));
    const clearedOrder = await deliveredOrder(fx, cleared.id);
    await settle(cleared.id, [clearedOrder.id]);
    await enRouteOrder(fx, beto.id, { units: "two" });
    await enRouteOrder(fx, beto.id, { paymentMethod: "transfer" });
    await enRouteOrder(fx, ana.id, { units: "melt" });

    const list = await listCadetBalances(db());
    expect(list.map((c) => c.name)).toEqual(["Zoe", "Inactivo con deuda", "Ana", "Beto", "Rendido"]);
    expect(list.find((c) => c.cadetId === idle.id)).toBeUndefined();
    const by = (id: number) => list.find((c) => c.cadetId === id)!;
    const zoeOwed = await sumTotals(zoeOrders.map((o) => o.id));
    expect(by(zoe.id)).toMatchObject({ owed: zoeOwed, owedOrderCount: 2, inRouteCount: 0, inRouteCash: 0, lastSettlementAt: null, active: true, phone: "11 5555-0000" });
    expect(by(ana.id)).toMatchObject({ owed: await sumTotals([anaOrder.id]), owedOrderCount: 1, inRouteCount: 1 });
    expect(by(debtor.id)).toMatchObject({ active: false, owed: await sumTotals([debtorOrder.id]), owedOrderCount: 1 });
    expect(by(beto.id)).toMatchObject({ owed: 0, owedOrderCount: 0, inRouteCount: 2 });
    expect(by(cleared.id)).toMatchObject({ owed: 0, owedOrderCount: 0 });
    expect(typeof by(cleared.id).lastSettlementAt).toBe("string");
    expect(Number.isNaN(Date.parse(by(cleared.id).lastSettlementAt!))).toBe(false);
  });

  it("inRouteCash counts only en_camino cash orders still pending", async () => {
    const c = await makeCadet("Ruta");
    const cash = await enRouteOrder(fx, c.id, { units: "two" });
    await enRouteOrder(fx, c.id, { paymentMethod: "transfer" });
    const [row] = await listCadetBalances(db());
    expect(row).toMatchObject({ inRouteCount: 2, inRouteCash: await sumTotals([cash.id]), owed: 0 });
  });

  it("lastSettlementAt is the most recent settlement", async () => {
    const c = await makeCadet();
    const a = await deliveredOrder(fx, c.id);
    await settle(c.id, [a.id]);
    const b = await deliveredOrder(fx, c.id);
    const second = await settle(c.id, [b.id]);
    const [st] = await db().select().from(s.settlements).where(eq(s.settlements.id, second.settlementId));
    const [row] = await listCadetBalances(db());
    expect(row.lastSettlementAt).toBe(st.createdAt.toISOString());
  });

  it("is a single query however many cadets and orders", async () => {
    for (let i = 0; i < 4; i++) {
      const c = await makeCadet(`C${i}`);
      await deliveredOrder(fx, c.id);
      await enRouteOrder(fx, c.id);
    }
    await withCountedQueries(async (spy, statements) => {
      await listCadetBalances(spy);
      expect(statements.length).toBe(1);
    });
  });
});

describe("domain consistency: SQL balance equals cadetBalance on the same data", () => {
  it("mixed dataset across several cadets", async () => {
    const cadets = [await makeCadet("Uno"), await makeCadet("Dos"), await makeCadet("Tres"), await makeCadet("Cuatro")];
    const units = ["one", "two", "melt"] as const;
    let n = 0;
    for (const [ci, cadet] of cadets.entries()) {
      for (const paymentMethod of ["cash", "transfer"] as const) {
        for (const kind of ["delivered", "en_camino", "delivered-paid", "cancelled"] as const) {
          if ((ci + n) % 3 === 0) { n++; continue; } // vary which combinations exist per cadet
          const opts = { paymentMethod, units: units[n % 3] };
          n++;
          if (kind === "en_camino") await enRouteOrder(fx, cadet.id, opts);
          else {
            const o = await deliveredOrder(fx, cadet.id, opts);
            if (kind === "delivered-paid") await db().update(s.orders).set({ paymentStatus: "paid" }).where(eq(s.orders.id, o.id));
            if (kind === "cancelled") await db().update(s.orders).set({ status: "cancelado" }).where(eq(s.orders.id, o.id));
          }
        }
      }
    }
    // a settled cadet and an unassigned order
    const settled = await makeCadet("Cinco");
    await settle(settled.id, [(await deliveredOrder(fx, settled.id)).id]);
    await deliveredOrder(fx, settled.id, { units: "two" });

    const rows = (await db().select().from(s.orders)) as BalanceOrder[];
    const list = await listCadetBalances(db());
    const all = [...cadets, settled];
    expect(list.map((c) => c.cadetId).sort()).toEqual(all.map((c) => c.id).sort());
    let totalOwed = 0;
    for (const cadet of all) {
      const domain = cadetBalance(rows, cadet.id);
      const row = list.find((c) => c.cadetId === cadet.id)!;
      expect(row.owed, cadet.name).toBe(domain.owed);
      expect(row.owedOrderCount, cadet.name).toBe(domain.orderIds.length);
      expect(row.inRouteCount, cadet.name).toBe(domain.inRoute);
      const detail = await getCadetSettlementDetail(db(), cadet.id);
      expect(detail!.owed).toBe(domain.owed);
      expect(detail!.orders.map((o) => o.id).sort((a, b) => a - b)).toEqual([...domain.orderIds].sort((a, b) => a - b));
      expect(detail!.inRoute.length).toBe(domain.inRoute);
      totalOwed += domain.owed;
    }
    expect(totalOwed).toBeGreaterThan(0);
  });
});

describe("getCadetSettlementDetail", () => {
  it("returns the exact orders a settlement would include, in-route orders and recent settlements", async () => {
    const cadet = await makeCadet("Nahuel");
    const t0 = new Date("2026-10-14T20:00:00Z");
    const late = await deliveredOrder(fx, cadet.id, { units: "two", now: new Date("2026-10-14T21:30:00Z") });
    const early = await deliveredOrder(fx, cadet.id, { units: "one", now: t0 });
    await deliveredOrder(fx, cadet.id, { paymentMethod: "transfer" });
    const route = await enRouteOrder(fx, cadet.id, { units: "melt" });
    const routeTransfer = await enRouteOrder(fx, cadet.id, { paymentMethod: "transfer" });

    const d = await getCadetSettlementDetail(db(), cadet.id, { now: new Date("2026-10-14T23:00:00Z") });
    expect(d).not.toBeNull();
    if (!d) return;
    expect(d.cadet).toMatchObject({ id: cadet.id, name: "Nahuel", active: true });
    expect(d.owed).toBe(await sumTotals([early.id, late.id]));
    expect(d.orders.map((o) => o.id)).toEqual([early.id, late.id]);
    expect(d.orders[0]).toMatchObject({
      id: early.id,
      number: early.number,
      total: await sumTotals([early.id]),
      paymentMethod: "cash",
      address: "Av. Siempreviva 742",
      deliveredAt: t0.toISOString(),
    });
    expect(d.orders[0].items).toEqual([{ name: "Ranchita simple", quantity: 1 }]);
    expect(d.orders[1].items).toEqual([{ name: "Ranchita simple", quantity: 1 }, { name: "Melt simple", quantity: 1 }]);
    expect(d.inRoute.map((o) => o.id).sort()).toEqual([route.id, routeTransfer.id].sort());
    expect(d.inRoute.find((o) => o.id === route.id)).toMatchObject({ number: route.number, paymentMethod: "cash", paymentStatus: "pending", total: await sumTotals([route.id]) });
    expect(d.recentSettlements).toEqual([]);

    // what the detail shows is what settleCadet takes
    const settled = await settleCadet(db(), { cadetId: cadet.id, expectedAmount: d.owed, userId: fx.userId });
    expect(settled).toMatchObject({ ok: true, data: { orderCount: 2, amount: d.owed } });
    const after = await getCadetSettlementDetail(db(), cadet.id);
    expect(after!.orders).toEqual([]);
    expect(after!.owed).toBe(0);
    expect(after!.recentSettlements).toHaveLength(1);
    expect(after!.recentSettlements[0]).toMatchObject({ amount: d.owed, orderCount: 2, cadetName: "Nahuel", settledByName: "Cora" });
  });

  it("is null for an unknown cadet, works for an inactive one and keeps only the last 10 settlements", async () => {
    expect(await getCadetSettlementDetail(db(), 999)).toBeNull();
    const cadet = await makeCadet("Mucho");
    for (let i = 0; i < 12; i++) await settle(cadet.id, [(await deliveredOrder(fx, cadet.id)).id], `n${i}`);
    await db().update(s.cadets).set({ active: false }).where(eq(s.cadets.id, cadet.id));
    const d = await getCadetSettlementDetail(db(), cadet.id);
    expect(d!.cadet.active).toBe(false);
    expect(d!.recentSettlements).toHaveLength(10);
    expect(d!.recentSettlements[0].note).toBe("n11");
    expect(d!.recentSettlements[9].note).toBe("n2");
  });

  it("uses a constant number of queries", async () => {
    const cadet = await makeCadet();
    await settle(cadet.id, [(await deliveredOrder(fx, cadet.id)).id]);
    await deliveredOrder(fx, cadet.id);
    const count = async () => {
      let n = 0;
      await withCountedQueries(async (spy, statements) => {
        await getCadetSettlementDetail(spy, cadet.id);
        n = statements.length;
      });
      return n;
    };
    const few = await count();
    for (let i = 0; i < 5; i++) {
      await deliveredOrder(fx, cadet.id, { units: "two" });
      await enRouteOrder(fx, cadet.id);
    }
    expect(await count()).toBe(few);
    expect(few).toBeLessThanOrEqual(8);
  });
});

describe("listSettlements", () => {
  async function seedThree() {
    const a = await makeCadet("Ana");
    const b = await makeCadet("Beto");
    const s1 = await settle(a.id, [(await deliveredOrder(fx, a.id)).id, (await deliveredOrder(fx, a.id, { units: "two" })).id], "primera");
    const s2 = await settle(b.id, [(await deliveredOrder(fx, b.id)).id], undefined, fx.otherUserId);
    const s3 = await settle(a.id, [(await deliveredOrder(fx, a.id, { units: "melt" })).id]);
    return { a, b, s1, s2, s3 };
  }

  it("newest first with order lines, user name and note", async () => {
    const { a, s1, s2, s3 } = await seedThree();
    const list = await listSettlements(db());
    expect(list.map((x) => x.id)).toEqual([s3.settlementId, s2.settlementId, s1.settlementId]);
    expect(list[2]).toMatchObject({ cadetName: "Ana", amount: s1.amount, orderCount: 2, settledByName: "Cora", note: "primera" });
    expect(list[2].orders).toEqual(s1.orders.map((o) => ({ id: o.id, number: o.number, total: o.total })));
    expect(list[1]).toMatchObject({ cadetName: "Beto", settledByName: "Enca", note: null });
    expect(Number.isNaN(Date.parse(list[0].createdAt))).toBe(false);
    expect((await listSettlements(db(), { cadetId: a.id })).map((x) => x.id)).toEqual([s3.settlementId, s1.settlementId]);
  });

  it("settledByName is null when the user was deleted", async () => {
    const { s2 } = await seedThree();
    await db().update(s.settlements).set({ settledBy: null }).where(eq(s.settlements.id, s2.settlementId));
    expect((await listSettlements(db())).find((x) => x.id === s2.settlementId)!.settledByName).toBeNull();
  });

  it("keyset pagination by id with no gaps or repeats, and limit clamps", async () => {
    const cadet = await makeCadet();
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push((await settle(cadet.id, [(await deliveredOrder(fx, cadet.id)).id])).settlementId);
    const newestFirst = [...ids].reverse();
    const p1 = await listSettlements(db(), { limit: 2 });
    expect(p1.map((x) => x.id)).toEqual(newestFirst.slice(0, 2));
    const p2 = await listSettlements(db(), { limit: 2, before: p1.at(-1)!.id });
    expect(p2.map((x) => x.id)).toEqual(newestFirst.slice(2, 4));
    const p3 = await listSettlements(db(), { limit: 2, before: p2.at(-1)!.id });
    expect(p3.map((x) => x.id)).toEqual(newestFirst.slice(4));
    expect(await listSettlements(db(), { before: newestFirst.at(-1)! })).toEqual([]);
    expect(await listSettlements(db(), { before: 1_000_000 })).toHaveLength(5);

    expect(await listSettlements(db(), { limit: 0 })).toHaveLength(1);
    expect(await listSettlements(db(), { limit: -3 })).toHaveLength(1);
    expect(await listSettlements(db(), { limit: 1000 })).toHaveLength(5);
    expect(await listSettlements(db(), { limit: Number.NaN })).toHaveLength(5);
    expect(await listSettlements(db(), { limit: 2.7 })).toHaveLength(2);
  });

  it("is two queries however many settlements and lines (no N+1)", async () => {
    const { a } = await seedThree();
    await withCountedQueries(async (spy, statements) => {
      await listSettlements(spy, { limit: 50 });
      expect(statements.length).toBe(2);
      statements.length = 0;
      await listSettlements(spy, { cadetId: a.id });
      expect(statements.length).toBe(2);
    });
    await withCountedQueries(async (spy, statements) => {
      await listSettlements(spy, { cadetId: 99999 });
      expect(statements.length).toBeLessThanOrEqual(2);
    });
  });
});

async function withCountedQueries(fn: (spy: Db, statements: string[]) => Promise<void>) {
  const statements: string[] = [];
  const pool = new Pool({ connectionString: getEnv().DATABASE_URL });
  const spy = drizzle(pool, { logger: { logQuery: (q) => void statements.push(q) } }) as unknown as Db;
  try {
    await fn(spy, statements);
  } finally {
    await pool.end();
  }
}
