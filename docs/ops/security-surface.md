# Authorization surface (generated)

Generated from `src/lib/security/surface.ts` by `src/lib/security/surface-doc.ts`; do not edit by hand.
Regenerate with `UPDATE_SURFACE_DOC=1 pnpm test:security`. `pnpm test:security` fails when:

- a Server Action export, Route Handler method or page exists in `src/` without an entry here (a new endpoint must be classified on purpose),
- an entry here no longer exists in the code,
- a non-public Server Action does not call its authorization helper before touching the database (static check),
- the behavioural tests in `src/lib/security/authz.test.ts` show that an action or route lets an anonymous or wrong-role caller through, or touches the database before authorizing,
- this file is stale.

Access classes: `public` (no credential; has an abuse bound), `staff` (session + role list; **admin is never implicit**), `admin`, `agent-token` (Bearer station token, no cookies), `capability-token` (the unguessable URL token is the credential).
Staff actions on orders additionally apply the sector rule server side (a cashier at a Delivery station is refused; admin is exempt).

## Server Actions (every one is a public HTTP endpoint)

| Entry | Access | Roles | Guard / abuse bound | Tests |
| --- | --- | --- | --- | --- |
| `src/app/(admin)/admin/ajustes/actions.ts#saveSettingsAction` | admin | admin | Store settings (fee, hours, closed switch). | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/ajustes/actions.ts#toggleAcceptingOrdersAction` | admin | admin | Open/closed switch. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/cadetes/actions.ts#saveCadetAction` | admin | admin | Create/edit a cadet. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/cadetes/actions.ts#toggleCadetActiveAction` | admin | admin | Deactivate/reactivate a cadet. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/estaciones/actions.ts#createStationAction` | admin | admin | Creates a station and returns its token once. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/estaciones/actions.ts#rotateStationTokenAction` | admin | admin | Rotates a station token (returned once). | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/estaciones/actions.ts#renameStationAction` | admin | admin | Renames a station. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/menu/actions.ts#saveCategoryAction` | admin | admin | Category CRUD. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/menu/actions.ts#saveProductAction` | admin | admin | Product CRUD (imagePath re-validated). | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/menu/actions.ts#saveProductModifierGroupsAction` | admin | admin | Product to modifier group links. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/menu/actions.ts#moveCategoryAction` | admin | admin | Reorder categories. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/menu/actions.ts#moveProductAction` | admin | admin | Reorder products. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/menu/actions.ts#toggleCategoryActiveAction` | admin | admin | Show/hide a category. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/menu/actions.ts#toggleProductActiveAction` | admin | admin | Show/hide a product. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/menu/actions.ts#toggleProductFeaturedAction` | admin | admin | Featured flag. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/modificadores/actions.ts#saveModifierGroupAction` | admin | admin | Modifier group CRUD. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/modificadores/actions.ts#saveModifierAction` | admin | admin | Modifier CRUD. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/modificadores/actions.ts#moveModifierAction` | admin | admin | Reorder modifiers. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/modificadores/actions.ts#toggleModifierActiveAction` | admin | admin | Show/hide a modifier. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/usuarios/actions.ts#saveUserAction` | admin | admin | Create/edit staff users and passwords. | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/usuarios/actions.ts#toggleUserActiveAction` | admin | admin | Deactivate/reactivate a user (revokes sessions). | `src/lib/security/authz.test.ts` |
| `src/app/(admin)/admin/usuarios/actions.ts#revokeSessionsAction` | admin | admin | Revoke every session of a user. | `src/lib/security/authz.test.ts` |
| `src/app/(staff)/caja/actions.ts#approveOrderAction` | staff | cajera, encargada_delivery, admin | Approve a web order (own sector; admin exempt). | `src/lib/security/authz.test.ts` |
| `src/app/(staff)/caja/actions.ts#rejectOrderAction` | staff | cajera, encargada_delivery, admin | Reject a web order with a reason (own sector). | `src/lib/security/authz.test.ts` |
| `src/app/(staff)/caja/actions.ts#reprintOrderAction` | staff | cajera, encargada_delivery, admin | Re-queue the tickets of an order (own sector). | `src/lib/security/authz.test.ts` |
| `src/app/(staff)/despacho/actions.ts#markReadyAction` | staff | cajera, encargada_delivery, admin | Order ready (own sector). | `src/lib/security/authz.test.ts` |
| `src/app/(staff)/despacho/actions.ts#markPickupAction` | staff | cajera, encargada_delivery, admin | Order to pickup (own sector). | `src/lib/security/authz.test.ts` |
| `src/app/(staff)/despacho/actions.ts#markDeliveredAction` | staff | cajera, encargada_delivery, admin | Order delivered, optional cash collected (own sector). | `src/lib/security/authz.test.ts` |
| `src/app/(staff)/despacho/actions.ts#returnToDispatchAction` | staff | cajera, encargada_delivery, admin | Return an order to dispatch with a reason (own sector). | `src/lib/security/authz.test.ts` |
| `src/app/(staff)/despacho/actions.ts#assignCadetAction` | staff | encargada_delivery, admin | Assign orders to a cadet (delivery manager and admin only). | `src/lib/security/authz.test.ts` |
| `src/app/(staff)/delivery/rendicion/actions.ts#settleCadetAction` | staff | encargada_delivery, admin | Settle a cadet's cash (delivery sector; admin exempt). | `src/lib/security/authz.test.ts` |
| `src/app/(staff)/mostrador/actions.ts#createCounterOrderAction` | staff | cajera, admin | POS sale (cashier and admin). | `src/lib/security/authz.test.ts` |
| `src/app/(staff)/mostrador/actions.ts#listActivePagersAction` | staff | cajera, admin | Active pager numbers. | `src/lib/security/authz.test.ts` |
| `src/app/(staff)/mostrador/actions.ts#getPrintStateAction` | staff | cajera, admin | Print status of one order. | `src/lib/security/authz.test.ts` |
| `src/app/(staff)/estacion/actions.ts#selectStation` | staff | cajera, encargada_delivery, admin | Bind the session to a station of the role's kind (guard: requireSessionOrRedirect). | `src/app/(staff)/estacion/actions.int.test.ts`<br>`src/lib/security/authz.test.ts` |
| `src/app/(staff)/login/actions.ts#login` | public | - | Credentials in the form. zod caps (user 64, password 256), limiter 5 attempts/15 min per ip+user and 20 per ip, dummy scrypt for unknown users, new session token on every login. | `src/app/(staff)/login/actions.int.test.ts`<br>`src/lib/auth/login.int.test.ts` |
| `src/app/(staff)/logout/actions.ts#logout` | public | - | No credential needed: revokes the caller's own session row (if any) and clears the cookie. Cannot touch anyone else's session. | `src/app/(staff)/logout/actions.int.test.ts` |
| `src/app/(public)/actions.ts#checkOrdersOpen` | public | - | Reads one boolean (store open). Same cost as a health check; the Nginx volume cap applies. | `src/app/(public)/actions.int.test.ts` |
| `src/app/(public)/checkout/actions.ts#createOrderAction` | public | - | Order creation: per-IP attempt limiter first, creation quota per ip+whatsapp, honeypot (bh_ref), idempotency key, max 100 units, zod caps on every text field, closed-store check. | `src/app/(public)/checkout/actions.int.test.ts`<br>`src/lib/orders/schemas.test.ts` |

