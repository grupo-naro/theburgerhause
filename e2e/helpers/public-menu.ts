import { expect, type Page } from "@playwright/test";

/**
 * The public menu is a prerendered, tag-cached page: right after an admin change the next request can
 * still be answered with the previous version while Next regenerates it. Customers see the new menu
 * on a following request, so tests assert the condition by reloading until it holds (never a fixed sleep).
 */
export async function reloadUntil(page: Page, check: () => Promise<void>, timeout = 15_000): Promise<void> {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout, intervals: [250, 500, 1000] });
}
