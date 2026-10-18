import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword, needsRehash, verifyPasswordUniformCost } from "@/lib/auth/password";
import type { AuthUser, Role } from "@/lib/auth/roles";

// Hash of a throwaway password with the CURRENT scrypt parameters; verifyPasswordUniformCost pads the other
// accepted sets so unknown users, current hashes and legacy hashes all cost the same time.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-for-timing-parity");
  return dummyHash;
}

/**
 * Rewrites a hash made with weaker scrypt parameters (see password.ts) now that we hold the plain
 * password. Best effort: a failure never fails the login (the old hash still verifies), and the
 * WHERE on the old hash makes a concurrent password change win.
 */
async function upgradeHash(db: Db, userId: number, stored: string, plain: string): Promise<void> {
  if (!needsRehash(stored)) return;
  try {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(plain) })
      .where(and(eq(users.id, userId), eq(users.passwordHash, stored)));
  } catch {
    console.error("password hash upgrade failed");
  }
}

/** Null for unknown user, wrong password or inactive user (indistinguishable to callers). */
export async function authenticate(
  db: Db,
  { username, password }: { username: string; password: string },
): Promise<AuthUser | null> {
  if (typeof username !== "string" || typeof password !== "string") return null;
  try {
    const [row] = await db
      .select()
      .from(users)
      .where(and(sql`lower(${users.username}) = ${username.trim().toLowerCase()}`, eq(users.active, true)));
    const ok = await verifyPasswordUniformCost(password, row ? row.passwordHash : await getDummyHash());
    if (!row || !ok) return null;
    await upgradeHash(db, row.id, row.passwordHash, password);
    return { id: row.id, name: row.name, username: row.username, role: row.role };
  } catch (err) {
    // Unexpected (DB outage, bug): log fixed text + pg code only, never the error
    // object/message (Drizzle errors embed bound params). Still fail closed.
    let code: string | undefined;
    for (let e: unknown = err, depth = 0; e && !code && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
      const c = (e as { code?: unknown }).code;
      if (typeof c === "string") code = c;
    }
    console.error(code ? `authenticate failed (code ${code})` : "authenticate failed");
    return null;
  }
}

const ROLE_HOME: Record<Role, string> = {
  admin: "/admin",
  cajera: "/mostrador",
  encargada_delivery: "/delivery",
};

export function roleHome(role: Role): string {
  return ROLE_HOME[role];
}

/** Only same-origin absolute paths; anything else (and /login itself) yields `fallback`. */
export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  if (raw === "/login" || /^\/login(?:[/?#]|$)/.test(raw)) return fallback;
  return raw;
}
