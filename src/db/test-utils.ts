import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { getEnv } from "@/lib/env";

function assertTestDatabase(): void {
  const dbName = new URL(getEnv().DATABASE_URL).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to touch non-test database "${dbName}"`);
  }
}

/** The drizzle instance bound to the test database (guarded by name). */
export function testDb() {
  assertTestDatabase();
  return getDb();
}

/** Truncates every table and restarts identities. Call from `beforeEach`. */
export async function resetDb(): Promise<void> {
  const tables = Object.values(schema)
    .filter((v): v is PgTable => is(v, PgTable))
    .map((t) => `"${getTableName(t)}"`);
  await testDb().execute(sql.raw(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`));
}
