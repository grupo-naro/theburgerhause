"use server";

import { redirect } from "next/navigation";
import { z } from "@/lib/zod";
import { getDb } from "@/db/client";
import { invalidateMenu } from "@/lib/menu/cache";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession, type Role } from "@/lib/auth/roles";
import { pgErrorCode } from "@/lib/orders/create-order";
import {
  assignCadet,
  markDelivered,
  markPickup,
  markReady,
  returnToDispatch,
  type AssignCadetData,
  type DispatchFailure,
  type DispatchOrderData,
} from "@/lib/orders/dispatch";
import { cancelOrder, type CancelOrderData } from "@/lib/orders/cancel-order";
import { MAX_ASSIGN_ORDERS } from "@/lib/orders/dispatch-schemas";
import { actorRefusal, actorSectorFor, type Sector } from "@/lib/orders/sector";
import { parseTanda, setOrderTanda, type SetOrderTandaData } from "@/lib/orders/tanda";
import { assignTanda, parseAssignTandaForm, type AssignTandaData } from "@/lib/orders/assign-tanda";

/**
 * Dispatch Server Actions: thin wrappers. They are PUBLIC endpoints, so each one:
 *  1. authorizes first (`requireRole`), 2. re-validates the client payload with zod (unknown keys
 *  are stripped: `userId` can only come from the verified session), 3. calls the core and returns
 *  a serializable result. Expected failures are returned, never thrown; unexpected ones become a
 *  fixed generic message. Staff pages are dynamic and the SSE event drives the refresh; only the
 *  cached menu is invalidated, when a drink's stock pause flips.
 *
 * Roles: the four order-level actions are open to the cashier (she calls takeaway pagers and
 * hands over orders), the delivery manager and the admin. Assigning cadets is `encargada_delivery`
 * and `admin` ONLY: sending cash out with a cadet is a delivery-manager responsibility and the
 * cashier's till is reconciled separately from the cadets' rendicion.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: DispatchFailure["code"] | "FORBIDDEN" | "STATION_REQUIRED"; message: string; details?: DispatchFailure["details"] };

const GENERIC_ERROR = "No se pudo completar la acción. Probá de nuevo.";
const FORBIDDEN_MESSAGE = "No tenés permisos para realizar esta acción.";
const INVALID_REQUEST = "Solicitud inválida";

const ORDER_ROLES: Role[] = ["cajera", "encargada_delivery", "admin", "encargado"];
const ASSIGN_ROLES: Role[] = ["encargada_delivery", "admin", "encargado"];

const orderId = z.number().int().positive().max(2_147_483_647);
const orderSchema = z.object({ orderId });
const deliveredSchema = z.object({ orderId, collected: z.boolean().optional() });
const returnSchema = z.object({ orderId, reason: z.string() });
const cancelSchema = z.object({ orderId, reason: z.string() });
const assignSchema = z.object({
  orderIds: z.array(orderId).min(1).max(MAX_ASSIGN_ORDERS),
  cadetId: orderId,
});

type Authorized = { session: AuthSession; sector: Sector | null } | { result: ActionResult<never> };


/** UNAUTHENTICATED -> /login; FORBIDDEN -> generic error result. */
async function authorize(roles: Role[]): Promise<Authorized> {
  try {
    const session = await requireRole(...roles);
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

/** Runs a core call; anything it throws is logged as a fixed string + pg code only. */
async function run<T>(core: () => Promise<{ ok: true; data: T } | DispatchFailure>): Promise<ActionResult<T>> {
  try {
    const r = await core();
    if (r.ok) return { ok: true, data: r.data };
    return r.details
      ? { ok: false, code: r.code, message: r.message, details: r.details }
      : { ok: false, code: r.code, message: r.message };
  } catch (e) {
    console.error("[despacho] action failed", pgErrorCode(e) ?? "");
    return { ok: false, code: "UNEXPECTED", message: GENERIC_ERROR };
  }
}

export async function markReadyAction(input: unknown): Promise<ActionResult<DispatchOrderData>> {
  const auth = await authorize(ORDER_ROLES);
  if ("result" in auth) return auth.result;
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { session, sector } = auth;
  return run(() => markReady(getDb(), { sector, orderId: parsed.data.orderId, userId: session.user.id }));
}

export async function markPickupAction(input: unknown): Promise<ActionResult<DispatchOrderData>> {
  const auth = await authorize(ORDER_ROLES);
  if ("result" in auth) return auth.result;
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { session, sector } = auth;
  return run(() => markPickup(getDb(), { sector, orderId: parsed.data.orderId, userId: session.user.id }));
}

export async function markDeliveredAction(input: unknown): Promise<ActionResult<DispatchOrderData>> {
  const auth = await authorize(ORDER_ROLES);
  if ("result" in auth) return auth.result;
  const parsed = deliveredSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { session, sector } = auth;
  return run(() =>
    markDelivered(getDb(), { sector, orderId: parsed.data.orderId, userId: session.user.id, collected: parsed.data.collected }),
  );
}

export async function returnToDispatchAction(input: unknown): Promise<ActionResult<DispatchOrderData>> {
  const auth = await authorize(ORDER_ROLES);
  if ("result" in auth) return auth.result;
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { session, sector } = auth;
  return run(() =>
    returnToDispatch(getDb(), { sector, orderId: parsed.data.orderId, userId: session.user.id, reason: parsed.data.reason }),
  );
}

/**
 * Cancel / void an order after approval (en_preparacion, listo_despacho, para_retirar) with a mandatory
 * reason. The sector rule decides who: the delivery manager cancels delivery orders, the cashier
 * takeaway and counter ones, admin all of them.
 */
export async function cancelOrderAction(input: unknown): Promise<ActionResult<CancelOrderData>> {
  const auth = await authorize(ORDER_ROLES);
  if ("result" in auth) return auth.result;
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { session, sector } = auth;
  return run(async () => {
    const r = await cancelOrder(getDb(), { sector, orderId: parsed.data.orderId, userId: session.user.id, reason: parsed.data.reason });
    // Returning the drinks lifted a stock pause: the (cached) menu shows the drink again.
    if (r.ok && r.data.menuChanged) invalidateMenu();
    return r.ok ? r : { ok: false as const, code: r.code === "STATION_REQUIRED" ? ("UNEXPECTED" as const) : r.code, message: r.message };
  });
}

export async function assignCadetAction(input: unknown): Promise<ActionResult<AssignCadetData>> {
  const auth = await authorize(ASSIGN_ROLES);
  if ("result" in auth) return auth.result;
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { session, sector } = auth;
  return run(() =>
    assignCadet(getDb(), { sector, orderIds: parsed.data.orderIds, cadetId: parsed.data.cadetId, userId: session.user.id }),
  );
}

/**
 * Writes (or clears, with an empty value) the tanda number of a delivery order. Form action: `(prev, formData)` with
 * `orderId` and `tanda`. Delivery manager, encargado and admin only (the cashier and the kitchen never edit it);
 * the sector rule is applied by the core.
 */
export async function setTandaAction(_prev: unknown, formData: FormData): Promise<ActionResult<SetOrderTandaData>> {
  const auth = await authorize(ASSIGN_ROLES);
  if ("result" in auth) return auth.result;
  const id = orderId.safeParse(Number(formData.get("orderId")));
  if (!id.success) return invalid();
  const raw = formData.get("tanda");
  const tanda = parseTanda(typeof raw === "string" ? raw : raw === null ? null : "x");
  if (!tanda.ok) return { ok: false, code: "VALIDATION", message: tanda.message };
  const { session, sector } = auth;
  return run(async () => {
    const r = await setOrderTanda(getDb(), { orderId: id.data, userId: session.user.id, tanda: tanda.tanda, sector });
    return r.ok ? r : { ok: false as const, code: r.code === "STATION_REQUIRED" ? ("UNEXPECTED" as const) : r.code, message: r.message };
  });
}

export type AssignTandaActionResult =
  | ActionResult<AssignTandaData>
  | { ok: false; code: "CHANGED"; message: string; details: NonNullable<DispatchFailure["details"]> }
  | { ok: false; code: "TANDA_INCOMPLETE"; message: string; ready: number; total: number };

/**
 * Sends a whole tanda out with one cadet. Form action: `(prev, formData)` with `tanda`, one `orderId` per order the
 * screen showed ready in that tanda, `cadetId` and `confirmPartial` ("1" once the person confirmed sending the ready
 * ones of an incomplete tanda). Same roles as the cadet assignment; the core re-checks the tanda in one transaction.
 */
export async function assignTandaAction(_prev: unknown, formData: FormData): Promise<AssignTandaActionResult> {
  const auth = await authorize(ASSIGN_ROLES);
  if ("result" in auth) return auth.result;
  const parsed = parseAssignTandaForm(formData);
  if (!parsed.ok) return invalid();
  const { session, sector } = auth;
  try {
    const r = await assignTanda(getDb(), { ...parsed.data, userId: session.user.id, sector });
    if (r.ok) return { ok: true, data: r.data };
    if (r.code === "TANDA_INCOMPLETE") return { ok: false, code: r.code, message: r.message, ready: r.ready, total: r.total };
    if (r.code === "CHANGED") return { ok: false, code: r.code, message: r.message, details: r.details };
    return r.details ? { ok: false, code: r.code, message: r.message, details: r.details } : { ok: false, code: r.code, message: r.message };
  } catch (e) {
    console.error("[despacho] action failed", pgErrorCode(e) ?? "");
    return { ok: false, code: "UNEXPECTED", message: GENERIC_ERROR };
  }
}
