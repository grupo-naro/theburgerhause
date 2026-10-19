"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { quick, toState } from "@/lib/admin/action-helpers";
import { saveCadet, setCadetActive } from "@/lib/cadets/admin";
import { invalidateCadets } from "@/lib/cadets/cache";
import { cadetFromForm } from "@/lib/cadets/form-data";
import { authorizeManager, type ActionState } from "@/lib/menu/action-state";
import { parseBoolValue, parseId } from "@/lib/menu/form-data";

/** Thin wrappers: authorize -> parse FormData -> core (zod inside) -> invalidate. */

export async function saveCadetAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeManager();
  if ("state" in auth) return auth.state;
  const result = await saveCadet(getDb(), cadetFromForm(fd));
  if (!result.ok) return toState(result, fd);
  invalidateCadets();
  redirect("/admin/cadetes");
}

export async function toggleCadetActiveAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return quick(() => {
    const id = parseId(fd);
    const value = parseBoolValue(fd);
    return id && value !== null ? setCadetActive(getDb(), id, value) : null;
  }, invalidateCadets, "manager");
}
