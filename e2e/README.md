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

## Journeys (`e2e/journey-*.spec.ts`)

Cross-role, end-to-end tests of the whole business cycle. Each journey is ONE long test made of
`test.step`s (a failure names the step), uses the real UI for every role-specific action and the REAL print
agent (`packages/print-agent`, started in-process with the `file` backend and temp dirs, see
`e2e/helpers/journey.ts`). DB helpers only set up extra orders/cadets, inject controlled timestamps and assert
the final state.

| Spec | Journey |
| --- | --- |
| `journey-delivery.spec.ts` (`@mobile`) | J1: customer on a phone builds a per-unit order (delivery + transfer) -> cashier sees it live, verifies, approves -> agent prints kitchen + ticket (ESC/POS bytes asserted) -> tracking page moves on by itself (Playwright clock) -> dispatch assigns it with two cash orders to ONE cadet -> deliveries -> exact settlement, balance $0, event chain and print jobs asserted. |
| `journey-counter.spec.ts` | J2: POS sale with a customized unit, change and pager 7 -> real printing (`LLAMADOR 7`, `Pago: Efectivo (pagado)`) -> pickup lane -> delivered -> pager 7 free again; reusing it before delivery is refused naming the order. |
| `journey-takeaway.spec.ts` | J3: web takeaway paid in cash (collect dialog on delivery -> `paid`), a rejected order (reason, cancelled, no jobs), a cadet settlement with a shortage. |
| `journey-print-agent.spec.ts` | J4: no agent (jobs pending, "Sin agente") -> agent starts and prints once; a crash after printing but before the ack -> stuck timeout -> redelivery that is NOT printed twice; three failed prints -> red alert -> Reimprimir. |

Time is never slept: the 30 s stuck timeout is simulated by moving `claimed_at` in the DB, tracking polls run on
`page.clock`, and agent output is awaited by polling the temp dir / the DB.

## Commands

```
pnpm e2e                                   # everything (builds first)
pnpm e2e e2e/journey-                      # only the journeys
pnpm e2e e2e/journey- --repeat-each=3      # flake hunt on the journeys
pnpm verify                                # lint + unit + agent typecheck + int + build + e2e (whole-branch gate)
pnpm verify:fast                           # lint + unit + agent typecheck + build
```

`pnpm e2e` and `pnpm test:int` share `burgerhause_test`: never run them at the same time.
