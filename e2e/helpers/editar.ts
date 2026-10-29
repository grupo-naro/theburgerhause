import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { expect, type Locator, type Page } from "@playwright/test";
import * as s from "../../src/db/schema";
import { confirmAddon, addOrderAddon } from "../../src/lib/orders/addons";
import { openRetiro } from "./caja";
import { db, findProduct, findUser } from "./db";

/** The product added in these specs: a plain, stock-free product (the seed has no stock-tracked items). */
export const ADDED = "Huevo simple";

export const editor = (page: Page): Locator => page.getByTestId("order-editor");

/** Taps the plain "Agregar <name>" tile inside the editor dialog. */
export async function addInEditor(page: Page, name = ADDED): Promise<void> {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await editor(page).getByRole("button", { name: new RegExp(`^Agregar ${escaped}, `) }).click();
}

/** /retiro has no tabs: orders in preparation are on the same screen (live). */
export async function openRetiroPreparing(page: Page): Promise<void> {
  await openRetiro(page);
  await expect(page.getByTestId("dispatch-board")).toBeVisible();
}

export const addonsOf = (orderId: number) =>
  db().select().from(s.orderAddons).where(eq(s.orderAddons.orderId, orderId)).orderBy(asc(s.orderAddons.seq));

export const addonItemCount = async (orderId: number): Promise<number> => {
  const rows = await db()
    .select({ id: s.orderItems.id, addonId: s.orderItems.addonId })
    .from(s.orderItems)
    .where(eq(s.orderItems.orderId, orderId));
  return rows.filter((r) => r.addonId !== null).length;
};

export const additionalJobsOf = (orderId: number) =>
  db()
    .select()
    .from(s.printJobs)
    .where(and(eq(s.printJobs.orderId, orderId), eq(s.printJobs.type, "additional")))
    .orderBy(asc(s.printJobs.id));

/** An add-on of one plain "Huevo simple" created through the core, the way the action would (staff session, no sector limit). */
export async function seedAddon(orderId: number): Promise<{ addonId: number; seq: number; status: string; subtotal: number }> {
  const [cajera, product] = await Promise.all([findUser("cajera"), findProduct(ADDED)]);
  const r = await addOrderAddon(db(), {
    orderId,
    userId: cajera.id,
    sector: null,
    units: [{ productId: product.id, modifierIds: [], note: "" }],
    idempotencyKey: randomUUID(),
  });
  if (!r.ok) throw new Error(`could not seed the add-on: ${r.code}`);
  return r.data;
}

export async function confirmAddonInDb(addonId: number): Promise<void> {
  const cajera = await findUser("cajera");
  const r = await confirmAddon(db(), { addonId, userId: cajera.id, sector: null, paymentVerified: true });
  if (!r.ok) throw new Error(`could not confirm the add-on: ${r.code}`);
}
