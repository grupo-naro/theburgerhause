import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile?.();
} catch {
  // no .env file; rely on the existing environment
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: databaseUrl },
});
