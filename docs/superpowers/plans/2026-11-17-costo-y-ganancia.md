# Costo y ganancia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Products and extras get an admin-only cost price. Each sale snapshots it, and Analíticas shows profit (card, per product in the top, and a warning for unit sales without cost).

**Architecture:**
- **Columns.** Two nullable cost columns (`products.cost`, `modifiers.cost`) and two nullable snapshot columns (`order_items.unit_cost_snapshot`, `order_item_modifiers.cost_snapshot`). Money is in centavos and NULL means "sin costo".
- **Cost to sale.** The cost travels catalog → `ResolvedUnit` → `insertOrderItems`, the single writer of sale items. Stored add-on JSON accepts an optional cost.
- **Admin forms.** The save cores treat `costArs: undefined` as "leave unchanged". The Server Actions force `undefined` for non-admins, so the encargado can never overwrite a cost. The admin pages strip the cost before rendering for non-admins.
- **Profit.** A new `getProfit` and an extended `getTopProducts` compute profit from the snapshots, behind the existing PIN lock.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` first), React 19, Drizzle/PostgreSQL, zod via `@/lib/zod`, Vitest unit + `*.int.test.ts`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-costo-y-ganancia-design.md`

## Global Constraints

- Cost is optional (NULL = "sin costo"); 0 is a valid cost. Validation is the same as the price: whole pesos, ≥ 0, max `100_000_000`, stored in centavos. A "remove" modifier ("Sin …") has no cost: it must be empty.
- Only role `admin` sees or edits a cost. For any other role, a save never changes the stored cost, and the cost never reaches a non-admin page.
- The cost never appears in the public menu, cart, checkout, tracking, caja, despacho, `/pantalla` or tickets. No query for those screens selects it.
- Snapshots are taken when units are resolved (order creation, add-on creation, pending-order edit). A later cost change never alters past profit.
- Profit uses the same orders, date range and `prevCutAt` as the KPIs. Delivery fee is excluded.
- A unit counts toward profit only if its `unit_cost_snapshot` is set AND every modifier with `price_delta > 0` has `cost_snapshot` set. Otherwise it counts in "sin costo". The `cost_snapshot` of a free modifier is subtracted when present.
- Unit profit = `unit_price_snapshot + Σ price_delta − (unit_cost_snapshot + Σ coalesce(cost_snapshot, 0))`.
- Margin = profit / revenue of costed units (`null` → "—" when that revenue is 0).
- Copy, verbatim:
  - field labels: `Precio de costo ($)` (product), `Costo ($)` (extra);
  - warning: `El costo es mayor que el precio de venta`;
  - KPI label: `Ganancia`, with the line `margen {n}%`;
  - top row, all units costed: `gana {$}`; some units costed: `gana {$} · {n} sin costo`; none costed: `sin costo`;
  - analytics warning: `{n} unidades sin costo cargado: la ganancia está incompleta` (`1 unidad sin costo cargado: …` when n = 1).
- Locked analytics: the Ganancia card, the profit text in the top and the warning all render `****`, with no number sent.
- Migration `0018_*` via `pnpm db:generate`, renamed `0018_costs`, journal tag updated. Surface entries are unchanged (same actions); still run `pnpm test:security`.
- Gates before each commit: `pnpm lint`, `pnpm test`, and `pnpm test:int` for int tests. Also `pnpm build` at the end of Tasks 2 and 4.

## Review Focus

- The encargado saves a product or extra that has a cost: the cost must stay intact. Covered in Task 2 (`encargado save keeps the cost`).
- An admin clears the cost field: the cost becomes NULL ("sin costo"), not 0, and not unchanged. Covered in Task 1 (`empty cost clears it`).
- A pending add-on stored before this change (JSON without cost) is confirmed: it must still confirm, with a NULL snapshot. Covered in Task 3 (`legacy add-on json without cost`).
- A unit with a paid extra that has no cost goes to "sin costo" entirely, so profit is never inflated. Covered in Task 4 (`paid extra without cost`).
- The cost never leaks to the public menu payload. Covered in Task 3 (`public menu has no cost`).

---

### Task 1: Cost columns and the save cores

