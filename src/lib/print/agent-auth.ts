import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { hashStationToken } from "@/lib/stations/token";
import { parseBearerToken } from "./protocol";

export type AgentStation = { id: number; name: string; kind: (typeof s.stations.$inferSelect)["kind"] };

/**
 * The station behind `Authorization: Bearer bhst_...`, or null for ANY failure (absent, malformed,
 * unknown, rotated). Only the sha256 is compared (256-bit tokens: a fast hash is fine, and a hash
 * lookup leaks nothing about the secret). A malformed header still runs one lookup (of the hash of
 * the empty string, which no station has) so every failure costs the same. Never logs the token.
 */
export async function authenticateStation(db: Db, authorization: string | null | undefined): Promise<AgentStation | null> {
  const token = parseBearerToken(authorization);
  const [row] = await db
    .select({ id: s.stations.id, name: s.stations.name, kind: s.stations.kind })
    .from(s.stations)
    .where(eq(s.stations.tokenHash, hashStationToken(token ?? "")));
  return token && row ? row : null;
}

/** Marks the agent as alive (drives the printer indicator in the Caja). */
export async function touchStationSeen(db: Db, stationId: number, at: Date): Promise<void> {
  await db.update(s.stations).set({ lastSeenAt: at }).where(eq(s.stations.id, stationId));
}
