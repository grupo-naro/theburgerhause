"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { GENERIC_ACTION_ERROR } from "@/lib/admin/action-helpers";
import { lockAnalytics, unlockAnalytics } from "@/lib/analytics/pin";
import { authorizeAdmin, type ActionState } from "@/lib/menu/action-state";

const PATH = "/admin/analiticas";

/** Unlocks the numbers for 15 min on the CALLER's session. The PIN is never echoed back. */
export async function unlockAnalyticsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeAdmin();
  if ("state" in auth) return auth.state;
  const pin = fd.get("pin");
  if (typeof pin !== "string" || pin.length === 0 || pin.length > 6) return { error: "Ingresá el PIN" };
  let result;
  try {
    result = await unlockAnalytics(getDb(), { sessionId: auth.session.sessionId, userId: auth.session.user.id, pin });
  } catch {
    return { error: GENERIC_ACTION_ERROR };
  }
  if (!result.ok) return { error: result.error };
  revalidatePath(PATH);
  return {};
}

/** Takes no input (still binds to ActionButton's `(prev, formData)` signature). */
export async function lockAnalyticsAction(): Promise<ActionState> {
  const auth = await authorizeAdmin();
  if ("state" in auth) return auth.state;
  try {
    await lockAnalytics(getDb(), auth.session.sessionId);
  } catch {
    return { error: GENERIC_ACTION_ERROR };
  }
  revalidatePath(PATH);
  return {};
}
