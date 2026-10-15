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
  if (typeof username !== "string" || typeof password !== "string") return null;
  try {
    const [row] = await db
      .select()
      .from(users)
      .where(and(sql`lower(${users.username}) = ${username.trim().toLowerCase()}`, eq(users.active, true)));
    const ok = await verifyPassword(password, row ? row.passwordHash : await getDummyHash());
    if (!row || !ok) return null;
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
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  if (raw === "/login" || /^\/login(?:[/?#]|$)/.test(raw)) return fallback;
  return raw;
}
