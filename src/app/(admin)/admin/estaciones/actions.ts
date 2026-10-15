"use server";

import { getDb } from "@/db/client";
import { GENERIC_ACTION_ERROR, toState } from "@/lib/admin/action-helpers";
import { authorizeAdmin, type ActionState } from "@/lib/menu/action-state";
import { parseId } from "@/lib/menu/form-data";
import { createStation, renameStation, rotateStationToken } from "@/lib/stations/admin";
import { invalidateStations } from "@/lib/stations/cache";
import { renameFromForm, stationFromForm } from "@/lib/stations/form-data";

/**
 * Thin wrappers: authorize -> parse FormData -> core (zod inside) -> invalidate.
 *
 * SECURITY: the plain station token exists only in the returned action state
 * (shown once by the page via useActionState). It is never put in a redirect/URL,
 * cookie, cache or log, and error states never contain it.
 */

export type StationActionState = ActionState & {
  /** Plain token, ONLY on a successful create/rotate. */
  token?: string;
  stationName?: string;
};

export async function createStationAction(_prev: StationActionState, fd: FormData): Promise<StationActionState> {
  const auth = await authorizeAdmin();
  if ("state" in auth) return auth.state;
  let result;
  try {
    result = await createStation(getDb(), stationFromForm(fd));
  } catch {
    return { error: GENERIC_ACTION_ERROR };
  }
  if (!result.ok) return toState(result, fd);
  invalidateStations();
  return { token: result.data.token, stationName: result.data.station.name };
}

export async function rotateStationTokenAction(_prev: StationActionState, fd: FormData): Promise<StationActionState> {
  const auth = await authorizeAdmin();
  if ("state" in auth) return auth.state;
  const id = parseId(fd);
  if (!id) return { error: "Solicitud inválida." };
  let result;
  try {
    result = await rotateStationToken(getDb(), id);
  } catch {
    return { error: GENERIC_ACTION_ERROR };
  }
  if (!result.ok) return toState(result);
  invalidateStations();
  return { token: result.data.token };
}

export async function renameStationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeAdmin();
  if ("state" in auth) return auth.state;
  let result;
  try {
    result = await renameStation(getDb(), renameFromForm(fd));
  } catch {
    return { error: GENERIC_ACTION_ERROR };
  }
  if (!result.ok) return toState(result, fd);
  invalidateStations();
  return { message: "Nombre guardado" };
}
