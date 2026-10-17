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
| `journey-delivery.spec.ts` (`@mobile`) | J1: customer on a phone builds a per-unit order (delivery + transfer) -> the delivery manager sees it live in Gestión Delivery (the cashier never does), verifies, approves -> the Delivery station agent prints the delivery ticket + the customer ticket with logo (GS v 0) and GRACIAS POR TU COMPRA (ESC/POS bytes asserted, no kitchen comanda) -> tracking page moves on by itself (Playwright clock) -> she assigns it with two cash orders to ONE cadet -> deliveries -> exact settlement, balance $0, event chain and print jobs asserted. |
| `journey-counter.spec.ts` | J2: POS sale with a customized unit, change and pager 7 -> real printing of exactly ONE ticket, the customer one (logo first, `LLAMADOR 7`, `Pago: Efectivo (pagado)`, GRACIAS last) -> pickup lane -> delivered -> pager 7 free again; reusing it before delivery is refused naming the order. |
| `journey-takeaway.spec.ts` | J3: web takeaway paid in cash (collect dialog on delivery -> `paid`), a rejected order (reason, cancelled, no jobs), a cadet settlement with a shortage. |
| `journey-print-agent.spec.ts` | J4: no agent (jobs pending, "Sin agente") -> agent starts and prints once (Mostrador station: one ticket per order); a crash after printing but before the ack -> stuck timeout -> redelivery that is NOT printed twice; three failed prints -> red alert -> Reimprimir. |

Time is never slept: the 30 s stuck timeout is simulated by moving `claimed_at` in the DB, tracking polls run on
`page.clock`, and agent output is awaited by polling the temp dir / the DB.

## Sector workspaces (Task 10.1)

One workspace per sector; web orders are distributed by type (delivery -> Delivery station, takeaway and counter sales -> Mostrador station).
The saved logins land on `/mostrador` (cajera, station Mostrador 1) and `/delivery` (encargada, station Delivery 1).

| Spec | What it covers |
| --- | --- |
| `sector-workspaces.spec.ts` | Distribution by order type (live and after reload), print jobs on the approving station, old URLs and redirects, station picker per role, role/kind mismatch message, one EventSource per page, layout (no overflow, >= 48 px targets, screenshots `sector-*`) at 1280/1024/768. |
| `delivery-workspace.spec.ts` | Gestión Delivery tabs: tablist semantics and arrow keys, `?tab=` deep links (survives live refresh), badges, selection kept across tabs, new-order alert while on another tab. |
| `caja.spec.ts`, `caja-chrome.spec.ts` | The cashier approval flow runs on `/retiro` with takeaway orders (`placeRetiroOrder`); the delivery manager's visual checks on `/delivery` (`placeDeliveryOrder`). |
| `despacho-flow/layout/safety.spec.ts` | The full dispatch board (every lane + counters) as **admin** on `/despacho`; `despacho-roles.spec.ts` covers cashier (`/mostrador/pedidos`), encargada (`/delivery`) and admin. |

Helpers: `openRetiro`, `openDelivery(page, tab?)`, `openPedidos`, `openDespacho` (admin board), `openCaja` (admin general view). `placeApproved` approves
delivery orders as the encargada at Delivery 1 and takeaway ones as the cajera at Mostrador 1.

## Commands

```
pnpm e2e                                   # everything (builds first)
pnpm e2e e2e/journey-                      # only the journeys
pnpm e2e e2e/journey- --repeat-each=3      # flake hunt on the journeys
pnpm verify                                # lint + unit + agent typecheck + int + build + e2e (whole-branch gate)
pnpm verify:fast                           # lint + unit + agent typecheck + build
```

`pnpm e2e` and `pnpm test:int` share `burgerhause_test`: never run them at the same time.
