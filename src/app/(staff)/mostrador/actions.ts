"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession } from "@/lib/auth/roles";
import { counterClientSchema } from "@/lib/orders/counter-schemas";
import {
  createCounterOrder,
  type CreateCounterOrderData,
  type CreateCounterOrderFailure,
} from "@/lib/orders/create-counter-order";
import { pgErrorCode } from "@/lib/orders/create-order";
import { listActivePagers, type ActivePager } from "@/lib/orders/pagers";
import { fieldErrorsOf } from "@/lib/orders/schemas";

/**
 * Counter-sale Server Actions: thin wrappers. They are PUBLIC endpoints, so each one:
 *  1. authorizes first (`requireRole`), 2. re-validates the client payload with zod (unknown keys
 *  are stripped: `userId`/`stationId` can only come from the verified session), 3. calls the core
 *  and returns a serializable result. Expected failures are returned, never thrown; unexpected
 *  ones become a fixed generic message. No cache invalidation: staff pages are dynamic and the
 *  SSE event drives the refresh.
 *
 * Roles: `cajera` and `admin` sell at the counter. `encargada_delivery` is excluded on purpose:
 * she dispatches delivery orders and does not operate the till, so she must not be able to
 * register paid sales or consume pager numbers.
 */

export type CounterActionFailure = {
  ok: false;
  code: CreateCounterOrderFailure["code"] | "FORBIDDEN";
  message: string;
  fieldErrors?: Record<string, string>;
  unitIssues?: CreateCounterOrderFailure["unitIssues"];
};
export type CounterActionResult<T> = { ok: true; data: T } | CounterActionFailure;

const GENERIC_ERROR = "No se pudo completar la acción. Probá de nuevo.";
const FORBIDDEN_MESSAGE = "No tenés permisos para realizar esta acción.";
const INVALID_REQUEST = "Revisá los datos de la venta";

type Authorized = { session: AuthSession } | { result: CounterActionFailure };

/** UNAUTHENTICATED -> /login; FORBIDDEN -> generic error result. */
async function authorize(): Promise<Authorized> {
  try {
    return { session: await requireRole("cajera", "admin") };
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.code === "UNAUTHENTICATED") redirect("/login");
      return { result: { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE } };
    }
    throw e;
  }
}

const unexpected = (e: unknown): CounterActionFailure => {
  console.error("[mostrador] action failed", pgErrorCode(e) ?? "");
  return { ok: false, code: "UNEXPECTED", message: GENERIC_ERROR };
};

export async function createCounterOrderAction(input: unknown): Promise<CounterActionResult<CreateCounterOrderData>> {
  const auth = await authorize();
  if ("result" in auth) return auth.result;
  const parsed = counterClientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION", message: INVALID_REQUEST, fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const { session } = auth;
  try {
    const r = await createCounterOrder(getDb(), {
      ...parsed.data,
      userId: session.user.id,
      stationId: session.stationId,
    });
    return r;
  } catch (e) {
    return unexpected(e);
  }
}

export async function listActivePagersAction(): Promise<CounterActionResult<ActivePager[]>> {
  const auth = await authorize();
  if ("result" in auth) return auth.result;
  try {
    return { ok: true, data: await listActivePagers(getDb()) };
  } catch (e) {
    return unexpected(e);
  }
}
