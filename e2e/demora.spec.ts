import { expect, test, type Page } from "@playwright/test";
import { isNull } from "drizzle-orm";
import * as s from "../src/db/schema";
import { db } from "./helpers/db";
import { authFile } from "./helpers/users";

// Manual delay: the cajera announces +10 min with an internal reason, the header chip shows it, then clears it.
test.use({ storageState: authFile("cajera") });

async function clearDelays() {
  await db().update(s.delayNotices).set({ endedAt: new Date() }).where(isNull(s.delayNotices.endedAt));
}
test.beforeEach(clearDelays);
test.afterAll(clearDelays);

async function roundTrip(page: Page) {
  await page.goto("/mostrador");
  const chip = page.getByTestId("delay-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("Sin demora");
  const box = await chip.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(43.5);

  await chip.click();
  const dialog = page.getByTestId("delay-dialog");
  await expect(dialog.getByTestId("delay-auto")).toContainText("Estimación automática");
  await expect(page.getByTestId("delay-activate")).toBeDisabled();
  await dialog.getByRole("button", { name: "+10", exact: true }).click();
  await dialog.getByLabel(/Motivo/).fill("Se pinchó el delivery");
  await page.getByTestId("delay-activate").click();
  await expect(dialog).toHaveCount(0);
  await expect(chip).toContainText("+10 min");

  await chip.click();
  await expect(page.getByTestId("delay-active")).toContainText("Se pinchó el delivery");
  await expect(page.getByTestId("delay-active")).toContainText("Cajera E2E");
  await page.getByTestId("delay-deactivate").click();
  await expect(dialog).toHaveCount(0);
  await expect(chip).toContainText("Sin demora");
}

test("cajera activates and clears a manual delay", async ({ page }) => {
  await roundTrip(page);
});

test("@mobile cajera activates and clears a manual delay on a phone", async ({ page }) => {
  await roundTrip(page);
  await page.getByTestId("delay-chip").click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
