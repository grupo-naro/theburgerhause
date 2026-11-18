# Grupos de extras en bloque Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a modifier group's page, assign the group to many products at once (with "Marcar toda la categoría"). New products start with the groups that every other product of their category shares.

**Architecture:**
- **Core functions:** two new functions in `src/lib/modifiers/admin.ts`. One reads the products grouped by category with a `checked` flag for the group; the other replaces the group's product links in one transaction.
- **Group page:** a new admin action and a client form on `/admin/modificadores/grupos/[id]`.
- **Product creation:** `saveProduct` links the category's common groups. Ruling: this is applied server-side on create, not as pre-checked boxes, because the create form has no group UI today; groups stay editable on the product edit page and on the group page.

**Tech Stack:** Next.js 16, React 19, Drizzle/PostgreSQL, Vitest unit + int, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-grupos-en-bloque-design.md`

## Global Constraints

- Roles: admin and encargado, through `authorizeManager()` and `requireSessionOrRedirect(["admin","encargado"])`.
- Copy, verbatim:
  - section title: `Productos que lo ofrecen`;
  - category buttons: `Marcar toda la categoría` / `Desmarcar toda la categoría`;
  - inactive products get the suffix ` (pausado)`;
  - save button: `Guardar`;
  - success message: `Productos del grupo guardados`.
- Saving replaces the group's links atomically. Unknown or deleted product ids are ignored, and a malformed form returns `Solicitud inválida.`
- After a save, call `invalidateMenu()` (the public menu shows each product's groups).
- The common groups on create are the intersection of the groups of all OTHER products in the category. An empty category gives none.
- The new action gets a `managerAction(...)` entry in `src/lib/security/surface.ts`; regenerate the doc with `UPDATE_SURFACE_DOC=1 pnpm test:security`.
- Gates before each commit: `pnpm lint`, `pnpm test`, `pnpm test:int`. Task 2 also runs `pnpm build` and the new e2e.

## Review Focus

- Saving with every box unchecked removes the group from all products, without an error. Covered in Task 1 (`empty selection clears`).
- A product deleted while the form was open is ignored, not a crash. Covered in Task 1 (`unknown ids ignored`).
- Other groups' links are untouched by a save. Covered in Task 1.
- An encargado can use it, and a cajera cannot. Covered in Task 2 (authz).
- Creating a product in an empty category does not fail. Covered in Task 1.

---

### Task 1: Core: list, replace and the common groups on create

**Files:**
- Modify: `src/lib/modifiers/admin.ts`, `src/lib/menu/admin.ts` (`saveProduct` create branch)
- Test: `src/lib/modifiers/admin.int.test.ts`, `src/lib/menu/admin.int.test.ts`

**Interfaces:**
- Produces:
  - `type GroupProductsView = { categoryId: number; categoryName: string; products: { id: number; name: string; active: boolean; checked: boolean }[] }[]`
  - `listProductsForGroup(db, groupId: number): Promise<GroupProductsView>`: categories and their products in menu order (`sort`, `id`).
  - `setGroupProducts(db, groupId: number, productIds: number[]): Promise<Result<null>>`: replaces the links in one transaction. An unknown group returns the error `"Grupo inexistente"`. Unknown product ids are skipped.
  - `commonGroupIdsForCategory(tx, categoryId: number, excludeProductId?: number): Promise<number[]>`
- `saveProduct` on create: inside the same transaction, after the insert, it inserts `product_modifier_groups` for `commonGroupIdsForCategory(tx, categoryId, newId)`.

- [ ] **Step 1: Write the failing int tests.**
  - `list marks the linked products by category`.
  - `set replaces exactly the selected products`: link A and B, then save `[B, C]` → B and C are linked and A is not.
  - `empty selection clears`.
  - `unknown ids ignored`: `[B, 99999]` → only B.
  - `other groups untouched`: a second group's links stay identical.
  - `unknown group`: returns the error.
  - Menu int:
    - `new product gets the groups every other product of its category shares`: products P1 {g1, g2} and P2 {g1} in category C. A new P3 in C gets `[g1]`.
    - `new product in an empty category gets no group`.
- [ ] **Step 2: Run `pnpm test:int src/lib/modifiers src/lib/menu`.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run `pnpm lint && pnpm test && pnpm test:int`.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(modifiers): assign a group to many products at once; new products inherit the category's common groups`.

---

### Task 2: Group page section, action and e2e

**Files:**
- Modify: `src/app/(admin)/admin/modificadores/actions.ts` (add `saveGroupProductsAction(prev, fd)`).
  - Input fields: `groupId` and repeated `productId`.
  - Parse: reuse a strict positive-int list parser like `groupIdsFromForm`; add `productIdsFromForm` in `src/lib/modifiers/form-data.ts`.
- Create: `src/app/(admin)/admin/modificadores/_components/group-products-form.tsx` (client).
  - Checkbox state lives in React state.
  - Each category has a toggle button that checks or unchecks all of its products.
  - The form submits the checked ids.
- Modify: `src/app/(admin)/admin/modificadores/grupos/[id]/page.tsx` (render the section below `GroupForm`).
- Modify: `src/lib/security/surface.ts`, `docs/ops/security-surface.md`.
- Test: `src/app/(admin)/admin/modificadores/actions.int.test.ts`, `src/lib/modifiers/form-data.test.ts` (new or existing), `e2e/admin-modifiers.spec.ts` (extend)

**Interfaces:**
- Consumes: `listProductsForGroup` and `setGroupProducts` (Task 1).

- [ ] **Step 1: Write the failing tests.**
  - Form parser: `productIdsFromForm` accepts repeated ids, returns `[]` when there are none, and returns `null` on a non-integer.
  - Action int:
    - a cajera gets an error and the links are unchanged;
    - an encargado saves → the links are replaced, the message is `Productos del grupo guardados` and `invalidateMenu` is called once;
    - a malformed id → `Solicitud inválida.`
  - E2E, as admin:
    - open a group's page;
    - click `Marcar toda la categoría` on one category;
    - uncheck one product;
    - `Guardar` → the success message shows;
    - reload: the boxes reflect the saved state;
    - open that unchecked product's edit page: the group is not checked.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement the action, the parser, the form, the page and the surface entry.**
- [ ] **Step 4: Run `pnpm lint && pnpm test && pnpm test:int && pnpm test:security && pnpm build && pnpm e2e e2e/admin-modifiers.spec.ts`.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(modifiers): "Productos que lo ofrecen" bulk section on the group page`.
