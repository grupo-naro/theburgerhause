"use server";

import { redirect } from "next/navigation";
import { z } from "@/lib/zod";
import { getDb } from "@/db/client";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type Role } from "@/lib/auth/roles";
import { pgErrorCode } from "@/lib/orders/create-order";
import { markReady, type DispatchFailure, type DispatchOrderData } from "@/lib/orders/dispatch";
import { actorRefusal, kitchenActorSectorFor } from "@/lib/orders/sector";
import { undoReady } from "@/lib/orders/undo-ready";

/**
 * Kitchen screen Server Actions (thin wrappers, PUBLIC endpoints): authorize first (`requireRole`), re-validate the
 * payload (unknown keys stripped: `userId` only comes from the verified session), call the core, return a serializable
 * result. Expected failures are returned, never thrown.
 *
 * Sector rule: the `cocina` role cooks every sector's orders, so it is exempt HERE and only here (`kitchenActorSectorFor`);
 * cashier / delivery manager using the screen keep their own sector, admin is exempt as everywhere.
 */

export type KitchenActionResult =
  | { ok: true; data: DispatchOrderData }
  | { ok: false; code: DispatchFailure["code"] | "FORBIDDEN" | "STATION_REQUIRED" | "NOT_IN_PREPARATION"; message: string };

const GENERIC_ERROR = "No se pudo completar la acción. Probá de nuevo.";
const FORBIDDEN_MESSAGE = "No tenés permisos para realizar esta acción.";
const NOT_IN_PREPARATION_MESSAGE = "Ese pedido ya no está en preparación.";

const KITCHEN_ROLES: Role[] = ["cocina", "cajera", "encargada_delivery", "admin", "encargado"];
const schema = z.object({ orderId: z.number().int().positive().max(2_147_483_647) });

type Authorized = { userId: number; sector: Parameters<typeof markReady>[1]["sector"] } | { result: KitchenActionResult };

async function authorize(): Promise<Authorized> {
  try {
    const session = await requireRole(...KITCHEN_ROLES);
    const actor = kitchenActorSectorFor(session.user.role, session.stationKind);
    return actor.ok ? { userId: session.user.id, sector: actor.sector } : { result: actorRefusal(actor.code) };
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.code === "UNAUTHENTICATED") redirect("/login");
      return { result: { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE } };
    }
    throw e;
  }
}

async function run(core: () => Promise<{ ok: true; data: DispatchOrderData } | DispatchFailure>, friendlyStale: boolean): Promise<KitchenActionResult> {
  try {
    const r = await core();
    if (r.ok) return { ok: true, data: r.data };
    if (friendlyStale && r.code === "INVALID_TRANSITION") return { ok: false, code: "NOT_IN_PREPARATION", message: NOT_IN_PREPARATION_MESSAGE };
    return { ok: false, code: r.code, message: r.message };
  } catch (e) {
    console.error("[cocina] action failed", pgErrorCode(e) ?? "");
    return { ok: false, code: "UNEXPECTED", message: GENERIC_ERROR };
  }
}

const invalid = (): KitchenActionResult => ({ ok: false, code: "VALIDATION", message: "Solicitud inválida" });

/** en_preparacion -> listo_despacho (same core as the "Listo" buttons). A stale card answers a friendly code, not an error. */
export async function kitchenReadyAction(input: unknown): Promise<KitchenActionResult> {
  const auth = await authorize();
  if ("result" in auth) return auth.result;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return invalid();
  return run(() => markReady(getDb(), { sector: auth.sector, orderId: parsed.data.orderId, userId: auth.userId }), true);
}

/** listo_despacho -> en_preparacion while nobody acted on it; the core's message explains a refusal. */
export async function kitchenUndoAction(input: unknown): Promise<KitchenActionResult> {
  const auth = await authorize();
  if ("result" in auth) return auth.result;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return invalid();
  return run(() => undoReady(getDb(), { sector: auth.sector, orderId: parsed.data.orderId, userId: auth.userId }), false);
}
