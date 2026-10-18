"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "@/lib/zod";
import { getDb } from "@/db/client";
import { authenticate, roleHome, safeNextPath } from "@/lib/auth/login";
import { isLoginBlocked, recordLoginFailure } from "@/lib/auth/login-rate-limit";
import { setSessionCookie } from "@/lib/auth/session";
import { createSession, deleteExpiredSessions, setSessionStation } from "@/lib/auth/session-store";
import { getStationCookie } from "@/lib/auth/station-cookie";
import { WRONG_STATION_REASON } from "@/lib/auth/workspace";
import { clientIp } from "@/lib/client-ip";
import { stationAllowedForRole } from "@/lib/orders/sector";
import { findStation } from "@/lib/stations";

export type LoginState = { error: string | null };

const GENERIC_ERROR = "Usuario o contraseña incorrectos";
const RATE_LIMIT_ERROR = "Demasiados intentos. Probá de nuevo en unos minutos.";

const credentials = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentials.safeParse({ username: formData.get("username"), password: formData.get("password") });
  if (!parsed.success) return { error: GENERIC_ERROR };
  const { username, password } = parsed.data;

  const ip = clientIp(await headers());
  if (isLoginBlocked(ip, username)) return { error: RATE_LIMIT_ERROR };

  const db = getDb();
  const user = await authenticate(db, { username, password });
  if (!user) {
    recordLoginFailure(ip, username);
    return { error: GENERIC_ERROR };
  }

  const rawNext = formData.get("next");
  const next = typeof rawNext === "string" ? rawNext : null;

  const { token } = await createSession(db, { userId: user.id });
  // Housekeeping: expired sessions are dead weight; every login (a few dozen a day) sweeps them. Never blocks a login.
  await deleteExpiredSessions(db).catch(() => console.error("[login] expired session purge failed"));
  await setSessionCookie(token);

  let destination: string;
  if (user.role === "admin" || user.role === "cocina") {
    // Admin and the kitchen device need no station: straight to their home.
    destination = safeNextPath(next, roleHome(user.role));
  } else {
    const stationId = await getStationCookie();
    const station = stationId === null ? null : await findStation(db, stationId);
    if (station && !stationAllowedForRole(user.role, station.kind)) {
      // A device left on the other kind of station: pick again (the page explains why).
      const safe = safeNextPath(next, "");
      destination = `/estacion?${safe ? `next=${encodeURIComponent(safe)}&` : ""}motivo=${WRONG_STATION_REASON}`;
    } else if (station) {
      await setSessionStation(db, token, station.id);
      destination = safeNextPath(next, roleHome(user.role));
    } else {
      const safe = safeNextPath(next, "");
      destination = safe ? `/estacion?next=${encodeURIComponent(safe)}` : "/estacion";
    }
  }
  redirect(destination);
}
