import { expect, test, type Locator, type Page } from "@playwright/test";
import { openDelivery } from "./helpers/caja";
import { noHorizontalOverflow } from "./helpers/checkout";
import { cleanBoard, dcard, openPedidos, placeApproved, placeReady, runCleanups } from "./helpers/despacho";
import { authFile } from "./helpers/users";

// Tanda: the free number the delivery manager writes on approved delivery orders. Cards show the number and the real address.
test.beforeEach(cleanBoard);
test.afterEach(runCleanups);
test.afterAll(cleanBoard);

const field = (page: Page, number: number): Locator => dcard(page, number).getByTestId("tanda-input");

async function setTanda(page: Page, number: number, value: string) {
  const input = field(page, number);
  await input.fill(value);
  await input.press("Enter");
}

async function expectTarget(locator: Locator, what: string) {
  const box = await locator.first().boundingBox();
  expect(box, what).not.toBeNull();
  expect(box!.height, `${what} height`).toBeGreaterThanOrEqual(43.5);
  expect(box!.width, `${what} width`).toBeGreaterThanOrEqual(43.5);
}

test.describe("encargada", () => {
  test.use({ storageState: authFile("encargada") });

  test("write, summarize, warn over 3, clear, reject invalid, live in another tab, no zone labels", async ({ page, context }) => {
    const orders = [];
    for (let i = 0; i < 5; i++) orders.push(await placeApproved({ paymentMethod: "cash" }));
    const [a, b, c, d, e] = orders;
    await openDelivery(page, "preparing");
    const other = await context.newPage();
    await openDelivery(other, "preparing");

    for (const o of orders) {
      await expect(dcard(page, o.number).getByTestId("tanda-none")).toHaveText("Sin tanda");
      await expect(field(page, o.number)).toHaveValue("");
    }
    await expect(page.getByTestId("tanda-summary")).toHaveCount(0);

    await setTanda(page, a.number, "1");
    await setTanda(page, b.number, "1");
    await setTanda(page, c.number, "2");
    await expect(field(page, a.number)).toHaveValue("1");
    await expect(dcard(page, a.number).getByTestId("tanda-none")).toHaveCount(0);
    await expect(dcard(page, d.number).getByTestId("tanda-none")).toHaveText("Sin tanda");
    const chips = page.getByTestId("tanda-chip");
    await expect(chips).toHaveText(["Tanda 1: 2 de 3", "Tanda 2: 1 de 3"]);
    await expect(page.getByTestId("tanda-warning")).toHaveCount(0);

    // A second tab sees the change live, without reloading.
    await expect(field(other, a.number)).toHaveValue("1");
    await expect(other.getByTestId("tanda-chip").first()).toHaveText("Tanda 1: 2 de 3");

    // No zone label on the card: only the number and the real address.
    const text = (await dcard(page, a.number).innerText()).toLowerCase();
    for (const zone of ["merlo", "barrio", "zona"]) expect(text).not.toContain(zone);
    await expect(dcard(page, a.number)).toContainText("Av. Rivadavia 1234");

    // A fourth order in tanda 1 warns but still saves.
    await setTanda(page, d.number, "1");
    await setTanda(page, e.number, "1");
    await expect(field(page, e.number)).toHaveValue("1");
    await expect(page.getByTestId("tanda-warning")).toHaveText("Tanda 1 tiene 4 pedidos: el máximo recomendado es 3");
    await expect(chips.first()).toHaveText("Tanda 1: 4 de 3");
    await page.reload();
    await expect(field(page, e.number)).toHaveValue("1");

    // Clearing goes back to "Sin tanda".
    await setTanda(page, e.number, "");
    await expect(dcard(page, e.number).getByTestId("tanda-none")).toHaveText("Sin tanda");
    await expect(page.getByTestId("tanda-warning")).toHaveCount(0);

    // Invalid values show the error inside the card and do not save.
    for (const bad of ["0", "abc"]) {
      await setTanda(page, e.number, bad);
      await expect(dcard(page, e.number).getByTestId("tanda-error")).toContainText("del 1 al 99");
    }
    await page.reload();
    await expect(field(page, e.number)).toHaveValue("");
    await expect(dcard(page, e.number).getByTestId("tanda-error")).toHaveCount(0);
  });

  test("the ready lane groups delivery orders by tanda and selection still works", async ({ page }) => {
    const a = await placeReady({ paymentMethod: "cash" });
    const b = await placeReady({ paymentMethod: "cash" });
    const c = await placeReady({ paymentMethod: "cash" });
    const d = await placeReady({ paymentMethod: "cash" });
    await openDelivery(page, "ready");
    await setTanda(page, c.number, "2");
    await setTanda(page, a.number, "1");
    await setTanda(page, b.number, "1");
    const groups = page.getByTestId("tanda-group");
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(0).getByTestId("tanda-group-title")).toHaveText("Tanda 1 · 2 de 2 listos");
    await expect(groups.nth(1).getByTestId("tanda-group-title")).toHaveText("Tanda 2 · 1 de 1 listos");
    await expect(groups.nth(2).getByTestId("tanda-group-title")).toHaveText("Sin tanda");
    await expect(groups.nth(0).locator('[data-testid="dispatch-card"]')).toHaveCount(2);
    await expect(groups.nth(2).locator(`[data-testid="dispatch-card"][data-order-number="${d.number}"]`)).toHaveCount(1);
    await dcard(page, a.number).getByTestId("select-order").check();
    await dcard(page, d.number).getByTestId("select-order").check();
    await expect(page.getByTestId("assign-summary")).toContainText("2 pedidos");
    // Typing in the field does not toggle the selection.
    await field(page, a.number).click();
    await expect(dcard(page, a.number).getByTestId("select-order")).toBeChecked();
  });

  test("@mobile phone: no overflow at 390 and 360, targets of 44 px, error inside the card", async ({ page }) => {
    const a = await placeApproved({ paymentMethod: "cash" });
    const b = await placeReady({ paymentMethod: "cash" });
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await openDelivery(page, "preparing");
      await setTanda(page, a.number, "abc");
      await expect(dcard(page, a.number).getByTestId("tanda-error")).toBeVisible();
      expect(await noHorizontalOverflow(page), `overflow preparing ${width}`).toBe(true);
      await expectTarget(field(page, a.number), "campo tanda");
      await setTanda(page, a.number, "3");
      await expect(page.getByTestId("tanda-chip")).toHaveText(["Tanda 3: 1 de 3"]);
      expect(await noHorizontalOverflow(page), `overflow preparing chips ${width}`).toBe(true);

      await openDelivery(page, "ready");
      await expectTarget(field(page, b.number), "campo tanda listos");
      await setTanda(page, b.number, "3");
      await expect(page.getByTestId("tanda-group-title").first()).toHaveText("Tanda 3 · 1 de 2 listos");
      expect(await noHorizontalOverflow(page), `overflow ready ${width}`).toBe(true);
      await setTanda(page, b.number, "");
      await openDelivery(page, "preparing");
      await setTanda(page, a.number, "");
      await expect(dcard(page, a.number).getByTestId("tanda-none")).toBeVisible();
    }
  });
});

test.describe("cajera", () => {
  test.use({ storageState: authFile("cajera") });

  test("has no tanda field on her screen", async ({ page }) => {
    const prep = await placeApproved({ paymentMethod: "cash" });
    await placeReady({ paymentMethod: "cash" });
    await openPedidos(page);
    await expect(dcard(page, prep.number)).toHaveCount(0);
    await expect(page.getByTestId("tanda-input")).toHaveCount(0);
    await expect(page.getByTestId("tanda-field")).toHaveCount(0);
  });
});
