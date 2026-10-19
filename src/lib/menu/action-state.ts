import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession, type Role } from "@/lib/auth/roles";

/** State shape shared by every admin Server Action (`useActionState`). */
export type ActionState = {
  error?: string;
  /** Success feedback for actions that stay on the page (no redirect). */
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Submitted raw values, so a failed form can repopulate its fields. */
  values?: Record<string, string>;
};

/**
 * Server Actions are public endpoints: every action authorizes here first.
 * UNAUTHENTICATED redirects to /login; FORBIDDEN returns an error state.
 */
async function authorizeRoles(...roles: Role[]): Promise<{ session: AuthSession } | { state: ActionState }> {
  try {
    return { session: await requireRole(...roles) };
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.code === "UNAUTHENTICATED") redirect("/login");
      return { state: { error: "No tenés permisos para realizar esta acción." } };
    }
    throw e;
  }
}

/** Admin-only zones (users, stations, settings). */
export function authorizeAdmin(): Promise<{ session: AuthSession } | { state: ActionState }> {
  return authorizeRoles("admin");
}

/** Zones the encargado shares with the admin (menu, modifiers, cadets). */
export function authorizeManager(): Promise<{ session: AuthSession } | { state: ActionState }> {
  return authorizeRoles("admin", "encargado");
}
