# Analíticas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-only `/admin/analiticas` page (KPIs with period comparison, top products, weekday × hour heatmap, sellers table) whose numbers are only computed and sent while the session is unlocked with the store PIN (15 min).

**Architecture:** A pure period resolver (`src/lib/analytics/period.ts`) turns the URL query into current/previous business-date ranges plus a same-time cut for the in-progress day. SQL reads in `src/lib/analytics/queries.ts` take that period. The PIN hash lives in `settings` (`analytics_pin_hash`). The unlock lives on the server session row (`sessions.analytics_unlocked_until`). The page checks the unlock BEFORE running any analytics query; locked, it renders the same layout from `src/lib/analytics/locked-names.ts` (alphabetical names, no sales data) with `****`.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` first: breaking changes), React 19, Drizzle + PostgreSQL, zod via `@/lib/zod`, Vitest unit + `*.int.test.ts`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-07-analiticas-design.md`

## Global Constraints

- UI text in Spanish (es-AR); mobile first; follow the existing admin panel tokens/components (`@/components/ui/*`). No new dependencies (heatmap is a CSS grid).
- Admin only: pages use `requireSessionOrRedirect(["admin"], ...)`; actions use `authorizeAdmin()` FIRST (before any DB access). `encargado` must not see the nav link nor the page.
- Money is integer centavos in the DB; display with `formatARS` from `@/domain/money`.
- Business day = `orders.business_date` (already rolls at `business_day_cutoff`, default 06:00). Clock times are `America/Argentina/Buenos_Aires` (fixed UTC−03:00, no DST).
- Valid order = status in `en_preparacion, listo_despacho, en_camino, para_retirar, entregado`. Cancelled = `cancelado`. `pendiente_aprobacion` never counts. `payment_status` is ignored.
- PIN: `^\d{4,6}$`, stored as `hashPassword(pin)` (`src/lib/auth/password.ts`) under settings key `analytics_pin_hash`. Unlock lasts exactly 15 min from the unlock (no sliding). Failure limit: 5 failed attempts / 15 min per user id, shared by "wrong PIN" and "wrong password when setting the PIN".
- Setting/changing the PIN requires the logged-in admin's password, also the first time.
- While locked, no number, percentage or heatmap value reaches the client (not even hidden); names come from a non-sales query, alphabetical.
- Next migration is `0017_*` after `0016_stock_closings.sql`, generated with `pnpm db:generate`.
- Every new Server Action is classified in `src/lib/security/surface.ts` (`adminAction(...)`); regenerate `docs/ops/security-surface.md` with `UPDATE_SURFACE_DOC=1 pnpm test:security`.
- Gates before each commit: `pnpm lint`, `pnpm test`; `pnpm test:int` for int tests (Docker Desktop running, never concurrent with e2e); `pnpm test:security` when `surface.ts` changes; `pnpm build` at the end of Tasks 4 and 5.

## Review Focus

- Empty period (no orders at all, first night): KPIs show `$ 0` / `0`, ticket `$ 0` (no NaN), deltas "—", heatmap and tables show the empty-state text. Covered in Task 2 (`empty period`) and Task 1 (`pctChange(0,0)`).
- Order created at 01:30 on Saturday night belongs to Friday's business day: it lands in the Friday heatmap row, hour column `01`, and in Friday's KPIs. Covered in Task 2 (`after-midnight order`).
- `getSettings` (and anything public built on it) must never carry `analytics_pin_hash`. Covered in Task 3 (`settings never expose the pin hash`).
- Unlock expires while the page is open: the next request renders `****` even without clicking anything; the countdown triggers `router.refresh()` at 0. Covered in Task 3 (`expired unlock`); the countdown's refresh is checked by eye.
- Malformed query string (`?p=custom&desde=2026-13-40`, `hasta < desde`, range > 366 days): falls back to Semana, never throws. Covered in Task 1 (`invalid custom falls back`).

---

### Task 1: Period resolution (pure)

**Files:**
- Create: `src/lib/analytics/period.ts`
- Test: `src/lib/analytics/period.test.ts`

