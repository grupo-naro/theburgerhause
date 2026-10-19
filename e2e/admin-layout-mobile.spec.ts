import { expect, test, type Locator, type Page } from "@playwright/test";
import { formatARS } from "../src/domain/money";
import { findCadet, findGroup, findModifier, findProduct, findUser } from "./helpers/db";
import { noHorizontalOverflow } from "./helpers/checkout";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("admin") });

const SECTIONS = ["Menú", "Modificadores", "Cadetes", "Usuarios", "Estaciones", "Ajustes"];

test("@mobile the admin shell has a sticky bar and a drawer with every section", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/menu");
  expect(await noHorizontalOverflow(page)).toBe(true);

  const burger = page.getByRole("button", { name: "Abrir menú" });
  await expect(burger).toBeVisible();
  await expect(burger).toHaveAttribute("aria-expanded", "false");
  const box = await burger.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(43.5);

  // The old horizontal strip is gone below md.
  await expect(page.getByRole("navigation", { name: "Administración" })).toBeHidden();

  await burger.click();
  const drawer = page.getByRole("dialog", { name: "Menú de administración" });
  await expect(drawer).toBeVisible();
  await expect(burger).toHaveAttribute("aria-expanded", "true");
  for (const name of SECTIONS) await expect(drawer.getByRole("link", { name })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Menú" })).toHaveAttribute("aria-current", "page");
  await expect(drawer.getByRole("link", { name: "Volver a operación" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  // The page behind does not scroll while the drawer is open.
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(burger).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");

  // Outside tap closes it too.
  await burger.click();
  await expect(drawer).toBeVisible();
  await page.getByTestId("admin-drawer-backdrop").click({ position: { x: 370, y: 400 } });
  await expect(drawer).toBeHidden();

  await burger.click();
  await drawer.getByRole("link", { name: "Usuarios" }).click();
  await expect(page).toHaveURL(/\/admin\/usuarios$/);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("heading", { name: "Usuarios", level: 1 })).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await expect(page.getByTestId("admin-mobile-bar")).toContainText("Usuarios");
});

test("@mobile the top bar stays in view after scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto("/admin/menu");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.getByTestId("admin-mobile-bar")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Abrir menú" })).toBeInViewport();
});

test("desktop keeps the sidebar and has no drawer button", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/admin/menu");
  await expect(page.getByRole("button", { name: "Abrir menú" })).toBeHidden();
  const nav = page.getByRole("navigation", { name: "Administración" });
  await expect(nav).toBeVisible();
  for (const name of SECTIONS) await expect(nav.getByRole("link", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
});

test("@mobile touch sizing is scoped to the admin", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/ajustes");
  expect(await page.locator("[data-admin-touch]").count()).toBe(1);
  const fieldSize = await page.getByLabel("Nombre del local").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fieldSize).toBeGreaterThanOrEqual(16);
  const save = await page.getByRole("button", { name: "Guardar ajustes" }).boundingBox();
  expect(save!.height).toBeGreaterThanOrEqual(43.5);
});

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

async function seedCategory(page: Page, category: string, products: Array<[string, string]>): Promise<void> {
  await page.goto("/admin/menu/categorias/nueva");
  await page.getByLabel("Nombre").fill(category);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/menu$/);
  for (const [name, price] of products) {
    await page.goto("/admin/menu/productos/nuevo");
    await page.getByLabel("Categoría").selectOption({ label: category });
    await page.getByLabel("Nombre").fill(name);
    await page.getByLabel("Precio (pesos)").fill(price);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page).toHaveURL(/\/admin\/menu$/);
  }
}

