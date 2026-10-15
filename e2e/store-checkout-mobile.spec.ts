import { expect, test, type Locator, type Page } from "@playwright/test";
import { findProduct, modifierIdByName, setAcceptingOrders, setProductActiveInDb } from "./helpers/db";
import {
  chooseFulfillment,
  choosePayment,
  fillCustomer,
  fillDelivery,
  fillValidDelivery,
  gotoCheckout,
  noHorizontalOverflow,
  submitButton,
  unique,
} from "./helpers/checkout";
import { shot, shotViewport } from "./helpers/shots";
import { seedCart } from "./helpers/store";

// Public storefront: no session.
test.use({ storageState: { cookies: [], origins: [] } });

/** Every match must be at least 44px tall. */
async function expectTall(locator: Locator, label: string) {
  const count = await locator.count();
  expect(count, `${label}: matches`).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await locator.nth(i).boundingBox();
    expect(box, `${label} ${i} has a box`).not.toBeNull();
    expect(box!.height, `${label} ${i} height`).toBeGreaterThanOrEqual(44);
  }
}

async function openCheckout(page: Page, width = 360): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 740 });
  const [ranchita, melt] = await Promise.all([findProduct("Ranchita simple"), findProduct("Melt simple")]);
  const dips = await modifierIdByName("+ Dips de cheddar");
  await seedCart(
    page,
    [{ productId: ranchita.id, modifierIds: [dips] }, { productId: ranchita.id }, { productId: melt.id }],
  );
  await gotoCheckout(page);
}

test("checkout fits a 360px phone: no overflow, collapsible summary, reachable CTA, big targets @mobile", async ({ page }) => {
  await openCheckout(page);
  expect(await noHorizontalOverflow(page)).toBe(true);
  await shot(page, "checkout-delivery-mobile");

  // Tap targets.
  await expectTall(page.locator("#checkout-delivery-address, #checkout-delivery-crossStreets, #checkout-customer-name, #checkout-customer-whatsapp"), "field");
  await expectTall(page.locator('label[for^="checkout-fulfillment-"]'), "segment");
  await expectTall(page.getByTestId("payment-cash").or(page.getByTestId("payment-transfer")), "payment card");
  await expectTall(page.getByTestId("summary-toggle"), "summary toggle");
  await expectTall(submitButton(page), "submit");

  // The summary lines are collapsed on phones but totals are always visible.
  const lines = page.getByTestId("summary-lines");
  const toggle = page.getByTestId("summary-toggle");
  await expect(lines).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("checkout-total")).toBeVisible();
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await expect(lines).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("summary-line")).toHaveCount(3);
  expect(await noHorizontalOverflow(page)).toBe(true);
  await shotViewport(page, "checkout-summary-expanded-mobile");
  await toggle.click();
  await expect(lines).toBeHidden();

  // Transfer with the bank data.
  await choosePayment(page, "transfer");
  await expect(page.getByTestId("bank-alias")).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.getByTestId("transfer-details").scrollIntoViewIfNeeded();
  await shotViewport(page, "checkout-transfer-mobile");

  // The CTA can be reached and used.
  await submitButton(page).scrollIntoViewIfNeeded();
  await expect(submitButton(page)).toBeInViewport();
  await shotViewport(page, "checkout-cta-mobile");

  // Validation errors (nothing filled).
  await submitButton(page).click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expect(page.getByLabel("Dirección")).toBeFocused();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await shot(page, "checkout-errors-mobile");

  // Takeaway.
  await chooseFulfillment(page, "takeaway");
  await expect(page.getByTestId("takeaway-info")).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await shot(page, "checkout-takeaway-mobile");
});

test("checkout is usable at 320px with errors showing @mobile", async ({ page }) => {
  await openCheckout(page, 320);
  await submitButton(page).click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await choosePayment(page, "transfer");
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("closed store and a stale cart on a phone @mobile", async ({ page }) => {
  const name = unique("MobileStale");
  await openCheckout(page);
  try {
    await setAcceptingOrders(false);
    await page.goto("/checkout");
    await expect(page.getByTestId("checkout-closed")).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();
    expect(await noHorizontalOverflow(page)).toBe(true);
    await shot(page, "checkout-closed-mobile");
  } finally {
    await setAcceptingOrders(true);
  }

  // Product disappears from the DB while the (cached) page is open.
  const aro = await findProduct("Aro simple");
  await seedCart(page, [{ productId: aro.id }, { productId: (await findProduct("Melt simple")).id }]);
  await gotoCheckout(page);
  await expect(submitButton(page)).toBeVisible();
  await fillDelivery(page);
  await fillCustomer(page, name);
  await choosePayment(page, "cash");
  try {
    await setProductActiveInDb("Aro simple", false);
    await submitButton(page).click();
    await expect(page.getByTestId("units-invalid-banner")).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
    await shotViewport(page, "checkout-units-invalid-mobile");
  } finally {
    await setProductActiveInDb("Aro simple", true);
  }
});

test("a complete order from a phone @mobile", async ({ page }) => {
  const name = unique("MobileOrder");
  await openCheckout(page, 412);
  await fillValidDelivery(page, name);
  await submitButton(page).scrollIntoViewIfNeeded();
  await submitButton(page).click();
  await expect(page).toHaveURL(/\/pedido\/[0-9a-f]{32}$/);
});
