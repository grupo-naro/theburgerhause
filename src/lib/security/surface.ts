import type { Role } from "@/lib/auth/roles";

/**
 * The authorization surface of the app: EVERY Server Action export, Route Handler method and page,
 * with its expected access class. `surface.test.ts` scans the source tree and fails when an entry
 * exists in the code but not here (a new, unclassified endpoint), when an entry here no longer exists,
 * when the guard is missing from a non-public entry, and when docs/ops/security-surface.md is stale.
 *
 * Classes:
 *  - public            no credential. Must have an abuse bound (rate limit, cap or pure read of public data).
 *  - staff             a valid session whose role is in `roles` (checked server side; admin is NOT implicit).
 *  - admin             staff with roles ["admin"].
 *  - agent-token       `Authorization: Bearer bhst_...` station token (no cookies).
 *  - capability-token  the unguessable URL token IS the credential (customer order page).
 */
export type AccessClass = "public" | "staff" | "admin" | "agent-token" | "capability-token";

export type Entry = {
  access: AccessClass;
  /** Roles allowed (staff/admin). */
  roles?: Role[];
  /** Abuse bound for public and token entries, or what the entry does for the others. */
  note: string;
  /** Where the negative / bound is asserted (existing tests count). */
  tests: string[];
};

const ADMIN: Role[] = ["admin"];
const STAFF3: Role[] = ["cajera", "encargada_delivery", "admin"];
const KITCHEN: Role[] = ["cocina", "cajera", "encargada_delivery", "admin"];
const DELIVERY: Role[] = ["encargada_delivery", "admin"];
const COUNTER: Role[] = ["cajera", "admin"];

const AUTHZ_TEST = "src/lib/security/authz.test.ts";

const adminAction = (note: string): Entry => ({ access: "admin", roles: ADMIN, note, tests: [AUTHZ_TEST] });
const staffAction = (roles: Role[], note: string, tests: string[] = [AUTHZ_TEST]): Entry => ({
  access: "staff",
  roles,
  note,
  tests,
});

const ADMIN_DIR = "src/app/(admin)/admin";
const STAFF_DIR = "src/app/(staff)";

