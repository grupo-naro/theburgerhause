export type Role = "admin" | "cajera" | "encargada_delivery";

export type AuthUser = { id: number; name: string; username: string; role: Role };

export type AuthSession = { user: AuthUser; stationId: number | null; sessionId: string };

export class AuthError extends Error {
  readonly code: "UNAUTHENTICATED" | "FORBIDDEN";
  constructor(code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(code === "UNAUTHENTICATED" ? "Authentication required" : "Insufficient role");
    this.name = "AuthError";
    this.code = code;
  }
}

/** Roles are explicit: `admin` is not implicitly allowed everywhere. */
export function assertRole(session: AuthSession | null, roles: Role[]): AuthSession {
  if (!session) throw new AuthError("UNAUTHENTICATED");
  if (!roles.includes(session.user.role)) throw new AuthError("FORBIDDEN");
  return session;
}
