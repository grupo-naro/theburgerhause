# End-to-end tests (Playwright)

## Run

```
docker compose up -d      # Postgres on :15435
pnpm e2e                  # builds the app, starts it on :3100, runs every spec
pnpm e2e:ui               # interactive runner
```

Chromium only (`pnpm exec playwright install chromium` once). The web server is a production
build (`next build` + `next start`) started by Playwright's `webServer` with the TEST database
(`burgerhause_test` on the same Postgres server as `DATABASE_URL`), and `UPLOAD_DIR=.uploads-e2e`. Locally an already-running server on :3100 is reused (rebuild it
if you changed code); in CI it is always started fresh.

## What global setup does (`e2e/global-setup.ts`)

1. Creates/migrates the test DB (reuses `src/db/global-setup.int.ts`).
2. Truncates every table and runs the menu seed.
3. Creates users `admin`, `cajera`, `encargada`, `cocina` (credentials in `e2e/helpers/users.ts`, test-only).
4. Logs each one in THROUGH THE LOGIN FORM (cashier picks "Mostrador 1", encargada "Delivery 1", the kitchen user has no station and lands on `/cocina`)
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

Staff screens that are not the workspace itself (Venta, Mostrador, Rendición) carry a shell-level alert for new web orders of the user's sector: nav badge on Retiro / Gestión Delivery, tab title, announcer (`shell-announcer`), beep and the shared sound toggle. The workspace pages keep CajaBoard's own alert, so there is never a double beep (covered in `sector-workspaces.spec.ts`).

Measure or photograph only a settled document: `shot()` and `waitForStablePage()` (`helpers/shots.ts`) wait for `load` plus a quiet window with no main-frame navigation, because a `page.evaluate` that overlaps a navigation dies with "Execution context was destroyed".

Helpers: `openRetiro`, `openDelivery(page, tab?)`, `openPedidos`, `openDespacho` (admin board), `openCaja` (admin general view). `placeApproved` approves
delivery orders as the encargada at Delivery 1 and takeaway ones as the cajera at Mostrador 1.

## Kitchen screen (KDS)

`cocina.spec.ts` (storage state `cocina`, plus cajera and admin blocks): a delivery order approved at Delivery appears LIVE on `/cocina` with the
exact unit / kitchen-label text (compared with the stored snapshots), the note and the DELIVERY tag; LISTO moves it to the Delivery "Listos" lane
live (second browser context as the encargada); takeaway (RETIRO) and counter sales (MOSTRADOR + LLAMADOR) likewise; Deshacer (toast) and
Volver a preparación (strip) with the audit chain; an order already called leaves the strip; double tap = ONE `listo_despacho` event; a stale card
(order changed behind the screen's back) answers the friendly "ya no está en preparación"; a cancelled order disappears live; green / yellow / red
clock from backdated `en_preparacion` events; HTML / emoji notes render as inert text; the `cocina` user is sent back to `/cocina` from every other
URL and has no navigation; exactly one EventSource; layout at 1280 / 1024 / 768 with a 8-unit order and a long note (no horizontal overflow, nothing
taller than the shell, LISTO / undo / sound targets >= 56 px, units scroll INSIDE the card). The cashier sees the Cocina link, can only mark her own
sector (the other cards read "OTRO SECTOR"); admin marks any. Screenshots: `test-results/shots/cocina-*.png`.

## Security (Task 9.3)

`security.spec.ts` checks the production build as an attacker/auditor would: hardening headers on public, redirect and 404 responses
(and `no-referrer` kept on `/pedido`), **zero CSP violations** on every public and staff page (collected from
`securitypolicyviolation` events and the console, so a new inline `eval` or remote origin fails the suite), cookie flags (`HttpOnly`,
`Secure`, `SameSite=Lax`, `Path=/`, 30-day max-age, nothing readable by page scripts), a fresh token per login and a planted
token never adopted, the 6th login attempt blocked, revoked and expired sessions refused on a page, a Server Action and
`/api/events`, a Server Action posted with a foreign `Origin`, and the 1 MB Server Action / 8 KB CSP-report body caps.
Its logins use their own `X-Forwarded-For` (the login limiter is per IP and the run shares one).

## Commands

```
pnpm e2e                                   # everything (builds first)
pnpm e2e e2e/journey-                      # only the journeys
pnpm e2e e2e/journey- --repeat-each=3      # flake hunt on the journeys
pnpm verify                                # lint + unit + agent typecheck + int + build + e2e (whole-branch gate)
pnpm verify:fast                           # lint + unit + agent typecheck + build
```

`pnpm e2e` and `pnpm test:int` share `burgerhause_test`: never run them at the same time.
