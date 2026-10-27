"use server";

import { eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { GENERIC_ACTION_ERROR } from "@/lib/admin/action-helpers";
import { authorizeManager } from "@/lib/menu/action-state";
import { invalidateMenu } from "@/lib/menu/cache";
import { parseId, rawValues } from "@/lib/menu/form-data";
import { revalidateStockPages } from "@/lib/stock/cache";
import { formFieldErrors, isUnit, parseOptionalQuantity, type StockActionState } from "@/lib/stock/form";
import { createStockItem, updateStockItem } from "@/lib/stock/items";
import { editMovement, registerConsumo, registerIngreso, setInitialStock } from "@/lib/stock/movements";
import { formatQuantity, parseQuantity, type Unit } from "@/lib/stock/quantity";
import { STOCK_MESSAGES, type StockFailure } from "@/lib/stock/schemas";

/**
 * Thin wrappers: authorize (admin + encargado) -> parse FormData -> stock core (zod inside) ->
 * refresh the stock screens (and the public menu when a drink's stock pause may have flipped).
 * Every export is a public HTTP endpoint: nothing from the form is trusted (ids are re-parsed,
 * quantities are parsed against the unit stored in the database, never the one the form claims).
 */

const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

const failureState = (f: StockFailure, fd: FormData): StockActionState => ({
  error: f.message,
  fieldErrors: formFieldErrors(f.fieldErrors),
  values: rawValues(fd),
});

const invalid = (fd: FormData): StockActionState => ({ error: "Solicitud inválida.", values: rawValues(fd) });

/** The menu only changes when a drink's stock moved (its linked products pause/unpause by stock). */
async function refreshAfterWrite(itemIds: number[]): Promise<void> {
  revalidateStockPages();
  if (itemIds.length === 0) return;
  const drinks = await getDb().select({ id: s.stockItems.id, kind: s.stockItems.kind }).from(s.stockItems).where(inArray(s.stockItems.id, itemIds));
  if (drinks.some((d) => d.kind === "bebida")) invalidateMenu();
}

async function unitOfItem(itemId: number): Promise<{ unit: Unit; name: string } | null> {
  const [row] = await getDb().select({ unit: s.stockItems.unit, name: s.stockItems.name }).from(s.stockItems).where(eq(s.stockItems.id, itemId));
  return row ?? null;
}

/** Runs a stock write; an unexpected throw becomes a fixed generic message. */
async function guarded(run: () => Promise<StockActionState>): Promise<StockActionState> {
  try {
    return await run();
  } catch (e) {
    if ((e as { digest?: unknown } | null)?.digest !== undefined) throw e; // redirect() / notFound() signals
    return { error: GENERIC_ACTION_ERROR };
  }
}

export async function createStockItemAction(_prev: StockActionState, fd: FormData): Promise<StockActionState> {
  const auth = await authorizeManager();
  if ("state" in auth) return auth.state;
  let createdId: number | null = null;
  const state = await guarded(async () => {
    const unitRaw = text(fd, "unit");
    const min = parseOptionalQuantity(text(fd, "minQty"), isUnit(unitRaw) ? unitRaw : "kg");
    if (!min.ok) return { error: min.message, fieldErrors: { minQty: min.message }, values: rawValues(fd) };
    const result = await createStockItem(getDb(), { name: text(fd, "name"), kind: text(fd, "kind"), unit: unitRaw, minQty: min.milli });
    if (!result.ok) return failureState(result, fd);
    createdId = result.data.id;
    revalidateStockPages();
    return {};
  });
  if (createdId !== null) redirect(`/admin/stock/articulos/${createdId}?nuevo=1`);
  return state;
}

export async function updateStockItemAction(_prev: StockActionState, fd: FormData): Promise<StockActionState> {
  const auth = await authorizeManager();
  if ("state" in auth) return auth.state;
  const itemId = parseId(fd);
  if (!itemId) return invalid(fd);
  const state = await guarded(async () => {
    const item = await unitOfItem(itemId);
    if (!item) return { error: STOCK_MESSAGES.ITEM_NOT_FOUND };
    const min = parseOptionalQuantity(text(fd, "minQty"), item.unit);
    if (!min.ok) return { error: min.message, fieldErrors: { minQty: min.message }, values: rawValues(fd) };
    const result = await updateStockItem(getDb(), { itemId, name: text(fd, "name"), minQty: min.milli, active: fd.has("active") });
    if (!result.ok) return failureState(result, fd);
    // Deactivating / reactivating a drink lifts / re-applies its stock pause.
    await refreshAfterWrite([itemId]);
    return {};
  });
  if (!state.error) redirect("/admin/stock/articulos");
  return state;
}

export async function setInitialStockAction(_prev: StockActionState, fd: FormData): Promise<StockActionState> {
  const auth = await authorizeManager();
  if ("state" in auth) return auth.state;
  const itemId = parseId(fd);
  if (!itemId) return invalid(fd);
  const state = await guarded(async () => {
    const item = await unitOfItem(itemId);
    if (!item) return { error: STOCK_MESSAGES.ITEM_NOT_FOUND };
    const qty = parseOptionalQuantity(text(fd, "qty"), item.unit);
    if (!qty.ok) return { error: qty.message, fieldErrors: { qty: qty.message }, values: rawValues(fd) };
    const result = await setInitialStock(getDb(), { itemId, userId: auth.session.user.id, milli: qty.milli });
    if (!result.ok) return failureState(result, fd);
    await refreshAfterWrite([itemId]);
    return {};
  });
  if (!state.error) redirect("/admin/stock");
  return state;
}

export async function registerIngresoAction(_prev: StockActionState, fd: FormData): Promise<StockActionState> {
  const auth = await authorizeManager();
  if ("state" in auth) return auth.state;
  const itemId = Number(text(fd, "itemId"));
  if (!Number.isSafeInteger(itemId) || itemId <= 0) return { error: "Elegí un artículo", fieldErrors: { itemId: "Elegí un artículo" }, values: rawValues(fd) };
  return guarded(async () => {
    const item = await unitOfItem(itemId);
    if (!item) return { error: STOCK_MESSAGES.ITEM_NOT_FOUND, values: rawValues(fd) };
    const qty = parseQuantity(text(fd, "qty"), item.unit);
    if (!qty.ok) return { error: qty.message, fieldErrors: { qty: qty.message }, values: rawValues(fd) };
    const result = await registerIngreso(getDb(), {
      itemId,
      userId: auth.session.user.id,
      milli: qty.milli,
      note: text(fd, "note"),
      idempotencyKey: text(fd, "idempotencyKey"),
    });
    if (!result.ok) return failureState(result, fd);
    await refreshAfterWrite([itemId]);
    return { message: `Ingreso cargado. Saldo de ${item.name}: ${formatQuantity(result.data.quantity, item.unit)}.` };
  });
}

const CONSUMO_PREFIX = "q_";
const MAX_LINES = 500;

export async function registerConsumoAction(_prev: StockActionState, fd: FormData): Promise<StockActionState> {
  const auth = await authorizeManager();
  if ("state" in auth) return auth.state;
  return guarded(async () => {
    const raw = [...fd.entries()].filter(([k, v]) => k.startsWith(CONSUMO_PREFIX) && typeof v === "string" && v.trim() !== "") as [string, string][];
    if (raw.length > MAX_LINES) return invalid(fd);
    const ids = raw.map(([k]) => Number(k.slice(CONSUMO_PREFIX.length)));
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return invalid(fd);
    const items = ids.length > 0 ? await getDb().select({ id: s.stockItems.id, unit: s.stockItems.unit }).from(s.stockItems).where(inArray(s.stockItems.id, ids)) : [];
    const unitById = new Map(items.map((i) => [i.id, i.unit]));
    const fieldErrors: Record<string, string> = {};
    const lines: { itemId: number; milli: number }[] = [];
    raw.forEach(([key, value], i) => {
      const unit = unitById.get(ids[i]);
      if (!unit) {
        fieldErrors[key] = STOCK_MESSAGES.ITEM_NOT_FOUND;
        return;
      }
      const qty = parseOptionalQuantity(value, unit);
      if (!qty.ok) fieldErrors[key] = qty.message;
      else lines.push({ itemId: ids[i], milli: qty.milli });
    });
    if (Object.keys(fieldErrors).length > 0) return { error: "Revisá las cantidades marcadas.", fieldErrors, values: rawValues(fd) };

    const result = await registerConsumo(getDb(), {
      userId: auth.session.user.id,
      businessDate: text(fd, "businessDate"),
      lines,
      idempotencyKey: text(fd, "idempotencyKey"),
      confirmNegative: fd.get("confirmNegative") === "true",
    });
    if (!result.ok) {
      if (result.code === "NEEDS_CONFIRMATION") {
        const names = (result.negatives ?? []).map((n) => n.name).join(", ");
        return { error: `${STOCK_MESSAGES.NEGATIVE} (${names})`, needsConfirm: true, values: rawValues(fd) };
      }
      return failureState(result, fd);
    }
    await refreshAfterWrite(lines.filter((l) => l.milli > 0).map((l) => l.itemId));
    return { message: "Consumo guardado." };
  });
}

export async function editMovementAction(_prev: StockActionState, fd: FormData): Promise<StockActionState> {
  const auth = await authorizeManager();
  if ("state" in auth) return auth.state;
  const movementId = Number(text(fd, "movementId"));
  if (!Number.isSafeInteger(movementId) || movementId <= 0) return invalid(fd);
  return guarded(async () => {
    const [m] = await getDb()
      .select({ itemId: s.stockMovements.itemId, unit: s.stockItems.unit })
      .from(s.stockMovements)
      .innerJoin(s.stockItems, eq(s.stockItems.id, s.stockMovements.itemId))
      .where(eq(s.stockMovements.id, movementId));
    if (!m) return { error: STOCK_MESSAGES.MOVEMENT_NOT_FOUND };
    const qty = parseOptionalQuantity(text(fd, "qty"), m.unit);
    if (!qty.ok) return { error: qty.message, fieldErrors: { qty: qty.message }, values: rawValues(fd) };
    const result = await editMovement(getDb(), {
      movementId,
      userId: auth.session.user.id,
      newMilli: qty.milli,
      confirmNegative: fd.get("confirmNegative") === "true",
    });
    if (!result.ok) return failureState(result, fd);
    if (result.data.needsConfirmation) {
      const after = formatQuantity(result.data.needsConfirmation.resultingQuantity, m.unit);
      return { error: `Esto deja el stock en ${after}. Confirmá para guardar igual.`, needsConfirm: true, values: rawValues(fd) };
    }
    await refreshAfterWrite([m.itemId]);
    return { message: "Movimiento corregido." };
  });
}