## Route Handlers

| Entry | Access | Roles | Guard / abuse bound | Tests |
| --- | --- | --- | --- | --- |
| `src/app/api/agent/heartbeat/route.ts#POST` | agent-token | - | Bearer station token (sha256 lookup). Failures spend a per-IP budget (30/10 min); a valid token always passes. No cookies, no CORS. | `src/lib/print/agent-routes.int.test.ts`<br>`src/lib/security/authz.test.ts` |
| `src/app/api/agent/jobs/[id]/ack/route.ts#POST` | agent-token | - | Bearer station token; body capped at 4096 chars; a job of another station answers like an unknown one. | `src/lib/print/agent-routes.int.test.ts`<br>`src/lib/security/authz.test.ts` |
| `src/app/api/agent/stream/route.ts#GET` | agent-token | - | Bearer station token; one stream per station, global cap 50. | `src/app/api/agent/stream/route.int.test.ts`<br>`src/lib/security/authz.test.ts` |
| `src/app/api/events/route.ts#GET` | staff | cajera, encargada_delivery, admin | SSE for staff screens: requireRole first, caps 10 per user / 200 global, session revalidated every 60 s without sliding. | `src/app/api/events/route.test.ts`<br>`src/lib/security/authz.test.ts` |
| `src/app/api/health/route.ts#GET` | public | - | Liveness probe: 60 req/min per IP, answers only status/db/realtime/time/version/commit. | `src/lib/health.test.ts`<br>`src/app/api/health/route.int.test.ts` |
| `src/app/api/pedido/[token]/status/route.ts#GET` | capability-token | - | Customer polling. The 256-bit token is the credential; per-IP request limiter plus a miss limiter; uniform 404/429 bodies; no-store. | `src/app/api/pedido/[token]/status/route.test.ts` |
| `src/app/api/uploads/route.ts#POST` | admin | admin | Image upload: same-origin check, requireRole(admin) before reading the body, 5 MB cap (Content-Length and real size), image re-encoded by sharp. | `src/app/api/uploads/route.test.ts`<br>`src/lib/security/authz.test.ts` |
| `src/app/api/csp-report/route.ts#POST` | public | - | CSP violation reports (browsers send no credentials): 30/min per IP, body read capped at 8 KB, one fixed log line, body never stored. | `src/lib/security/csp-report.test.ts` |
| `src/app/uploads/[...path]/route.ts#GET` | public | - | Product photos. Strict uuid.webp name (no traversal, no listing); Nginx serves the directory directly in production. | `src/app/uploads/[...path]/route.test.ts` |

