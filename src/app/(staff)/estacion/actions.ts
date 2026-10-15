"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { roleHome, safeNextPath } from "@/lib/auth/login";
import { getSessionToken } from "@/lib/auth/session";
import { setSessionStation } from "@/lib/auth/session-store";
import { setStationCookie } from "@/lib/auth/station-cookie";
import { findStation } from "@/lib/stations";

export async function selectStation(formData: FormData): Promise<void> {
  const session = await requireSessionOrRedirect(["admin", "cajera", "encargada_delivery"], "/estacion");
  const id = z.coerce.number().int().positive().safeParse(formData.get("stationId"));
  const rawNext = formData.get("next");
  const next = typeof rawNext === "string" ? safeNextPath(rawNext, "") : "";
  const back = next ? `/estacion?next=${encodeURIComponent(next)}` : "/estacion";
  if (!id.success) redirect(back);

  const db = getDb();
  const station = await findStation(db, id.data);
  const token = await getSessionToken();
  if (!station || !token) redirect(back);

  await setSessionStation(db, token, station.id);
  await setStationCookie(station.id);
  redirect(safeNextPath(next, roleHome(session.user.role)));
}
