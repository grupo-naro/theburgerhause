import { expect, type Locator, type Page } from "@playwright/test";
import { CART_KEY } from "./store";

export const CUSTOMER_KEY = "bh_customer_v1";
export const CHECKOUT_KEY = "bh_checkout_key_v1";

export const submitButton = (page: Page): Locator => page.getByTestId("checkout-submit");

/** Opens /checkout and waits for the form (it mounts after hydration and once the stored cart is loaded). */
export async function gotoCheckout(page: Page): Promise<void> {
  await page.goto("/checkout");
  await expect(submitButton(page)).toBeVisible();
}

export async function chooseFulfillment(page: Page, which: "delivery" | "takeaway"): Promise<void> {
  // The native radio is visually hidden: the label is the control people tap.
  await page.locator(`label[for="checkout-fulfillment-${which}"]`).click();
  await expect(page.locator(`#checkout-fulfillment-${which}`)).toBeChecked();
}

export async function choosePayment(page: Page, which: "cash" | "transfer"): Promise<void> {
  await page.getByTestId(`payment-${which}`).click();
  await expect(page.getByTestId(`payment-${which}`)).toBeVisible();
  await expect(page.locator(`input[name="paymentMethod"][value="${which}"]`)).toBeChecked();
}

export async function fillCustomer(page: Page, name: string, whatsapp = uniquePhone()): Promise<void> {
  await page.getByLabel("Nombre y apellido").fill(name);
  await page.getByLabel("WhatsApp").fill(whatsapp);
}

export async function fillDelivery(
  page: Page,
  d: { address?: string; crossStreets?: string; notes?: string } = {},
): Promise<void> {
  await page.getByLabel("Dirección").fill(d.address ?? "Calle Falsa 123, piso 2");
  await page.getByLabel("Entre calles").fill(d.crossStreets ?? "Rivadavia y Mitre");
  if (d.notes !== undefined) await page.getByLabel("Aclaraciones del lugar (opcional)").fill(d.notes);
}

/** A complete, valid delivery order form paid in cash. */
export async function fillValidDelivery(page: Page, name: string): Promise<void> {
  await fillDelivery(page);
  await fillCustomer(page, name);
  await choosePayment(page, "cash");
}

export async function storedCart(page: Page): Promise<{ lines: unknown[] } | null> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), CART_KEY);
  return raw ? (JSON.parse(raw) as { lines: unknown[] }) : null;
}

export const unique = (label: string): string => `E2E ${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

export const noHorizontalOverflow = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** A fresh WhatsApp per test: the server allows only 3 created orders per number per 10 minutes. */
export const uniquePhone = (): string => `11 ${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`;

/** The idempotency key of this checkout session (sessionStorage holds `{ k: key, s: cart signature }`). */
export async function storedKey(page: Page): Promise<string | null> {
  const raw = await page.evaluate((k) => sessionStorage.getItem(k), CHECKOUT_KEY);
  return raw ? (JSON.parse(raw) as { k: string }).k : null;
}
