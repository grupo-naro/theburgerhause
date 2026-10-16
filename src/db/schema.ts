import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Data model (spec §3). Money is stored as integer centavos.
 * Orders keep snapshots of names/prices so menu edits never rewrite history.
 */

// ---------------------------------------------------------------- enums
export const orderStatus = pgEnum("order_status", [
  "pendiente_aprobacion",
  "en_preparacion",
  "listo_despacho",
  "en_camino",
  "para_retirar",
  "entregado",
  "cancelado",
]);
export const paymentMethod = pgEnum("payment_method", ["cash", "transfer"]);
export const paymentStatus = pgEnum("payment_status", ["pending", "paid"]);
export const fulfillment = pgEnum("fulfillment", ["delivery", "takeaway"]);
export const channel = pgEnum("channel", ["web", "counter"]);
export const userRole = pgEnum("user_role", ["admin", "cajera", "encargada_delivery"]);
export const printJobStatus = pgEnum("print_job_status", [
  "pending",
  "printing",
  "done",
  "failed",
]);
export const printJobType = pgEnum("print_job_type", ["kitchen", "ticket"]);
export const modifierKind = pgEnum("modifier_kind", ["remove", "add", "swap"]);
export const stationKind = pgEnum("station_kind", ["mostrador", "delivery"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------- menu
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  imagePath: text("image_path"),
});

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    price: integer("price").notNull(),
    imagePath: text("image_path"),
    active: boolean("active").notNull().default(true),
    /** Shown in the storefront carousel (UX spec §6). */
    featured: boolean("featured").notNull().default(false),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [
    unique("products_category_name_unique").on(t.categoryId, t.name),
    index("products_category_idx").on(t.categoryId),
    check("products_price_nonneg", sql`${t.price} >= 0`),
  ],
);

export const modifierGroups = pgTable("modifier_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const modifiers = pgTable(
  "modifiers",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => modifierGroups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: modifierKind("kind").notNull(),
    priceDelta: integer("price_delta").notNull().default(0),
    /** Uppercase label printed on the kitchen ticket, e.g. "SIN CHEDDAR". */
    kitchenLabel: text("kitchen_label").notNull(),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [
    unique("modifiers_group_name_unique").on(t.groupId, t.name),
    index("modifiers_group_idx").on(t.groupId),
    check("modifiers_remove_free", sql`${t.kind} <> 'remove' OR ${t.priceDelta} = 0`),
  ],
);

export const productModifierGroups = pgTable(
  "product_modifier_groups",
  {
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    groupId: integer("group_id")
      .notNull()
      .references(() => modifierGroups.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.groupId] }),
    index("product_modifier_groups_group_idx").on(t.groupId),
  ],
);

// ---------------------------------------------------------------- operation
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull(),
  active: boolean("active").notNull().default(true),
});

