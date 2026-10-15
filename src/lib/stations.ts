import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { stations } from "@/db/schema";

export type StationInfo = { id: number; name: string; kind: (typeof stations.$inferSelect)["kind"] };

const columns = { id: stations.id, name: stations.name, kind: stations.kind };

export async function listStations(db: Db): Promise<StationInfo[]> {
  return db.select(columns).from(stations).orderBy(asc(stations.id));
}

export async function findStation(db: Db, id: number): Promise<StationInfo | null> {
  const [row] = await db.select(columns).from(stations).where(eq(stations.id, id));
  return row ?? null;
}
