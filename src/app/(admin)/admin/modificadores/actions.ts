"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { withCostFor } from "@/lib/menu/cost-schema";
import { authorizeManager, type ActionState } from "@/lib/menu/action-state";
import { invalidateMenu } from "@/lib/menu/cache";
import { parseBoolValue, parseDirection, parseId, rawValues } from "@/lib/menu/form-data";
import type { Result } from "@/lib/menu/admin";
import { moveModifier, saveModifier, saveModifierGroup, setGroupProducts, setModifierActive } from "@/lib/modifiers/admin";
import { groupFromForm, modifierFromForm, productIdsFromForm } from "@/lib/modifiers/form-data";

/**
 * Thin wrappers: authorize -> parse FormData -> core (zod inside) -> invalidate.
 * Public endpoints: nothing from the form is trusted.
 */

function toState(result: Result<unknown>, fd?: FormData): ActionState {
  if (result.ok) return {};
  return { error: result.error, fieldErrors: result.fieldErrors, values: fd ? rawValues(fd) : undefined };
}

export async function saveModifierGroupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeManager();
  if ("state" in auth) return auth.state;
  const result = await saveModifierGroup(getDb(), groupFromForm(fd));
  if (!result.ok) return toState(result, fd);
  invalidateMenu();
  redirect("/admin/modificadores");
}

export async function saveModifierAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeManager();
  if ("state" in auth) return auth.state;
  const result = await saveModifier(getDb(), withCostFor(auth.session.user.role, modifierFromForm(fd)));
  if (!result.ok) return toState(result, fd);
  invalidateMenu();
  redirect("/admin/modificadores");
}

async function quick(run: () => Promise<Result<unknown>> | null): Promise<ActionState> {
  const auth = await authorizeManager();
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

/** "Productos que lo ofrecen": offers one group on exactly the checked products. */
export async function saveGroupProductsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeManager();
  if ("state" in auth) return auth.state;
  const groupId = Number(fd.get("groupId"));
  const productIds = productIdsFromForm(fd);
  if (!Number.isInteger(groupId) || groupId <= 0 || !productIds) return { error: "Solicitud inválida." };
  const result = await setGroupProducts(getDb(), groupId, productIds);
  if (!result.ok) return { error: result.error ?? "No se pudo guardar." };
  invalidateMenu();
  return { message: "Productos del grupo guardados" };
}
