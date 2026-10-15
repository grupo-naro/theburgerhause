"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { quick, toState } from "@/lib/admin/action-helpers";
import { authorizeAdmin, type ActionState } from "@/lib/menu/action-state";
import { parseBoolValue, parseId } from "@/lib/menu/form-data";
import { revokeAllSessionsForUser, saveUser, setUserActive } from "@/lib/users/admin";
import { invalidateUsers } from "@/lib/users/cache";
import { userFromForm } from "@/lib/users/form-data";

/**
 * Thin wrappers: authorize -> parse FormData -> core (zod inside) -> invalidate.
 * The acting admin comes from the verified session, never from the form.
 * Passwords are never echoed back in the action state.
 */

export async function saveUserAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeAdmin();
  if ("state" in auth) return auth.state;
  const result = await saveUser(getDb(), userFromForm(fd), auth.session.user.id);
  if (!result.ok) return toState(result, fd, ["password"]);
  invalidateUsers();
  redirect("/admin/usuarios");
}

export async function toggleUserActiveAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return quick((session) => {
    const id = parseId(fd);
    const value = parseBoolValue(fd);
    return id && value !== null ? setUserActive(getDb(), id, value, session.user.id) : null;
  }, invalidateUsers);
}

export async function revokeSessionsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return quick(() => {
    const id = parseId(fd);
    return id ? revokeAllSessionsForUser(getDb(), id) : null;
  }, invalidateUsers);
}