**Interfaces:**
- Produces:
  - `type PeriodKind = "hoy" | "semana" | "mes" | "custom"`
  - `type Period = { kind: PeriodKind; from: string; to: string; prevFrom: string; prevTo: string; prevCutAt: Date | null }`. Dates are `YYYY-MM-DD` business dates, inclusive. `prevCutAt` is non-null only when `to` is the current business day: orders with `business_date = prevTo` count only if `created_at < prevCutAt`.
  - `resolvePeriod(query: { p?: string; desde?: string; hasta?: string }, now: Date, cutoff: string): Period`
  - `businessDayStart(date: string, cutoff: string): Date` gives the instant `date` + cutoff at −03:00.
  - `pctChange(cur: number, prev: number): number | null` returns `null` when `prev === 0`. Otherwise it returns `(cur − prev) / prev × 100`, rounded to an integer.

Rules (spec §"Período y comparación"): today = `businessDateFor(now, cutoff)` (`src/db/order-number.ts`). The default/unknown `p` is `semana`.
- **hoy:** `[today, today]`, prev `[today−7, today−7]`.
- **semana:** Monday of today's week → today. Prev is the same days shifted −7.
- **mes:** day 1 → today. Prev runs from day 1 of the previous month to `min(same day, last day of previous month)`.
- **custom:** `desde..hasta` inclusive, with n = days in the range. Prev is `[desde−n, desde−1]`. It is invalid if either date does not parse, `hasta < desde`, or n > 366; invalid falls back to `semana`.
- **prevCutAt:** when `to === today`, it is `businessDayStart(prevTo) + (now − businessDayStart(today))`. Otherwise `null`.

- [ ] **Step 1: Write the failing tests**

```ts
const CUT = "06:00";
const at = (iso: string) => new Date(iso); // ISO with -03:00
it("hoy compares with same weekday last week, cut at same time", () => {
  const p = resolvePeriod({ p: "hoy" }, at("2026-11-07T22:00:00-03:00"), CUT); // Saturday
  expect(p).toMatchObject({ kind: "hoy", from: "2026-11-07", to: "2026-11-07", prevFrom: "2026-10-31", prevTo: "2026-10-31" });
  expect(p.prevCutAt?.toISOString()).toBe(at("2026-10-31T22:00:00-03:00").toISOString());
});
it("01:30 is still the previous business day", () => {
  const p = resolvePeriod({ p: "hoy" }, at("2026-11-08T01:30:00-03:00"), CUT);
  expect(p.from).toBe("2026-11-07");
  expect(p.prevCutAt?.toISOString()).toBe(at("2026-11-01T01:30:00-03:00").toISOString());
});
it("default is semana Monday→today vs same days last week", () => {
  expect(resolvePeriod({}, at("2026-11-07T22:00:00-03:00"), CUT)).toMatchObject({
    kind: "semana", from: "2026-11-02", to: "2026-11-07", prevFrom: "2026-10-26", prevTo: "2026-10-31" });
});
it("mes clamps to the previous month's last day", () => {
  expect(resolvePeriod({ p: "mes" }, at("2026-03-31T21:00:00-03:00"), CUT)).toMatchObject({
    from: "2026-03-01", to: "2026-03-31", prevFrom: "2026-02-01", prevTo: "2026-02-28" });
});
it("custom in the past has the same-length previous range and no cut", () => {
  expect(resolvePeriod({ p: "custom", desde: "2026-10-10", hasta: "2026-10-19" }, at("2026-11-07T22:00:00-03:00"), CUT))
    .toMatchObject({ from: "2026-10-10", to: "2026-10-19", prevFrom: "2026-09-30", prevTo: "2026-10-09", prevCutAt: null });
});
it.each([
  [{ p: "custom", desde: "2026-13-40", hasta: "2026-10-19" }],
  [{ p: "custom", desde: "2026-10-19", hasta: "2026-10-10" }],
  [{ p: "custom", desde: "2025-01-01", hasta: "2026-10-10" }],
  [{ p: "xx" }],
])("invalid custom falls back to semana %#", (q) => {
  expect(resolvePeriod(q, at("2026-11-07T22:00:00-03:00"), CUT).kind).toBe("semana");
});
it("pctChange", () => {
  expect(pctChange(112, 100)).toBe(12);
  expect(pctChange(0, 0)).toBeNull();
  expect(pctChange(5, 0)).toBeNull();
  expect(pctChange(0, 50)).toBe(-100);
});
```

