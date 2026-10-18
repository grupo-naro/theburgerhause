# Pantalla de cocina (KDS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kitchen screen `/cocina` showing orders in preparation as cards, where the cook marks "LISTO" with one tap; replaces the paper kitchen ticket.

**Architecture:** New read model over existing orders (status `en_preparacion`), reusing the existing `markReady` core and the SSE `LiveRefresh` pattern; one new role `cocina`; one new reverse transition (undo ready) with audit. No new order status.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` first), Drizzle/PostgreSQL, Vitest (unit + `*.int.test.ts`), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-18-pantalla-cocina-design.md`

## Global Constraints

- Spanish (es-AR) UI copy; money untouched; ONE `order_items` row per unit (one card per ORDER, units numbered inside).
- Authorization enforced server-side first (`requireRole`), sector rule exempt ONLY for role `cocina` and ONLY for ready/undo-ready.
- Exactly ONE EventSource per page (`LiveRefresh`); targets ≥ 56 px; dark high-contrast; no horizontal overflow at 1280/1024/768.
- New Server Actions/pages must be classified in `src/lib/security/surface.ts` (`pnpm test:security` fails otherwise); regenerate `docs/ops/security-surface.md`.
- Thresholds default: green < 8 min, yellow 8–15, red ≥ 15 (settings keys editable in Admin → Ajustes).
- Commit with explicit paths only; never `.env`, `.superpowers`, `bh.dump`, `test-results`, `perf-reports`, `.uploads*`.

## Review Focus

- Order with 6+ units and long modifier lists: card must stay readable (scroll inside the card, never clip text).
- Cancelled / already-ready order disappears live; tapping LISTO on a stale card gives a friendly "ya no está en preparación", no 500.
- Double tap on LISTO = one transition. Two kitchen screens open: the second tap is a no-op message.
- Undo after the order was already called/assigned/delivered is refused with a clear message.
- Order created before the cutoff/with notes containing HTML/emoji renders as text.

---

### Task 1: Role, settings and kitchen domain (server)

**Files:** modify `src/lib/auth/roles.ts`, user admin form/labels (`src/app/(admin)/admin/usuarios/_components/{role-label.ts,user-form.tsx}` and the users action schema), `src/lib/events/sse.ts` (`STAFF_ROLES`), schema/migration for the role (check if `role` is an enum/check constraint in `src/db/schema.ts`; add migration `0007_*`), settings (`src/lib/settings/*`, keys `kds_warn_minutes`=8, `kds_late_minutes`=15, defaults in migration/seed/init-prod), `src/lib/security/surface.ts`; create `src/lib/orders/kitchen-queries.ts`, `src/lib/orders/undo-ready.ts`, `src/app/(staff)/cocina/actions.ts`.

**Interfaces:**
- Produces: `listKitchenBoard(db, ctx?: { now?: Date }): Promise<KitchenCard[]>` where `KitchenCard = { id, number, type: "delivery"|"mostrador"|"retiro", pager: number|null, since: Date, units: { n: number; productName: string; lines: string[] }[], note: string|null }` (lines from the stored kitchen labels/snapshots, uppercase as the old kitchen ticket); `listRecentlyReady(db, { limit?: number }): Promise<KitchenCard[]>` (status `listo_despacho` or `para_retirar` that nobody has called/assigned yet, newest first, default 6); `undoReady(db, { orderId, userId }): Promise<DispatchResult<DispatchOrderData>>`; actions `kitchenReadyAction({orderId})`, `kitchenUndoAction({orderId})` in `src/app/(staff)/cocina/actions.ts`, roles `cocina`, `cajera`, `encargada_delivery`, `admin`; `kitchenThresholds(): { warnMin: number; lateMin: number }` and `ageColor(minutes, t): "green"|"yellow"|"red"` (pure, in `src/lib/orders/kitchen-age.ts`).
- Consumes: existing `markReady` in `src/lib/orders/dispatch.ts`, `sectorOfOrder`/`decideSector`, order event audit, settings reader.

