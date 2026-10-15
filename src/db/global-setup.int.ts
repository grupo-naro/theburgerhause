import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { TEST_DB_NAME, testDatabaseUrl } from "./test-database";

try {
  process.loadEnvFile?.();
} catch {
  // no .env file; rely on the existing environment
}

export default async function setup(): Promise<void> {
  const serverUrl = process.env.DATABASE_URL;
  if (!serverUrl) throw new Error("DATABASE_URL is not set");
  const testUrl = testDatabaseUrl(serverUrl);

  // 1-2. Connect to the server's maintenance DB and create the test DB if missing.
  const admin = new Client({ connectionString: serverUrl });
  await admin.connect();
  try {
    const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
    if (found.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
    }
  } finally {
    await admin.end();
  }

  // 3. Apply the committed migrations to the test DB.
  const pool = new Pool({ connectionString: testUrl });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.resolve(process.cwd(), "src/db/migrations"),
    });
  } finally {
    await pool.end();
  }

  // 4. Make the test DB the one every code path sees in this run.
  process.env.DATABASE_URL = testUrl;
}
