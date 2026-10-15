import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import type { AuthSession } from "@/lib/auth/roles";
import { validateSessionToken } from "@/lib/auth/session-store";

export const SESSION_COOKIE = "bh_session";

/** Thin Next glue: all session logic lives in session-store.ts. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function getSession(): Promise<AuthSession | null> {
  const token = await getSessionToken();
  if (!token) return null;
  return validateSessionToken(getDb(), token);
}
