import type { Page } from "@playwright/test";

/**
 * Waits for a STABLE document before anything is measured or photographed: the load event has fired and the main
 * frame has not committed a navigation for `quietMs`. A page.evaluate that overlaps a navigation dies with
 * "Execution context was destroyed", so measurements go through this first (it waits for the state, it never retries
 * an assertion).
 */
export async function waitForStablePage(page: Page, quietMs = 200): Promise<void> {
  for (;;) {
    await page.waitForLoadState("load");
    let navigated = false;
    const onNav = (frame: { parentFrame(): unknown }) => {
      if (frame.parentFrame() === null) navigated = true;
    };
    page.on("framenavigated", onNav);
    try {
      await page.waitForTimeout(quietMs);
    } finally {
      page.off("framenavigated", onNav);
    }
    if (!navigated) return;
  }
}

/** Two animation frames: styles and transitions have been painted (screenshots show the final state). */
async function paintSettled(page: Page): Promise<void> {
  await waitForStablePage(page);
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Full-page screenshot into test-results/shots/<name>.png (viewed by humans/agents). */
export async function shot(page: Page, name: string): Promise<string> {
  await paintSettled(page);
  const path = `test-results/shots/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}

/** Only what is on screen (fixed bars, sheets and toasts stay where the user sees them). */
export async function shotViewport(page: Page, name: string): Promise<string> {
  await paintSettled(page);
  const path = `test-results/shots/${name}.png`;
  await page.screenshot({ path });
  return path;
}
