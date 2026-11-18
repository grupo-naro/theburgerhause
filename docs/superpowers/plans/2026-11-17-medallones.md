# Medallones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Products carry a beef-patty count (0–3). Every sale snapshots it, and Analíticas shows total patties with a comparison and a Simple/Doble/Triple unit breakdown.

**Architecture:** Same path as the cost feature on this branch. `products.patties` travels catalog → `ResolvedUnit` → `insertOrderItems` → `order_items.patties_snapshot`, and stored add-on JSON accepts an optional `patties`. A new `getPatties` query reuses `VALID`, `curRange` and `prevRange`. The block renders only in the unlocked branch; the locked branch shows `****`.

**Tech Stack:** Next.js 16, React 19, Drizzle/PostgreSQL, zod, Vitest unit + int, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-medallones-design.md`

## Global Constraints

- `products.patties`: `smallint NOT NULL DEFAULT 0`, with check `products_patties_range` (`patties BETWEEN 0 AND 3`). `order_items.patties_snapshot`: `smallint NOT NULL DEFAULT 0`. The migration is `0019_patties` (generated, renamed, journal tag updated).
- The field is editable by admin AND encargado (it is not sensitive). Extras never add patties.
- The same orders as revenue are counted: `VALID` statuses, `curRange`, and `prevRange` with `prevCutAt`.
- Copy, verbatim:
  - field label: `Medallones de carne`;
  - block title: `Medallones`;
  - total: `{n} medallones` (`1 medallón` when n = 1);
  - breakdown: `Simple: {a} u · Doble: {b} u · Triple: {c} u` (omit a level with 0 units; `Sin hamburguesas en este período` when all are 0).
- Locked: the block shows `****` and no number is sent.
- Seed:
  - `Hamburguesa simple + papa chica` products → 1;
  - `Hamburguesa doble + papa chica` → 2;
  - all others → 0;
  - a re-seed only fills seeded rows still at 0 in those two categories.
- Gates before each commit: `pnpm lint`, `pnpm test`, and `pnpm test:int` for int tests. `pnpm build` at the end of Task 3, plus `pnpm e2e e2e/admin-analiticas.spec.ts e2e/admin-menu.spec.ts`.

## Review Focus

- A product without a patties value in the form (older forms or tampered requests): its value is left unchanged on edit and is 0 on create. Covered in Task 1 (`undefined keeps patties`).
- `patties = 4` or `-1` is rejected with a clear message and never reaches the DB. Covered in Task 1.
- A pending add-on JSON without `patties` still confirms and counts 0. Covered in Task 2.
- A product changed from 2 to 3 patties does not change past sales. Covered in Task 2.
- Cancelled or pending orders do not count. Covered in Task 3.

---

### Task 1: Patties field on products

**Files:**
- Modify: `src/db/schema.ts` (both columns and the check); create migration `0019_patties.sql`.
- Modify:
  - `src/lib/menu/schemas.ts`: `patties: z.number().int("…").min(0, "Entre 0 y 3 medallones").max(3, "Entre 0 y 3 medallones").optional()`;
  - `src/lib/menu/form-data.ts`: a missing key gives `undefined`; otherwise `Number(value)`;
  - `src/lib/menu/admin.ts` `saveProduct`: `undefined` → omit the key on update; insert uses 0.
- Modify:
  - `src/app/(admin)/admin/menu/_components/product-form.tsx`: a `<Select name="patties">` with options 0–3 and label `Medallones de carne`, always shown;
  - the product new/edit pages pass `initial.patties`.
- Test: `src/lib/menu/schemas.test.ts`, `src/lib/menu/cost-form.test.ts` (or a new form-data test), `src/lib/menu/admin.int.test.ts`

**Interfaces:**
- Produces: `products.patties` (number 0–3) and `orderItems.pattiesSnapshot` (column only; Task 2 writes it).

- [ ] **Step 1: Write the failing tests.**
  - Schema: accepts `0` and `3`. Rejects `4`, `-1` and `1.5` with `Entre 0 y 3 medallones` (and the int message for 1.5).
  - Form-data: a missing key gives `undefined`, and `"2"` gives `2`.
  - Int:
    - `create stores patties`: `patties: 2` → 2.
    - `create without patties defaults to 0`.
    - `undefined keeps patties`: an edit without `patties` keeps 2.
    - The encargado can save `patties`. This is covered at the core level: the action does not strip it, so assert in `menu/actions.int.test.ts` that an encargado save with `patties=3` stores 3.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Add the columns.** Run `pnpm db:generate`, rename the file to `0019_patties.sql` and fix the journal. Check that the SQL contains only 2 `ADD COLUMN` lines and 1 `ADD CONSTRAINT` line.
- [ ] **Step 4: Implement the schema, form-data, core, form and pages.** Run `pnpm db:migrate` on the dev DB, so `build` can prerender.
- [ ] **Step 5: Run `pnpm lint && pnpm test && pnpm test:int`.** Expected: PASS.
- [ ] **Step 6: Commit:** `feat(patties): beef patty count on products (0-3)`.

---

### Task 2: Snapshot patties on every sale

**Files:**
- Modify:
  - `src/lib/orders/resolve-units.ts`: `CatalogProduct.patties?: number`;
  - `src/lib/orders/order-rows.ts`: `loadCatalog` selects it, and `insertOrderItems` writes `pattiesSnapshot: u.product.patties ?? 0`;
  - `src/lib/orders/addons.ts`: the stored product object gets `patties: z.number().int().optional()`.
- Test: `src/lib/orders/cost-snapshot.int.test.ts` (extend; rename the describe to "sale snapshots" if it reads better)

**Interfaces:**
- Consumes: `products.patties`.
- Produces: `order_items.patties_snapshot`.

- [ ] **Step 1: Write the failing int tests.**
  - `sale snapshots patties`: ranchita with patties 2 → its item has `pattiesSnapshot` 2.
  - `later patties change does not touch past sales`: update ranchita to 3 → the item stays 2.
  - `legacy add-on json without patties`: strip the `patties` keys like the cost test does → confirm succeeds and the snapshot is 0.
  - `public menu has no patties`: `loadMenu` JSON has no `"patties"` key (keep the public DTO unchanged; it is not needed there).
- [ ] **Step 2: Run them.** Expected: FAIL (the public-menu assertion may already pass: keep it as a guard).
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run `pnpm lint && pnpm test && pnpm test:int`.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(patties): every sale snapshots the product's patties`.

