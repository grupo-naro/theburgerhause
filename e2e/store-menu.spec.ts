import { expect, test, type Browser, type Page } from "@playwright/test";
import { findProduct, setAcceptingOrders } from "./helpers/db";
import { reloadUntil } from "./helpers/public-menu";
import { shot } from "./helpers/shots";
import { authFile } from "./helpers/users";

// Public storefront: no session.
test.use({ storageState: { cookies: [], origins: [] } });

const SIMPLE = "Hamburguesa simple + papa chica";
const DOUBLE = "Hamburguesa doble + papa chica";
const SEEDED_PRODUCTS = [
  "Ranchita simple",
  "Melt simple",
  "Cuarto de libra simple",
  "Holtber extreme simple",
  "828 simple",
  "Huevo simple",
  "Aro simple",
  "Ranchita doble",
  "Melt doble",
  "Cuarto de libra doble",
  "Holtber extreme doble",
];

const card = (page: Page, name: string) =>
  page.getByTestId("product-card").filter({ has: page.getByText(name, { exact: true }) });

/** Admin session in its own context (the public page itself stays anonymous). */
async function withAdmin(browser: Browser, baseURL: string | undefined, fn: (page: Page) => Promise<void>) {
  const context = await browser.newContext({
    baseURL,
    storageState: authFile("admin"),
    extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
  });
  try {
    await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

/** Resolves once the page stopped scrolling (programmatic smooth scrolls take ~1s). */
const scrollSettled = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = -1;
        const tick = () => {
          if (window.scrollY === last) resolve();
          else {
            last = window.scrollY;
            setTimeout(tick, 150);
          }
        };
        tick();
      }),
  );

async function renameProduct(page: Page, from: string, to: string): Promise<void> {
  const { id } = await findProduct(from);
  await page.goto(`/admin/menu/productos/${id}`);
  await page.getByLabel("Nombre").fill(to);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/menu$/);
}

test("home renders the store name, every active category and product", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The Burger House 828");
  await expect(page).toHaveTitle("The Burger House 828 — Pedí online");
  await expect(page.getByRole("heading", { name: SIMPLE, level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: DOUBLE, level: 2 })).toBeVisible();
  // Seeded categories without active products are not listed.
  await expect(page.getByRole("heading", { name: "Kids", level: 2 })).toHaveCount(0);
  for (const name of SEEDED_PRODUCTS) await expect(card(page, name)).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Destacados", level: 2 })).toBeVisible();

  // The public payload (HTML + flight data) never carries internal fields.
  const html = await page.content();
  expect(html).not.toContain("kitchenLabel");
  expect(html).not.toContain("SIN CHEDDAR");

  // Photos load (first two seeded products have one).
  for (const name of ["Ranchita simple", "Melt simple"]) {
    const img = card(page, name).locator("img");
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  }

  await shot(page, "store-home-desktop");
});

test("clicking a category chip scrolls to its section and marks the chip current", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Categorías del menú" });
  await expect(nav.getByRole("link", { name: SIMPLE })).toHaveAttribute("aria-current", "true");

  await nav.getByRole("link", { name: DOUBLE }).click();
  await expect(nav.getByRole("link", { name: DOUBLE })).toHaveAttribute("aria-current", "true");
  await expect(nav.getByRole("link", { name: SIMPLE })).not.toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { name: DOUBLE, level: 2 })).toBeInViewport();

  // Scrolling back up moves the spy back.
  await nav.getByRole("link", { name: SIMPLE }).click();
  await expect(nav.getByRole("link", { name: SIMPLE })).toHaveAttribute("aria-current", "true");
});

test("instant search filters accent-insensitively, clears and shows the empty state", async ({ page }) => {
  await page.goto("/");
  await expect(card(page, "Ranchita simple")).toHaveCount(1);
  const total = await page.getByTestId("product-card").count(); // other specs may add products
  const box = page.getByRole("searchbox", { name: "Buscar en el menú" });
  await box.fill("RÁNCHITA");
  await expect(page.getByTestId("product-card")).toHaveCount(2);
  await expect(card(page, "Ranchita simple")).toBeVisible();
  await expect(card(page, "Ranchita doble")).toBeVisible();
  await expect(card(page, "Melt simple")).toHaveCount(0);
  await shot(page, "store-search-results");

  await page.getByRole("button", { name: "Borrar búsqueda" }).click();
  await expect(box).toHaveValue("");
  await expect(page.getByTestId("product-card")).toHaveCount(total);

  await box.fill("zzzz");
  await expect(page.getByText("No encontramos productos para «zzzz»")).toBeVisible();
  await expect(page.getByTestId("product-card")).toHaveCount(0);
  await shot(page, "store-search-empty");
  await page.getByRole("button", { name: "Borrar búsqueda" }).last().click();
  await expect(page.getByTestId("product-card")).toHaveCount(total);
});

test("the header search button focuses the search box", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Buscar en el menú" }).click();
  await expect(page.getByRole("searchbox", { name: "Buscar en el menú" })).toBeFocused();
});

