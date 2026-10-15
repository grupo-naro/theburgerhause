import { sql } from "drizzle-orm";
import type { DbTransaction } from "@/db/client";
import type { Channel, ChannelPayloads } from "./channels";

/** Postgres rejects NOTIFY payloads of 8000 bytes or more; stay well below it. */
export const MAX_NOTIFY_BYTES = 7000;

/**
 * Emits a typed event INSIDE the caller's transaction: Postgres delivers it only if the
 * transaction commits, and drops it on rollback. The payload is JSON and bound as a parameter.
 */
export async function notifyInTx<C extends Channel>(
  tx: DbTransaction,
  channel: C,
  payload: ChannelPayloads[C],
): Promise<void> {
  const json = JSON.stringify(payload);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes >= MAX_NOTIFY_BYTES) {
    throw new Error(`NOTIFY payload too large for channel ${channel}: ${bytes} bytes (limit ${MAX_NOTIFY_BYTES})`);
  }
  await tx.execute(sql`select pg_notify(${channel}, ${json})`);
}
