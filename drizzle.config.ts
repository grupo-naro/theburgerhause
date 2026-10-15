import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile?.();
} catch {
  // no .env file; rely on the existing environment
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
