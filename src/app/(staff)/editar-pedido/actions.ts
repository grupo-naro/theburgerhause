"use server";

import { redirect } from "next/navigation";
import { z } from "@/lib/zod";
import { getDb } from "@/db/client";
import { invalidateMenu } from "@/lib/menu/cache";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession } from "@/lib/auth/roles";
import {
  addOrderAddon,
  cancelAddon,
  confirmAddon,
  type AddOrderAddonData,
  type ConfirmAddonData,
} from "@/lib/orders/addons";
import { pgErrorCode, type OutOfStockFailure } from "@/lib/orders/create-order";
import { editPendingOrder, type EditPendingOrderData } from "@/lib/orders/order-edit";
import { reprintAddonTicket, type ReprintOrderData } from "@/lib/orders/reprint";
import { idempotencyKeySchema, unitSchema } from "@/lib/orders/schemas";
import { actorRefusal, actorSectorFor, type Sector } from "@/lib/orders/sector";
import type { OrderFailureCode } from "@/lib/orders/transition";

/**
 * Order-edit Server Actions (edit a pending order, add-ons): thin wrappers. They are PUBLIC endpoints, so
 * each one: 1. authorizes first (`requireRole`), 2. re-validates the client payload with zod (unknown keys
 * are stripped: `userId`/`stationId` can only come from the verified session), 3. calls the core and returns
 * a serializable result. Expected failures (including OUT_OF_STOCK, with the products) are returned, never
 * thrown; unexpected ones become a fixed generic message. Staff pages are dynamic and the SSE event drives
 * the refresh; only the cached menu is invalidated, when a drink's stock pause flips.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: OrderFailureCode | "FORBIDDEN"; message: string }
  | { ok: false; code: "OUT_OF_STOCK"; message: string; productIds: number[]; names: string[] };

const GENERIC_ERROR = "No se pudo completar la acción. Probá de nuevo.";
const FORBIDDEN_MESSAGE = "No tenés permisos para realizar esta acción.";
const INVALID_REQUEST = "Solicitud inválida";

const id = z.number().int().positive().max(2_147_483_647);
const unitsSchema = z.array(unitSchema).max(100);
const editSchema = z.object({ orderId: id, removeItemIds: z.array(id).max(200), addUnits: unitsSchema });
const addAddonSchema = z.object({ orderId: id, units: unitsSchema.min(1), idempotencyKey: idempotencyKeySchema });
const confirmSchema = z.object({ addonId: id, paymentVerified: z.boolean() });
const cancelSchema = z.object({ addonId: id, reason: z.string().max(500).optional() });
const reprintSchema = z.object({ orderId: id, addonSeq: z.number().int().positive().max(32_767) });

type Authorized = { session: AuthSession; sector: Sector | null } | { result: ActionResult<never> };

/** UNAUTHENTICATED -> /login; FORBIDDEN -> generic error result. */
async function authorize(): Promise<Authorized> {
  try {
    const session = await requireRole("cajera", "encargada_delivery", "admin", "encargado");
    // Sector rule, server side: staff only act on orders of their station kind (admin exempt).
    const actor = actorSectorFor(session.user.role, session.stationKind);
    return actor.ok ? { session, sector: actor.sector } : { result: actorRefusal(actor.code) };
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.code === "UNAUTHENTICATED") redirect("/login");
      return { result: { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE } };
    }
    throw e;
  }
}

const invalid = (): ActionResult<never> => ({ ok: false, code: "VALIDATION", message: INVALID_REQUEST });

type CoreResult<T> = { ok: true; data: T } | { ok: false; code: OrderFailureCode; message: string } | OutOfStockFailure;

/** Runs a core call; `menuChanged` refreshes the cached menu; anything thrown is logged as a fixed string + pg code only. */
async function run<T>(core: () => Promise<CoreResult<T>>): Promise<ActionResult<T>> {
  try {
    const r = await core();
    if (!r.ok) return r;
    if (typeof r.data === "object" && r.data !== null && "menuChanged" in r.data && r.data.menuChanged === true) invalidateMenu();
    return { ok: true, data: r.data };
  } catch (e) {
    console.error("[editar-pedido] action failed", pgErrorCode(e) ?? "");
    return { ok: false, code: "UNEXPECTED", message: GENERIC_ERROR };
  }
}

export async function editPendingOrderAction(input: unknown): Promise<ActionResult<EditPendingOrderData>> {
  const auth = await authorize();
  if ("result" in auth) return auth.result;
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { session, sector } = auth;
  return run(() => editPendingOrder(getDb(), { ...parsed.data, sector, userId: session.user.id }));
}

export async function addAddonAction(input: unknown): Promise<ActionResult<AddOrderAddonData>> {
  const auth = await authorize();
  if ("result" in auth) return auth.result;
  const parsed = addAddonSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { session, sector } = auth;
  return run(() => addOrderAddon(getDb(), { ...parsed.data, sector, userId: session.user.id }));
}

export async function confirmAddonAction(input: unknown): Promise<ActionResult<ConfirmAddonData>> {
  const auth = await authorize();
  if ("result" in auth) return auth.result;
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { session, sector } = auth;
  return run(() => confirmAddon(getDb(), { ...parsed.data, sector, userId: session.user.id }));
}

export async function cancelAddonAction(input: unknown): Promise<ActionResult<{ addonId: number }>> {
  const auth = await authorize();
  if ("result" in auth) return auth.result;
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { session, sector } = auth;
  return run(() =>
    cancelAddon(getDb(), { addonId: parsed.data.addonId, reason: parsed.data.reason ?? null, sector, userId: session.user.id }),
  );
}

export async function reprintAddonAction(input: unknown): Promise<ActionResult<ReprintOrderData>> {
  const auth = await authorize();
  if ("result" in auth) return auth.result;
  const parsed = reprintSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { session, sector } = auth;
  return run(() =>
    reprintAddonTicket(getDb(), { ...parsed.data, sector, userId: session.user.id, stationId: session.stationId }),
  );
}
