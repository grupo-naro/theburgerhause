import { expect, test, type Page } from "@playwright/test";
import { shot } from "./helpers/shots";
import { deliveredFor, ensureCadet, openDetail, openList, retireCadets, settlementsOf, tag } from "./helpers/rendicion";
import { authFile } from "./helpers/users";

const cadets: number[] = [];
test.afterAll(() => retireCadets(cadets));

const nav = (page: Page) => page.getByRole("navigation", { name: "Secciones" });

/** Counts the EventSource instances a page creates (installed before any script runs). */
async function countEventSources(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __es: number; EventSource: typeof EventSource };
    w.__es = 0;
    const Original = w.EventSource;
    w.EventSource = class extends Original {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        w.__es += 1;
      }
    };
  });
}

test.describe("encargada", () => {
  test.use({ storageState: authFile("encargada") });

  test("exactly one EventSource, nav shows Rendición and highlights only it", async ({ page }) => {
    await countEventSources(page);
    await openList(page);
    await expect(nav(page).getByRole("link", { name: "Rendición" })).toHaveAttribute("aria-current", "page");
    await expect(nav(page).getByRole("link", { name: "Gestión Delivery" })).not.toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => (window as unknown as { __es: number }).__es)).toBe(1);
    const cadet = await ensureCadet(`Uno ${tag()}`);
    cadets.push(cadet.id);
    await openDetail(page, cadet.id);
    expect(await page.evaluate(() => (window as unknown as { __es: number }).__es)).toBe(1);
  });

  test("print: only the receipt is visible; the history modal shows a past settlement", async ({ page }) => {
    const cadet = await ensureCadet(`Imprime ${tag()}`);
    cadets.push(cadet.id);
    await deliveredFor(cadet.id);
    await deliveredFor(cadet.id);
    await openDetail(page, cadet.id);
    await page.getByTestId("confirm-settlement").click();
    await page.getByTestId("confirm-yes").click();
    await expect(page.getByTestId("receipt-title")).toBeVisible();
    const [st] = await settlementsOf(cadet.id);

    await page.emulateMedia({ media: "print" });
    const display = (testId: string) => page.getByTestId(testId).evaluate((el) => getComputedStyle(el).display);
    await expect(page.getByTestId("receipt")).toBeVisible();
    await expect(nav(page)).toBeHidden();
    await expect(page.getByTestId("station-name")).toBeHidden();
    await expect(page.getByTestId("print-receipt")).toBeHidden();
    await expect(page.getByTestId("owed-table")).toHaveCount(0);
    await expect(page.getByTestId("history")).toBeHidden();
    expect(await display("receipt")).not.toBe("none");
    // The sheet is white (no dark nav or tinted page behind the receipt) wherever the paper is painted.
    const bg = (sel: string) => page.evaluate((q) => getComputedStyle(document.querySelector(q)!).backgroundColor, sel);
    expect(await bg("body")).toBe("rgb(255, 255, 255)");
    expect(["rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"]).toContain(await bg("html"));
    expect(await page.getByTestId("receipt").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    await shot(page, "rendicion-print");
    await page.emulateMedia({ media: "screen" });
    await expect(nav(page)).toBeVisible();

    // Past settlement: "Ver comprobante" in a modal (fresh load, the history comes from the server).
    await openDetail(page, cadet.id);
    await page.locator(`[data-testid="history-row"][data-settlement-id="${st.id}"]`).getByTestId("view-receipt").click();
    const modal = page.getByTestId("receipt-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("receipt-title")).toHaveText(`Rendición #${st.id}`);
    await expect(modal.getByTestId("receipt-order-numbers")).toContainText("#");
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
  });

  test("the Gestión Delivery 'Rendir' link opens the cadet detail", async ({ page }) => {
    const cadet = await ensureCadet(`Link ${tag()}`);
    cadets.push(cadet.id);
    await deliveredFor(cadet.id, { delivered: false });
    await page.goto("/delivery?tab=enroute");
    await page.locator(`[data-testid="cadet-group"][data-cadet-id="${cadet.id}"]`).getByTestId("render-link").click();
    await expect(page).toHaveURL(new RegExp(`/delivery/rendicion\\?cadet=${cadet.id}$`));
    await expect(page.getByTestId("cadet-detail")).toBeVisible();
    await expect(page.getByTestId("nothing-to-settle")).toBeVisible();
    await expect(page.getByTestId("inroute-row")).toHaveCount(1);
  });
});

test.describe("admin", () => {
  test.use({ storageState: authFile("admin") });
  test("is allowed and sees Rendición in the nav", async ({ page }) => {
    await page.goto("/delivery/rendicion");
    await expect(page.getByTestId("rendicion-list")).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Rendición" })).toBeVisible();
  });
});

test.describe("cajera", () => {
  test.use({ storageState: authFile("cajera") });
  test("is redirected away and has no Rendición link", async ({ page }) => {
    await page.goto("/despacho/rendicion");
    await expect(page).toHaveURL(/\/mostrador$/);
    await expect(page.getByTestId("rendicion-list")).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Rendición" })).toHaveCount(0);
  });
});

test.describe("anonymous", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("is sent to /login", async ({ page }) => {
    await page.goto("/despacho/rendicion");
    await expect(page).toHaveURL(/\/login/);
  });
});