test("@mobile menu shows product cards with a big pause toggle and a ⋯ menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cat = `Cat ${uid()}`;
  const a = `Alfa ${uid()}`;
  const b = `Beta ${uid()} ${"x".repeat(120)}`.slice(0, 120);
  expect(b.length).toBe(120);
  await seedCategory(page, cat, [[a, "9000"], [b, "10000"]]);
  await page.goto("/admin/menu");
  expect(await noHorizontalOverflow(page)).toBe(true);

  const list = page.getByRole("list", { name: `Productos de ${cat}` });
  const cardA = list.getByRole("listitem").filter({ hasText: a });
  const cardB = list.getByRole("listitem").filter({ hasText: b.slice(0, 20) });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  // No photo -> neutral placeholder.
  await expect(cardA.getByText("Sin foto")).toBeVisible();

  // The state button is on screen (no sideways scroll), >= 44px tall, and flips on tap.
  const toggle = cardA.getByRole("button", { name: `Desactivar ${a}` });
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeInViewport({ ratio: 1 });
  await expect(toggle).toHaveText("Activo");
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await toggle.click();
  const reactivate = cardA.getByRole("button", { name: `Activar ${a}` });
  await expect(reactivate).toHaveText("Pausado");
  expect((await findProduct(a)).active).toBe(false);
  await reactivate.click();
  await expect(cardA.getByRole("button", { name: `Desactivar ${a}` })).toHaveText("Activo");
  expect((await findProduct(a)).active).toBe(true);

  await expect(cardA.getByRole("link", { name: "Editar" })).toHaveAttribute("href", /\/admin\/menu\/productos\/\d+$/);

  // The 120-character name wraps inside the card.
  await cardB.scrollIntoViewIfNeeded();
  expect(await noHorizontalOverflow(page)).toBe(true);
  const cardBox = await cardB.boundingBox();
  expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(390);

  // ⋯ menu: Destacar / Subir / Bajar; first can't go up, last can't go down.
  const more = cardA.getByRole("button", { name: `Más acciones de ${a}` });
  expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(cardA.getByRole("button", { name: `Destacar ${a}` })).toBeVisible();
  await expect(cardA.getByRole("button", { name: `Subir ${a}` })).toBeDisabled();
  await expect(cardA.getByRole("button", { name: `Bajar ${a}` })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(more).toHaveAttribute("aria-expanded", "false");

  const moreB = cardB.getByRole("button", { name: /^Más acciones de / });
  await moreB.click();
  await expect(cardB.getByRole("button", { name: /^Bajar / })).toBeDisabled();
  await expect(cardB.getByRole("button", { name: /^Subir / })).toBeEnabled();
  await page.keyboard.press("Escape");

  // Choosing an item submits its action AND closes the menu.
  await more.click();
  await cardA.getByRole("button", { name: `Destacar ${a}` }).click();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(cardA.getByText("Destacado", { exact: true })).toBeVisible();
  expect((await findProduct(a)).featured).toBe(true);
  await more.click();
  await cardA.getByRole("button", { name: `Bajar ${a}` }).click();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(list.getByRole("listitem").first()).toContainText(b.slice(0, 20));
});

test("@mobile category header keeps Nuevo producto and Editar, the rest sits in ⋯", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cat = `Cat ${uid()}`;
  await seedCategory(page, cat, [[`P ${uid()}`, "1000"]]);
  await page.goto("/admin/menu");
  const section = page.locator("section, div").filter({ has: page.getByRole("heading", { name: cat, level: 2 }) }).last();
  await expect(section.getByRole("link", { name: "Nuevo producto" })).toBeVisible();
  await expect(section.getByRole("link", { name: "Editar" }).first()).toBeVisible();
  const more = section.getByRole("button", { name: `Más acciones de la categoría ${cat}` });
  await more.click();
  await expect(section.getByRole("button", { name: `Desactivar categoría ${cat}` })).toBeVisible();
  await expect(section.getByRole("button", { name: `Subir categoría ${cat}` })).toBeVisible();
  await section.getByRole("button", { name: `Desactivar categoría ${cat}` }).click();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(section.getByText("Inactiva")).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("@mobile the drawer overlays ⋯ menus and cards, and the ⋯ panel stays under the bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/menu");
  const more = page.getByRole("button", { name: /^Más acciones de (?!la categoría)/ }).first();
  await more.scrollIntoViewIfNeeded();
  await more.click();
  const panelZ = await page.locator(`#${await more.getAttribute("aria-controls")}`).evaluate((el) => Number(getComputedStyle(el).zIndex));
  const barZ = await page.getByTestId("admin-mobile-bar").evaluate((el) => Number(getComputedStyle(el).zIndex));
  expect(panelZ).toBeLessThan(barZ);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Abrir menú" }).click();
  const drawer = page.getByRole("dialog", { name: "Menú de administración" });
  await expect(drawer).toBeVisible();
  const covered = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')!;
    return [[20, 300], [195, 600], [370, 400], [195, 800]].every(([x, y]) => d.contains(document.elementFromPoint(x, y)));
  });
  expect(covered).toBe(true);
});