/** Keys: `action:<file>#<export>`, `route:<file>#<METHOD>`, `page:<file>`. */
export const SURFACE: Record<string, Entry> = {
  // ---- admin Server Actions (authorizeAdmin first; `quick` authorizes before running) ----
  [`action:${ADMIN_DIR}/ajustes/actions.ts#saveSettingsAction`]: adminAction("Store settings (fee, hours, closed switch)."),
  [`action:${ADMIN_DIR}/ajustes/actions.ts#toggleAcceptingOrdersAction`]: adminAction("Open/closed switch."),
  [`action:${ADMIN_DIR}/cadetes/actions.ts#saveCadetAction`]: adminAction("Create/edit a cadet."),
  [`action:${ADMIN_DIR}/cadetes/actions.ts#toggleCadetActiveAction`]: adminAction("Deactivate/reactivate a cadet."),
  [`action:${ADMIN_DIR}/estaciones/actions.ts#createStationAction`]: adminAction("Creates a station and returns its token once."),
  [`action:${ADMIN_DIR}/estaciones/actions.ts#rotateStationTokenAction`]: adminAction("Rotates a station token (returned once)."),
  [`action:${ADMIN_DIR}/estaciones/actions.ts#renameStationAction`]: adminAction("Renames a station."),
  [`action:${ADMIN_DIR}/menu/actions.ts#saveCategoryAction`]: adminAction("Category CRUD."),
  [`action:${ADMIN_DIR}/menu/actions.ts#saveProductAction`]: adminAction("Product CRUD (imagePath re-validated)."),
  [`action:${ADMIN_DIR}/menu/actions.ts#saveProductModifierGroupsAction`]: adminAction("Product to modifier group links."),
  [`action:${ADMIN_DIR}/menu/actions.ts#moveCategoryAction`]: adminAction("Reorder categories."),
  [`action:${ADMIN_DIR}/menu/actions.ts#moveProductAction`]: adminAction("Reorder products."),
  [`action:${ADMIN_DIR}/menu/actions.ts#toggleCategoryActiveAction`]: adminAction("Show/hide a category."),
  [`action:${ADMIN_DIR}/menu/actions.ts#toggleProductActiveAction`]: adminAction("Show/hide a product."),
  [`action:${ADMIN_DIR}/menu/actions.ts#toggleProductFeaturedAction`]: adminAction("Featured flag."),
  [`action:${ADMIN_DIR}/modificadores/actions.ts#saveModifierGroupAction`]: adminAction("Modifier group CRUD."),
  [`action:${ADMIN_DIR}/modificadores/actions.ts#saveModifierAction`]: adminAction("Modifier CRUD."),
  [`action:${ADMIN_DIR}/modificadores/actions.ts#moveModifierAction`]: adminAction("Reorder modifiers."),
  [`action:${ADMIN_DIR}/modificadores/actions.ts#toggleModifierActiveAction`]: adminAction("Show/hide a modifier."),
  [`action:${ADMIN_DIR}/usuarios/actions.ts#saveUserAction`]: adminAction("Create/edit staff users and passwords."),
  [`action:${ADMIN_DIR}/usuarios/actions.ts#toggleUserActiveAction`]: adminAction("Deactivate/reactivate a user (revokes sessions)."),
  [`action:${ADMIN_DIR}/usuarios/actions.ts#revokeSessionsAction`]: adminAction("Revoke every session of a user."),

  // ---- staff Server Actions (requireRole first, then the sector rule) ----
  [`action:${STAFF_DIR}/caja/actions.ts#approveOrderAction`]: staffAction(STAFF3, "Approve a web order (own sector; admin exempt)."),
  [`action:${STAFF_DIR}/caja/actions.ts#rejectOrderAction`]: staffAction(STAFF3, "Reject a web order with a reason (own sector)."),
  [`action:${STAFF_DIR}/caja/actions.ts#reprintOrderAction`]: staffAction(STAFF3, "Re-queue the tickets of an order (own sector)."),
  [`action:${STAFF_DIR}/despacho/actions.ts#markReadyAction`]: staffAction(STAFF3, "Order ready (own sector)."),
  [`action:${STAFF_DIR}/despacho/actions.ts#markPickupAction`]: staffAction(STAFF3, "Order to pickup (own sector)."),
  [`action:${STAFF_DIR}/despacho/actions.ts#markDeliveredAction`]: staffAction(STAFF3, "Order delivered, optional cash collected (own sector)."),
  [`action:${STAFF_DIR}/despacho/actions.ts#returnToDispatchAction`]: staffAction(STAFF3, "Return an order to dispatch with a reason (own sector)."),
  [`action:${STAFF_DIR}/despacho/actions.ts#cancelOrderAction`]: staffAction(STAFF3, "Cancel/void an order after approval with a mandatory reason (own sector: delivery manager cancels delivery, cashier takeaway and counter; admin all)."),
  [`action:${STAFF_DIR}/despacho/actions.ts#assignCadetAction`]: staffAction(DELIVERY, "Assign orders to a cadet (delivery manager and admin only)."),
  [`action:${STAFF_DIR}/delivery/rendicion/actions.ts#settleCadetAction`]: staffAction(DELIVERY, "Settle a cadet's cash (delivery sector; admin exempt)."),
  [`action:${STAFF_DIR}/mostrador/actions.ts#createCounterOrderAction`]: staffAction(COUNTER, "POS sale (cashier and admin)."),
  [`action:${STAFF_DIR}/mostrador/actions.ts#listActivePagersAction`]: staffAction(COUNTER, "Active pager numbers."),
  [`action:${STAFF_DIR}/mostrador/actions.ts#getPrintStateAction`]: staffAction(COUNTER, "Print status of one order."),
  [`action:${STAFF_DIR}/cocina/actions.ts#kitchenReadyAction`]: staffAction(
    KITCHEN,
    "Kitchen screen: order ready. The cocina role is exempt from the sector rule (only here); cashier / delivery manager keep their own sector, admin exempt.",
    ["src/app/(staff)/cocina/actions.int.test.ts", AUTHZ_TEST],
  ),
  [`action:${STAFF_DIR}/cocina/actions.ts#kitchenUndoAction`]: staffAction(
    KITCHEN,
    "Kitchen screen: put a ready order back in preparation, only while nobody called / assigned it (audited). Same sector rule as kitchenReadyAction.",
    ["src/app/(staff)/cocina/actions.int.test.ts", AUTHZ_TEST],
  ),
  [`action:${STAFF_DIR}/estacion/actions.ts#selectStation`]: staffAction(
    STAFF3,
    "Bind the session to a station of the role's kind (guard: requireSessionOrRedirect).",
    ["src/app/(staff)/estacion/actions.int.test.ts", AUTHZ_TEST],
  ),

  // ---- public Server Actions ----
  [`action:${STAFF_DIR}/login/actions.ts#login`]: {
    access: "public",
    note: "Credentials in the form. zod caps (user 64, password 256), limiter 5 attempts/15 min per ip+user and 20 per ip, dummy scrypt for unknown users, new session token on every login.",
    tests: ["src/app/(staff)/login/actions.int.test.ts", "src/lib/auth/login.int.test.ts"],
  },
  [`action:${STAFF_DIR}/logout/actions.ts#logout`]: {
    access: "public",
    note: "No credential needed: revokes the caller's own session row (if any) and clears the cookie. Cannot touch anyone else's session.",
    tests: ["src/app/(staff)/logout/actions.int.test.ts"],
  },
  ["action:src/app/(public)/actions.ts#checkOrdersOpen"]: {
    access: "public",
    note: "Reads one boolean (store open). Same cost as a health check; the Nginx volume cap applies.",
    tests: ["src/app/(public)/actions.int.test.ts"],
  },
  ["action:src/app/(public)/checkout/actions.ts#createOrderAction"]: {
    access: "public",
    note: "Order creation: per-IP attempt limiter first, creation quota per ip+whatsapp, honeypot (bh_ref), idempotency key, max 100 units, zod caps on every text field, closed-store check.",
    tests: ["src/app/(public)/checkout/actions.int.test.ts", "src/lib/orders/schemas.test.ts"],
  },

  // ---- Route Handlers ----
  ["route:src/app/api/agent/heartbeat/route.ts#POST"]: {
    access: "agent-token",
    note: "Bearer station token (sha256 lookup). Failures spend a per-IP budget (30/10 min); a valid token always passes. No cookies, no CORS.",
    tests: ["src/lib/print/agent-routes.int.test.ts", AUTHZ_TEST],
  },
  ["route:src/app/api/agent/jobs/[id]/ack/route.ts#POST"]: {
    access: "agent-token",
    note: "Bearer station token; body capped at 4096 chars; a job of another station answers like an unknown one.",
    tests: ["src/lib/print/agent-routes.int.test.ts", AUTHZ_TEST],
  },
  ["route:src/app/api/agent/stream/route.ts#GET"]: {
    access: "agent-token",
    note: "Bearer station token; one stream per station, global cap 50.",
    tests: ["src/app/api/agent/stream/route.int.test.ts", AUTHZ_TEST],
  },
  ["route:src/app/api/events/route.ts#GET"]: {
    access: "staff",
    roles: KITCHEN,
    note: "SSE for staff screens: requireRole first, caps 10 per user / 200 global, session revalidated every 60 s without sliding.",
    tests: ["src/app/api/events/route.test.ts", AUTHZ_TEST],
  },
  ["route:src/app/api/health/route.ts#GET"]: {
    access: "public",
    note: "Liveness probe: 60 req/min per IP, answers only status/db/realtime/time/version/commit.",
    tests: ["src/lib/health.test.ts", "src/app/api/health/route.int.test.ts"],
  },
  ["route:src/app/api/pedido/[token]/status/route.ts#GET"]: {
    access: "capability-token",
    note: "Customer polling. The 256-bit token is the credential; per-IP request limiter plus a miss limiter; uniform 404/429 bodies; no-store.",
    tests: ["src/app/api/pedido/[token]/status/route.test.ts"],
  },
  ["route:src/app/api/uploads/route.ts#POST"]: {
    access: "admin",
    roles: ADMIN,
    note: "Image upload: same-origin check, requireRole(admin) before reading the body, 5 MB cap (Content-Length and real size), image re-encoded by sharp.",
    tests: ["src/app/api/uploads/route.test.ts", AUTHZ_TEST],
  },
  ["route:src/app/api/csp-report/route.ts#POST"]: {
    access: "public",
    note: "CSP violation reports (browsers send no credentials): 30/min per IP, body read capped at 8 KB, one fixed log line, body never stored.",
    tests: ["src/lib/security/csp-report.test.ts"],
  },
  ["route:src/app/uploads/[...path]/route.ts#GET"]: {
    access: "public",
    note: "Product photos. Strict uuid.webp name (no traversal, no listing); Nginx serves the directory directly in production.",
    tests: ["src/app/uploads/[...path]/route.test.ts"],
  },

  // ---- pages ----
  ["page:src/app/(public)/page.tsx"]: { access: "public", note: "Prerendered menu.", tests: ["e2e/store-menu.spec.ts"] },
  ["page:src/app/(public)/carrito/page.tsx"]: { access: "public", note: "Cart (client state).", tests: ["e2e/store-cart.spec.ts"] },
  ["page:src/app/(public)/checkout/page.tsx"]: { access: "public", note: "Checkout form.", tests: ["e2e/store-checkout.spec.ts"] },
  ["page:src/app/(public)/pedido/[token]/page.tsx"]: {
    access: "capability-token",
    note: "Order tracking: no-store, no-referrer, noindex; an unknown token answers the same not-found.",
    tests: ["e2e/store-tracking.spec.ts"],
  },
  ["page:src/app/(staff)/login/page.tsx"]: { access: "public", note: "Login form.", tests: ["e2e/auth.spec.ts"] },
  ["page:src/app/(staff)/estacion/page.tsx"]: { access: "staff", roles: STAFF3, note: "Station picker.", tests: ["e2e/sector-workspaces.spec.ts"] },
  ["page:src/app/(staff)/caja/page.tsx"]: { access: "staff", roles: STAFF3, note: "General view; staff are redirected to their workspace.", tests: ["e2e/caja.spec.ts"] },
  ["page:src/app/(staff)/despacho/page.tsx"]: { access: "staff", roles: STAFF3, note: "General dispatch view; staff are redirected.", tests: ["e2e/despacho-roles.spec.ts"] },
  ["page:src/app/(staff)/mostrador/page.tsx"]: { access: "staff", roles: COUNTER, note: "POS (mostrador sector).", tests: ["e2e/mostrador-guards.spec.ts"] },
  ["page:src/app/(staff)/mostrador/pedidos/page.tsx"]: { access: "staff", roles: COUNTER, note: "Counter orders board.", tests: ["e2e/despacho-roles.spec.ts"] },
  ["page:src/app/(staff)/retiro/page.tsx"]: { access: "staff", roles: COUNTER, note: "Takeaway approval workspace.", tests: ["e2e/caja.spec.ts"] },
  ["page:src/app/(staff)/cocina/page.tsx"]: { access: "staff", roles: KITCHEN, note: "Kitchen screen (orders in preparation, no customer data).", tests: ["e2e/cocina.spec.ts"] },
  ["page:src/app/(staff)/delivery/page.tsx"]: { access: "staff", roles: DELIVERY, note: "Delivery workspace.", tests: ["e2e/delivery-workspace.spec.ts"] },
  ["page:src/app/(staff)/delivery/rendicion/page.tsx"]: { access: "staff", roles: DELIVERY, note: "Cadet settlement screen.", tests: ["e2e/rendicion-roles-print.spec.ts"] },
};

/** Every page under (admin)/admin is admin-only (guard in the page itself or in the admin shell). */
export const ADMIN_PAGE_PREFIX = "page:src/app/(admin)/admin/";
