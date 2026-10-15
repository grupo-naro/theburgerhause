import { redirect } from "next/navigation";
import { roleHome } from "@/lib/auth/login";
import type { AuthSession, Role } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";

function withNext(base: string, next?: string): string {
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

/**
 * Page-level guard (the real check; the proxy is only optimistic). No session ->
 * /login; wrong role -> that role's home. Uses redirect() rather than forbidden():
 * forbidden() is still experimental (needs experimental.authInterrupts).
 */
export async function requireSessionOrRedirect(roles: Role[], next?: string): Promise<AuthSession> {
  const session = await getSession();
  if (!session) redirect(withNext("/login", next));
  if (!roles.includes(session.user.role)) redirect(roleHome(session.user.role));
  return session;
}

/** Terminals must know their station; send them to pick one if the session has none. */
export function requireStationOrRedirect(session: AuthSession, next?: string): number {
  if (session.stationId === null) redirect(withNext("/estacion", next));
  return session.stationId;
}
