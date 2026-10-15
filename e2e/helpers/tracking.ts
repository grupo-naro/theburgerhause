import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { createOrder } from "../../src/lib/orders/create-order";
import { db, findProduct, modifierIdByName } from "./db";
import { unique, uniquePhone } from "./checkout";

export type PlacedOrder = {
  token: string;
  number: number;
  total: number;
  name: string;
  surname: string;
  whatsappDigits: string;
  idempotencyKey: string;
  crossStreets: string;
  notes: string;
};

/**
 * Creates an order through the real `createOrder` (same pricing, snapshots and token as checkout)
 * without driving the UI. Two Ranchita with different mods and a Melt by default. The customer
 * has a unique surname, a unique whatsapp and private address details so privacy checks have
 * something to look for.
 */
export async function placeOrderInDb(
  o: { fulfillment?: "delivery" | "takeaway"; paymentMethod?: "cash" | "transfer"; units?: "default" | "single" } = {},
): Promise<PlacedOrder> {
  const fulfillment = o.fulfillment ?? "delivery";
  const ranchita = await findProduct("Ranchita simple");
  const melt = await findProduct("Melt simple");
  const surname = `Zubiría${Math.floor(Math.random() * 1e6)}`;
  const name = `Lucía ${surname}`;
  const phone = uniquePhone();
  const idempotencyKey = randomUUID();
  const crossStreets = `Entre ${unique("Calle")} y Mitre`;
  const notes = `Timbre ${unique("roto")}`;
  const units =
    o.units === "single"
      ? [{ productId: ranchita.id, modifierIds: [] as number[], note: "" }]
      : [
          { productId: ranchita.id, modifierIds: [await modifierIdByName("Sin cheddar")], note: "" },
          { productId: ranchita.id, modifierIds: [await modifierIdByName("+ Dips de cheddar")], note: "" },
          { productId: melt.id, modifierIds: [] as number[], note: "" },
        ];
  const result = await createOrder(db(), {
    idempotencyKey,
    units,
    customer: { name, whatsapp: phone },
    fulfillment,
    delivery: fulfillment === "delivery" ? { address: "Av. Rivadavia 1234, 3B", crossStreets, notes } : undefined,
    paymentMethod: o.paymentMethod ?? "cash",
    bh_ref: "",
  });
  if (!result.ok) throw new Error(`could not place the test order: ${result.code}`);
  return {
    token: result.data.publicToken,
    number: result.data.number,
    total: result.data.total,
    name,
    surname,
    whatsappDigits: phone.replace(/\D/g, ""),
    idempotencyKey,
    crossStreets,
    notes,
  };
}

export const headline = (page: Page) => page.getByTestId("status-headline");
export const currentStep = (page: Page) => page.locator('[data-testid="timeline-step"][data-state="current"]');
export const steps = (page: Page) => page.getByTestId("timeline-step");

/**
 * Opens a tracking URL and waits until the streamed page has settled. Right after `goto` resolves the
 * Suspense boundary can still be in its hidden streaming container (`id="S:n"`), where every test id
 * exists twice: strict-mode locators would trip on that.
 */
export async function openTracking(page: Page, path: string) {
  const response = await page.goto(path);
  await expect(page.locator('[id^="S:"]')).toHaveCount(0);
  return response;
}
