import type { AuthSession } from "@/lib/auth/roles";
import { authorizeAdmin, authorizeManager, type ActionState } from "@/lib/menu/action-state";
import { rawValues } from "@/lib/menu/form-data";
import type { Result } from "@/lib/menu/admin";

/**
 * Shared plumbing for admin Server Action wrappers (cadets, users, stations,
 * settings). Lives outside any "use server" file because those may only export
 * async actions.
 */

export const GENERIC_ACTION_ERROR = "No se pudo completar la acción. Probá de nuevo.";

/** Failed core result -> action state. `omit` drops fields (e.g. passwords) from the echoed values. */
export function toState(result: Result<unknown>, fd?: FormData, omit: string[] = []): ActionState {
  if (result.ok) return {};
  let values: Record<string, string> | undefined;
  if (fd) {
    values = rawValues(fd);
    for (const k of omit) delete values[k];
  }
  return { error: result.error, fieldErrors: result.fieldErrors, values };
}

/**
 * One-button actions: authorize FIRST, then run; a null `run()` means the
 * (untrusted) input was malformed. Unexpected throws become a fixed generic
 * message (nothing from the exception reaches the client or the log).
 */
export async function quick(
  run: (session: AuthSession) => Promise<Result<unknown>> | null,
  onSuccess: () => void,
  zone: "admin" | "manager" = "admin",
): Promise<ActionState> {
  const auth = await (zone === "manager" ? authorizeManager() : authorizeAdmin());
  if ("state" in auth) return auth.state;
  const pending = run(auth.session);
  if (!pending) return { error: "Solicitud inválida." };
  let result: Result<unknown>;
  try {
    result = await pending;
  } catch {
    return { error: GENERIC_ACTION_ERROR };
  }
  if (!result.ok) return toState(result);
  onSuccess();
  return {};
}
