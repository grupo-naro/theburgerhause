import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/menu/cache", () => ({ MENU_CACHE_TAG: "menu", invalidateMenu: vi.fn() }));
vi.mock("@/lib/stock/cache", () => ({ revalidateStockPages: vi.fn(), revalidateAdminShell: vi.fn() }));

import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession, type Role } from "@/lib/auth/roles";
import { invalidateMenu } from "@/lib/menu/cache";
import { revalidateAdminShell } from "@/lib/stock/cache";
import { consume, itemQty, key, movementsOf, productFlags, seedStock, type StockFx } from "@/lib/stock/test-fixtures";
import { form, redirectOf } from "@/test-support/next-mocks";
import {
  closeStockDayAction,
  createStockItemAction,
  editMovementAction,
  registerIngresoAction,
  setInitialStockAction,
  updateStockItemAction,
} from "./actions";

const session = (id: number, role: Role): AuthSession => ({ user: { id, name: "U", username: "u", role }, stationId: null, stationKind: null, sessionId: "x" });
const as = (id: number, role: Role) => vi.mocked(requireRole).mockResolvedValue(session(id, role));
const refuse = () => vi.mocked(requireRole).mockRejectedValue(new AuthError("FORBIDDEN"));
const anonymous = () => vi.mocked(requireRole).mockRejectedValue(new AuthError("UNAUTHENTICATED"));
const prev = {};

let fx: StockFx;
beforeEach(async () => {
  await resetDb();
  fx = await seedStock();
  vi.clearAllMocks();
});
afterAll(closeDb);

describe("authorization", () => {
  const calls: [string, () => Promise<unknown>][] = [
    ["createStockItemAction", () => createStockItemAction(prev, form({ name: "X", kind: "materia_prima", unit: "kg" }))],
    ["updateStockItemAction", () => updateStockItemAction(prev, form({ id: "1", name: "X" }))],
    ["setInitialStockAction", () => setInitialStockAction(prev, form({ id: "1", qty: "5" }))],
    ["registerIngresoAction", () => registerIngresoAction(prev, form({ itemId: "1", qty: "5", idempotencyKey: key(1) }))],
    ["closeStockDayAction", () => closeStockDayAction(prev, form({ q_1: "5", businessDate: "2026-10-19", idempotencyKey: key(2) }))],
    ["editMovementAction", () => editMovementAction(prev, form({ movementId: "1", qty: "5" }))],
  ];

  it.each(calls)("%s: cajera is refused and nothing is written", async (_n, run) => {
    refuse();
    const r = (await run()) as { error?: string };
    expect(r.error).toBeTruthy();
    expect(await testDb().select().from(s.stockMovements)).toHaveLength(0);
    expect(await testDb().select().from(s.stockClosings)).toHaveLength(0);
    expect(invalidateMenu).not.toHaveBeenCalled();
  });

  it.each(calls)("%s: anonymous is sent to /login", async (_n, run) => {
    anonymous();
    expect(await redirectOf(run())).toBe("/login");
  });
});

