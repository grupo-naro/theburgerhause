import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  smallint,
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
export const userRole = pgEnum("user_role", ["admin", "cajera", "encargada_delivery", "cocina", "encargado"]);
export const printJobStatus = pgEnum("print_job_status", [
  "pending",
  "printing",
  "done",
  "failed",
]);
/** `kitchen` and `ticket` are legacy/future: history rows (ticket = the old customer ticket) and the KDS phase. Orders enqueue `kitchen`, `customer` and `delivery` (`ticket` only exists in history). */
export const printJobType = pgEnum("print_job_type", ["kitchen", "ticket", "delivery", "customer", "additional"]);
export const modifierKind = pgEnum("modifier_kind", ["remove", "add", "swap"]);
export const stationKind = pgEnum("station_kind", ["mostrador", "delivery"]);
export const stockItemKind = pgEnum("stock_item_kind", ["bebida", "materia_prima"]);
export const stockUnit = pgEnum("stock_unit", ["kg", "u", "l"]);
export const stockMovementKind = pgEnum("stock_movement_kind", ["ajuste_inicial", "ingreso", "consumo", "venta", "devolucion", "ajuste_pedido"]);
export const addonStatus = pgEnum("addon_status", ["pendiente_pago", "confirmado", "cancelado"]);

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
    /** Optional link to a `bebida` stock item: each unit sold takes one unit (1000 milli) of stock. */
    stockItemId: integer("stock_item_id").references(() => stockItems.id, { onDelete: "set null" }),
    /** Paused BY STOCK (linked item at <= 0). Distinct from `active` (manual pause), which stock never touches. */
    stockPaused: boolean("stock_paused").notNull().default(false),
  },
  (t) => [
    unique("products_category_name_unique").on(t.categoryId, t.name),
    index("products_category_idx").on(t.categoryId),
    /** 1 product <-> 1 stock item. */
    uniqueIndex("products_stock_item_unique").on(t.stockItemId).where(sql`${t.stockItemId} IS NOT NULL`),
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
    /** Free number (1-99) the delivery manager writes by hand to group the orders one cadet carries in one trip. Delivery only. */
    tanda: smallint("tanda"),
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
    check("orders_tanda_range", sql`${t.tanda} IS NULL OR ${t.tanda} BETWEEN 1 AND 99`),
  ],
);

/**
 * Add-on ("adicional") to an existing order. `units` is the serialized ResolvedUnit[] kept while it is
 * pendiente_pago; confirming it inserts the order_items (with addon_id) and moves the order totals.
 */
