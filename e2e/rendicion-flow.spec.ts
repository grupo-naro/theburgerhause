import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { formatARS } from "../src/domain/money";
import { listCadetBalances } from "../src/lib/settlements/queries";
import { formatPesosInput } from "../src/lib/rendicion/parse-pesos";
import { db } from "./helpers/db";
import { setCadetActive } from "./helpers/despacho";
import { shot, shotViewport } from "./helpers/shots";
import {
  cadetCard,
  deliveredFor,
  ensureCadet,
  openDetail,
  openList,
  retireCadets,
  settlementLines,
  settlementsOf,
  tag,
} from "./helpers/rendicion";
import { authFile } from "./helpers/users";

test.use({ storageState: authFile("encargada") });

const cadets: number[] = [];
test.afterAll(() => retireCadets(cadets));

async function newCadet(name: string) {
  const c = await ensureCadet(name);
  cadets.push(c.id);
  return c;
}

const sum = (xs: { total: number }[]) => xs.reduce((a, x) => a + x.total, 0);
const ordersOf = (cadetId: number) => db().select().from(s.orders).where(eq(s.orders.cadetId, cadetId));

test("list: owed amount, count, en-route line, totals strip, 'Al día', inactive debtor, sorted by debt", async ({ page }) => {
  const label = tag();
  const ana = await newCadet(`Ana ${label}`);
  const delivered = [await deliveredFor(ana.id), await deliveredFor(ana.id), await deliveredFor(ana.id)];
  const route = await deliveredFor(ana.id, { delivered: false });
  await deliveredFor(ana.id, { paymentMethod: "transfer" }); // transfer: never counted
  const beto = await newCadet(`Beto ${label}`);
  const zeta = await newCadet(`Zeta ${label}`);
  const zOrder = await deliveredFor(zeta.id);
  await setCadetActive(zeta.id, false);

  await openList(page);
  const card = cadetCard(page, ana.id);
  await expect(card.getByTestId("cadet-owed")).toHaveText(formatARS(sum(delivered)));
  await expect(card.getByTestId("cadet-owed-count")).toHaveText("3 pedidos en efectivo");
  await expect(card.getByTestId("cadet-inroute")).toContainText("1 en ruta");
  await expect(card.getByTestId("cadet-inroute")).toContainText(formatARS(route.total));
  await expect(card.getByTestId("cadet-last")).toHaveText("Nunca");
  await expect(cadetCard(page, beto.id).getByTestId("cadet-owed")).toContainText("Al día");
  await expect(cadetCard(page, zeta.id).getByTestId("inactive-tag")).toBeVisible();
  await expect(cadetCard(page, zeta.id).getByTestId("cadet-owed")).toHaveText(formatARS(zOrder.total));

  const balances = await listCadetBalances(db());
  const totalOwed = balances.reduce((a, b) => a + b.owed, 0);
  await expect(page.getByTestId("total-pending")).toHaveText(formatARS(totalOwed));
  const ids = await page.getByTestId("cadet-balance").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-cadet-id"))));
  expect(ids).toEqual(balances.map((b) => b.cadetId));
  await shot(page, "rendicion-list");
});

