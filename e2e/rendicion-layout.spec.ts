import { expect, test, type Locator } from "@playwright/test";
import { formatARS } from "../src/domain/money";
import { noHorizontalOverflow } from "./helpers/checkout";
import { shot, shotViewport } from "./helpers/shots";
import { deliveredFor, ensureCadet, openDetail, openList, retireCadets, tag } from "./helpers/rendicion";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("encargada") });

const cadets: number[] = [];
test.afterAll(() => retireCadets(cadets));

const SIZES = [
  { name: "1280", width: 1280, height: 900 },
  { name: "1024", width: 1024, height: 800 },
  { name: "768", width: 768, height: 1024 },
] as const;

async function expectTarget(locator: Locator, what: string, min = 47.5) {
  const box = await locator.first().boundingBox();
  expect(box, what).not.toBeNull();
  expect(box!.height, `${what} height`).toBeGreaterThanOrEqual(min);
}

test("layout: list and detail at 1280 / 1024 / 768 without overflow, with big targets", async ({ page }) => {
  const label = tag();
  const main = await ensureCadet(`Nahuel ${label}`);
  const other = await ensureCadet(`Lucía ${label}`);
  const idle = await ensureCadet(`Mateo ${label}`);
  cadets.push(main.id, other.id, idle.id);
  const orders = [await deliveredFor(main.id), await deliveredFor(main.id), await deliveredFor(main.id)];
  await deliveredFor(main.id, { delivered: false });
  await deliveredFor(other.id);
  const owed = orders.reduce((a, o) => a + o.total, 0);

  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await openList(page);
    expect(await noHorizontalOverflow(page), `list overflow at ${size.name}`).toBe(true);
    await expectTarget(page.locator('[data-testid="cadet-balance"]').first(), "cadet card", 120);
    await shot(page, `rendicion-list-${size.name}`);

    await openDetail(page, main.id);
    expect(await noHorizontalOverflow(page), `detail overflow at ${size.name}`).toBe(true);
    await expect(page.getByTestId("owed-amount")).toHaveText(formatARS(owed));
    // The amount to collect is the biggest text on the screen.
    const sizes = await page.evaluate(() => {
      const px = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
      const amount = px(document.querySelector('[data-testid="owed-amount"]')!);
      const others = [...document.querySelectorAll("main *")]
        .filter((e) => e.children.length === 0 && e.textContent?.trim() && e.getAttribute("data-testid") !== "owed-amount")
        .map(px);
      return { amount, other: Math.max(...others) };
    });
    expect(sizes.amount).toBeGreaterThan(sizes.other);
    await expectTarget(page.getByTestId("confirm-settlement"), "Confirmar rendición", 55.5);
    await shot(page, `rendicion-detail-${size.name}`);

    await page.getByTestId("received-input").fill("0");
    for (const chip of await page.getByTestId("quick-note").all()) await expectTarget(chip, "quick chip");
    await page.getByTestId("note-input").fill("Cliente no pagó");
    await page.getByTestId("confirm-settlement").click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await expectTarget(page.getByTestId("confirm-yes"), "Sí, confirmar", 55.5);
    await expectTarget(page.getByTestId("confirm-cancel"), "Cancelar", 55.5);
    expect(await noHorizontalOverflow(page), `dialog overflow at ${size.name}`).toBe(true);
    if (size.name === "768") await shotViewport(page, "rendicion-confirm-768");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
    // Focus returns to the button that opened the dialog.
    await expect(page.getByTestId("confirm-settlement")).toBeFocused();
  }
});
