"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type Role } from "@/lib/auth/roles";
import { pgErrorCode } from "@/lib/orders/create-order";
import { actorRefusal, actorSectorFor, WRONG_SECTOR_MESSAGE } from "@/lib/orders/sector";
import { settleCadetPayloadSchema } from "@/lib/settlements/schemas";
import { settleCadet, type SettleData, type SettleFailure } from "@/lib/settlements/settle-cadet";

/**
 * Cadet settlement (rendicion) Server Action: a thin wrapper over the core. It is a PUBLIC
 * endpoint, so it 1. authorizes first (`requireRole`), 2. re-validates the client payload with
 * zod (unknown keys are stripped: `userId` can only come from the verified session), 3. calls
 * the core and returns a serializable result. Expected failures are returned, never thrown;
 * unexpected ones become a fixed generic message. No cache invalidation: staff pages are dynamic
 * and the SSE `settled` event drives the refresh.
 *
 * Roles: `encargada_delivery` and `admin` ONLY. Counting a cadet's cash and clearing his debt is
 * the delivery manager's responsibility; the cashier's till is reconciled separately and a
 * cashier must not be able to forgive or move a cadet's debt.
 */

export type SettleActionResult =
  | { ok: true; data: SettleData }
  | { ok: false; code: SettleFailure["code"] | "FORBIDDEN" | "WRONG_SECTOR" | "STATION_REQUIRED"; message: string; details?: SettleFailure["details"] };

const GENERIC_ERROR = "No se pudo completar la acción. Probá de nuevo.";
const FORBIDDEN_MESSAGE = "No tenés permisos para realizar esta acción.";
const INVALID_REQUEST = "Solicitud inválida";

const SETTLE_ROLES: Role[] = ["encargada_delivery", "admin"];

export async function settleCadetAction(input: unknown): Promise<SettleActionResult> {
  let userId: number;
  try {
    const session = await requireRole(...SETTLE_ROLES);
    userId = session.user.id;
    // Sector rule, server side: cadet cash belongs to the delivery sector (admin exempt).
    const actor = actorSectorFor(session.user.role, session.stationKind);
    if (!actor.ok) return actorRefusal(actor.code);
    if (actor.sector !== null && actor.sector !== "delivery") return { ok: false, code: "WRONG_SECTOR", message: WRONG_SECTOR_MESSAGE };
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.code === "UNAUTHENTICATED") redirect("/login");
      return { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
    }
    throw e;
  }

  const parsed = settleCadetPayloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION", message: INVALID_REQUEST };

  try {
    const r = await settleCadet(getDb(), { ...parsed.data, userId });
    if (r.ok) return { ok: true, data: r.data };
    return r.details
      ? { ok: false, code: r.code, message: r.message, details: r.details }
      : { ok: false, code: r.code, message: r.message };
  } catch (e) {
    console.error("[rendicion] action failed", pgErrorCode(e) ?? "");
    return { ok: false, code: "UNEXPECTED", message: GENERIC_ERROR };
  }
}
