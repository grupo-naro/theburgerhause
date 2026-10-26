import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { SAMPLE_MAX_AGE_MIN, SAMPLE_WINDOW } from "./constants";

/** Events older than this cannot belong to a sample (ready_at is capped at SAMPLE_MAX_AGE_MIN): keeps the scan bounded. */
const EVENT_LOOKBACK_HOURS = 6;

/**
 * Kitchen minutes per order: latest entry into `en_preparacion` to the first later
 * ready event. Tanda edits (from_status = to_status) are ignored.
 */
export async function loadPrepSamples(db: Db, now: Date): Promise<number[]> {
  const rows = await db.execute<{ minutes: string }>(sql`
    WITH ev AS (
      SELECT order_id, to_status, at FROM order_events
      WHERE from_status IS DISTINCT FROM to_status
        AND at > ${now}::timestamptz - make_interval(hours => ${EVENT_LOOKBACK_HOURS})
    ),
    started AS (
      SELECT order_id, max(at) AS start_at FROM ev WHERE to_status = 'en_preparacion' GROUP BY order_id
    ),
    done AS (
      SELECT st.order_id, st.start_at,
        (SELECT min(e.at) FROM ev e
          WHERE e.order_id = st.order_id AND e.at > st.start_at
            AND e.to_status IN ('listo_despacho', 'para_retirar')) AS ready_at
      FROM started st
    )
    SELECT extract(epoch FROM (ready_at - start_at)) / 60 AS minutes
    FROM done
    WHERE ready_at IS NOT NULL
      AND ready_at > ${now}::timestamptz - make_interval(mins => ${SAMPLE_MAX_AGE_MIN})
      AND ready_at > start_at
    ORDER BY ready_at DESC
    LIMIT ${SAMPLE_WINDOW}
  `);
  return rows.rows.map((r) => Number(r.minutes)).filter((m) => m > 0);
}

export async function countInPreparation(db: Db): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s.orders).where(eq(s.orders.status, "en_preparacion"));
  return r?.n ?? 0;
}

export async function loadEstimateInputs(
  db: Db,
  now: Date,
): Promise<{ samplesMinutes: number[]; inPreparation: number }> {
  const [samplesMinutes, inPreparation] = await Promise.all([loadPrepSamples(db, now), countInPreparation(db)]);
  return { samplesMinutes, inPreparation };
}
