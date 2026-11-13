# Mostrador unificado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web takeaway orders ("retirar en el local") are handled on `/mostrador/pedidos` together with counter sales. "Retiro en local" disappears. A fixed banner on the cashier's other screens shows how many app orders are waiting for approval.

**Architecture:** `/retiro` already renders the layout we want: `SectorWorkspacePage` → `SectorWorkspace` → `CajaBoard`, with "Por aprobar" and failed prints, then the `DispatchBoard` in `between`, then Recientes. The only difference is that its board is filtered to `channel: "web"`. So `/mostrador/pedidos` becomes that workspace with the board scoped to the whole sector (web + counter), and `/retiro` becomes a redirect. The nav, badges and legacy redirects point at `/mostrador/pedidos`. A pure `originLabel` adds the origin chip on the counter-sector cards. `StaffShell` renders the banner from the `waiting` list it already loads.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` first), React 19, Drizzle/PostgreSQL, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-mostrador-unificado-design.md`

## Global Constraints

- Delivery does not change: `/delivery` and its queries, tabs and cards stay as they are. A cashier never sees delivery orders.
- Origin label text, verbatim: counter sale → `MOSTRADOR`; web takeaway → `APP · RETIRA EN LOCAL`; delivery → no label.
- Banner text, verbatim: `🔔 {n} pedido de la app por aprobar` when n = 1, `🔔 {n} pedidos de la app por aprobar` when n > 1. The button reads `Ver y aprobar` and links to `/mostrador/pedidos`. The banner has no close control.
- The banner is shown on every cashier page except `/mostrador/pedidos`, the page that owns the order alert (`ownsOrderAlert`). The beep and the tab-title count stay as they are.
- No order statuses, tickets, `/pantalla`, kitchen or print agent changes.
- Spanish (es-AR) UI, touch targets ≥ 44 px, one live connection per page.
- `src/lib/security/surface.ts` is updated for changed pages. Regenerate `docs/ops/security-surface.md` with `UPDATE_SURFACE_DOC=1 pnpm test:security`.
- Gates before each commit: `pnpm lint` and `pnpm test`. Also `pnpm test:int` when queries or actions change, and `pnpm build` at the end of Tasks 2 and 4.

## Review Focus

- A cashier with an old `/retiro` bookmark or pinned tab: it must land on `/mostrador/pedidos`, never on a 404. Covered in Task 2 (`retiro redirects`) and Task 4 (e2e).
- A web takeaway order that is approved, then ready, then waiting for pickup must show up in every lane of `/mostrador/pedidos`, not only in "Por aprobar", because today's counter page filters `channel: "counter"`. Covered in Task 4 (e2e journey).
- Delivery orders must never leak into `/mostrador/pedidos` for a cashier. The board is scoped by sector, not by channel. Covered in Task 2 (`mostrador board excludes delivery`).
- The banner on `/mostrador/pedidos` itself would duplicate the "Por aprobar" list, so it must not render there. Covered in Task 3 (`no banner on the page that owns the alert`).
- 0 pending → no banner (no empty orange bar). Covered in Task 3.

---

### Task 1: Origin label on counter-sector cards

**Files:**
- Create: `src/lib/despacho/origin.ts`, `src/lib/despacho/origin.test.ts`
- Modify: `src/components/despacho/preparing-card.tsx`, `src/components/despacho/counter-ready-card.tsx`, `src/components/despacho/pickup-card.tsx`

**Interfaces:**
- Produces: `originLabel(o: { channel: "web" | "counter"; fulfillment: "delivery" | "takeaway" }): string | null`

