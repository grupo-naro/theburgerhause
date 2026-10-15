import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/lib/env";

const globalForDb = globalThis as unknown as { __pgPool?: Pool };

function getPool(): Pool {
  if (!globalForDb.__pgPool) {
    const pool = new Pool({ connectionString: getEnv().DATABASE_URL });
    // An idle client dropping (server restart, network) emits "error" on the
    // pool; without a listener Node would crash on the unhandled event.
    pool.on("error", (err) => {
      console.error("[db] idle pg client error:", err);
    });
    globalForDb.__pgPool = pool;
  }
  return globalForDb.__pgPool;
}

export function getDb() {
  return drizzle(getPool());
}

export type Db = ReturnType<typeof getDb>;

/** The `tx` handed to the callback of `db.transaction(...)`. */
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function closeDb(): Promise<void> {
  const pool = globalForDb.__pgPool;
  globalForDb.__pgPool = undefined;
  await pool?.end();
}