- [ ] **Step 2: Run `pnpm vitest run src/lib/analytics/period.test.ts`.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement `period.ts`** with the signatures above. Do date arithmetic on `YYYY-MM-DD` strings through UTC-midnight `Date`s (`Date.UTC`), so no local-timezone leaks in.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(analytics): period resolution and comparison ranges`.

---

### Task 2: Analytics queries

**Files:**
- Create: `src/lib/analytics/queries.ts`, `src/lib/analytics/locked-names.ts`
- Test: `src/lib/analytics/queries.int.test.ts`

**Interfaces:**
- Consumes: `Period` from Task 1.
- Produces (all `(db: Db, ...)`, amounts in centavos):
  - `getKpis(db, period): Promise<{ cur: Kpis; prev: Kpis }>` with `type Kpis = { revenue: number; orders: number; avgTicket: number; cancelledCount: number; cancelledAmount: number }`. `avgTicket = orders ? Math.round(revenue / orders) : 0`.
  - `getTopProducts(db, period, opts: { categoryId?: number; limit?: number }): Promise<{ key: string; name: string; units: number; revenue: number }[]>`. The limit defaults to 10. Rows are ordered by units desc, then revenue desc.
  - `getHeatmap(db, period): Promise<{ hours: number[]; cells: { dow: number; hour: number; orders: number }[]; max: number }>`. `dow` 1=Mon…7=Sun from `business_date`. `hour` is 0–23 of `created_at` in Buenos Aires. `hours` holds only the hours with ≥1 order, ordered starting at the cutoff hour (cutoff 06 → 19,20,…,23,0,1,2).
  - `getSellers(db, period): Promise<{ userId: number | null; name: string; orders: number; revenue: number; avgTicket: number; addons: number }[]>`. Rows are ordered by revenue desc. When `userId` is null the name is `"Sin asignar"`.
  - `getLockedNames(db, opts: { categoryId?: number }): Promise<{ products: string[]; sellers: string[] }>` (in `locked-names.ts`). It returns up to 10 **active** products (filtered by category), alphabetical, and the **active** users with role `cajera`, alphabetical. It must not touch `orders`/`order_items`.
- Only the CURRENT range is used for top products, heatmap and sellers. The previous range (with `prevCutAt`) is used only by `getKpis`.

Query rules (spec §"Qué cuenta como venta", §"Top productos", §"Vendedoras"):
- **Range filter (current):** `business_date BETWEEN from AND to`.
- **Range filter (previous):** `business_date BETWEEN prevFrom AND prevTo AND (business_date < prevTo OR prevCutAt IS NULL OR created_at < prevCutAt)`. Apply it to both valid and cancelled orders.
- **Unit revenue:** `unit_price_snapshot + COALESCE(SUM(order_item_modifiers.price_delta), 0)`.
- **Product grouping:** group key is `'p' || product_id`, or `'n' || name_snapshot` when `product_id` is null. The name is the current `products.name` when one exists, otherwise the snapshot.
- **Category filter:** `products.category_id = categoryId`. Rows with a null product drop out when a category is filtered.
- **Sellers:** group by `orders.approved_by`. `addons` = count of `order_addons` with `status = 'confirmado'`, `confirmed_by = user`, whose order is valid and in range. A user who only confirmed add-ons still appears, with orders 0.

- [ ] **Step 1: Write the failing int tests.** Each `beforeEach` runs `resetDb()`. Define a local fixture `insertOrder(over: Partial<typeof s.orders.$inferInsert>)` that inserts one order with sane defaults (channel `counter`, pager, status `entregado`, totals), plus `insertItem(orderId, { productId, name, price, deltas: number[] })`. Seed two users (`cajera` Sofía id 2, Camila id 3), one inactive cajera, one `encargado`, two categories and products. Cases, with exact expected numbers:
  - `kpis count only valid orders`: in range, 2 × `entregado` (10 000 + 20 000), 1 × `en_preparacion` (5 000), 1 × `pendiente_aprobacion` (99 999), 1 × `cancelado` (7 000). Expected: cur `{ revenue: 35000, orders: 3, avgTicket: 11667, cancelledCount: 1, cancelledAmount: 7000 }`.
  - `previous range respects prevCutAt`: on `prevTo`, one order at 20:00 and one at 23:00; `prevCutAt` = 21:00 that day. Expected: prev orders 1.
  - `empty period`: no orders. Every field is 0, and the products, heatmap cells and sellers arrays are empty.
  - `after-midnight order`: business_date `2026-11-06` (Fri), `created_at` `2026-11-07T01:30-03:00`. Expected heatmap cell `{ dow: 5, hour: 1, orders: 1 }`. With another order at 20:00 the expected `hours` is `[20, 1]`.
  - `top products sum modifier deltas and order by units`: 3 units of Doble (price 7 000, one with delta +1 000) and 2 units of Bacon (9 000). Expected `[{ name: "Doble", units: 3, revenue: 22000 }, { name: "Bacon", units: 2, revenue: 18000 }]`. Also: with `categoryId` set to the drinks category only drinks come back, and a deleted product (null `product_id`) groups by snapshot.
  - `sellers attribute by approved_by and count confirmed add-ons on valid orders`: Sofía gets 2 orders and 1 confirmed add-on. Camila gets 1 order plus 1 confirmed add-on whose order is `cancelado` (not counted). One order has null `approved_by`. Expected rows: Sofía `addons: 1`, Camila `addons: 0`, `"Sin asignar"` present.
  - `locked names are alphabetical and ignore sales`: there are orders where Camila outsells Sofía. Expected sellers `["Camila", "Sofía"]` (alphabetical; the inactive cajera and the encargado are excluded). Products come back alphabetical, active only.
- [ ] **Step 2: Run `pnpm test:int src/lib/analytics/queries.int.test.ts`.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement `queries.ts` and `locked-names.ts`** with Drizzle `sql` where aggregation needs it (`extract(isodow from business_date)`, `extract(hour from created_at at time zone 'America/Argentina/Buenos_Aires')`). Cast aggregates to `int`, because `count`/`sum` come back as strings from `pg`. Add an index on `orders.business_date` only if `EXPLAIN` shows a seq scan matters. That index would go into the Task 3 migration.
- [ ] **Step 4: Run the int tests again.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(analytics): sales queries and locked-name lists`.

