import { describe, expect, it } from "vitest";
import { AuthError, assertRole, type AuthSession, type Role } from "@/lib/auth/roles";

function session(role: Role): AuthSession {
  return { user: { id: 1, name: "N", username: "n", role }, stationId: null, sessionId: "s" };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AuthError);
    return (e as AuthError).code;
  }
  return undefined;
}

describe("assertRole", () => {
  it("throws UNAUTHENTICATED for a null session", () => {
    expect(codeOf(() => assertRole(null, ["admin"]))).toBe("UNAUTHENTICATED");
  });
  it("throws FORBIDDEN when the role is not allowed", () => {
    expect(codeOf(() => assertRole(session("cajera"), ["admin"]))).toBe("FORBIDDEN");
  });
  it("returns the session when the role is allowed", () => {
    const s = session("cajera");
    expect(assertRole(s, ["admin", "cajera"])).toBe(s);
  });
  it("does not implicitly allow admin", () => {
    expect(codeOf(() => assertRole(session("admin"), ["cajera"]))).toBe("FORBIDDEN");
  });
});
