import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { testDatabaseUrl } from "./src/db/test-database";

try {
  process.loadEnvFile?.();
} catch {
  // no .env file; rely on the existing environment
}

const PORT = 3100;
const serverUrl = process.env.DATABASE_URL;
if (!serverUrl) throw new Error("DATABASE_URL is not set (needed to reach the Postgres server)");

/** Test-only values, shared by the web server, global setup and helpers. */
export const E2E_DATABASE_URL = testDatabaseUrl(serverUrl);
export const E2E_UPLOAD_DIR = path.resolve(process.cwd(), ".uploads-e2e");
const E2E_SESSION_SECRET = "e2e-only-session-secret-0123456789abcdef";

// Everything in the runner process (global setup, helpers) talks to the TEST database.
process.env.E2E_SERVER_DATABASE_URL = serverUrl;
process.env.DATABASE_URL = E2E_DATABASE_URL;
process.env.SESSION_SECRET = E2E_SESSION_SECRET;
process.env.UPLOAD_DIR = E2E_UPLOAD_DIR;

// Login rate limits are per IP (X-Forwarded-For, in-memory in the server). A random
// IP per runner/worker process keeps repeated runs against a reused server independent.
const rnd = () => Math.floor(Math.random() * 250) + 1;
const clientIp = `10.${rnd()}.${rnd()}.${rnd()}`;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    extraHTTPHeaders: { "x-forwarded-for": clientIp },
  },
  projects: [
    {
      name: "desktop",
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      grep: /@mobile/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    // Seeds the DB first (the public menu is prerendered at build time), then production build + server: closest to what ships.
    command: `pnpm exec tsx e2e/prepare-db-cli.ts && pnpm exec next build && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      E2E_SERVER_DATABASE_URL: serverUrl,
      SESSION_SECRET: E2E_SESSION_SECRET,
      UPLOAD_DIR: E2E_UPLOAD_DIR,
      PORT: String(PORT),
    },
  },
});