describe("encargado flow", () => {
  it("creates an item and lands on its page; duplicate names are a field error", async () => {
    as(fx.userId, "encargado");
    const to = await redirectOf(createStockItemAction(prev, form({ name: "Pan de papa", kind: "materia_prima", unit: "u", minQty: "24" })));
    const [row] = await testDb().select().from(s.stockItems).where(eq(s.stockItems.name, "Pan de papa"));
    expect(to).toBe(`/admin/stock/articulos/${row.id}?nuevo=1`);
    expect(row).toMatchObject({ unit: "u", minQty: 24000, quantity: 0 });
    const dup = await createStockItemAction(prev, form({ name: "pan de papa", kind: "materia_prima", unit: "u" }));
    expect(dup.fieldErrors?.name).toBe("Ya existe un artículo con ese nombre");
    const bad = await createStockItemAction(prev, form({ name: "Sal", kind: "materia_prima", unit: "u", minQty: "1,5" }));
    expect(bad.fieldErrors?.minQty).toBe("Para unidades usá números enteros");
  });

  it("initial stock, ingreso with decimal comma and the rendición update the balance; a drink refreshes the menu", async () => {
    as(fx.userId, "encargado");
    await redirectOf(setInitialStockAction(prev, form({ id: String(fx.carne), qty: "60" })));
    expect(await itemQty(fx.carne)).toBe(60000);

    const ing = await registerIngresoAction(prev, form({ itemId: String(fx.coca), qty: "48", note: "Proveedor", idempotencyKey: key(10) }));
    expect(ing.message).toBe("Ingreso cargado. Saldo de Coca-Cola 500 ml: 48 u.");
    expect(invalidateMenu).toHaveBeenCalledTimes(1);

    vi.mocked(invalidateMenu).mockClear();
    const con = await closeStockDayAction(prev, form({ [`q_${fx.carne}`]: "12,5", businessDate: "2026-10-19", idempotencyKey: key(11) }));
    expect(con.message).toBe("Rendición del lunes 19/10/2026 cerrada.");
    expect(await itemQty(fx.carne)).toBe(47500);
    expect(invalidateMenu).not.toHaveBeenCalled(); // raw material never touches the menu
    expect(revalidateAdminShell).toHaveBeenCalledTimes(1); // the shell's reminder
  });

  it("parses quantities with the unit stored in the database, not the form", async () => {
    as(fx.userId, "encargado");
    const r = await registerIngresoAction(prev, form({ itemId: String(fx.coca), qty: "1,5", unit: "kg", idempotencyKey: key(12) }));
    expect(r.fieldErrors?.qty).toBe("Para unidades usá números enteros");
    expect(await movementsOf(fx.coca)).toHaveLength(0);
  });

  it("a double submit of the rendición (same key) closes ONCE; another key for the same day and the key on another day are refused", async () => {
    as(fx.userId, "admin");
    const fd = () => form({ [`q_${fx.carne}`]: "2", businessDate: "2026-10-19", idempotencyKey: key(13), confirmNegative: "true" });
    const both = await Promise.all([closeStockDayAction(prev, fd()), closeStockDayAction(prev, fd())]);
    for (const r of both) expect(r.message).toBe("Rendición del lunes 19/10/2026 cerrada.");
    expect(await movementsOf(fx.carne)).toHaveLength(1);
    expect(await testDb().select().from(s.stockClosings)).toHaveLength(1);
    const again = await closeStockDayAction(prev, form({ [`q_${fx.carne}`]: "3", businessDate: "2026-10-19", idempotencyKey: key(20), confirmNegative: "true" }));
    expect(again.error).toBe("La rendición de ese día ya está cerrada. Para corregirla usá el Historial.");
    expect(again.fieldErrors?.businessDate).toBeTruthy();
    const reused = await closeStockDayAction(prev, form({ [`q_${fx.carne}`]: "2", businessDate: "2026-10-18", idempotencyKey: key(13), confirmNegative: "true" }));
    expect(reused.error).toContain("otros datos");
    expect(await movementsOf(fx.carne)).toHaveLength(1);
  });

  it("refuses an empty rendición, a bad quantity, a drink and a future day", async () => {
    as(fx.userId, "encargado");
    expect((await closeStockDayAction(prev, form({ [`q_${fx.carne}`]: "", businessDate: "2026-10-19", idempotencyKey: key(21) }))).error).toBe("Cargá al menos una cantidad");
    expect((await closeStockDayAction(prev, form({ [`q_${fx.carne}`]: "0", businessDate: "2026-10-19", idempotencyKey: key(22) }))).error).toBe("Cargá al menos una cantidad");
    const bad = await closeStockDayAction(prev, form({ [`q_${fx.carne}`]: "1,2,3", businessDate: "2026-10-19", idempotencyKey: key(23) }));
    expect(bad.fieldErrors?.[`q_${fx.carne}`]).toBeTruthy();
    const drink = await closeStockDayAction(prev, form({ [`q_${fx.coca}`]: "1", businessDate: "2026-10-19", idempotencyKey: key(24), confirmNegative: "true" }));
    expect(drink.error).toBe("Solo se rinde materia prima: Coca-Cola 500 ml");
    const future = await closeStockDayAction(prev, form({ [`q_${fx.carne}`]: "1", businessDate: "2999-01-01", idempotencyKey: key(25) }));
    expect(future.error).toBe("Ese día todavía no llegó: elegí hoy o un día anterior.");
    expect(await testDb().select().from(s.stockMovements)).toHaveLength(0);
    expect(await testDb().select().from(s.stockClosings)).toHaveLength(0);
  });

  it("asks for confirmation before leaving the stock negative, then saves with it", async () => {
    as(fx.userId, "encargado");
    const base = { [`q_${fx.carne}`]: "5", businessDate: "2026-10-19", idempotencyKey: key(14) };
    const ask = await closeStockDayAction(prev, form(base));
    expect(ask.needsConfirm).toBe(true);
    expect(ask.error).toBe("Esto deja el stock en negativo. Confirmá para guardar igual. (Carne picada)");
    expect(await movementsOf(fx.carne)).toHaveLength(0);
    expect(await testDb().select().from(s.stockClosings)).toHaveLength(0);
    const ok = await closeStockDayAction(prev, form({ ...base, confirmNegative: "true" }));
    expect(ok.message).toBe("Rendición del lunes 19/10/2026 cerrada.");
    expect(await itemQty(fx.carne)).toBe(-5000);
  });

  it("edits a movement, keeps the previous value, and asks to confirm when it leaves a negative", async () => {
    as(fx.userId, "encargado");
    await registerIngresoAction(prev, form({ itemId: String(fx.coca), qty: "10", idempotencyKey: key(15) }));
    const [ing] = await movementsOf(fx.coca);
    const ask = await editMovementAction(prev, form({ movementId: String(ing.id), qty: "0" }));
    expect(ask.needsConfirm).toBeUndefined(); // 10 -> 0 stays at zero
    expect(ask.message).toBe("Movimiento corregido.");
    await registerIngresoAction(prev, form({ itemId: String(fx.coca), qty: "5", idempotencyKey: key(17) }));
    await consume(fx.coca, 5000);
    const second = (await movementsOf(fx.coca)).find((m) => m.qtyDelta === 5000)!;
    const neg = await editMovementAction(prev, form({ movementId: String(second.id), qty: "1" }));
    expect(neg.needsConfirm).toBe(true);
    expect(neg.error).toContain("-4 u");
    expect(await itemQty(fx.coca)).toBe(0);
    const done = await editMovementAction(prev, form({ movementId: String(second.id), qty: "1", confirmNegative: "true" }));
    expect(done.message).toBe("Movimiento corregido.");
    expect(await itemQty(fx.coca)).toBe(-4000);
    expect(await productFlags(fx.cocaProduct)).toEqual({ active: true, stockPaused: true });
  });

  it("deactivating a drink refreshes the menu and lifts its pause", async () => {
    as(fx.userId, "encargado");
    await consume(fx.coca, 1000);
    expect((await productFlags(fx.cocaProduct)).stockPaused).toBe(true);
    vi.mocked(invalidateMenu).mockClear();
    await redirectOf(updateStockItemAction(prev, form({ id: String(fx.coca), name: "Coca-Cola 500 ml", minQty: "6" })));
    expect(await productFlags(fx.cocaProduct)).toEqual({ active: true, stockPaused: false });
    expect(invalidateMenu).toHaveBeenCalledTimes(1);
    await redirectOf(updateStockItemAction(prev, form({ id: String(fx.coca), name: "Coca-Cola 500 ml", minQty: "6", active: "on" })));
    expect(await productFlags(fx.cocaProduct)).toEqual({ active: true, stockPaused: true });
    expect(invalidateMenu).toHaveBeenCalledTimes(2);
  });
});
