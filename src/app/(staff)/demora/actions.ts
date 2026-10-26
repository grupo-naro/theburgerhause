"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession } from "@/lib/auth/roles";
import { activateDelay, deactivateDelay, type ActiveDelay } from "@/lib/delay/notices";
import { pgErrorCode } from "@/lib/orders/create-order";

/**
 * Manual delay Server Actions: PUBLIC endpoints, so each one authorizes first (`requireRole`), then lets the
 * core re-validate the payload with zod (userId only ever comes from the verified session). Not order-sector
 * actions: any staff role may announce a delay. The banner is uncached and the delay channel drives the refresh.
 */

export type DelayActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: "FORBIDDEN" | "VALIDATION" | "UNEXPECTED"; message: string; fieldErrors?: Record<string, string> };

const GENERIC_ERROR = "No se pudo completar la acción. Probá de nuevo.";
const FORBIDDEN_MESSAGE = "No tenés permisos para realizar esta acción.";

type Authorized = { session: AuthSession } | { result: DelayActionResult<never> };

/** UNAUTHENTICATED -> /login; FORBIDDEN -> generic error result. */
async function authorize(): Promise<Authorized> {
  try {
    return { session: await requireRole("cajera", "encargada_delivery", "admin", "encargado") };
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.code === "UNAUTHENTICATED") redirect("/login");
      return { result: { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE } };
    }
    throw e;
  }
}

export async function activateDelayAction(input: unknown): Promise<DelayActionResult<ActiveDelay>> {
  const auth = await authorize();
  if ("result" in auth) return auth.result;
  try {
    const r = await activateDelay(getDb(), auth.session.user.id, input);
    if (r.ok) return { ok: true, data: r.data };
    return { ok: false, code: "VALIDATION", message: r.error ?? "Revisá los datos de la demora.", fieldErrors: r.fieldErrors };
  } catch (e) {
    console.error("[demora] activate failed", pgErrorCode(e) ?? "");
    return { ok: false, code: "UNEXPECTED", message: GENERIC_ERROR };
  }
}

export async function deactivateDelayAction(): Promise<DelayActionResult<{ wasActive: boolean }>> {
  const auth = await authorize();
  if ("result" in auth) return auth.result;
  try {
    const r = await deactivateDelay(getDb(), auth.session.user.id);
    return r.ok ? { ok: true, data: r.data } : { ok: false, code: "UNEXPECTED", message: GENERIC_ERROR };
  } catch (e) {
    console.error("[demora] deactivate failed", pgErrorCode(e) ?? "");
    return { ok: false, code: "UNEXPECTED", message: GENERIC_ERROR };
  }
}
