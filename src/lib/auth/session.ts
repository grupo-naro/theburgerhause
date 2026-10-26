import { cookies } from "next/headers";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import type { AuthSession } from "@/lib/auth/roles";
import { validateSessionToken } from "@/lib/auth/session-store";

export const SESSION_COOKIE = "bh_session";

/** Long browser lifetime; the DB row is the only authority on session expiry (12 h sliding). */
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
/** The counter TV's cookie (`cocina` user): 400 days, the browser maximum, matching its long DB session. */
export const KIOSK_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

/** Thin Next glue: all session logic lives in session-store.ts. `long` is the counter TV's session. */
export async function setSessionCookie(token: string, { long = false }: { long?: boolean } = {}): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: long ? KIOSK_COOKIE_MAX_AGE_SECONDS : COOKIE_MAX_AGE_SECONDS,
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
  // Session validity depends on the current time: opt out of (runtime) prefetch
  // prerendering, which rejects `new Date()`, and validate on the real request.
  await connection();
  return validateSessionToken(getDb(), token);
}
