# Precios de compra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin records the unit price of each stock replenishment (ingreso) and sees, in a new Stock tab, every priced purchase per article with its total and the % change against the previous purchase.

**Architecture:** A nullable `unit_price` column on `stock_movements` (only for `ingreso`). The ingreso core accepts it; a new admin-only core/action sets or clears it afterwards. Pure helpers compute totals and % change; one query groups priced ingresos per article. UI: an admin-only field in "Reponer stock" and an admin-only page `/admin/stock/precios`.

**Tech Stack:** Next.js 16.4.6 (read `node_modules/next/dist/docs/` before touching routing/actions), React 19 `useActionState`, Drizzle + PostgreSQL 16, zod via `@/lib/zod`, Vitest (unit + `*.int.test.ts`), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-precios-de-compra-design.md`

## Global Constraints

- `unit_price` is integer **centavos per whole unit** (per kg, per l, per u). NULL = no price. DB check: `unit_price IS NULL OR (kind = 'ingreso' AND unit_price > 0)`.
- Total (centavos) = `round(qty_delta_milli × unit_price / 1000)`, computed on read, never stored. Use BigInt for the product (milli × centavos can exceed 2^53).
- % change = against the **immediately previous priced, non-annulled ingreso of the same item**, ordered by `business_date` then `id`. None → no %. Display: `▲ 20%`, `▼ 6,5%`, `= 0%`; at most one decimal, es-AR comma, trailing `,0` dropped.
- Annulled movements (`qty_delta = 0`) are neither listed nor used as "previous".
- Price input uses `parsePesosToCents` from `src/lib/rendicion/parse-pesos.ts` ("1.500", "1500", "1.500,50"). Empty = no price. Must be > 0.
- Only the admin enters or sees prices. The encargado's "Reponer stock", "Historial" and subnav are unchanged. A non-admin request carrying `unitPrice` is rejected with `"Solicitud inválida."`.
- Tab label: `Precios de compra`; route `/admin/stock/precios`; page title `Precios de compra · Administración`.
- Copy (Spanish): field label `Precio unitario (opcional)`, hint `Por ${UNIT_LABEL[unit]}. Ej: 2.000`; live total `Total: $40.000`; success after price edit `Precio guardado`; invalid price `Ingresá un precio válido`.
- Migration file `src/db/migrations/0021_purchase_prices.sql` generated with drizzle-kit (`pnpm db:generate` or the project's script), never hand-numbered differently.
- e2e and int share `burgerhause_test`: never run them concurrently.

## Review Focus

- Encargado opens `/admin/stock/precios` by URL → redirected like any admin-only page (Task 4 e2e).
- Same idempotency key resubmitted with a **different price** → `KEY_REUSED` conflict, not a silent second price (Task 1 int test).
- Quantity later corrected in Historial → the purchase total follows the new quantity; corrected to 0 → disappears and the next purchase's % compares with the one before (Task 2 int test).
- Price with centavos `1.500,50` and a fractional kg quantity `12,5` → total `$18.756,25` = 1 875 625 centavos (Task 2 unit test).
- Encargado's reponer form posts no `unitPrice` and keeps working exactly as before (Task 3 int test).

---

### Task 1: Column + ingreso core with price + price edit core

**Files:**
- Modify: `src/db/schema.ts` (stockMovements: column + check)
- Create: `src/db/migrations/0021_purchase_prices.sql` (generated)
- Modify: `src/lib/stock/schemas.ts` (`ingresoSchema`, new `setIngresoPriceSchema`)
- Modify: `src/lib/stock/movements.ts` (`RecordMovementInput`, `recordMovement`, `registerIngreso`, new `setIngresoPrice`)
- Test: `src/lib/stock/movements.int.test.ts`

**Interfaces:**
- Produces:
  - `stockMovements.unitPrice: integer("unit_price")` nullable; check name `stock_movements_unit_price_ingreso`.
  - `registerIngreso(db, { itemId, userId, milli, note?, idempotencyKey, unitPrice?: number | null })` — stores `unitPrice ?? null`.
  - `setIngresoPrice(db: Db, input: { movementId: number; unitPrice: number | null }): Promise<Result<null>>` — only `kind = 'ingreso'` movements; otherwise `stockFailure("NOT_FOUND", STOCK_MESSAGES.MOVEMENT_NOT_FOUND)` (reuse the existing message if present, else add `MOVEMENT_NOT_FOUND: "El movimiento no existe"`). Does not touch quantity, balance or pause.

- [ ] **Step 1: Write failing int tests** in `movements.int.test.ts`:
  - `registerIngreso stores the unit price` → movement row `unitPrice === 200000`.
  - `registerIngreso without price stores null`.
  - `same key with a different price is a conflict` → first call `unitPrice: 200000`, second same key `unitPrice: 210000` → `ok: false`, error `STOCK_MESSAGES.KEY_REUSED`; only one movement exists.
  - `same key and same price returns the first result` → `ok: true`, one movement.
  - `setIngresoPrice sets and clears` → 150000 then null; quantity of the item unchanged.
  - `setIngresoPrice refuses a consumo movement` → `ok: false`.
  - `unitPrice 0 is rejected` (schema) → `ok: false`, kind VALIDATION.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/stock/movements.int.test.ts` → the new tests FAIL.
