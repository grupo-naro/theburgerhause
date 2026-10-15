import { cookies } from "next/headers";

/** Device cookie remembering which station this terminal is (not a credential). */
export const STATION_COOKIE = "bh_station";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function setStationCookie(stationId: number): Promise<void> {
  (await cookies()).set(STATION_COOKIE, String(stationId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR_SECONDS,
  });
}

/** The remembered station id, or null when missing/malformed. */
export async function getStationCookie(): Promise<number | null> {
  const raw = (await cookies()).get(STATION_COOKIE)?.value;
  return raw && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}
