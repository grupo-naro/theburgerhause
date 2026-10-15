import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { AuthUser, Role } from "@/lib/auth/roles";

// Hash of a throwaway password, produced with the same scrypt parameters as real
// ones. Verifying against it for unknown users keeps response time comparable.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-for-timing-parity");
  return dummyHash;
}

/** Null for unknown user, wrong password or inactive user (indistinguishable to callers). */
export async function authenticate(
  db: Db,
  { username, password }: { username: string; password: string },
): Promise<AuthUser | null> {
  try {
    const [row] = await db
      .select()
      .from(users)
      .where(and(sql`lower(${users.username}) = ${username.trim().toLowerCase()}`, eq(users.active, true)));
    const ok = await verifyPassword(password, row ? row.passwordHash : await getDummyHash());
    if (!row || !ok) return null;
    return { id: row.id, name: row.name, username: row.username, role: row.role };
  } catch {
    return null;
  }
}

const ROLE_HOME: Record<Role, string> = {
  admin: "/admin",
  cajera: "/caja",
  encargada_delivery: "/despacho",
};

export function roleHome(role: Role): string {
  return ROLE_HOME[role];
}

/** Only same-origin absolute paths; anything else (and /login itself) yields `fallback`. */
export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  if (raw === "/login" || /^\/login(?:[/?#]|$)/.test(raw)) return fallback;
  return raw;
}