---

### Task 3: Medallones block in Analíticas

**Files:**
- Modify: `src/lib/analytics/queries.ts`. Add `type Patties = { total: number; byLevel: { 1: number; 2: number; 3: number } }` (units per level) and `getPatties(db, period): Promise<{ cur: Patties; prev: Patties }>`. Sums are cast `::bigint` → `Number`, like the money sums.
- Create: `src/lib/analytics/patties-copy.ts`, with `pattiesTotalText(n)` and `pattiesBreakdownText(byLevel)`, plus its unit test.
- Modify:
  - `src/app/(admin)/admin/analiticas/_components/blocks.tsx`: `PattiesBlock({ data })` with `data-testid="patties"`, showing the total, the `Delta` against prev and the breakdown; `LockedPattiesBlock()` with `****`;
  - `page.tsx`: call `getPatties` only when unlocked, and place the block after the KPIs/warning, full width.
- Modify: `src/db/seed.ts` (patties per the Global Constraints).
- Test: `src/lib/analytics/queries.int.test.ts`, `src/lib/analytics/patties-copy.test.ts`, `src/db/seed.int.test.ts`, `e2e/admin-analiticas.spec.ts`

**Interfaces:**
- Consumes: `order_items.patties_snapshot`, plus `Period`, `VALID`, `curRange` and `prevRange`.

- [ ] **Step 1: Write the failing tests.**
  - Int `patties count by snapshot`: 3 units with snapshot 1, 2 with snapshot 2, 1 with snapshot 3 and 4 with snapshot 0. Expected `{ total: 3 + 4 + 3 = 10, byLevel: { 1: 3, 2: 2, 3: 1 } }`.
  - Int `patties use the same orders as revenue`: cancelled and pending orders are excluded, and `prevCutAt` is respected.
  - Int `empty period patties`: `{ total: 0, byLevel: { 1: 0, 2: 0, 3: 0 } }`.
  - Copy:
    - `pattiesTotalText(1)` → `1 medallón`;
    - `pattiesTotalText(1284)` → `1.284 medallones`;
    - the breakdown omits zero levels, and all zero gives `Sin hamburguesas en este período`.
  - Seed: the simple-category products have 1, the double-category ones 2, and every other product 0.
  - E2E: once unlocked, `getByTestId("patties")` contains `medallones` or `medallón`. While locked, its text has no digit.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run `pnpm lint && pnpm test && pnpm test:int && pnpm build && pnpm e2e e2e/admin-analiticas.spec.ts e2e/admin-menu.spec.ts`.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(analytics): medallones block (total, comparison, simple/doble/triple)`.
