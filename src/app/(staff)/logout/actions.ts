"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { clearSessionCookie, getSessionToken } from "@/lib/auth/session";
import { revokeSession } from "@/lib/auth/session-store";

/** Revokes the DB session (so a copied cookie is dead too) and clears the cookie. */
export async function logout(): Promise<void> {
  try {
    const token = await getSessionToken();
    if (token) await revokeSession(getDb(), token);
  } finally {
    await clearSessionCookie();
  }
  redirect("/login");
}
