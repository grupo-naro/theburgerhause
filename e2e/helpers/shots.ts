import type { Page } from "@playwright/test";

/** Full-page screenshot into test-results/shots/<name>.png (viewed by humans/agents). */
export async function shot(page: Page, name: string): Promise<string> {
  const path = `test-results/shots/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}

/** Only what is on screen (fixed bars, sheets and toasts stay where the user sees them). */
export async function shotViewport(page: Page, name: string): Promise<string> {
  const path = `test-results/shots/${name}.png`;
  await page.screenshot({ path });
  return path;
}