**Files:**
- Modify: `src/db/schema.ts`. Add `products.cost: integer("cost")`, `modifiers.cost: integer("cost")`, `orderItems.unitCostSnapshot: integer("unit_cost_snapshot")` and `orderItemModifiers.costSnapshot: integer("cost_snapshot")`, all nullable. Add check constraints `*_cost_nonneg` (`IS NULL OR >= 0`) on products and modifiers, and `modifiers_remove_no_cost` (`kind <> 'remove' OR cost IS NULL`).
- Create: `src/db/migrations/0018_costs.sql` (generated, then renamed) and update the journal.
- Modify: `src/lib/menu/schemas.ts` (`costArs`), `src/lib/menu/form-data.ts`, `src/lib/menu/admin.ts` (`saveProduct`), `src/lib/modifiers/schemas.ts`, `src/lib/modifiers/form-data.ts`, `src/lib/modifiers/admin.ts` (`saveModifier`).
- Test: `src/lib/menu/schemas.test.ts`, `src/lib/modifiers/schemas.test.ts`, `src/lib/menu/admin.int.test.ts`, `src/lib/modifiers/admin.int.test.ts` (extend each).

**Interfaces:**
- Produces:
  - Product and modifier inputs accept `costArs?: number | null`, where `undefined` = leave unchanged (or NULL on create), `null` = clear, and a number = set.
  - `productFromForm(fd)` and `modifierFromForm(fd)`:
    - no `costArs` key in the form → `undefined`;
    - `""` → `null`;
    - a numeric string → the number;
    - anything else → `NaN`, so zod fails.
  - Modifier schema: a `remove` with a non-null cost is an error, `"Un quite no puede tener costo"` on `costArs`.

- [ ] **Step 1: Write the failing tests.**
  - Schemas: `costArs` accepts `1500`, `0`, `null` and `undefined`. It rejects `-1` with the same message as the price, `1.5` and `100_000_001`. A modifier `remove` with `costArs: 0` fails with the message above.
  - Form-data:
    - a missing `costArs` key gives `undefined`;
    - `""` gives `null`;
    - `"1500"` gives `1500`.
  - Int `saveProduct`:
    - `set cost on create and edit`: saved with `costArs: 2800` → `products.cost === 280000`.
    - `undefined keeps it`: an edit without `costArs` keeps `280000`.
    - `empty cost clears it`: `costArs: null` → `NULL`.
  - Int `saveModifier`: the same three cases.
- [ ] **Step 2: Run `pnpm vitest run src/lib/menu src/lib/modifiers` and `pnpm test:int src/lib/menu src/lib/modifiers`.** Expected: FAIL.
- [ ] **Step 3: Add the columns, then run `pnpm db:generate`.** Check that the SQL contains only the 4 `ADD COLUMN` lines and 3 `ADD CONSTRAINT` lines. Rename the file to `0018_costs.sql` and update the tag in `meta/_journal.json`.
- [ ] **Step 4: Implement the schemas, form-data and cores.** `cost: v.costArs === undefined ? <omit key> : v.costArs === null ? null : pesosToCents(v.costArs)`, so an edit leaves the column untouched when the value is undefined.
- [ ] **Step 5: Run the tests again.** Expected: PASS. `pnpm test:int src/db` still passes (schema sync test).
- [ ] **Step 6: Commit:** `feat(costs): cost columns and admin save cores (undefined keeps, empty clears)`.

---

### Task 2: Admin UI: cost field for the admin only