export const orderAddons = pgTable(
  "order_addons",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    seq: smallint("seq").notNull(),
    status: addonStatus("status").notNull(),
    units: jsonb("units").notNull(),
    subtotal: integer("subtotal").notNull(),
    idempotencyKey: text("idempotency_key"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    confirmedBy: integer("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledBy: integer("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    unique("order_addons_order_seq_unique").on(t.orderId, t.seq),
    uniqueIndex("order_addons_idempotency_key_unique")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index("order_addons_created_by_idx").on(t.createdBy),
    index("order_addons_confirmed_by_idx").on(t.confirmedBy),
    index("order_addons_cancelled_by_idx").on(t.cancelledBy),
    check("order_addons_subtotal_nonneg", sql`${t.subtotal} >= 0`),
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
    /** NULL for the original order; set for units that came in through an add-on. */
    addonId: integer("addon_id").references(() => orderAddons.id, { onDelete: "no action" }),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    index("order_items_product_idx").on(t.productId),
    index("order_items_addon_idx").on(t.addonId),
  ],
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

// ---------------------------------------------------------------- delay notices
/** Manual "demora" notices. History is kept: a notice is closed (ended_at), never deleted. At most one is active. */
export const delayNotices = pgTable(
  "delay_notices",
  {
    id: serial("id").primaryKey(),
    extraMinutes: smallint("extra_minutes").notNull(),
    /** Staff-only: never shown to customers. */
    reason: text("reason").notNull(),
    startedBy: integer("started_by")
      .notNull()
      .references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedBy: integer("ended_by").references(() => users.id),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    check("delay_notices_extra_minutes_valid", sql`${t.extraMinutes} BETWEEN 5 AND 60 AND ${t.extraMinutes} % 5 = 0`),
    check("delay_notices_reason_len", sql`char_length(${t.reason}) BETWEEN 1 AND 120`),
    uniqueIndex("delay_notices_one_active").on(sql`(true)`).where(sql`${t.endedAt} IS NULL`),
    index("delay_notices_started_by_idx").on(t.startedBy),
    index("delay_notices_ended_by_idx").on(t.endedBy),
  ],
);

// ---------------------------------------------------------------- settlements
export const settlements = pgTable(
  "settlements",
  {
    id: serial("id").primaryKey(),
    cadetId: integer("cadet_id")
      .notNull()
      .references(() => cadets.id, { onDelete: "restrict" }),
    /** Centavos of debt cleared: the sum of the settled orders. */
    amount: integer("amount").notNull(),
    /** Centavos the cadet actually handed over; shortage = amount - received_amount. */
    receivedAmount: integer("received_amount").notNull(),
    settledBy: integer("settled_by").references(() => users.id, { onDelete: "set null" }),
    /** Free text from the manager; required (explaining the shortage) when received_amount < amount. */
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("settlements_cadet_idx").on(t.cadetId),
    index("settlements_settled_by_idx").on(t.settledBy),
    check("settlements_amount_positive", sql`${t.amount} > 0`),
    check("settlements_received_nonneg", sql`${t.receivedAmount} >= 0`),
    check("settlements_received_le_amount", sql`${t.receivedAmount} <= ${t.amount}`),
    check("settlements_note_len", sql`char_length(${t.note}) <= 200`),
  ],
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
    // An order is settled AT MOST once (also serves as the lookup index by order).
    uniqueIndex("settlement_orders_order_uniq").on(t.orderId),
    check("settlement_orders_amount_nonneg", sql`${t.amount} >= 0`),
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

// ---------------------------------------------------------------- stock
/**
 * Stock (drinks and raw material). Quantities are integer MILLI-units (1 kg = 1000, 1 u = 1000)
 * so decimals never go through floats. `quantity` is the running balance, kept in the SAME
 * transaction as every movement under a row lock: quantity = sum(stock_movements.qty_delta).
 */
export const stockItems = pgTable(
  "stock_items",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    kind: stockItemKind("kind").notNull(),
    unit: stockUnit("unit").notNull(),
    /** "Poco" threshold (milli); 0 = no minimum. */
    minQty: integer("min_qty").notNull().default(0),
    quantity: integer("quantity").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("stock_items_name_unique").on(sql`lower(${t.name})`),
    check("stock_items_min_qty_nonneg", sql`${t.minQty} >= 0`),
    check("stock_items_unit_whole", sql`${t.unit} <> 'u' OR ${t.minQty} % 1000 = 0`),
  ],
);

/**
 * Append-only ledger. Only `qty_delta` of ajuste_inicial/ingreso/consumo may be edited, and an edit
 * keeps the value it replaced in `superseded_value` (+ who/when). Signs: consumo/venta <= 0, the rest >= 0.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => stockItems.id, { onDelete: "restrict" }),
    kind: stockMovementKind("kind").notNull(),
    qtyDelta: integer("qty_delta").notNull(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    orderId: integer("order_id").references(() => orders.id, { onDelete: "restrict" }),
    note: text("note"),
    idempotencyKey: text("idempotency_key"),
    supersededValue: integer("superseded_value"),
    editedBy: integer("edited_by").references(() => users.id, { onDelete: "set null" }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("stock_movements_idempotency_key_unique")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    /** At most one venta and one devolucion per order and item (ajuste_pedido may repeat). Only old enum values here (the new one cannot be used in its own migration). */
    uniqueIndex("stock_movements_order_item_kind_unique")
      .on(t.orderId, t.itemId, t.kind)
      .where(sql`${t.orderId} IS NOT NULL AND ${t.kind} IN ('venta','devolucion')`),
    index("stock_movements_item_idx").on(t.itemId, t.id),
    index("stock_movements_user_idx").on(t.userId),
    index("stock_movements_edited_by_idx").on(t.editedBy),
    check(
      "stock_movements_sign",
      sql`(${t.kind}::text IN ('consumo','venta') AND ${t.qtyDelta} <= 0) OR (${t.kind}::text IN ('ajuste_inicial','ingreso','devolucion') AND ${t.qtyDelta} >= 0) OR (${t.kind}::text = 'ajuste_pedido' AND ${t.qtyDelta} <> 0)`,
    ),
    check("stock_movements_order_only_sales", sql`${t.orderId} IS NULL OR ${t.kind}::text IN ('venta','devolucion','ajuste_pedido')`),
    check("stock_movements_note_len", sql`char_length(${t.note}) <= 200`),
  ],
);

/**
 * Append-only audit of every edit of a movement (one row per edit, written in the same
 * transaction). The movement's superseded_value/edited_by/edited_at mirror only the LATEST edit.
 */
export const stockMovementEdits = pgTable(
  "stock_movement_edits",
  {
    id: serial("id").primaryKey(),
    movementId: integer("movement_id")
      .notNull()
      .references(() => stockMovements.id, { onDelete: "restrict" }),
    previousDelta: integer("previous_delta").notNull(),
    newDelta: integer("new_delta").notNull(),
    editedBy: integer("edited_by").references(() => users.id, { onDelete: "set null" }),
    editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_movement_edits_movement_idx").on(t.movementId, t.id),
    index("stock_movement_edits_edited_by_idx").on(t.editedBy),
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
 *  - (removed) kds_warn_minutes / kds_late_minutes: the old kitchen screen is gone; rows may remain in old databases but are unused
 *  - business_day_cutoff string "HH:MM" (Buenos Aires; numbering and business_date roll here, default 06:00)
 *  - base_prep_minutes integer 5-180 (default 25); delivery_travel_minutes integer 0-120 (default 15)
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});
