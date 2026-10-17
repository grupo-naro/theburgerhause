"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession } from "@/lib/auth/roles";
import { actorRefusal, actorSectorFor, type Sector } from "@/lib/orders/sector";
import { approveOrder, type ApproveOrderData } from "@/lib/orders/approve-order";
import { pgErrorCode } from "@/lib/orders/create-order";
import { rejectOrder, type RejectOrderData } from "@/lib/orders/reject-order";
import { reprintOrder, type ReprintOrderData } from "@/lib/orders/reprint";
import type { OrderFailureCode } from "@/lib/orders/transition";

/**
 * Cashier Server Actions: thin wrappers. They are PUBLIC endpoints, so each one:
 *  1. authorizes first (`requireRole`), 2. re-validates the client payload with zod
 *  (unknown keys are stripped: `userId`/`stationId` can only come from the verified session),
 *  3. calls the core and returns a serializable result. Expected failures are returned, never
 *  thrown; unexpected ones become a fixed generic message. No cache invalidation: staff pages
 *  are dynamic and the SSE event drives the refresh.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: OrderFailureCode | "FORBIDDEN"; message: string };

const GENERIC_ERROR = "No se pudo completar la acción. Probá de nuevo.";
const FORBIDDEN_MESSAGE = "No tenés permisos para realizar esta acción.";
const INVALID_REQUEST = "Solicitud inválida";

const orderId = z.number().int().positive().max(2_147_483_647);
const approveSchema = z.object({ orderId, paymentVerified: z.boolean() });
const rejectSchema = z.object({ orderId, reason: z.string() });
const reprintSchema = z.object({ orderId, which: z.enum(["customer", "delivery", "both"]) });

type Authorized = { session: AuthSession; sector: Sector | null } | { result: ActionResult<never> };


/** UNAUTHENTICATED -> /login; FORBIDDEN -> generic error result. */
async function authorize(): Promise<Authorized> {
  try {
    const session = await requireRole("cajera", "encargada_delivery", "admin");
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
async function run<T>(
  core: () => Promise<{ ok: true; data: T } | { ok: false; code: OrderFailureCode; message: string }>,
): Promise<ActionResult<T>> {
  try {
    const r = await core();
    return r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code, message: r.message };
  } catch (e) {
    console.error("[caja] action failed", pgErrorCode(e) ?? "");
    return { ok: false, code: "UNEXPECTED", message: GENERIC_ERROR };
  }
}

export async function approveOrderAction(
  input: unknown,
): Promise<ActionResult<ApproveOrderData>> {
  const auth = await authorize();
  if ("result" in auth) return auth.result;
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { session, sector } = auth;
  return run(() =>
    approveOrder(getDb(), {
      sector,
      orderId: parsed.data.orderId,
      userId: session.user.id,
      stationId: session.stationId,
      paymentVerified: parsed.data.paymentVerified,
    }),
  );
}

export async function rejectOrderAction(
  input: unknown,
): Promise<ActionResult<RejectOrderData>> {
  const auth = await authorize();
  if ("result" in auth) return auth.result;
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { session, sector } = auth;
  return run(() =>
    rejectOrder(getDb(), { sector, orderId: parsed.data.orderId, userId: session.user.id, reason: parsed.data.reason }),
  );
}

export async function reprintOrderAction(
  input: unknown,
): Promise<ActionResult<ReprintOrderData>> {
  const auth = await authorize();
  if ("result" in auth) return auth.result;
  const parsed = reprintSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const { session, sector } = auth;
  return run(() =>
    reprintOrder(getDb(), {
      sector,
      orderId: parsed.data.orderId,
      userId: session.user.id,
      stationId: session.stationId,
      which: parsed.data.which,
    }),
  );
}
