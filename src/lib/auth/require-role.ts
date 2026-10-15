import { assertRole, type AuthSession, type Role } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";

/** Real authorization point: throws AuthError (UNAUTHENTICATED / FORBIDDEN). */
export async function requireRole(...roles: Role[]): Promise<AuthSession> {
  return assertRole(await getSession(), roles);
}