// ---- Modificadores / Usuarios / Cadetes cards ----

const PHONE_WIDTHS = [390, 360];

async function expectTall(locator: Locator): Promise<void> {
  expect((await locator.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
}

async function seedGroupWithOptions(page: Page, group: string, options: Array<[string, string]>): Promise<void> {
  await page.goto("/admin/modificadores/grupos/nuevo");
  await page.getByLabel("Nombre").fill(group);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/modificadores$/);
  const groupId = (await findGroup(group)).id;
  for (const [name, price] of options) {
    await page.goto(`/admin/modificadores/nuevo?grupo=${groupId}`);
    await expect(page.getByLabel("Grupo")).not.toHaveValue("");
    await page.getByLabel("Nombre").fill(name);
    await page.getByLabel("Tipo").selectOption({ label: "Agregar" });
    await page.getByLabel("Precio (pesos)").fill(price);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page).toHaveURL(/\/admin\/modificadores$/);
  }
}

test("@mobile modifier groups show one card per group with stacked option cards", async ({ page }) => {
  const u = uid();
  const group = `Grupo ${u}`;
  const a = `Dips ${u}`;
  const b = `Bacon ${u} ${"y".repeat(34)}`;
  await seedGroupWithOptions(page, group, [[a, "1200"], [b, "800"]]);
  const groupId = (await findGroup(group)).id;

  for (const width of PHONE_WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/admin/modificadores");
    expect(await noHorizontalOverflow(page)).toBe(true);
    await expect(page.getByRole("table", { name: `Modificadores de ${group}` })).toBeHidden();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/modificadores");
  const list = page.getByRole("list", { name: `Modificadores de ${group}` });
  const cardA = list.getByRole("listitem").filter({ hasText: a });
  const cardB = list.getByRole("listitem").filter({ hasText: b.slice(0, 20) });
  await expect(cardA).toContainText(formatARS(120000));
  await expect(cardA).toContainText("Activo");
  await cardB.scrollIntoViewIfNeeded();
  const boxB = await cardB.boundingBox();
  expect(boxB!.x + boxB!.width).toBeLessThanOrEqual(390);

  const toggle = cardA.getByRole("button", { name: `Desactivar ${a}` });
  await expectTall(toggle);
  await expectTall(cardA.getByRole("link", { name: "Editar" }));
  await expect(cardA.getByRole("link", { name: "Editar" })).toHaveAttribute("href", /\/admin\/modificadores\/\d+$/);
  await toggle.click();
  await expect(cardA.getByRole("button", { name: `Activar ${a}` })).toBeVisible();
  await expect(cardA).toContainText("Inactivo");
  expect((await findModifier(groupId, a)).active).toBe(false);
  await cardA.getByRole("button", { name: `Activar ${a}` }).click();
  await expect(cardA.getByRole("button", { name: `Desactivar ${a}` })).toBeVisible();

  // ⋯: first can't go up; Bajar reorders and closes the menu.
  const more = cardA.getByRole("button", { name: `Más acciones de ${a}` });
  await expectTall(more);
  await more.click();
  await expect(cardA.getByRole("button", { name: `Subir ${a}` })).toBeDisabled();
  await cardA.getByRole("button", { name: `Bajar ${a}` }).click();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(list.getByRole("listitem").first()).toContainText(b.slice(0, 20));

  await expectTall(page.getByRole("link", { name: "Editar grupo" }).first());
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("@mobile users show cards; deactivating keeps its effect and self-protection", async ({ page }) => {
  const username = `cajera.${uid()}`;
  await page.goto("/admin/usuarios/nuevo");
  await page.getByLabel("Nombre").fill(`Cajera ${username}`);
  await page.getByLabel("Usuario", { exact: true }).fill(username);
  await page.getByLabel("Rol").selectOption("cajera");
  await page.getByLabel("Contraseña").fill("e2e-user-pass-1");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/usuarios$/);

  for (const width of PHONE_WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/admin/usuarios");
    expect(await noHorizontalOverflow(page)).toBe(true);
    await expect(page.getByRole("table", { name: "Usuarios" })).toBeHidden();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/usuarios");
  const list = page.getByRole("list", { name: "Usuarios" });
  const card = list.getByRole("listitem").filter({ hasText: username });
  await expect(card).toContainText("Cajera");
  await expect(card).toContainText("Activo");
  const toggle = card.getByRole("button", { name: `Desactivar ${username}` });
  await expectTall(toggle);
  await expectTall(card.getByRole("link", { name: "Editar" }));
  await expect(card.getByRole("link", { name: "Editar" })).toHaveAttribute("href", /\/admin\/usuarios\/\d+$/);

  // Cerrar sesiones lives in ⋯ and is disabled with no sessions.
  const more = card.getByRole("button", { name: `Más acciones de ${username}` });
  await expectTall(more);
  await more.click();
  await expect(card.getByRole("button", { name: `Cerrar sesiones de ${username}` })).toBeDisabled();
  await page.keyboard.press("Escape");

  await toggle.click();
  await expect(card).toContainText("Inactivo");
  expect((await findUser(username)).active).toBe(false);

  // The only admin cannot deactivate itself: same error as the table.
  const admin = list.getByRole("listitem").filter({ hasText: "(vos)" });
  await admin.getByRole("button", { name: "Desactivar admin" }).click();
  await expect(admin.getByRole("alert")).toContainText("No podés desactivarte a vos mismo");
  expect((await findUser("admin")).active).toBe(true);
});

test("@mobile cadets show cards with toggle and edit", async ({ page }) => {
  const name = `Cadete ${uid()}`;
  await page.goto("/admin/cadetes/nuevo");
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Teléfono").fill("+54 11 5555-1234");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/\/admin\/cadetes$/);

  for (const width of PHONE_WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/admin/cadetes");
    expect(await noHorizontalOverflow(page)).toBe(true);
    await expect(page.getByRole("table", { name: "Cadetes" })).toBeHidden();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/cadetes");
  const card = page.getByRole("list", { name: "Cadetes" }).getByRole("listitem").filter({ hasText: name });
  await expect(card).toContainText("+54 11 5555-1234");
  await expect(card).toContainText("0 en camino");
  const toggle = card.getByRole("button", { name: `Desactivar ${name}` });
  await expectTall(toggle);
  await expectTall(card.getByRole("link", { name: "Editar" }));
  await expect(card.getByRole("link", { name: "Editar" })).toHaveAttribute("href", /\/admin\/cadetes\/\d+$/);
  await toggle.click();
  await expect(card).toContainText("Inactivo");
  expect((await findCadet(name)).active).toBe(false);
  await card.getByRole("button", { name: `Activar ${name}` }).click();
  await expect(card).toContainText("Activo");
  expect((await findCadet(name)).active).toBe(true);
});