---

### Task 3: PIN storage, unlock and rate limit (core)

**Files:**
- Modify: `src/db/schema.ts` (`sessions`: add `analyticsUnlockedUntil: timestamp("analytics_unlocked_until", { withTimezone: true })`; document the `analytics_pin_hash` key in the settings comment)
- Create: `src/db/migrations/0017_*.sql` (via `pnpm db:generate`)
- Create: `src/lib/analytics/pin.ts`, `src/lib/analytics/pin-rate-limit.ts`, `src/lib/analytics/schemas.ts`
- Test: `src/lib/analytics/pin.int.test.ts`, `src/lib/analytics/pin-rate-limit.test.ts`, `src/lib/analytics/schemas.test.ts`

**Interfaces:**
- Produces:
  - `UNLOCK_MS = 15 * 60 * 1000`, `PIN_FAILURE_LIMIT = 5`
  - `isPinBlocked(userId: number): { blocked: boolean; retryAfterMs: number }`, `recordPinFailure(userId: number): void`, `resetPinRateLimit(): void`. These follow `src/lib/auth/login-rate-limit.ts`: the limiter is kept on `globalThis` with a 15 min window, and only failures are recorded.
  - `pinInputSchema` (zod) validates `{ pin, pinConfirm, password }`. `pin` must match `^\d{4,6}$` (message "El PIN tiene que tener de 4 a 6 números"). `pinConfirm` must equal `pin` ("Los PIN no coinciden"). `password` must be non-empty ("Ingresá tu contraseña").
  - `hasAnalyticsPin(db): Promise<boolean>`
  - `setAnalyticsPin(db, userId: number, input: unknown): Promise<Result<null>>`. It checks blocked → fieldError `password: "Demasiados intentos, probá en N min"`. Then it validates, then verifies the password against `users.password_hash` (on failure: `recordPinFailure` + fieldError `password: "Contraseña incorrecta"`), then upserts the settings row `analytics_pin_hash`. `Result` comes from `@/lib/menu/admin`.
  - `unlockAnalytics(db, { sessionId: string; userId: number; pin: string; now?: Date }): Promise<Result<{ until: Date }>>`. It returns the error `"Configurá el PIN en Ajustes"` when there is no PIN, or `"Demasiados intentos, probá en N min"` when blocked. A wrong PIN calls `recordPinFailure` and returns `"PIN incorrecto"`. Success sets `sessions.analytics_unlocked_until = now + UNLOCK_MS` for that session id only.
  - `lockAnalytics(db, sessionId: string): Promise<void>` sets the column to NULL.
  - `getAnalyticsUnlock(db, sessionId: string, now?: Date): Promise<Date | null>` returns the stored value only if it is `> now`.