**Files:**
- Modify: `src/app/(admin)/admin/menu/actions.ts` (`saveProductAction`) and `src/app/(admin)/admin/modificadores/actions.ts` (`saveModifierAction`). After `authorizeManager()`, when `auth.session.user.role !== "admin"`, the parsed input gets `costArs: undefined` before calling the core.
- Modify: `src/lib/menu/admin-queries.ts` and `src/lib/modifiers/admin.ts`. Add `export function redactCost<T extends { cost: number | null }>(row: T, role: Role): T | Omit<T, "cost">`, which drops the key for non-admins. Apply it in the pages that call `listMenuForAdmin`, `getProductForAdmin`, `listGroupsWithModifiers` and `getModifierForAdmin` (the four admin pages listed by `grep -rln` for those names).
- Modify: the product and modifier form components (under `src/app/(admin)/admin/menu/_components` and `.../modificadores/_components`). They get a `showCost: boolean` prop: the `Precio de costo ($)` / `Costo ($)` input is rendered only when it is true, with `name="costArs"` and `inputMode="numeric"`. Show the warning `El costo es mayor que el precio de venta` (non-blocking) when both values are filled and cost > price. Hide the extra's cost input when kind is `remove`.
- Test: `src/app/(admin)/admin/menu/actions.int.test.ts`, `src/app/(admin)/admin/modificadores/actions.int.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's `costArs` semantics.
- Produces: `redactCost(row, role)`.

- [ ] **Step 1: Write the failing int tests.**
  - `encargado save keeps the cost`: seed a product with `cost = 280000`. An encargado's `saveProductAction` with the form including `costArs=1` (a tampered request) succeeds, and `cost` is still `280000`. The same for `saveModifierAction`.
  - `admin sets the cost`: admin + `costArs=3000` → `300000`.
  - `redactCost`: for `encargado` the key `cost` is absent (`"cost" in r === false`); for `admin` it is kept.
- [ ] **Step 2: Run `pnpm test:int "src/app/(admin)/admin/menu" "src/app/(admin)/admin/modificadores"`.** Expected: FAIL.
- [ ] **Step 3: Implement the actions, `redactCost`, the page wiring and the form fields.**
- [ ] **Step 4: Run `pnpm lint && pnpm test && pnpm test:int && pnpm test:security && pnpm build`.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(costs): admin-only cost field on products and extras`.

---

### Task 3: Snapshot the cost on every sale

**Files:**
- Modify: `src/lib/orders/resolve-units.ts`: `CatalogProduct.cost: number | null`, `CatalogModifier.cost: number | null`.
- Modify: `src/lib/orders/order-rows.ts`: `loadCatalog` selects `products.cost` and `modifiers.cost`, and `insertOrderItems` writes `unitCostSnapshot: u.product.cost ?? null` and `costSnapshot: m.cost ?? null`.
- Modify: `src/lib/orders/addons.ts`: `modifierSchema` and the `product` object get `cost: z.number().int().nullable().optional()`, so legacy JSON without the key still parses. The confirm path inserts the stored units, so their snapshot is the cost at add-on creation (missing → null).
- Modify: every other `CatalogProduct` or `CatalogModifier` literal the type checker flags (test fixtures included), adding `cost: null`.
- Test: `src/lib/orders/order-rows.int.test.ts` (or the closest existing int test of `createOrder` / `insertOrderItems`), `src/lib/orders/addons.int.test.ts`, `src/lib/menu/queries.int.test.ts` (or the existing public-menu test)

**Interfaces:**
- Produces: the `order_items.unit_cost_snapshot` and `order_item_modifiers.cost_snapshot` values that Task 4 reads.

- [ ] **Step 1: Write the failing int tests.**
  - `sale snapshots product and extra cost`: product cost 280000, extra "+ Dips" cost 40000. Place a web order with 1 unit + that extra. The `order_items.unit_cost_snapshot` is 280000 and the modifier `cost_snapshot` is 40000.
  - `later cost change does not touch past sales`: after the order, update `products.cost` to 999900. The snapshot is still 280000.
  - `product without cost snapshots null`.
  - `legacy add-on json without cost`: insert an `order_addons` row (`pendiente_pago`) whose `units` JSON has no `cost` keys, then confirm it. It succeeds, and the inserted items have `unit_cost_snapshot = null`.
  - `public menu has no cost`: with a cost set, `JSON.stringify(await getMenu())` does not contain the cost value nor the key `"cost"`. If `getMenu` is cached, call the uncached loader it wraps.
