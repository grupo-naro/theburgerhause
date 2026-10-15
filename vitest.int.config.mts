import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile?.();
} catch {
  // no .env file; rely on the existing environment
}

// Mirrors testDatabaseUrl() in src/db/test-database.ts (kept inline: the config
// loader cannot import extensionless TS).
function testDatabaseUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.pathname = "/burgerhause_test";
  return url.toString();
}

const serverUrl = process.env.DATABASE_URL;
if (!serverUrl) {
  throw new Error("DATABASE_URL is not set (needed to reach the Postgres server)");
}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    fileParallelism: false,
    globalSetup: ["./src/db/global-setup.int.ts"],
    // Tests always run against the dedicated test database, never the dev one.
    env: { DATABASE_URL: testDatabaseUrl(serverUrl) },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