- `sessionId` is `AuthSession.sessionId` (already the DB key of `sessions.id`).

- [ ] **Step 1: Write the failing tests.**
  - `schemas.test.ts`: `"1234"` and `"123456"` pass. `"123"`, `"1234567"`, `"12a4"` fail with the message above. A mismatch fails on `pinConfirm`.
  - `pin-rate-limit.test.ts`: 5 `recordPinFailure(1)` → `isPinBlocked(1).blocked` true and `isPinBlocked(2).blocked` false.
  - `pin.int.test.ts`. Each `beforeEach` runs `resetDb`, `resetPinRateLimit` and seeds the admin with `hashPassword("secreta")` plus two session rows for that admin:
    - `set pin requires the admin password`: a wrong password gives the `password` fieldError and `hasAnalyticsPin` stays false. The right one makes `hasAnalyticsPin` true, and the stored value starts with `scrypt$` and is not `"1234"`.
    - `settings never expose the pin hash`: after setting it, `JSON.stringify(await getSettings(db))` does not contain `scrypt$` nor `analytics_pin_hash`.
    - `unlock without pin`: error `"Configurá el PIN en Ajustes"`.
    - `unlock sets 15 min on that session only`: `now` = fixed date. `getAnalyticsUnlock(s1, now)` equals `now + 15 min`, and `getAnalyticsUnlock(s2, now)` is null.
    - `expired unlock`: `getAnalyticsUnlock(s1, now + 15 min + 1 ms)` is null.
    - `wrong pin 5 times blocks even the right pin`: the sixth attempt, made with the correct PIN, returns the "Demasiados intentos" error.
    - `lock clears it`: after `lockAnalytics(s1)`, `getAnalyticsUnlock` returns null.
