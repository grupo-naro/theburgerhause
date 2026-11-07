"use server";

import { getDb } from "@/db/client";
import { setAnalyticsPin } from "@/lib/analytics/pin";
import { GENERIC_ACTION_ERROR, quick, toState } from "@/lib/admin/action-helpers";
import { authorizeAdmin, type ActionState } from "@/lib/menu/action-state";
import { parseBoolValue } from "@/lib/menu/form-data";
import { saveSettings, setAcceptingOrders } from "@/lib/settings/admin";
import { invalidateSettings } from "@/lib/settings/cache";
import { settingsFromForm } from "@/lib/settings/form-data";

/** Thin wrappers: authorize -> parse FormData -> core (zod inside) -> invalidate. */

export async function saveSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeAdmin();
  if ("state" in auth) return auth.state;
  let result;
  try {
    result = await saveSettings(getDb(), settingsFromForm(fd));
  } catch {
    return { error: GENERIC_ACTION_ERROR };
  }
  if (!result.ok) return toState(result, fd);
  invalidateSettings();
  return { message: "Ajustes guardados" };
}

/** Quick open/closed switch on the page. */
export async function toggleAcceptingOrdersAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return quick(() => {
    const value = parseBoolValue(fd);
    return value === null ? null : setAcceptingOrders(getDb(), value);
  }, invalidateSettings);
}

/** Analytics PIN: separate form; needs the logged-in admin's password. Secrets are never echoed back. */
export async function setAnalyticsPinAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeAdmin();
  if ("state" in auth) return auth.state;
  const str = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v : "";
  };
  let result;
  try {
    result = await setAnalyticsPin(getDb(), auth.session.user.id, { pin: str("pin"), pinConfirm: str("pinConfirm"), password: str("password") });
  } catch {
    return { error: GENERIC_ACTION_ERROR };
  }
  if (!result.ok) return toState(result, fd, ["pin", "pinConfirm", "password"]);
  return { message: "PIN de analíticas guardado" };
}