- [ ] **Step 1: Write the failing test** (`origin.test.ts`):
```ts
expect(originLabel({ channel: "counter", fulfillment: "takeaway" })).toBe("MOSTRADOR");
expect(originLabel({ channel: "web", fulfillment: "takeaway" })).toBe("APP · RETIRA EN LOCAL");
expect(originLabel({ channel: "web", fulfillment: "delivery" })).toBeNull();
```
- [ ] **Step 2: Run `pnpm vitest run src/lib/despacho/origin.test.ts`.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement `originLabel`.** In each of the three cards, render the label as a chip with `data-testid="origin-chip"` near the order number, only when it is non-null. Use a dark chip for `MOSTRADOR` and a violet/brand chip for `APP · RETIRA EN LOCAL`, so the two read differently at a glance.
- [ ] **Step 4: Run the test again, then `pnpm test`.** Expected: PASS. Existing card tests still pass.
- [ ] **Step 5: Commit:** `feat(mostrador): origin label on counter and app takeaway cards`.

---

### Task 2: `/mostrador/pedidos` becomes the unified workspace; `/retiro` redirects

**Files:**
- Modify: `src/components/staff/sector-workspace-page.tsx`. Rename the `retiro` config key to `mostrador` with `path: "/mostrador/pedidos"` and `title: "Mostrador"`. For the mostrador sector the board scope is `{ sector }` (both channels). Delivery keeps `{ sector, channel: "web" }`. `pending` stays `channel: "web"`.
- Modify: `src/app/(staff)/mostrador/pedidos/page.tsx`. It renders `<SectorWorkspacePage which="mostrador" searchParams={searchParams} />` inside `Suspense`, like `/retiro` does today. Keep `metadata.title = "Mostrador · The Burger House 828"`.
- Modify: `src/app/(staff)/retiro/page.tsx`. It becomes `redirect("/mostrador/pedidos")` (no guard needed: the target guards).
- Modify: `src/lib/caja/nav.ts`. `MOSTRADOR_WORKSPACE = [VENTA, MOSTRADOR]`, with `RETIRO` removed. `legacyRedirectTarget("caja", cajera)` returns `"/mostrador/pedidos"`.
- Modify: `src/components/staff/staff-shell.tsx`. The badge key for the mostrador sector is `"/mostrador/pedidos"`.
- Modify: `src/lib/caja/workspaces.ts`. Update the comments that mention `/retiro`; the behavior does not change.
- Modify: `src/lib/security/surface.ts`. The `/mostrador/pedidos` page note becomes "Unified counter workspace: app takeaway approval + counter and app orders in flight + recent". The `/retiro` note becomes "Legacy URL: redirects to /mostrador/pedidos". Then regenerate the doc.
- Test: `src/lib/caja/nav.test.ts`, `src/lib/caja/workspaces.test.ts` (update), `src/lib/orders/dispatch-queries.int.test.ts` (add)

**Interfaces:**
- Consumes: `getDispatchBoard(db, { now, sector, channel? })` (existing).
- Produces: `SectorWorkspacePage({ which: "mostrador" | "delivery", searchParams })`

- [ ] **Step 1: Update the failing unit tests.**
  - `nav.test.ts`: the cajera on a Mostrador station gets `["/mostrador", "/mostrador/pedidos", "/pantalla", "/stock"]` and no `/retiro`. Managers no longer get `/retiro` either.
  - `workspaces.test.ts`: `legacyRedirectTarget("caja", "cajera")` is `"/mostrador/pedidos"`.
  - Add an int test `mostrador board excludes delivery` to the dispatch-queries int tests. Seed one counter takeaway, one web takeaway and one web delivery order, all `en_preparacion`. `getDispatchBoard(db, { now, sector: "mostrador" })` returns preparing = the counter and the web takeaway orders, not the delivery one.
- [ ] **Step 2: Run `pnpm vitest run src/lib/caja` and `pnpm test:int src/lib/orders/dispatch-queries.int.test.ts`.** Expected: the nav and workspaces tests FAIL. The int test may already PASS, which proves the existing sector filter covers it: keep it as a guard.
- [ ] **Step 3: Implement the file changes listed above.**
- [ ] **Step 4: Run `pnpm lint && pnpm test && pnpm test:int && UPDATE_SURFACE_DOC=1 pnpm test:security && pnpm build`.** Expected: all pass.
- [ ] **Step 5: Commit:** `feat(mostrador): app takeaway orders handled on the Mostrador screen; /retiro redirects`.

