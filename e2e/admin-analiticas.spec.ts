import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { db } from "./helpers/db";
import { authFile, USERS } from "./helpers/users";

test.describe("admin", () => {
  test.use({ storageState: authFile("admin") });

  test.beforeEach(async () => {
    await db().delete(s.settings).where(eq(s.settings.key, "analytics_pin_hash"));
  });
  // Never leave the shared admin session unlocked for other specs.
  test.afterEach(async () => {
    await db().update(s.sessions).set({ analyticsUnlockedUntil: null });
  });

  test("numbers stay hidden until the store PIN unlocks them, and lock again on demand", async ({ page }) => {
    await page.goto("/admin/analiticas");
    await expect(page.getByRole("heading", { name: "Analíticas", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Configurá el PIN en Ajustes" })).toBeVisible();

    await page.goto("/admin/ajustes");
    await page.getByLabel("PIN nuevo").fill("2468");
    await page.getByLabel("Repetí el PIN").fill("2468");
    await page.getByLabel("Tu contraseña").fill(USERS.admin.password);
    await page.getByRole("button", { name: "Guardar PIN" }).click();
    await expect(page.getByRole("status").filter({ hasText: "PIN de analíticas guardado" })).toBeVisible();

    await page.goto("/admin/analiticas");
    const kpis = page.getByTestId("kpis");
    await expect(kpis).toContainText("****");
    expect(await kpis.textContent()).not.toMatch(/\d/);

    await page.getByLabel("PIN").fill("1111");
    await page.getByRole("button", { name: "Desbloquear" }).click();
    await expect(page.getByText("PIN incorrecto")).toBeVisible();

    await page.getByLabel("PIN").fill("2468");
    await page.getByRole("button", { name: "Desbloquear" }).click();
    await expect(page.getByRole("button", { name: "Bloquear ya" })).toBeVisible();
    await expect(kpis).toContainText(/\$\s?\d/);
    await expect(kpis).not.toContainText("****");

    await page.getByRole("button", { name: "Bloquear ya" }).click();
    await expect(kpis).toContainText("****");
    await expect(page.getByRole("button", { name: "Desbloquear" })).toBeVisible();
  });
});

test.describe("encargado", () => {
  test.use({ storageState: authFile("encargado") });

  test("has no Analíticas link and is sent away from the URL", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/admin/menu");
    await expect(page.getByRole("navigation", { name: "Administración" }).getByRole("link", { name: "Analíticas" })).toHaveCount(0);
    await page.goto("/admin/analiticas");
    await expect(page).not.toHaveURL(/\/admin\/analiticas/);
    await expect(page.getByRole("heading", { name: "Analíticas", level: 1 })).toHaveCount(0);
  });
});
