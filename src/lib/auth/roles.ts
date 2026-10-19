export type Role = "admin" | "cajera" | "encargada_delivery" | "cocina" | "encargado";

/** Managers (admin, encargado) act in every sector and need no station. Shared access decisions use this. */
export function isManager(role: Role): boolean {
  return role === "admin" || role === "encargado";
}

export type AuthUser = { id: number; name: string; username: string; role: Role };

/** `stationKind` is the kind of the session station (null without one): it decides the staff sector. */
export type AuthSession = { user: AuthUser; stationId: number | null; stationKind: "mostrador" | "delivery" | null; sessionId: string };

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
