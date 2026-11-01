import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import * as s from "../src/db/schema";
import { db } from "./helpers/db";
import { clearPromo, setPromo } from "./helpers/promo";
import { authFile } from "./helpers/users";

const BASE = "http://localhost:3100";
const TITLE = "EDICIÓN ESPECIAL HALLOWEEN";
const modal = (page: Page) => page.getByRole("dialog", { name: TITLE });

test.beforeEach(clearPromo);
test.afterEach(clearPromo);

const minutes = (n: number) => new Date(Date.now() + n * 60_000);

/** The modal only opens after the store has hydrated and the image has loaded: assert absence once both settled. */
async function settle(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(1500);
}
async function expectNoModal(page: Page) {
  await settle(page);
  await expect(page.getByTestId("promo-modal")).toHaveCount(0);
}

async function pngFile(dir: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "promo.png");
  await sharp({ create: { width: 600, height: 800, channels: 3, background: "#e67e22" } }).png().toFile(file);
  return file;
}

async function adminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE, storageState: authFile("admin") });
  return context.newPage();
}

/** A brand-new visitor (own cookies and sessionStorage). */
async function visitor(browser: Browser): Promise<Page> {
  return (await browser.newContext({ baseURL: BASE })).newPage();
}

test("admin creates a promotion with an image; the store shows it once per visit and again to a new visitor", async ({ browser, page }, testInfo) => {
  const admin = await adminPage(browser);
  await admin.goto("/admin/promocion");
  await expect(admin.getByRole("heading", { name: "Promoción", level: 1 })).toBeVisible();
  await admin.getByLabel("Título (opcional)").fill(TITLE);
  await admin.getByLabel("Imagen de la promoción: elegir archivo").setInputFiles(await pngFile(testInfo.outputPath("img")));
  await expect(admin.getByAltText("Vista previa de la imagen")).toHaveAttribute("src", /\/uploads\//);
  await admin.getByLabel("Activa").check();
  await admin.getByRole("button", { name: "Guardar promoción" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Promoción guardada" })).toBeVisible();
  await admin.context().close();

  // A customer enters the store: the modal opens with title and the whole image.
  await page.goto("/");
  const dialog = modal(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: TITLE })).toBeVisible();
  const img = dialog.getByRole("img", { name: TITLE });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await expect(img).toHaveCSS("object-fit", "contain");

  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await expect(dialog).toBeHidden();

  // Same tab session: reloading or moving around the store does not bring it back.
  await page.reload();
  await expectNoModal(page);
  await page.goto("/carrito");
  await page.goto("/");
  await expectNoModal(page);

  // A new browser context is a new visit.
  const other = await visitor(browser);
  await other.goto("/");
  await expect(modal(other)).toBeVisible();
  await other.context().close();

  // Deactivating from the admin panel hides it for new visitors right away.
  const admin2 = await adminPage(browser);
  await admin2.goto("/admin/promocion");
  await admin2.getByLabel("Activa").uncheck();
  await admin2.getByRole("button", { name: "Guardar promoción" }).click();
  await expect(admin2.getByRole("status").filter({ hasText: "Promoción guardada" })).toBeVisible();
  await admin2.context().close();
  const third = await visitor(browser);
  await third.goto("/");
  await expectNoModal(third);
  await third.context().close();
});

test("closes with Escape and with a click on the backdrop; focus starts inside", async ({ browser }) => {
  await setPromo();
  for (const how of ["escape", "backdrop"] as const) {
    const page = await visitor(browser);
    await page.goto("/");
    await expect(modal(page)).toBeVisible();
    if (how === "escape") {
      expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
      await page.keyboard.press("Escape");
    } else {
      await page.mouse.click(4, 4);
    }
    await expect(modal(page)).toBeHidden();
    await page.context().close();
  }
});

test("a new or edited promotion shows again in the same session", async ({ page }) => {
  await setPromo();
  await page.goto("/");
  await modal(page).getByRole("button", { name: "Cerrar" }).click();
  await page.reload();
  await expectNoModal(page);

  await setPromo({ title: "OTRA PROMO" });
  await page.reload();
  await expect(page.getByRole("dialog", { name: "OTRA PROMO" })).toBeVisible();
});

test("scheduling: not shown before the start or after the end, shown inside the window", async ({ browser }) => {
  const visit = async () => {
    const page = await visitor(browser);
    await page.goto("/");
    return page;
  };
  await setPromo({ startsAt: minutes(30), endsAt: minutes(90) });
  let page = await visit();
  await expectNoModal(page);
  await page.context().close();

  await setPromo({ startsAt: minutes(-90), endsAt: minutes(-30) });
  page = await visit();
  await expectNoModal(page);
  await page.context().close();

  await setPromo({ startsAt: minutes(-30), endsAt: minutes(30) });
  page = await visit();
  await expect(modal(page)).toBeVisible();
  await page.context().close();

  // Inactive, or active without an image: nothing.
  await setPromo({ active: false });
  page = await visit();
  await expectNoModal(page);
  await page.context().close();
  await setPromo({ imagePath: null });
  page = await visit();
  await expectNoModal(page);
  await page.context().close();
});

test("landing on the cart, checkout or order tracking never shows it, nor later in the same visit", async ({ page }) => {
  await setPromo();
  for (const route of ["/carrito", "/checkout", "/pedido/token-inexistente"]) {
    await page.goto(route);
    await expectNoModal(page);
  }
  await page.goto("/carrito");
  await settle(page);
  // The visit started on the cart: the home later in the same session is not "the first page".
  await page.goto("/");
  await expectNoModal(page);
});

test("the admin and the login never show it", async ({ browser }) => {
  await setPromo();
  const admin = await adminPage(browser);
  await admin.goto("/admin");
  await expectNoModal(admin);
  await admin.context().close();
  const page = await visitor(browser);
  await page.goto("/login");
  await expectNoModal(page);
  await page.context().close();
});

test("admin form: end must be after start", async ({ browser }, testInfo) => {
  const admin = await adminPage(browser);
  await admin.goto("/admin/promocion");
  await admin.getByLabel("Imagen de la promoción: elegir archivo").setInputFiles(await pngFile(testInfo.outputPath("img")));
  await expect(admin.getByAltText("Vista previa de la imagen")).toHaveAttribute("src", /\/uploads\//);
  await admin.getByLabel("Desde (opcional)").fill("2030-01-02T10:00");
  await admin.getByLabel("Hasta (opcional)").fill("2030-01-01T10:00");
  await admin.getByRole("button", { name: "Guardar promoción" }).click();
  await expect(admin.getByRole("alert").filter({ hasText: "posterior al inicio" })).toBeVisible();
  expect(await db().select().from(s.storePromo)).toHaveLength(0);
  await admin.context().close();
});

test("@mobile the modal fits the phone: whole image, 44px close target, no sideways scroll", async ({ page }) => {
  await setPromo();
  await page.goto("/");
  const dialog = modal(page);
  await expect(dialog).toBeVisible();
  const box = await dialog.getByRole("button", { name: "Cerrar" }).boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const img = await dialog.getByRole("img", { name: TITLE }).boundingBox();
  const vp = page.viewportSize()!;
  expect(img!.height).toBeLessThanOrEqual(vp.height * 0.8 + 1);
  expect(img!.width).toBeLessThanOrEqual(vp.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Cerrar" }).click();
  await expect(dialog).toBeHidden();
});