## Pages

Every page under `src/app/(admin)/admin/**` is admin-only: the page (or, for the index redirect, the admin shell) calls `requireSessionOrRedirect(["admin"])`. The scanner enforces a guard marker on each of them.

| Entry | Access | Roles | Guard / abuse bound | Tests |
| --- | --- | --- | --- | --- |
| `src/app/(public)/page.tsx` | public | - | Prerendered menu. | `e2e/store-menu.spec.ts` |
| `src/app/(public)/carrito/page.tsx` | public | - | Cart (client state). | `e2e/store-cart.spec.ts` |
| `src/app/(public)/checkout/page.tsx` | public | - | Checkout form. | `e2e/store-checkout.spec.ts` |
| `src/app/(public)/pedido/[token]/page.tsx` | capability-token | - | Order tracking: no-store, no-referrer, noindex; an unknown token answers the same not-found. | `e2e/store-tracking.spec.ts` |
| `src/app/(staff)/login/page.tsx` | public | - | Login form. | `e2e/auth.spec.ts` |
| `src/app/(staff)/estacion/page.tsx` | staff | cajera, encargada_delivery, admin | Station picker. | `e2e/sector-workspaces.spec.ts` |
| `src/app/(staff)/caja/page.tsx` | staff | cajera, encargada_delivery, admin | General view; staff are redirected to their workspace. | `e2e/caja.spec.ts` |
| `src/app/(staff)/despacho/page.tsx` | staff | cajera, encargada_delivery, admin | General dispatch view; staff are redirected. | `e2e/despacho-roles.spec.ts` |
| `src/app/(staff)/mostrador/page.tsx` | staff | cajera, admin | POS (mostrador sector). | `e2e/mostrador-guards.spec.ts` |
| `src/app/(staff)/mostrador/pedidos/page.tsx` | staff | cajera, admin | Counter orders board. | `e2e/despacho-roles.spec.ts` |
| `src/app/(staff)/retiro/page.tsx` | staff | cajera, admin | Takeaway approval workspace. | `e2e/caja.spec.ts` |
| `src/app/(staff)/delivery/page.tsx` | staff | encargada_delivery, admin | Delivery workspace. | `e2e/delivery-workspace.spec.ts` |
| `src/app/(staff)/delivery/rendicion/page.tsx` | staff | encargada_delivery, admin | Cadet settlement screen. | `e2e/rendicion-roles-print.spec.ts` |
