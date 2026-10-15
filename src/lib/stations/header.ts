import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { stations } from "@/db/schema";
import { listFailedPrintJobs } from "@/lib/orders/caja-queries";

export type StationHeader = { name: string; lastSeenAt: string | null; failedCount: number };

/** What the staff top bar needs about a station: name, agent heartbeat and unhandled failed prints. */
export async function getStationHeader(db: Db, stationId: number): Promise<StationHeader | null> {
  const [[row], failed] = await Promise.all([
    db.select({ name: stations.name, lastSeenAt: stations.lastSeenAt }).from(stations).where(eq(stations.id, stationId)),
    listFailedPrintJobs(db, stationId),
  ]);
  if (!row) return null;
  return { name: row.name, lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null, failedCount: failed.length };
}