export const stations = pgTable("stations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  kind: stationKind("kind").notNull(),
  /** Hash of the print-agent token; NULL until generated from the admin panel. */
  tokenHash: text("token_hash"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export const sessions = pgTable(
  "sessions",
  {
    /** Random opaque token (text), not a serial. */
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    stationId: integer("station_id").references(() => stations.id, { onDelete: "set null" }),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_station_idx").on(t.stationId)],
);

export const cadets = pgTable("cadets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
});

// ---------------------------------------------------------------- orders
/** Atomic per-day counter backing `orders.number` (see order-number.ts). */
export const dailyCounters = pgTable("daily_counters", {
  businessDate: date("business_date", { mode: "string" }).primaryKey(),
  lastNumber: integer("last_number").notNull(),
});

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    /** Argentina calendar day of creation; scope of the daily `number`. */
    businessDate: date("business_date", { mode: "string" }).notNull(),
    number: integer("number").notNull(),
    /** 128-bit random token, generated by the app. */
    publicToken: text("public_token").notNull().unique(),
    /** Client-supplied key to dedupe double submits. */
    idempotencyKey: text("idempotency_key"),
    channel: channel("channel").notNull(),
    fulfillment: fulfillment("fulfillment").notNull(),
    status: orderStatus("status").notNull(),
    paymentMethod: paymentMethod("payment_method").notNull(),
    paymentStatus: paymentStatus("payment_status").notNull().default("pending"),
    /** NULL only for counter sales without a name. */
    customerName: text("customer_name"),
    whatsapp: text("whatsapp"),
    address: text("address"),
    crossStreets: text("cross_streets"),
    addressNotes: text("address_notes"),
    pagerNumber: integer("pager_number"),
    subtotal: integer("subtotal").notNull(),
    deliveryFee: integer("delivery_fee").notNull().default(0),
    total: integer("total").notNull(),
    cadetId: integer("cadet_id").references(() => cadets.id, { onDelete: "set null" }),
    approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
    stationId: integer("station_id").references(() => stations.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    unique("orders_business_date_number_unique").on(t.businessDate, t.number),
    uniqueIndex("orders_idempotency_key_unique")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index("orders_status_created_idx").on(t.status, t.createdAt),
    index("orders_cadet_status_idx").on(t.cadetId, t.status),
    index("orders_approved_by_idx").on(t.approvedBy),
    index("orders_station_idx").on(t.stationId),
    check("orders_counter_requires_pager", sql`${t.channel} <> 'counter' OR ${t.pagerNumber} IS NOT NULL`),
    check("orders_pager_range", sql`${t.pagerNumber} IS NULL OR ${t.pagerNumber} BETWEEN 1 AND 999`),
    /** A pager number is held by at most ONE active counter order; it frees up on entregado/cancelado. */
    uniqueIndex("orders_active_counter_pager_unique")
      .on(t.pagerNumber)
      .where(sql`${t.channel} = 'counter' AND ${t.status} IN ('en_preparacion','listo_despacho','para_retirar')`),
    /** Only counter sales may omit the customer name (web orders always carry one). */
    check("orders_web_requires_name", sql`${t.channel} = 'counter' OR ${t.customerName} IS NOT NULL`),
    check("orders_total_nonneg", sql`${t.total} >= 0`),
  ],
);

/** One row per unit (2 burgers = 2 rows, each with its own modifiers). */
export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Nullable: the product may be deleted later; snapshots keep the history. */
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    nameSnapshot: text("name_snapshot").notNull(),
    unitPriceSnapshot: integer("unit_price_snapshot").notNull(),
    notes: text("notes"),
  },
  (t) => [index("order_items_order_idx").on(t.orderId), index("order_items_product_idx").on(t.productId)],
);

export const orderItemModifiers = pgTable(
  "order_item_modifiers",
  {
    id: serial("id").primaryKey(),
    orderItemId: integer("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    modifierId: integer("modifier_id").references(() => modifiers.id, { onDelete: "set null" }),
    nameSnapshot: text("name_snapshot").notNull(),
    kitchenLabel: text("kitchen_label").notNull(),
    kind: modifierKind("kind").notNull(),
    priceDelta: integer("price_delta").notNull(),
  },
  (t) => [
    index("order_item_modifiers_item_idx").on(t.orderItemId),
    index("order_item_modifiers_modifier_idx").on(t.modifierId),
  ],
);

/** Audit trail of status changes (also holds the reject reason in `note`). */
export const orderEvents = pgTable(
  "order_events",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: orderStatus("from_status"),
    toStatus: orderStatus("to_status").notNull(),
    /** NULL when the actor is the web customer. */
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId), index("order_events_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------- settlements
export const settlements = pgTable(
  "settlements",
  {
    id: serial("id").primaryKey(),
    cadetId: integer("cadet_id")
      .notNull()
      .references(() => cadets.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    settledBy: integer("settled_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("settlements_cadet_idx").on(t.cadetId), index("settlements_settled_by_idx").on(t.settledBy)],
);

export const settlementOrders = pgTable(
  "settlement_orders",
  {
    settlementId: integer("settlement_id")
      .notNull()
      .references(() => settlements.id, { onDelete: "cascade" }),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.settlementId, t.orderId] }),
    index("settlement_orders_order_idx").on(t.orderId),
  ],
);

// ---------------------------------------------------------------- printing
export const printJobs = pgTable(
  "print_jobs",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    stationId: integer("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "restrict" }),
    type: printJobType("type").notNull(),
    payload: jsonb("payload").notNull(),
    status: printJobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
    /** Set when the agent claims the job (status -> printing). */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    printedAt: timestamp("printed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("print_jobs_station_status_idx").on(t.stationId, t.status),
    index("print_jobs_order_idx").on(t.orderId),
    check("print_jobs_attempts_nonneg", sql`${t.attempts} >= 0`),
  ],
);

// ---------------------------------------------------------------- settings
/**
 * Key/value store. Known keys (value is jsonb):
 *  - store_name      string
 *  - store_address   string
 *  - bank_alias      string   (transfer payments)
 *  - bank_cbu        string   (transfer payments)
 *  - delivery_fee    number   (centavos)
 *  - accepting_orders boolean (false shows the "local cerrado" banner)
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});
