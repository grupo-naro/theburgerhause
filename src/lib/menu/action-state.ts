import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession } from "@/lib/auth/roles";

/** State shape shared by every admin Server Action (`useActionState`). */
export type ActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Submitted raw values, so a failed form can repopulate its fields. */
  values?: Record<string, string>;
};

/**
 * Server Actions are public endpoints: every action authorizes here first.
 * UNAUTHENTICATED redirects to /login; FORBIDDEN returns an error state.
 */
export async function authorizeAdmin(): Promise<{ session: AuthSession } | { state: ActionState }> {
  try {
    return { session: await requireRole("admin") };
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.code === "UNAUTHENTICATED") redirect("/login");
      return { state: { error: "No tenés permisos para realizar esta acción." } };
    }
    throw e;
  }
}
