"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import {
  moveCategory,
  moveProduct,
  saveCategory,
  saveProduct,
  setCategoryActive,
  setProductActive,
  setProductFeatured,
  type Result,
} from "@/lib/menu/admin";
import { setProductModifierGroups } from "@/lib/modifiers/admin";
import { groupIdsFromForm } from "@/lib/modifiers/form-data";
import { authorizeManager, type ActionState } from "@/lib/menu/action-state";
import { invalidateMenu } from "@/lib/menu/cache";
import {
  categoryFromForm,
  parseBoolValue,
  parseDirection,
  parseId,
  productFromForm,
  rawValues,
} from "@/lib/menu/form-data";

/**
 * Thin wrappers: authorize -> parse FormData -> core (which validates with zod)
 * -> invalidate the public menu. Every export is a public HTTP endpoint, so
 * nothing from the form is trusted (ids are re-parsed, imagePath re-validated).
 */

function toState(result: Result<unknown>, fd?: FormData): ActionState {
  if (result.ok) return {};
  return { error: result.error, fieldErrors: result.fieldErrors, values: fd ? rawValues(fd) : undefined };
}

export async function saveCategoryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeManager();
  if ("state" in auth) return auth.state;
  const result = await saveCategory(getDb(), categoryFromForm(fd));
  if (!result.ok) return toState(result, fd);
  invalidateMenu();
  redirect("/admin/menu");
}

export async function saveProductAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeManager();
  if ("state" in auth) return auth.state;
  const result = await saveProduct(getDb(), productFromForm(fd));
  if (!result.ok) return toState(result, fd);
  invalidateMenu();
  redirect("/admin/menu");
}

/** Replaces the modifier groups linked to a product (separate form on the product edit page). */
export async function saveProductModifierGroupsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeManager();
  if ("state" in auth) return auth.state;
  const productId = parseId(fd);
  const groupIds = groupIdsFromForm(fd);
  if (!productId || !groupIds) return { error: "Solicitud inválida." };
  let result: Result<null>;
  try {
    result = await setProductModifierGroups(getDb(), productId, groupIds);
  } catch {
    return { error: "No se pudo guardar. Intentá de nuevo." };
  }
  if (!result.ok) return toState(result);
  invalidateMenu();
  return { message: "Grupos guardados" };
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
    // Never leak DB details (or throw to the client) from a quick action.
    return { error: "No se pudo completar la acción. Probá de nuevo." };
  }
  if (!result.ok) return toState(result);
  invalidateMenu();
  return {};
}

export async function moveCategoryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return quick(() => {
    const id = parseId(fd);
    const dir = parseDirection(fd);
    return id && dir ? moveCategory(getDb(), id, dir) : null;
  });
}

export async function moveProductAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return quick(() => {
    const id = parseId(fd);
    const dir = parseDirection(fd);
    return id && dir ? moveProduct(getDb(), id, dir) : null;
  });
}

export async function toggleCategoryActiveAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return quick(() => {
    const id = parseId(fd);
    const value = parseBoolValue(fd);
    return id && value !== null ? setCategoryActive(getDb(), id, value) : null;
  });
}

export async function toggleProductActiveAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return quick(() => {
    const id = parseId(fd);
    const value = parseBoolValue(fd);
    return id && value !== null ? setProductActive(getDb(), id, value) : null;
  });
}

export async function toggleProductFeaturedAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return quick(() => {
    const id = parseId(fd);
    const value = parseBoolValue(fd);
    return id && value !== null ? setProductFeatured(getDb(), id, value) : null;
  });
}