- [ ] **Step 1:** RED unit tests `src/lib/orders/kitchen-age.test.ts`: `ageColor(7,{warnMin:8,lateMin:15})==="green"`, `(8)`→`"yellow"`, `(14)`→`"yellow"`, `(15)`→`"red"`.
- [ ] **Step 2:** RED int tests `src/lib/orders/kitchen-queries.int.test.ts`: board lists only `en_preparacion`, oldest first, types derived from fulfillment/channel, units numbered with modifier lines, note present; cancelled/ready orders absent; `listRecentlyReady` excludes called/assigned/delivered. `src/lib/orders/undo-ready.int.test.ts`: `listo_despacho`→`en_preparacion` and `para_retirar`→`en_preparacion` write an `order_events` row and clear nothing else; refused when order is `en_camino`, `entregado`, assigned to a cadet, or pager already called.
- [ ] **Step 3:** Implement the modules above; `cocina` role passes `decideSector` for ready/undo only (add an explicit `kitchen` actor flag, do not weaken the rule for other actions). Migration for role + settings defaults; admin Users form offers "Cocina".
- [ ] **Step 4:** Action int tests `src/app/(staff)/cocina/actions.int.test.ts`: anonymous/wrong role rejected before DB; `cocina` marks a delivery order and a takeaway order ready; double call → second returns the friendly "ya no está en preparación" code, one event written; classify both actions in `surface.ts`, run `pnpm test:security` and regenerate `docs/ops/security-surface.md`.
- [ ] **Step 5:** `pnpm lint && pnpm test && pnpm test:int && pnpm test:security`, commit `feat(kds): cocina role, kitchen queries, ready/undo actions`.

### Task 2: Kitchen screen UI

**Files:** create `src/app/(staff)/cocina/page.tsx`, `src/components/cocina/{kitchen-board.tsx,kitchen-card.tsx,recently-ready.tsx}`, `src/lib/cocina/` pure helpers if needed; modify `src/lib/caja/nav.ts` + `workspaces.ts` (role home for `cocina` = `/cocina`, nav link "Cocina" for cajera/encargada/admin), `src/proxy.ts` matcher if routes are enumerated, `src/components/staff/staff-shell.tsx` (hide navigation chrome for `cocina`: fullscreen).

**Interfaces:** Consumes Task 1 queries/actions. Produces route `/cocina`.

- [ ] **Step 1:** RED unit tests for nav (`cocina` → only `/cocina`; cajera/encargada/admin get "Cocina") and any pure helper (age label "hace 7 min").
- [ ] **Step 2:** Page (dynamic, in `<Suspense>`, `requireSessionOrRedirect([...4 roles])`) renders `KitchenBoard` with `LiveRefresh` (one EventSource) and `useNewOrderAlert` + sound toggle (shared `useSoundPreference`) for new cards.
- [ ] **Step 3:** `KitchenCard` per design A: big number, type tag colors (DELIVERY orange `#e0612b`, MOSTRADOR blue `#3b6fd1`, RETIRO distinct), age clock colored by `ageColor`, "LLAMADOR n" for counter sales, units numbered with modifier lines, note highlighted, full-width "LISTO" button ≥ 56 px using the guarded-action hook (synchronous in-flight ref + `useTransition`). On success: toast "Pedido #N listo · Deshacer" (8 s) calling `kitchenUndoAction`. `RecentlyReady` strip with "Volver a preparación".
- [ ] **Step 4:** Empty state ("Sin pedidos en preparación"), friendly stale-card message, long-order scroll inside the card; screenshot at 1280/1024/768 and LOOK at them (fix visible defects in separate commits).
- [ ] **Step 5:** `pnpm lint && pnpm test && pnpm build`, commit `feat(kds): kitchen screen`.

### Task 3: E2E, docs and cleanup

**Files:** create `e2e/cocina.spec.ts`; modify `e2e/journey-*.spec.ts` only if a journey should use the kitchen, `docs/guias/*` (all "DEFINIR POR EL DUEÑO" kitchen notes replaced by the real procedure + a new `docs/guias/guia-cocina.md` one-pager), `docs/ops/runbook.md`, README route map, `e2e/README.md`.

- [ ] **Step 1:** E2E (cocina storageState via the e2e seed: add a `cocina` user to the e2e seed/helper): web delivery order approved at Delivery PC appears LIVE on `/cocina` with the exact unit/modifier text, note and type tag; LISTO moves it to the Delivery "Listos" lane live; takeaway and counter orders likewise (counter shows LLAMADOR); undo returns it to preparation; double tap = one event; cancelled order disappears; `cocina` cannot open `/caja`, `/retiro`, `/delivery`; cajera/admin can open `/cocina`; exactly one EventSource; layout 1280/1024/768 (no overflow, targets ≥ 56 px); named screenshots.
- [ ] **Step 2:** Docs per above; UAT scenarios for the kitchen added to `docs/guias/uat-prueba-de-aceptacion.md`; checklist item for the kitchen device.
- [ ] **Step 3:** Run the full gates: `pnpm lint`, `pnpm test`, `pnpm test:int`, `pnpm test:security`, `pnpm build`, fresh-build `pnpm e2e`; commit `test(e2e)+docs: kitchen screen`.
