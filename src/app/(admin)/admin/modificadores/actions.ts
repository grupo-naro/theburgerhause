"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { authorizeAdmin, type ActionState } from "@/lib/menu/action-state";
import { invalidateMenu } from "@/lib/menu/cache";
import { parseBoolValue, parseDirection, parseId, rawValues } from "@/lib/menu/form-data";
import type { Result } from "@/lib/menu/admin";
import { moveModifier, saveModifier, saveModifierGroup, setModifierActive } from "@/lib/modifiers/admin";
import { groupFromForm, modifierFromForm } from "@/lib/modifiers/form-data";

/**
 * Thin wrappers: authorize -> parse FormData -> core (zod inside) -> invalidate.
 * Public endpoints: nothing from the form is trusted.
 */

function toState(result: Result<unknown>, fd?: FormData): ActionState {
  if (result.ok) return {};
  return { error: result.error, fieldErrors: result.fieldErrors, values: fd ? rawValues(fd) : undefined };
}

export async function saveModifierGroupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeAdmin();
  if ("state" in auth) return auth.state;
  const result = await saveModifierGroup(getDb(), groupFromForm(fd));
  if (!result.ok) return toState(result, fd);
  invalidateMenu();
  redirect("/admin/modificadores");
}

export async function saveModifierAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeAdmin();
  if ("state" in auth) return auth.state;
  const result = await saveModifier(getDb(), modifierFromForm(fd));
  if (!result.ok) return toState(result, fd);
  invalidateMenu();
  redirect("/admin/modificadores");
}

async function quick(run: () => Promise<Result<unknown>> | null): Promise<ActionState> {
  const auth = await authorizeAdmin();
  if ("state" in auth) return auth.state;
  const pending = run();
  if (!pending) return { error: "Solicitud inválida." };
  let result: Result<unknown>;
  try {
    result = await pending;
  } catch {
    return { error: "No se pudo completar la acción. Probá de nuevo." };
  }
  if (!result.ok) return toState(result);
  invalidateMenu();
  return {};
}

export async function moveModifierAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return quick(() => {
    const id = parseId(fd);
    const dir = parseDirection(fd);
    return id && dir ? moveModifier(getDb(), id, dir) : null;
  });
}

export async function toggleModifierActiveAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return quick(() => {
    const id = parseId(fd);
    const value = parseBoolValue(fd);
    return id && value !== null ? setModifierActive(getDb(), id, value) : null;
  });
}
