import { and, eq, inArray, like } from "drizzle-orm";
import { expect, type Locator, type Page } from "@playwright/test";
import * as s from "../../src/db/schema";
import { markDelivered } from "../../src/lib/orders/dispatch";
import type { CajaOrderFixture } from "./caja";
import { db, findUser } from "./db";
import { assignInDb, ensureCadet, placeReady, tag } from "./despacho";

export { ensureCadet, tag };

/** A delivery order, approved, ready, assigned to the cadet and DELIVERED (cash stays pending: the cadet owes it). */
export async function deliveredFor(
  cadetId: number,
  o: { paymentMethod?: "cash" | "transfer"; delivered?: boolean } = {},
): Promise<CajaOrderFixture> {
  const fx = await placeReady({ fulfillment: "delivery", paymentMethod: o.paymentMethod ?? "cash" });
  await assignInDb([fx.id], cadetId);
  if (o.delivered !== false) {
    const encargada = await findUser("encargada");
    const r = await markDelivered(db(), { sector: null, orderId: fx.id, userId: encargada.id });
    if (!r.ok) throw new Error(`markDelivered failed: ${r.message}`);
    // markDelivered settles cash by itself: reopen the debt (the state of orders delivered before that existed).
    if ((o.paymentMethod ?? "cash") === "cash") {
      for (const l of await db().select({ id: s.settlementOrders.settlementId }).from(s.settlementOrders).where(eq(s.settlementOrders.orderId, fx.id))) {
        await db().delete(s.settlements).where(eq(s.settlements.id, l.id));
      }
      await db().delete(s.orderEvents).where(and(eq(s.orderEvents.orderId, fx.id), like(s.orderEvents.note, "Rendición #%")));
      await db().update(s.orders).set({ paymentStatus: "pending" }).where(eq(s.orders.id, fx.id));
    }
  }
  return fx;
}

/** Leaves no debt behind: the cadet's orders are paid and the cadet is inactive. */
export async function retireCadets(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db().update(s.orders).set({ paymentStatus: "paid" }).where(inArray(s.orders.cadetId, ids));
  await db().update(s.cadets).set({ active: false }).where(inArray(s.cadets.id, ids));
}

export const settlementsOf = (cadetId: number) => db().select().from(s.settlements).where(eq(s.settlements.cadetId, cadetId));
export const settlementLines = (settlementId: number) =>
  db().select().from(s.settlementOrders).where(eq(s.settlementOrders.settlementId, settlementId));

export const cadetCard = (page: Page, cadetId: number): Locator =>
  page.locator(`[data-testid="cadet-balance"][data-cadet-id="${cadetId}"]`);

/** Opens a cadet's detail and waits for the live connection (events created afterwards are not missed). */
export async function openDetail(page: Page, cadetId: number): Promise<void> {
  await page.goto(`/delivery/rendicion?cadet=${cadetId}`);
  await expect(page.getByTestId("cadet-detail")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
}

export async function openList(page: Page): Promise<void> {
  await page.goto("/delivery/rendicion");
  await expect(page.getByTestId("rendicion-list")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "En vivo" })).toBeVisible();
}

/** Parses "$ 12.345" / "$ 12.345,50" (nbsp tolerant) back to centavos. */
export function centsOf(text: string): number {
  const m = /\$\s*([\d.]+)(?:,(\d{2}))?/.exec(text.replace(/\s/g, " "));
  if (!m) throw new Error(`no amount in "${text}"`);
  return Number(m[1].replaceAll(".", "")) * 100 + Number(m[2] ?? 0);
}