test("closed banner appears without moving the page, and the scrollspy still works", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("closed-banner")).toHaveCount(0);
  const first = card(page, "Ranchita simple");
  await expect(first).toBeVisible();
  const before = (await first.boundingBox())!;
  await setAcceptingOrders(false);
  try {
    await page.reload();
    const banner = page.getByTestId("closed-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Por el momento no estamos tomando pedidos");
    // No layout shift: the notice floats instead of pushing the content.
    const after = (await first.boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    // Menu is still browsable, the notice and the bars stay in view while scrolling.
    const nav = page.getByRole("navigation", { name: "Categorías del menú" });
    await page.mouse.wheel(0, 900);
    await expect(banner).toBeInViewport();
    await expect(nav).toBeInViewport();
    // Scrollspy and chip clicks still pick the right section.
    await nav.getByRole("link", { name: DOUBLE }).click();
    await expect(nav.getByRole("link", { name: DOUBLE })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("heading", { name: DOUBLE, level: 2 })).toBeInViewport();
    await scrollSettled(page); // the chip click smooth-scrolls; do not race it
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(nav.getByRole("link", { name: SIMPLE })).toHaveAttribute("aria-current", "true");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    // Viewport shot (fixed elements are meaningless in a stitched full-page capture).
    await page.screenshot({ path: "test-results/shots/store-closed.png", animations: "disabled" });
  } finally {
    await setAcceptingOrders(true);
  }
  await page.reload();
  await expect(page.getByTestId("closed-banner")).toHaveCount(0);
});

test("header and category bar stay visible and nothing overflows on a phone @mobile", async ({ page }) => {
  await page.goto("/");
  await expect(card(page, "Ranchita simple")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, "store-home-mobile-top");

  const header = page.getByRole("banner");
  const nav = page.getByRole("navigation", { name: "Categorías del menú" });
  await card(page, "Holtber extreme simple").scrollIntoViewIfNeeded();
  await expect(card(page, "Holtber extreme simple")).toBeInViewport();
  await expect(header).toBeInViewport({ ratio: 1 });
  await expect(nav).toBeInViewport({ ratio: 1 });
  const headerBox = await header.boundingBox();
  const navBox = await nav.boundingBox();
  expect(headerBox!.y).toBe(0);
  expect(Math.abs(navBox!.y - (headerBox!.y + headerBox!.height))).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/shots/store-home-mobile-scrolled.png" });
  await shot(page, "store-home-mobile-full");
  const after = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(after).toBeLessThanOrEqual(0);
});

test("a product with a very long unbroken name does not widen the page on a phone @mobile", async ({
  page,
  browser,
  baseURL,
}) => {
  const u = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const category = `Largos ${u}`;
  const name = `Larguisimo ${u} ${"w".repeat(120)}`.slice(0, 120);
  await withAdmin(browser, baseURL, async (admin) => {
    await admin.goto("/admin/menu/categorias/nueva");
    await admin.getByLabel("Nombre").fill(category);
    await admin.getByRole("button", { name: "Guardar" }).click();
    await expect(admin).toHaveURL(/\/admin\/menu$/);
    await admin.goto("/admin/menu/productos/nuevo");
    await admin.getByLabel("Categoría").selectOption({ label: category });
    await admin.getByLabel("Nombre").fill(name);
    await admin.getByLabel("Precio (pesos)").fill("5000");
    await admin.getByRole("button", { name: "Guardar" }).click();
    await expect(admin).toHaveURL(/\/admin\/menu$/);
  });
  const viewport = page.viewportSize()!;
  const longCard = card(page, name);
  await page.goto("/");
  await reloadUntil(page, () => expect(longCard).toHaveCount(1, { timeout: 1000 }));
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await longCard.scrollIntoViewIfNeeded();
  const box = (await longCard.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

  await longCard.click();
  const sheet = page.getByTestId("product-sheet");
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect((await sheet.boundingBox())!.width).toBeLessThanOrEqual(viewport.width);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await sheet.getByTestId("sheet-cta").click();
  await expect(sheet).toBeHidden();

  await page.goto("/carrito");
  const line = page.getByTestId("cart-line").filter({ hasText: name.slice(0, 22) });
  await expect(line).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  const lineBox = (await line.boundingBox())!;
  expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(viewport.width);
  expect(await line.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("a deactivated product disappears from the public menu", async ({ page, browser, baseURL }) => {
  const name = "Aro simple";
  await page.goto("/");
  await expect(card(page, name)).toHaveCount(1);
  await withAdmin(browser, baseURL, async (admin) => {
    await admin.goto("/admin/menu");
    try {
      await admin.getByRole("button", { name: `Desactivar ${name}` }).click();
      await expect(admin.getByRole("button", { name: `Activar ${name}` })).toBeVisible();
      await reloadUntil(page, async () => {
        await expect(card(page, name)).toHaveCount(0, { timeout: 1000 });
        await expect(card(page, "Melt simple")).toHaveCount(1, { timeout: 1000 });
      });
    } finally {
      await admin.goto("/admin/menu");
      await expect(admin.getByRole("row", { name: new RegExp(name) })).toBeVisible();
      const activate = admin.getByRole("button", { name: `Activar ${name}` });
      if (await activate.isVisible()) await activate.click();
      await expect(admin.getByRole("button", { name: `Desactivar ${name}` })).toBeVisible();
    }
  });
  await reloadUntil(page, () => expect(card(page, name)).toHaveCount(1, { timeout: 1000 }));
});

test("renaming a product in the admin shows up on the public page (cache invalidation)", async ({
  page,
  browser,
  baseURL,
}) => {
  const original = "Huevo simple";
  const renamed = `Huevo simple ${Date.now().toString(36)}`;
  await page.goto("/");
  await expect(card(page, original)).toHaveCount(1);
  await withAdmin(browser, baseURL, async (admin) => {
    try {
      await renameProduct(admin, original, renamed);
      await reloadUntil(page, async () => {
        await expect(card(page, renamed)).toHaveCount(1, { timeout: 1000 });
        await expect(card(page, original)).toHaveCount(0, { timeout: 1000 });
      });
    } finally {
      const current = await findProduct(renamed);
      if (current) await renameProduct(admin, renamed, original);
    }
  });
  await reloadUntil(page, () => expect(card(page, original)).toHaveCount(1, { timeout: 1000 }));
});