- [ ] **Step 2: Run `pnpm test` and `pnpm test:int src/lib/analytics/pin.int.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Add the column, then run `pnpm db:generate`.** Check that the new `0017_*.sql` contains only `ALTER TABLE "sessions" ADD COLUMN "analytics_unlocked_until" timestamp with time zone;` (plus the optional index from Task 2).
- [ ] **Step 4: Implement** `pin-rate-limit.ts`, `schemas.ts`, `pin.ts`. Use `verifyPassword` / `hashPassword` from `src/lib/auth/password.ts`. Confirm that `parseSettings` ignores unknown keys; if it does not, make it skip `analytics_pin_hash`.
- [ ] **Step 5: Run the tests again.** Expected: PASS.
- [ ] **Step 6: Commit:** `feat(analytics): store PIN, session unlock and attempt limit`.

---

### Task 4: PIN block in Ajustes

**Files:**
- Modify: `src/app/(admin)/admin/ajustes/actions.ts` (add `setAnalyticsPinAction`), `src/app/(admin)/admin/ajustes/page.tsx`
- Create: `src/app/(admin)/admin/ajustes/_components/analytics-pin-form.tsx`
- Modify: `src/lib/security/surface.ts`, `docs/ops/security-surface.md` (regenerated)
- Test: `src/app/(admin)/admin/ajustes/actions.int.test.ts` (extend)

**Interfaces:**
- Consumes: `setAnalyticsPin`, `hasAnalyticsPin` (Task 3).
- Produces: `setAnalyticsPinAction(prev: ActionState, fd: FormData): Promise<ActionState>` follows the pattern of `savePromoAction`: `authorizeAdmin()` first, then the core with `auth.session.user.id` and `{ pin, pinConfirm, password }` taken from `fd`. On failure it returns `toState(result, fd, ["pin", "pinConfirm", "password"])`, so secrets are never echoed back. On success it returns `{ message: "PIN de analíticas guardado" }`.

- [ ] **Step 1: Write the failing int tests** in the existing ajustes action test file:
  - an `encargado` is refused and no settings row is written;
  - a wrong password returns `fieldErrors.password`, and the returned `values` contain no `pin`/`password`;
  - success returns the message and `hasAnalyticsPin` becomes true.
- [ ] **Step 2: Run `pnpm test:int "src/app/(admin)/admin/ajustes/actions.int.test.ts"`.** Expected: FAIL.
- [ ] **Step 3: Implement the action and the form.** The form is a separate `Card` titled "PIN de analíticas", with a status badge ("Configurado" / "Sin configurar"). It has three `type="password"` inputs (`inputMode="numeric"` for the two PIN fields; labels "PIN nuevo", "Repetí el PIN", "Tu contraseña") and the button "Guardar PIN". Use `useActionState`, like the other admin forms. The fields clear after success. The page passes `hasPin` from `hasAnalyticsPin`.
- [ ] **Step 4: Classify the action in `surface.ts`:** `adminAction("Set the analytics PIN (requires the admin's password; 5 failures / 15 min).")`. Then run `UPDATE_SURFACE_DOC=1 pnpm test:security`.
- [ ] **Step 5: Run `pnpm lint && pnpm test && pnpm test:int && pnpm test:security && pnpm build`.** Expected: all pass.
- [ ] **Step 6: Commit:** `feat(analytics): PIN setting in Ajustes guarded by the admin password`.

---

### Task 5: Analíticas page, unlock/lock actions and nav

**Files:**
- Create: `src/app/(admin)/admin/analiticas/page.tsx`, `src/app/(admin)/admin/analiticas/actions.ts`
- Create: `src/app/(admin)/admin/analiticas/_components/period-bar.tsx`, `pin-gate.tsx`, `unlock-countdown.tsx`, `kpi-cards.tsx`, `top-products.tsx`, `heatmap.tsx`, `sellers-table.tsx`
- Modify: `src/app/(admin)/admin/admin-nav.tsx` (add `{ href: "/admin/analiticas", label: "Analíticas", adminOnly: true }` as the FIRST link), `src/lib/security/surface.ts`, `docs/ops/security-surface.md`
- Test: `src/app/(admin)/admin/analiticas/actions.int.test.ts`, `e2e/admin-analiticas.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`resolvePeriod`, `pctChange`, `get*`, `getLockedNames`, `unlockAnalytics`, `lockAnalytics`, `getAnalyticsUnlock`, `hasAnalyticsPin`), `getBusinessDayCutoff` from `@/lib/settings`.
- Produces:
  - `unlockAnalyticsAction(prev: ActionState, fd: FormData): Promise<ActionState>` uses `authorizeAdmin()` and then `unlockAnalytics({ sessionId, userId, pin })`. On success it calls `revalidatePath("/admin/analiticas")`. It never echoes the PIN.
  - `lockAnalyticsAction(): Promise<ActionState>` uses `authorizeAdmin()`, then `lockAnalytics`, then revalidates.
  - URL query: `p` (`hoy|semana|mes|custom`), `desde`, `hasta` (`YYYY-MM-DD`), `cat` (category id, optional).

