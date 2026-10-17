"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
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
import { MAX_ASSIGN_ORDERS } from "@/lib/orders/dispatch-schemas";
import { actorRefusal, actorSectorFor, type Sector } from "@/lib/orders/sector";

/**
 * Dispatch Server Actions: thin wrappers. They are PUBLIC endpoints, so each one:
 *  1. authorizes first (`requireRole`), 2. re-validates the client payload with zod (unknown keys
 *  are stripped: `userId` can only come from the verified session), 3. calls the core and returns
 *  a serializable result. Expected failures are returned, never thrown; unexpected ones become a
 *  fixed generic message. No cache invalidation: staff pages are dynamic and the SSE event drives
 *  the refresh.
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

const ORDER_ROLES: Role[] = ["cajera", "encargada_delivery", "admin"];
const ASSIGN_ROLES: Role[] = ["encargada_delivery", "admin"];

const orderId = z.number().int().positive().max(2_147_483_647);
const orderSchema = z.object({ orderId });
const deliveredSchema = z.object({ orderId, collected: z.boolean().optional() });
const returnSchema = z.object({ orderId, reason: z.string() });
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
