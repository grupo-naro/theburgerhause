# End-to-end tests (Playwright)

## Run

```
docker compose up -d      # Postgres on :15435
pnpm e2e                  # builds the app, starts it on :3100, runs every spec
pnpm e2e:ui               # interactive runner
```

Chromium only (`pnpm exec playwright install chromium` once). The web server is a production
build (`next build` + `next start`) started by Playwright's `webServer` with the TEST database
(`burgerhause_test` on the same Postgres server as `DATABASE_URL`), a constant `SESSION_SECRET`
and `UPLOAD_DIR=.uploads-e2e`. Locally an already-running server on :3100 is reused (rebuild it
if you changed code); in CI it is always started fresh.

## What global setup does (`e2e/global-setup.ts`)

1. Creates/migrates the test DB (reuses `src/db/global-setup.int.ts`).
2. Truncates every table and runs the menu seed.
3. Creates users `admin`, `cajera`, `encargada` (credentials in `e2e/helpers/users.ts`, test-only).
4. Logs each one in THROUGH THE LOGIN FORM (cashier picks "Mostrador 1", encargada "Delivery 1")
   and saves cookies to `e2e/.auth/<role>.json` (git-ignored).

Specs opt into a role with `test.use({ storageState: authFile("admin") })`; for anonymous flows use
`test.use({ storageState: { cookies: [], origins: [] } })`. Specs that mutate data use unique names
(`Date.now()` suffixes) because the DB is seeded once per run, not per test.

## Projects

- `desktop` (1280x800): every spec except those tagged `@mobile`.
- `mobile` (Pixel 7): only tests whose title contains `@mobile`.

## Adding a spec

Create `e2e/<feature>.spec.ts`, use web-first assertions (`await expect(locator)...`), never fixed
sleeps. Take named screenshots with `shot(page, "name")` (-> `test-results/shots/name.png`), and
use `e2e/helpers/db.ts` for DB assertions. Login attempts are rate limited per IP; the config sends
a random `X-Forwarded-For` per process so repeated runs do not interfere.

## Rule

UI tasks extend e2e AND look at the screenshots they produce (open the PNGs) before being declared
done. A green run says nothing about spacing, overflow or contrast.

## Build-time database rule

The public menu (`/`) is prerendered and cached from the DB at `next build` time. So the test DB is
seeded exactly once per server start, BEFORE the build: the `webServer` command runs
`e2e/prepare-db-cli.ts` (migrate, wipe, seed, product photos, users, plus an `e2e_prepared_at` marker
in `settings`) and then `next build`. Global setup does NOT reseed (new ids/image uuids would no longer
match the cached menu); it only checks the marker and logs the users in. If you reuse a server that is
already running on :3100 after something wiped the DB (e.g. `pnpm test:int`, which shares
`burgerhause_test`), global setup fails with an explicit message: stop that server so Playwright
restarts it.