test("exact settlement: dialog repeats the numbers, receipt, DB and live updates", async ({ page, context }) => {
  const label = tag();
  const cadet = await newCadet(`Nahuel ${label}`);
  const delivered = [await deliveredFor(cadet.id), await deliveredFor(cadet.id), await deliveredFor(cadet.id)];
  const route = await deliveredFor(cadet.id, { delivered: false });
  const owed = sum(delivered);

  const listPage = await context.newPage();
  await openList(listPage);
  await expect(cadetCard(listPage, cadet.id).getByTestId("cadet-owed")).toHaveText(formatARS(owed));

  await openDetail(page, cadet.id);
  await expect(page.getByTestId("owed-row")).toHaveCount(3);
  for (const o of delivered) await expect(page.locator(`[data-testid="owed-row"][data-order-number="${o.number}"]`)).toBeVisible();
  await expect(page.getByTestId("owed-amount")).toHaveText(formatARS(owed));
  await expect(page.getByTestId("owed-table-total")).toHaveText(formatARS(owed));
  await expect(page.getByTestId("inroute-row")).toHaveCount(1);
  await expect(page.getByTestId("received-input")).toHaveValue(formatPesosInput(owed));
  await expect(page.getByTestId("diff-line")).toContainText("Exacto");
  await shot(page, "rendicion-detail-exact");

  await page.getByTestId("confirm-settlement").click();
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("confirm-summary")).toContainText(`Cadete Nahuel ${label} · 3 pedidos`);
  await expect(dialog.getByTestId("confirm-expected")).toHaveText(formatARS(owed));
  await expect(dialog.getByTestId("confirm-received")).toHaveText(formatARS(owed));
  await expect(dialog.getByTestId("confirm-shortage")).toHaveCount(0);
  await shotViewport(page, "rendicion-confirm-dialog");

  await dialog.getByTestId("confirm-yes").click();
  await expect(page.getByTestId("receipt-title")).toHaveText(/^Rendición #\d+$/);
  await expect(page.getByTestId("receipt-expected")).toHaveText(formatARS(owed));
  await expect(page.getByTestId("receipt-received")).toHaveText(formatARS(owed));
  await expect(page.getByTestId("receipt-order-numbers")).toContainText(`#${delivered[0].number}`);
  await expect(page.getByTestId("owed-amount")).toHaveText(formatARS(0));
  await shot(page, "rendicion-receipt");

  const [st] = await settlementsOf(cadet.id);
  expect(st).toMatchObject({ amount: owed, receivedAmount: owed });
  expect((await settlementLines(st.id)).length).toBe(3);
  const rows = await ordersOf(cadet.id);
  for (const o of delivered) expect(rows.find((r) => r.id === o.id)?.paymentStatus).toBe("paid");
  const inRoute = rows.find((r) => r.id === route.id)!;
  expect(inRoute.status).toBe("en_camino");
  expect(inRoute.paymentStatus).toBe("pending");

  // The list page that stayed open follows the settlement without a reload.
  await expect(cadetCard(listPage, cadet.id).getByTestId("cadet-owed")).toContainText("Al día");
  await expect(cadetCard(listPage, cadet.id).getByTestId("cadet-last")).toContainText("hoy");
  await listPage.close();

  // The board still shows only the en-route cash (the settled orders left the balance).
  const board = await context.newPage();
  await board.goto("/delivery?tab=enroute");
  const group = board.locator(`[data-testid="cadet-group"][data-cadet-id="${cadet.id}"]`);
  await expect(group.getByTestId("cash-pending")).toHaveText(formatARS(route.total));
  await board.close();
});

test("shortage: note required (chip fills it), over-amount refused, DB records the shortage", async ({ page }) => {
  const label = tag();
  const cadet = await newCadet(`Faltante ${label}`);
  const delivered = [await deliveredFor(cadet.id), await deliveredFor(cadet.id)];
  const owed = sum(delivered);
  const missing = 250_00;

  await openDetail(page, cadet.id);
  const input = page.getByTestId("received-input");
  const button = page.getByTestId("confirm-settlement");

  await input.fill(formatPesosInput(owed + 100));
  await expect(page.getByTestId("diff-line")).toContainText("No puede ser más que lo que debe rendir");
  await expect(button).toBeDisabled();

  await input.fill(formatPesosInput(owed - missing));
  await expect(page.getByTestId("diff-line")).toContainText(/Faltan\s+\$\s*250/);
  await expect(page.getByTestId("quick-note")).toHaveCount(5);
  await expect(button).toBeDisabled();
  await expect(page.getByTestId("confirm-reason")).toContainText("nota");
  await page.getByTestId("note-input").fill("ab");
  await expect(button).toBeDisabled();
  await page.getByTestId("note-input").fill("");
  await page.getByRole("button", { name: "Gastó en nafta" }).click();
  await expect(page.getByTestId("note-input")).toHaveValue("Gastó en nafta");
  await expect(button).toBeEnabled();
  await shot(page, "rendicion-shortage");

  await button.click();
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog.getByTestId("confirm-shortage")).toHaveText(/\$\s*250/);
  await expect(dialog.getByTestId("confirm-note")).toContainText("Gastó en nafta");
  await shotViewport(page, "rendicion-confirm-shortage");
  await dialog.getByTestId("confirm-yes").click();
  await expect(page.getByTestId("receipt-title")).toBeVisible();
  await expect(page.getByTestId("receipt-shortage")).toHaveText(/\$\s*250/);

  const [st] = await settlementsOf(cadet.id);
  expect(st).toMatchObject({ amount: owed, receivedAmount: owed - missing, note: "Gastó en nafta" });
  for (const r of await ordersOf(cadet.id)) expect(r.paymentStatus).toBe("paid");

  await expect(page.getByTestId("history-shortage")).toBeVisible();
  await page.getByTestId("back-after-settle").click();
  await expect(page.getByTestId("rendicion-list")).toBeVisible();
  await expect(cadetCard(page, cadet.id).getByTestId("cadet-shortage")).toContainText(/Faltantes acumulados\s+\$\s*250/);
});

