import type { Page } from "@playwright/test";

/** Full-page screenshot into test-results/shots/<name>.png (viewed by humans/agents). */
export async function shot(page: Page, name: string): Promise<string> {
  const path = `test-results/shots/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}
