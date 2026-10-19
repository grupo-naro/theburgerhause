# Admin mobile UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/admin/*` phone-first: ☰ drawer navigation, product/modifier/user/cadet cards with big tap targets below `md`, desktop unchanged.

**Architecture:** Presentation-only change. Below `md` (768 px) the admin shell renders a sticky top bar with a ☰ drawer; list screens render a card list (`md:hidden`) next to the existing table (`hidden md:block`), both fed by the same data and the same Server Actions. Touch sizing (44 px buttons, 16 px text fields) is scoped to the admin through a marker on the admin shell wrapper so staff screens do not change.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` first), React 19, Tailwind 4 (tokens in `src/app/globals.css`), Vitest, Playwright (projects `desktop` 1280x800 and `mobile` Pixel 7).

**Spec:** `docs/superpowers/specs/2026-10-18-admin-mobile-ux-design.md`

## Global Constraints

- UI copy in Spanish (es-AR). No new screens, no data/permission/Server Action changes; no behavior lost (destacar, subir/bajar, editar, activar/desactivar).
- Breakpoint `md` (768 px). From `md` up the shell, sidebar and tables stay exactly as today.
- Below `md`: no horizontal page scroll at 360–430 px; tap targets ≥ 44 px tall; text fields 16 px.
- 44 px / 16 px rules apply ONLY inside the admin (Mostrador, Delivery, Caja, Cocina untouched).
- Pause/activate has no confirmation; destructive actions keep today's confirmation.
- ☰ drawer and "⋯" menus: `aria-expanded`/`aria-controls`, Escape and outside tap close, focus moves in and returns to the trigger, state shown with text not only color.
- Existing admin e2e specs must keep passing in both Playwright projects (update selectors without weakening assertions). New Server Actions are NOT added, so `src/lib/security/surface.ts` is unchanged (verify `pnpm test:security`).
- Commit with explicit paths only; never `.env`, `.superpowers`, `bh.dump`, `test-results`, `perf-reports`, `.uploads*`. Trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- A product/category with a very long name or no photo: card wraps, never overflows, placeholder shown.
- First/last product in a category: Subir/Bajar disabled in the "⋯" menu.
- Opening the ☰ drawer then navigating: drawer closes and the new section is highlighted; body does not scroll behind the open drawer.
- Resize across 768 px (rotate phone): no duplicated-visible content, no stale open drawer.
- Server Action failure (error state) shows its message inside the card, not lost.

---

### Task 1: Admin shell — sticky bar, ☰ drawer, admin-scoped touch sizing

**Files:** modify `src/app/(admin)/admin/admin-shell.tsx`, `src/app/(admin)/admin/admin-nav.tsx`, `src/app/globals.css`, `src/components/logout-button.tsx` only if needed; create `src/app/(admin)/admin/admin-mobile-bar.tsx` (client), `src/components/ui/overflow-menu.tsx` (client, shared "⋯" disclosure used by Tasks 2–3), `e2e/admin-layout-mobile.spec.ts`.

**Interfaces:**
- Produces: `AdminMobileBar({ userName, homeHref }: { userName: string; homeHref: string })` rendering the sticky `<md` bar (☰, current section title, drawer with `ADMIN_LINKS`, link "Volver a operación" to `homeHref`, "Cerrar sesión" via `LogoutButton`). `OverflowMenu({ label, children, align? }: { label: string; children: ReactNode; align?: "start" | "end" })` — trigger button "⋯" with `aria-label={label}`, `aria-expanded`, menu panel closing on Escape/outside tap, children are the menu items (ActionButton/Link). The admin shell wrapper carries `data-admin-touch`; globals.css defines the `<md` sizing under that attribute (buttons/links built with `buttonClass`, and `input/select/textarea` at 16 px).
- Consumes: `ADMIN_LINKS` from `admin-nav.tsx`; the role-home helper already used by `src/lib/caja/nav.ts` (find how the staff nav links to `/admin` and use the inverse for `homeHref`); `buttonClass` from `src/components/ui/button.tsx`.

- [ ] **Step 1:** Write `e2e/admin-layout-mobile.spec.ts` (RED, mobile project, 390x844, admin storageState): on `/admin/menu` the document has no horizontal overflow (`scrollWidth <= clientWidth`); the ☰ button is visible with accessible name "Abrir menú"; clicking it shows the six links by name (Menú, Modificadores, Cadetes, Usuarios, Estaciones, Ajustes); Escape closes it and focus returns to ☰; clicking "Usuarios" navigates to `/admin/usuarios` and closes the drawer; the top bar stays visible after scrolling (`toBeInViewport`); at 1280x800 (desktop project) there is NO ☰ and the sidebar nav is visible. Run `pnpm e2e --grep "admin-layout-mobile"`; expect FAIL.
- [ ] **Step 2:** Implement `OverflowMenu` and `AdminMobileBar`; in `admin-shell.tsx` render the bar `md:hidden` (sticky `top-0`, safe-area padding for `viewportFit: cover`), hide the old header and horizontal strip below `md` (`hidden md:flex` / `hidden md:block`), keep desktop markup byte-equivalent. Lock body scroll while the drawer is open. Add `data-admin-touch` to the shell root and the `<md` sizing rules in `globals.css` (min-height 44 px for `buttonClass`-based controls, 16 px field text) scoped to `[data-admin-touch]`.
- [ ] **Step 3:** Run the new spec in both projects (mobile + desktop) until green; run `pnpm lint && pnpm test`.
- [ ] **Step 4:** Commit `feat(admin): mobile shell with drawer navigation and touch sizing`.

### Task 2: Menu — product cards, category header, "⋯" actions

**Files:** modify `src/app/(admin)/admin/menu/_components/category-section.tsx`, `product-row.tsx` (keep as the `md+` table row); create `src/app/(admin)/admin/menu/_components/product-card.tsx`; modify `e2e/admin-menu.spec.ts` and `e2e/admin-layout-mobile.spec.ts`.

**Interfaces:**
- Produces: `ProductCard({ product, first, last }: { product: AdminProduct; first: boolean; last: boolean })` — photo (`Thumb`, neutral placeholder when `imagePath` is null), name, price (`formatARS`), a full-width state button reading "Activo" (green) / "Pausado" (muted) bound to `toggleProductActiveAction` via `ActionButton` with `label` `Desactivar X`/`Activar X` (same aria-labels as the table), "Editar" link to `/admin/menu/productos/${id}`, and an `OverflowMenu` (label `Más acciones de ${name}`) with Destacar/Quitar destacado, Subir (disabled when `first`), Bajar (disabled when `last`). A visible text "Destacado" tag when `featured`. Inactive cards are visually muted.
- Consumes: `OverflowMenu` (Task 1), existing actions `moveProductAction`, `toggleProductActiveAction`, `toggleProductFeaturedAction`, `AdminProduct`.

- [ ] **Step 1:** RED in `e2e/admin-layout-mobile.spec.ts` (mobile, seeded menu): on `/admin/menu` no horizontal overflow; the first product's "Pausado/Activo" button is visible without scrolling sideways and ≥ 44 px tall; clicking it flips the label (and clicking again restores it); "⋯" opens a menu containing Destacar, Subir, Bajar; Subir disabled on the first product of its category and Bajar on the last; a product with a 120-character name does not overflow (create/rename via the admin form or seed helper); no photo → placeholder visible. Run; expect FAIL.
- [ ] **Step 2:** Implement `ProductCard`; in `CategorySection` render cards `md:hidden` (list with `role="list"`) and the existing table `hidden md:block`; make the category header actions wrap sensibly below `md` (primary "Nuevo producto" and "Editar" visible, ↑↓/Desactivar via `OverflowMenu`).
- [ ] **Step 3:** Fix `e2e/admin-menu.spec.ts` selectors if duplicated DOM changes them (display:none elements are excluded from role queries; keep assertions equally strict). Run `pnpm e2e --grep "admin-menu|admin-layout-mobile"` in both projects, then `pnpm lint && pnpm test && pnpm build`.
- [ ] **Step 4:** Capture screenshots at 390 px and 1280 px to the scratchpad, LOOK at them, fix visible defects in a separate commit. Commit `feat(admin): mobile product cards with big pause toggle`.

### Task 3: Modificadores, Usuarios, Cadetes — cards below `md`

**Files:** modify `src/app/(admin)/admin/modificadores/_components/group-card.tsx` and its page; `src/app/(admin)/admin/usuarios/page.tsx`; `src/app/(admin)/admin/cadetes/page.tsx`; create small card components next to each page (`option-card.tsx` or inline) as needed; modify `e2e/admin-modifiers.spec.ts`, `admin-users.spec.ts`, `admin-cadets.spec.ts`, `admin-layout-mobile.spec.ts`.

**Interfaces:**
- Consumes: `OverflowMenu`, `ActionButton`, `buttonClass`, the existing actions/confirmations of each screen (unchanged).
- Rule: on each card the most frequent action (Activar/Desactivar and Editar) is visible; the rest goes in `OverflowMenu`; destructive actions keep today's confirmation flow exactly. Modifier groups: one card per group with its options listed stacked inside, each option with the same visible/"⋯" split.

- [ ] **Step 1:** RED in `e2e/admin-layout-mobile.spec.ts` (mobile): `/admin/modificadores`, `/admin/usuarios`, `/admin/cadetes` each have no horizontal overflow at 390 px; a primary action per card is ≥ 44 px tall; a deactivate/destructive action still shows its confirmation (assert the existing confirm behavior per screen); each screen's seeded row text is visible without sideways scroll. Run; expect FAIL.
- [ ] **Step 2:** Implement cards (`md:hidden`) beside the existing tables (`hidden md:block`) on the three screens.
- [ ] **Step 3:** Update the three existing admin specs where needed, keep assertions equally strict. Run `pnpm e2e --grep "admin-"` in both projects; `pnpm lint && pnpm test && pnpm build`.
- [ ] **Step 4:** Commit `feat(admin): mobile cards for modifiers, users and cadets`.

### Task 4: Forms touch targets, Estaciones/Ajustes pass, full verification, docs

**Files:** modify `src/app/(admin)/admin/menu/_components/product-form.tsx`, `modifier-form.tsx`, `src/app/(admin)/admin/usuarios/_components/user-form.tsx`, `src/app/(admin)/admin/ajustes/_components/settings-form.tsx`, `src/components/ui/field.tsx` (only if the checkbox/field change is admin-safe), `src/app/(admin)/admin/menu/_components/image-upload-field.tsx`; modify `docs/guias/guia-administrador.md`, `README.md` route notes if any; `e2e/README.md`.

**Interfaces:** checkbox/radio rows become full-width label rows ≥ 44 px (whole row tappable); file input button ≥ 44 px; `settings-form` grids stay single column below `md`; all admin form fields 16 px on mobile (via Task 1 scoping).

- [ ] **Step 1:** RED in `e2e/admin-layout-mobile.spec.ts`: on the product form, user form and settings page at 390 px: no horizontal overflow; each checkbox label row is ≥ 44 px tall and clicking its text toggles it; computed `font-size` of text inputs is ≥ 16 px; Estaciones page has no overflow. Run; expect FAIL.
- [ ] **Step 2:** Implement the form changes; keep staff screens unchanged (assert `data-admin-touch` scoping: a Mostrador page button keeps its previous height — add one assertion in the spec).
- [ ] **Step 3:** Update `docs/guias/guia-administrador.md` (celular: ☰, pausar un producto, "⋯") and `e2e/README.md`.
- [ ] **Step 4:** Full gates: `pnpm lint`, `pnpm test`, `pnpm test:int`, `pnpm test:security`, `pnpm build`, fresh-build `pnpm e2e` (both projects). Take screenshots at 390 px and 1280 px of menu, modificadores, usuarios, cadetes, estaciones, ajustes and LOOK at them; fix defects in separate commits.
- [ ] **Step 5:** Commit `feat(admin): mobile form targets, docs and verification`.