---

### Task 3: Pending-approval banner on the cashier's other screens

**Files:**
- Create: `src/components/staff/pending-app-orders-banner.tsx`. A server component, no client state.
- Modify: `src/components/staff/staff-shell.tsx`. Render the banner at the top of `<main>` when `sector === "mostrador" && !ownsOrderAlert && waiting.length > 0`.
- Test: `src/components/staff/staff-shell.test.ts` (extend; it already walks the element tree with `contains`)

**Interfaces:**
- Produces: `PendingAppOrdersBanner({ count }: { count: number })`, which renders `role="status"`, `data-testid="pending-app-banner"`, the exact text from Global Constraints and a `Link` "Ver y aprobar" to `/mostrador/pedidos` (min-h 44 px, orange/`state-pending` tone).

- [ ] **Step 1: Write the failing tests** in `staff-shell.test.ts`. Mock `listPendingApproval` to return 2 rows, and use a cajera session with `stationKind: "mostrador"`.
  - `banner on Venta when app orders wait`: the tree contains `PendingAppOrdersBanner` with `count: 2`.
  - `no banner on the page that owns the alert`: with `ownsOrderAlert`, there is no `PendingAppOrdersBanner`.
  - `no banner with nothing pending`: `listPendingApproval` returns `[]`, and there is no banner.
  - `no banner for the delivery manager`: an `encargada_delivery` session on a delivery station gets no banner. The delivery screen is its own workspace and stays as is.
- [ ] **Step 2: Run `pnpm vitest run src/components/staff/staff-shell.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement the banner and wire it into the shell.**
- [ ] **Step 4: Run `pnpm lint && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(mostrador): fixed banner on the cashier screens while app orders wait for approval`.

---

### Task 4: End-to-end sweep

**Files:**
- Modify: `e2e/helpers/caja.ts` (the cashier workspace helper opens `/mostrador/pedidos`), `e2e/helpers/editar.ts`, and every spec that navigates to `/retiro` or asserts the "Retiro en local" link. Find them with `grep -rn "retiro\|Retiro en local" e2e`: `caja-chrome`, `editar-pedido`, `journey-delivery`, `pantalla`, `realtime`, `sector-workspaces`, `security` and others.
- Create: `e2e/mostrador-unificado.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (labels, route, banner).

- [ ] **Step 1: Write the new failing e2e** `mostrador-unificado.spec.ts`. Reuse the existing helpers that place a web takeaway order and the cajera storage state.
  - `a web takeaway order is approved and followed on Mostrador`:
    - Place a web takeaway order.
    - The cajera on `/mostrador` sees `pending-app-banner` with "1 pedido de la app por aprobar".
    - She clicks "Ver y aprobar" and lands on `/mostrador/pedidos`, where she approves the order.
    - The order card shows the `APP · RETIRA EN LOCAL` origin chip in En preparación, and a counter sale in the same lane shows `MOSTRADOR`.
    - The banner is gone on `/mostrador`.
  - `old /retiro link redirects`: `page.goto("/retiro")` ends on `/mostrador/pedidos`.
  - `cashier nav has no Retiro en local`.
- [ ] **Step 2: Run `pnpm e2e e2e/mostrador-unificado.spec.ts`.** Expected: PASS (Tasks 1–3 are in). To prove it can fail, run it once against the commit before Task 2 (`git stash`/checkout `a70d822`): it must FAIL there on the missing banner/redirect.
- [ ] **Step 3: Update the existing specs and helpers** that used `/retiro` so they use `/mostrador/pedidos`. Specs that asserted "Retiro en local" in the nav now assert its absence.
- [ ] **Step 4: Run `pnpm e2e`** (full suite). Expected: all pass except the known-flaky `e2e/editar-pedido.spec.ts:95`, which also fails before this work. Re-run any failure in isolation before blaming it on this change.
- [ ] **Step 5: Commit:** `test(e2e): unified Mostrador screen replaces Retiro en local`.