test("race: stale second confirm gets a Spanish message and no second settlement", async ({ page, browser }) => {
  const cadet = await newCadet(`Carrera ${tag()}`);
  await deliveredFor(cadet.id);
  await deliveredFor(cadet.id);

  const admin = await browser.newContext({ storageState: authFile("admin") });
  try {
    // The stale tab never hears about the settlement: its live stream is cut.
    await admin.route("**/api/events", (r) => r.abort());
    const stale = await admin.newPage();
    await stale.goto(`/delivery/rendicion?cadet=${cadet.id}`);
    await expect(stale.getByTestId("cadet-detail")).toBeVisible();
    await stale.getByTestId("confirm-settlement").click();
    await expect(stale.getByTestId("confirm-dialog")).toBeVisible();

    await openDetail(page, cadet.id);
    await page.getByTestId("confirm-settlement").click();
    await page.getByTestId("confirm-yes").click();
    await expect(page.getByTestId("receipt-title")).toBeVisible();

    await stale.getByTestId("confirm-yes").click();
    await expect(stale.getByTestId("mismatch-banner")).toContainText("ya fue rendido");
    await expect(stale.getByTestId("confirm-dialog")).toHaveCount(0);
    expect((await settlementsOf(cadet.id)).length).toBe(1);
  } finally {
    await admin.close();
  }
});

test("race: a new delivery while the dialog is open closes it, shows the mismatch banner and resets the input", async ({ page }) => {
  const cadet = await newCadet(`Llega ${tag()}`);
  const first = await deliveredFor(cadet.id);
  await openDetail(page, cadet.id);
  await page.getByTestId("confirm-settlement").click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();

  const second = await deliveredFor(cadet.id);
  const now = first.total + second.total;
  await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
  const banner = page.getByTestId("mismatch-banner");
  await expect(banner).toContainText("El saldo cambió");
  await expect(banner).toContainText(formatARS(first.total));
  await expect(banner).toContainText(formatARS(now));
  await expect(page.getByTestId("received-input")).toHaveValue(formatPesosInput(now));
  await expect(page.getByTestId("owed-amount")).toHaveText(formatARS(now));
  await shot(page, "rendicion-mismatch-banner");
  expect((await settlementsOf(cadet.id)).length).toBe(0);
});

test("double click on 'Sí, confirmar' settles once", async ({ page }) => {
  const cadet = await newCadet(`Doble ${tag()}`);
  await deliveredFor(cadet.id);
  await openDetail(page, cadet.id);
  await page.getByTestId("confirm-settlement").click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  // Two clicks in the same frame, before React could disable the button.
  await page.getByTestId("confirm-yes").evaluate((el) => {
    (el as HTMLButtonElement).click();
    (el as HTMLButtonElement).click();
  });
  await expect(page.getByTestId("receipt-title")).toBeVisible();
  expect((await settlementsOf(cadet.id)).length).toBe(1);
  const lines = await db()
    .select()
    .from(s.settlementOrders)
    .innerJoin(s.settlements, and(eq(s.settlements.id, s.settlementOrders.settlementId), eq(s.settlements.cadetId, cadet.id)));
  expect(lines.length).toBe(1);
});

test("unknown or invalid cadet shows a friendly state inside the shell", async ({ page }) => {
  for (const q of ["999999", "abc", "0", "99999999999"]) {
    const res = await page.goto(`/delivery/rendicion?cadet=${q}`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.getByTestId("cadet-not-found")).toBeVisible();
    await expect(page.getByTestId("station-name")).toBeVisible();
  }
});