- [ ] **Step 3: Implement.** Schema column + check; `ingresoSchema.unitPrice: z.number().int().positive().max(2_147_483_647).nullable().optional()`; pass `unitPrice` through `recordMovement` (new optional field `unitPrice?: number | null`); include `(prev.unitPrice ?? null) === (input.unitPrice ?? null)` in the `duplicate` sameness check. `setIngresoPrice` updates `unit_price` where `id = movementId AND kind = 'ingreso'`, returning the id. Generate the migration; check it only adds the column and the check.
- [ ] **Step 4: Run** `pnpm db:migrate:test` (or the project's test-migrate script) then the test file → PASS. Run `pnpm vitest run src/lib/stock` → all PASS.
- [ ] **Step 5: Commit** `feat(stock): ingresos can carry a unit price (admin purchase prices)`.

### Task 2: Totals, % change and the purchases query

**Files:**
- Create: `src/lib/stock/purchases.ts`
- Test: `src/lib/stock/purchases.test.ts`, `src/lib/stock/purchases.int.test.ts`

**Interfaces:**
- Consumes: `stockMovements.unitPrice` (Task 1).
- Produces:
  - `purchaseTotal(milli: number, unitPrice: number): number` — centavos, `round(milli*unitPrice/1000)` via BigInt, half up.
  - `priceChangePct(prev: number, cur: number): number` — `(cur - prev) / prev * 100`, rounded to 1 decimal.
  - `formatPriceChange(pct: number): string` — `"▲ 20%"`, `"▼ 6,5%"`, `"= 0%"`.
  - `type Purchase = { movementId: number; businessDate: string; milli: number; unitPrice: number; total: number; changePct: number | null; userName: string | null; note: string | null }`
  - `type PurchaseGroup = { itemId: number; itemName: string; unit: Unit; last: Purchase; purchases: Purchase[] }` (purchases newest first; `last = purchases[0]`).
  - `listPurchases(db: Conn, opts?: { itemId?: number; perItem?: number }): Promise<PurchaseGroup[]>` — priced, `qty_delta <> 0`, `kind = 'ingreso'`; groups ordered by their newest purchase desc; `perItem` default 12 (the % of the oldest shown row still uses its real previous purchase).
  - `listUnpricedIngresos(db: Conn, itemId: number, limit?: number): Promise<{ movementId: number; businessDate: string; milli: number; userName: string | null }[]>` — `unit_price IS NULL`, `qty_delta <> 0`, newest first, default limit 20.

- [ ] **Step 1: Write failing unit tests** (`purchases.test.ts`):
  - `purchaseTotal(20_000, 200_000) === 4_000_000` (20 kg × $2.000 = $40.000).
  - `purchaseTotal(40_000, 150_000) === 6_000_000` (40 u × $1.500).
  - `purchaseTotal(12_500, 150_050) === 1_875_625` (12,5 kg × $1.500,50 = $18.756,25).
  - `purchaseTotal(2_000_000_000, 2_000_000_000) === 4e15` (the product 4e18 exceeds 2^53; BigInt path keeps it exact).
  - `purchaseTotal(1, 1_499) === 1` and `purchaseTotal(1, 1_500) === 2` (half up).
  - `priceChangePct(200_000, 240_000) === 20`; `priceChangePct(160_000, 150_000) === -6.3` (−6.25 → −6.3); `priceChangePct(100, 100) === 0`.
  - `formatPriceChange(20) === "▲ 20%"`, `formatPriceChange(-6.5) === "▼ 6,5%"`, `formatPriceChange(0) === "= 0%"`.
- [ ] **Step 2: Write failing int tests** (`purchases.int.test.ts`), using `src/lib/stock/test-fixtures.ts`:
  - Two items, three priced ingresos for cheese (2000, 2000→2400 order), one unpriced → group `last.unitPrice === 240000`, `last.changePct === 20`, oldest `changePct === null`, unpriced not listed, groups ordered newest first.
  - Annul the middle purchase (edit qty to 0 via `editMovement`) → it disappears and the newest compares with the oldest.
  - Edit quantity of a priced purchase 20 → 10 → its `total` halves.
  - `itemId` filter returns only that group; `listUnpricedIngresos` returns only the unpriced one.
- [ ] **Step 3: Run** both files → FAIL.
- [ ] **Step 4: Implement** `purchases.ts`. Compute `changePct` in SQL with `lag(unit_price) over (partition by item_id order by business_date, id)` over the filtered (priced, non-annulled) set, then limit per item with `row_number()` in an outer query; join `users` for the name. No next/* imports.
- [ ] **Step 5: Run** → PASS. **Commit** `feat(stock): purchase totals, price change and per-article purchase history`.

### Task 3: Actions (admin-only price) + security surface

**Files:**
- Modify: `src/app/(admin)/admin/stock/actions.ts` (`registerIngresoAction`, new `setPurchasePriceAction`)
- Modify: `src/lib/security/surface.ts` (+ regenerate doc: `UPDATE_SURFACE_DOC=1 pnpm test:security`)
- Test: `src/app/(admin)/admin/stock/actions.int.test.ts`

**Interfaces:**
- Consumes: `registerIngreso(..., unitPrice)`, `setIngresoPrice` (Task 1); `parsePesosToCents`.
- Produces:
  - `registerIngresoAction` reads optional field `unitPrice`. Key absent or blank → no price. Present and non-blank: if role ≠ admin → `{ error: "Solicitud inválida." }` (no movement written); if `parsePesosToCents` fails or cents = 0 → `{ error: "Ingresá un precio válido", fieldErrors: { unitPrice: "Ingresá un precio válido" }, values }`.
  - `setPurchasePriceAction(_prev: StockActionState, fd: FormData): Promise<StockActionState>` — `authorizeAdmin()` first; fields `movementId`, `unitPrice` (blank = clear). Success `{ message: "Precio guardado" }` and `revalidatePath("/admin/stock/precios")`.
  - Surface: `registerIngresoAction` note updated ("…; the unit price is admin-only"); new `adminAction("Set or clear the unit price of an ingreso (purchase prices).")` for `setPurchasePriceAction`.

- [ ] **Step 1: Failing int tests:** admin ingreso with `unitPrice "2.000"` stores 200000; encargado ingreso with `unitPrice "2.000"` → `"Solicitud inválida."` and no movement; encargado without the field works as before; admin `"abc"` → field error `Ingresá un precio válido`; `"0"` → same; `setPurchasePriceAction` as encargado → unauthorized state (same shape the other admin actions return), as admin sets/clears.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the file plus `pnpm test:security` (after regenerating the doc) → PASS.
- [ ] **Step 5: Commit** `feat(stock): admin-only unit price on ingresos and price correction action`.

### Task 4: UI — price field, tab and page

**Files:**
- Modify: `src/app/(admin)/admin/stock/_components/ingreso-form.tsx` (prop `showPrice: boolean`)
- Modify: `src/app/(admin)/admin/stock/reponer/page.tsx` (pass `showPrice={session.user.role === "admin"}`)
- Modify: `src/app/(admin)/admin/stock/layout.tsx` (make async, `requireSessionOrRedirect(["admin","encargado"])`, pass `isAdmin` to the subnav)
- Modify: `src/app/(admin)/admin/stock/_components/stock-subnav.tsx` (prop `isAdmin`; the `Precios de compra` link only when true, after Historial)
- Create: `src/app/(admin)/admin/stock/precios/page.tsx`
- Create: `src/app/(admin)/admin/stock/_components/purchase-price-form.tsx` (small client form for `setPurchasePriceAction`)
- Test: `e2e/stock-purchase-prices.spec.ts`

**Interfaces:**
- Consumes: `listPurchases`, `listUnpricedIngresos`, `formatPriceChange`, `purchaseTotal` (Task 2); `setPurchasePriceAction` (Task 3); `formatARS`, `formatQuantity`, `UNIT_LABEL`.

Behavior:
- Ingreso form: when `showPrice`, field `unitPrice` (`inputMode="decimal"`, label/hint from Global Constraints) and, under it, a live `Total: $…` computed client-side from the typed quantity and price (parse both; show nothing while either is invalid). Use `parsePesosToCents` and the quantity parser the form's unit uses (`parseQuantity` from `src/lib/stock/quantity.ts`) — both are pure, import them in the client.
- Page `/admin/stock/precios`: `requireSessionOrRedirect(["admin"], "/admin/stock/precios")`; `?item=<id>` filter (validated like the reponer page) with a select `Artículo: Todos / …`; one card per group: header `Name (unit)`, `Último: $2.400 / kg` and the `formatPriceChange` badge (`data-testid="price-change"`); rows `18/11 · 20 kg × $2.400 = $48.000 · ▲ 20% · Juan`, each with an "Editar precio" toggle opening `PurchasePriceForm`. When filtered by one item, a section `Reposiciones sin precio` listing `listUnpricedIngresos` with the same form to add a price. Empty state: `Todavía no hay compras con precio. Cargá el precio al reponer stock.`
- Mobile-first: no horizontal scroll at 360 px; rows wrap.

- [ ] **Step 1: Failing e2e** (`stock-purchase-prices.spec.ts`), admin session: create an item `Queso test <rand>` (kg), reponer 10 kg at `2.000` → sees `Total: $20.000` before submitting; reponer 20 kg at `2.400`; open `Precios de compra` → card shows `Último: $2.400` and `▲ 20%`. Second test: encargado session → no `Precios de compra` link in the subnav, no `Precio unitario` field in reponer, and `goto("/admin/stock/precios")` ends away from that URL. Third: an unpriced ingreso gets a price from `Reposiciones sin precio` → appears in the list.
- [ ] **Step 2: Run** `pnpm exec playwright test e2e/stock-purchase-prices.spec.ts` → FAIL.
- [ ] **Step 3: Implement** the UI.
- [ ] **Step 4: Run** the new spec plus `e2e/admin-stock.spec.ts` → PASS. Run `pnpm lint` and `pnpm exec tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `feat(stock): "Precios de compra" tab and unit price when replenishing (admin)`.

### Task 5: Full verification

- [ ] `pnpm test` (unit) → PASS; then `pnpm test:int` → PASS; then (not concurrently) `pnpm exec playwright test` → PASS; `pnpm build` → OK.
- [ ] Commit any regenerated surface doc if it changed.
