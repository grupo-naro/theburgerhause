import { randomBytes } from "node:crypto";
import path from "node:path";
import { closeDb, getDb, type Db, type DbTransaction } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { revokeUserSessions } from "@/lib/auth/session-store";

/**
 * Creates the admin user, or resets the password of the existing one
 * (re-activating it and revoking its sessions). Idempotent; never deletes.
 */
export async function upsertAdmin(
  db: Db | DbTransaction,
  { username, password }: { username: string; password: string },
): Promise<void> {
  const passwordHash = await hashPassword(password);
  const [row] = await db
    .insert(users)
    .values({ name: "Administrador", username, passwordHash, role: "admin" })
    .onConflictDoUpdate({ target: users.username, set: { passwordHash, role: "admin", active: true } })
    .returning({ id: users.id });
  // Old sessions must not survive a credential reset (no-op on first creation).
  await revokeUserSessions(db, row.id);
}

function generatePassword(): string {
  return randomBytes(12).toString("base64url").slice(0, 16);
}

// Run only when executed directly (`pnpm db:seed-admin`), not when imported by tests.
if (process.argv[1] && path.basename(process.argv[1]) === "seed-admin.ts") {
  try {
    process.loadEnvFile?.();
  } catch {
    // no .env file; rely on the existing environment
  }
  const username = process.env.ADMIN_USERNAME || "admin";
  const provided = process.env.ADMIN_PASSWORD;
  const password = provided || generatePassword();
  upsertAdmin(getDb(), { username, password })
    .then(() => {
      console.log(`Admin user "${username}" is ready.`);
      if (!provided) console.log(`Generated password (shown once, store it now): ${password}`);
    })
    .catch((err) => {
      // Never log the error object/message: Drizzle query errors embed the bound
      // params (which include the password hash). Log only fixed text and the pg code.
      let code: string | undefined;
      for (let e: unknown = err; e && !code; e = (e as { cause?: unknown }).cause) {
        const c = (e as { code?: unknown }).code;
        if (typeof c === "string") code = c;
      }
      console.error(code ? `seed-admin failed (code ${code})` : "seed-admin failed");
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
