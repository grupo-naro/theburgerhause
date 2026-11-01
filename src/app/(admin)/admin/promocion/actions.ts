"use server";

import { getDb } from "@/db/client";
import { GENERIC_ACTION_ERROR, toState } from "@/lib/admin/action-helpers";
import { authorizeAdmin, type ActionState } from "@/lib/menu/action-state";
import { savePromo } from "@/lib/promo/admin";
import { invalidatePromo } from "@/lib/promo/cache";
import { promoFromForm } from "@/lib/promo/form-data";

/** Thin wrapper: authorize -> parse FormData -> core (zod inside) -> refresh the admin page. */
export async function savePromoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeAdmin();
  if ("state" in auth) return auth.state;
  let result;
  try {
    result = await savePromo(getDb(), promoFromForm(fd));
  } catch {
    return { error: GENERIC_ACTION_ERROR };
  }
  if (!result.ok) return toState(result, fd);
  invalidatePromo();
  return { message: "Promoción guardada" };
}