Page flow (order matters, see spec §"Seguridad del bloqueo"):
1. `const session = await requireSessionOrRedirect(["admin"], "/admin/analiticas")`.
2. Resolve the period from `searchParams` (await it, per Next 16 docs).
3. `const until = await getAnalyticsUnlock(db, session.sessionId)`.
4. **Locked** (`until === null`): run ONLY `getLockedNames` and `hasAnalyticsPin`. Render `PeriodBar` and `PinGate`. When there is no PIN, `PinGate` shows "Configurá el PIN en Ajustes" with a link to `/admin/ajustes` instead of the input. Render the KPI cards with the literal `****`, the product list with names and `****`, a heatmap placeholder "mapa oculto", and the sellers table with names and `****`. The locked components receive no numeric props at all.
5. **Unlocked:** run the four queries and render everything, plus `UnlockCountdown untilIso={until.toISOString()}`. It shows "🔓 mm:ss · Bloquear ya", the button calls `lockAnalyticsAction`, and at 0 it calls `router.refresh()`.

UI details (approved mockup):
- KPI card: label, value, "▲ 12% vs período anterior" (green) / "▼ 5%" (red) / "—".
- Top products shows "182 u · $ 1.274.000", with a category `<select>` that updates `cat`.
- Heatmap: rows Lun…Dom, columns = `hours` (labels `19`, `00`, …). The cell background is brand color with an opacity of `orders / max`, and `title`/`aria-label` read "Sáb 21 h: 34 pedidos".
- Sellers columns: Nombre, Pedidos, Facturación, Ticket prom., Adicionales.
- Empty state for each block: "No hay ventas en este período".
- Custom range: two `<input type="date">` plus "Aplicar" (a GET form, no action).

- [ ] **Step 1: Write the failing int tests** (`actions.int.test.ts`, mocking `requireRole` as in the promo test, with real DB session rows):
  - an `encargado` is refused and the session column stays null;
  - the right PIN sets `analytics_unlocked_until` on the caller's session row;
  - a wrong PIN returns `error: "PIN incorrecto"`, and the state contains no `values.pin`;
  - lock clears the column.
- [ ] **Step 2: Write the failing e2e** `e2e/admin-analiticas.spec.ts`. Reuse the admin login helper and the seeded data used by the other admin e2e specs.
  - The admin opens `/admin/analiticas`: the "Configurá el PIN en Ajustes" link is visible.
  - The admin sets PIN `2468` in Ajustes with their password.
  - Back on analíticas, the facturación card shows `****`, and the KPI block's text content (tagged with `data-testid="kpis"`) contains no digit (`/\d/` does not match).
  - Entering `2468` makes the card show `$` followed by digits, and the "Bloquear ya" button is visible.
  - Clicking "Bloquear ya" brings `****` back.
  - The encargado login does not see the "Analíticas" nav link, and opening `/admin/analiticas` directly redirects away.
- [ ] **Step 3: Run the new int tests and `pnpm e2e e2e/admin-analiticas.spec.ts`.** Expected: FAIL.
- [ ] **Step 4: Implement** the page, actions, components and nav link. Classify both actions in `surface.ts` with `adminAction(...)`: "Unlock analytics for 15 min with the store PIN (5 failures / 15 min)." and "Lock analytics now.". Then run `UPDATE_SURFACE_DOC=1 pnpm test:security`.
- [ ] **Step 5: Run `pnpm lint && pnpm test && pnpm test:int && pnpm test:security && pnpm build`, then `pnpm e2e e2e/admin-analiticas.spec.ts`.** Expected: all pass.
- [ ] **Step 6: Commit:** `feat(analytics): admin analytics page with PIN lock`.