- [ ] **Step 2: Run the int tests.** Expected: FAIL. (The public-menu test may already PASS: keep it as a guard.)
- [ ] **Step 3: Implement it.** Run `pnpm exec tsc --noEmit -p .` to find every literal that needs `cost`.
- [ ] **Step 4: Run `pnpm lint && pnpm test && pnpm test:int`.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(costs): every sale snapshots product and extra cost`.

---

### Task 4: Profit in Analíticas

**Files:**
- Modify: `src/lib/analytics/queries.ts`
- Modify: `src/app/(admin)/admin/analiticas/_components/blocks.tsx` and `src/app/(admin)/admin/analiticas/page.tsx`
- Modify: `src/db/seed.ts`. The cost of products and of modifiers with `priceDelta > 0` is `Math.round(price * 0.4 / 100) * 100` (40%, rounded to the peso). `remove` modifiers stay NULL. Only set it when the row has no cost yet, so a re-seed never overwrites a cost an admin entered.
- Test: `src/lib/analytics/queries.int.test.ts` (extend), `e2e/admin-analiticas.spec.ts` (extend)

**Interfaces:**
- Consumes: Task 3's snapshots and Task 1's `Period`/`pctChange` (from `src/lib/analytics/period.ts`).
- Produces:
  - `type Profit = { profit: number; costedRevenue: number; margin: number | null; uncostedUnits: number }`
  - `getProfit(db, period): Promise<{ cur: Profit; prev: Profit }>`
  - `getTopProducts` rows gain `profit: number | null` (null when no unit is costed) and `uncostedUnits: number`.

- [ ] **Step 1: Write the failing int tests**, with the fixtures of the existing file plus snapshot columns on `insertItem` (`cost?`, `modifierCosts?`).
  - `profit of costed units`: 2 units Doble, price 7000 and cost 2800, one with extra +1000 / cost 400. Expected `profit = (7000-2800) + (8000-3200) = 9000`, `costedRevenue = 15000`, `margin = 60` (rounded integer %), `uncostedUnits = 0`.
  - `paid extra without cost`: a costed unit with a +1000 extra that has a NULL cost counts as 1 `uncostedUnits` and adds nothing to profit.
  - `free extra cost is subtracted`: an extra with price 0 and cost 300 lowers the profit by 300.
  - `profit uses the same orders as revenue`: cancelled and pending orders are excluded, and the previous range respects `prevCutAt`. Mirror the existing KPI tests.
  - `empty period profit`: `{ profit: 0, costedRevenue: 0, margin: null, uncostedUnits: 0 }`.
  - `top product partial profit`: Doble has 2 costed and 1 uncosted unit. Expected `profit` = the 2 units' profit and `uncostedUnits: 1`. A product with no costed unit gives `profit: null`.
- [ ] **Step 2: Run `pnpm test:int src/lib/analytics`.** Expected: FAIL.
- [ ] **Step 3: Implement `getProfit` and extend `getTopProducts`.** Use the same `VALID`, `curRange` and `prevRange` helpers. A unit is costed when `unit_cost_snapshot IS NOT NULL AND NOT EXISTS (modifier with price_delta > 0 AND cost_snapshot IS NULL)`.
- [ ] **Step 4: UI.**
  - `KpiCards` gets a fifth card, `Ganancia`: value `formatARS(cur.profit)`, a line `margen {n}%` (or `margen —`) and the `Delta` against `prev.profit`.
  - `LockedKpiCards` adds the masked fifth card. The grid becomes `grid-cols-2 lg:grid-cols-5`.
  - The `TopProducts` row text appends the profit copy from Global Constraints. `LockedTopProducts` stays names only, with `****`.
  - The page shows the analytics warning (copy from Global Constraints) under the KPIs when `cur.uncostedUnits > 0`, with `data-testid="uncosted-warning"`. When locked it shows nothing.
  - The page calls `getProfit` only in the unlocked branch, next to `getKpis`.
- [ ] **Step 5: Extend the e2e.** After unlocking, the KPI block contains `Ganancia`. While locked, the KPI block text still matches no digit (the existing assertion now covers the fifth card).
- [ ] **Step 6: Run `pnpm lint && pnpm test && pnpm test:int && pnpm build && pnpm e2e e2e/admin-analiticas.spec.ts`.** Expected: PASS.
- [ ] **Step 7: Commit:** `feat(analytics): profit card, profit per product and uncosted warning; demo costs in seed`.
