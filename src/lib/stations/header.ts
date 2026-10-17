import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { stations } from "@/db/schema";
import { listFailedPrintJobs } from "@/lib/orders/caja-queries";
import type { Sector } from "@/lib/orders/sector";

export type StationHeader = { name: string; lastSeenAt: string | null; failedCount: number };

/**
 * What the staff top bar needs about a station: name, agent heartbeat and unhandled failed prints. The failed count
 * is scoped to the user's sector exactly like the workspace alert list (null = admin: all the station's own jobs),
 * so the header never shows a red indicator that the workspace cannot clear.
 */
export async function getStationHeader(db: Db, stationId: number, sector: Sector | null): Promise<StationHeader | null> {
  const [[row], failed] = await Promise.all([
    db.select({ name: stations.name, lastSeenAt: stations.lastSeenAt }).from(stations).where(eq(stations.id, stationId)),
    listFailedPrintJobs(db, stationId, { sector }),
  ]);
  if (!row) return null;
  return { name: row.name, lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null, failedCount: failed.length };
}
