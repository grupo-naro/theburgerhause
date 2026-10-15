import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/lib/env";

const globalForDb = globalThis as unknown as { __pgPool?: Pool };

function getPool(): Pool {
  globalForDb.__pgPool ??= new Pool({ connectionString: getEnv().DATABASE_URL });
  return globalForDb.__pgPool;
}

export function getDb() {
  return drizzle(getPool());
}

export type Db = ReturnType<typeof getDb>;

export async function closeDb(): Promise<void> {
  const pool = globalForDb.__pgPool;
  globalForDb.__pgPool = undefined;
  await pool?.end();
}
