import { expect, test } from "@playwright/test";
import { authFile } from "./helpers/users";

test.describe("anonymous", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("/mostrador without a session goes to /login", async ({ page }) => {
    await page.goto("/mostrador");
    await expect(page).toHaveURL(/\/login\?next=%2Fmostrador/);
  });
});

test.describe("encargada de delivery", () => {
  test.use({ storageState: authFile("encargada") });
  test("is sent to her home, not to the till", async ({ page }) => {
    await page.goto("/mostrador");
    await expect(page).toHaveURL(/\/despacho$/);
  });
});

test.describe("admin without a station", () => {
  test.use({ storageState: authFile("admin") });
  test("sees the blocking 'Elegir estación' message instead of the till", async ({ page }) => {
    await page.goto("/mostrador");
    const msg = page.getByTestId("no-station");
    await expect(msg).toBeVisible();
    await expect(msg).toContainText("Falta elegir la estación");
    await expect(msg.getByRole("link", { name: "Elegir estación" })).toHaveAttribute("href", "/estacion?next=/mostrador");
    await expect(page.getByTestId("pos-board")).toHaveCount(0);
  });
});

test.describe("cajera", () => {
  test.use({ storageState: authFile("cajera") });
  test("the nav highlights Mostrador and the page title is set", async ({ page }) => {
    await page.goto("/mostrador");
    await expect(page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Mostrador" })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveTitle("Mostrador · The Burger House 828");
  });
});
