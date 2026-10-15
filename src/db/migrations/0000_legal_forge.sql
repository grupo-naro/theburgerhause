CREATE TYPE "public"."channel" AS ENUM('web', 'counter');--> statement-breakpoint
CREATE TYPE "public"."fulfillment" AS ENUM('delivery', 'takeaway');--> statement-breakpoint
CREATE TYPE "public"."modifier_kind" AS ENUM('remove', 'add', 'swap');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pendiente_aprobacion', 'en_preparacion', 'listo_despacho', 'en_camino', 'para_retirar', 'entregado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid');--> statement-breakpoint
CREATE TYPE "public"."print_job_status" AS ENUM('pending', 'printing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."print_job_type" AS ENUM('kitchen', 'ticket');--> statement-breakpoint
CREATE TYPE "public"."station_kind" AS ENUM('mostrador', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'cajera', 'encargada_delivery');--> statement-breakpoint
CREATE TABLE "cadets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"image_path" text,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "daily_counters" (
	"business_date" date PRIMARY KEY NOT NULL,
	"last_number" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modifier_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "modifier_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "modifiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" "modifier_kind" NOT NULL,
	"price_delta" integer DEFAULT 0 NOT NULL,
	"kitchen_label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "modifiers_group_name_unique" UNIQUE("group_id","name"),
	CONSTRAINT "modifiers_remove_free" CHECK ("modifiers"."kind" <> 'remove' OR "modifiers"."price_delta" = 0)
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"user_id" integer,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_item_modifiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_item_id" integer NOT NULL,
	"modifier_id" integer,
	"name_snapshot" text NOT NULL,
	"kitchen_label" text NOT NULL,
	"kind" "modifier_kind" NOT NULL,
	"price_delta" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer,
	"name_snapshot" text NOT NULL,
	"unit_price_snapshot" integer NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_date" date NOT NULL,
	"number" integer NOT NULL,
	"public_token" text NOT NULL,
	"idempotency_key" text,
	"channel" "channel" NOT NULL,
	"fulfillment" "fulfillment" NOT NULL,
	"status" "order_status" NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"payment_status" "payment_status" DEFAULT 'pending' NOT NULL,
	"customer_name" text NOT NULL,
	"whatsapp" text,
	"address" text,
	"cross_streets" text,
	"address_notes" text,
	"pager_number" integer,
	"subtotal" integer NOT NULL,
	"delivery_fee" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"cadet_id" integer,
	"approved_by" integer,
	"station_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "orders_public_token_unique" UNIQUE("public_token"),
	CONSTRAINT "orders_business_date_number_unique" UNIQUE("business_date","number"),
	CONSTRAINT "orders_counter_requires_pager" CHECK ("orders"."channel" <> 'counter' OR "orders"."pager_number" IS NOT NULL),
	CONSTRAINT "orders_total_nonneg" CHECK ("orders"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "print_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"station_id" integer NOT NULL,
	"type" "print_job_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "print_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"printed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_jobs_attempts_nonneg" CHECK ("print_jobs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_modifier_groups" (
	"product_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	CONSTRAINT "product_modifier_groups_product_id_group_id_pk" PRIMARY KEY("product_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" integer NOT NULL,
	"image_path" text,
	"active" boolean DEFAULT true NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "products_category_name_unique" UNIQUE("category_id","name"),
	CONSTRAINT "products_price_nonneg" CHECK ("products"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"station_id" integer
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_orders" (
	"settlement_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "settlement_orders_settlement_id_order_id_pk" PRIMARY KEY("settlement_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"cadet_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"settled_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "station_kind" NOT NULL,
	"token_hash" text,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "stations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_group_id_modifier_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifier_id_modifiers_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."modifiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cadet_id_cadets_id_fk" FOREIGN KEY ("cadet_id") REFERENCES "public"."cadets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_group_id_modifier_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_orders" ADD CONSTRAINT "settlement_orders_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_orders" ADD CONSTRAINT "settlement_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_cadet_id_cadets_id_fk" FOREIGN KEY ("cadet_id") REFERENCES "public"."cadets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_settled_by_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "modifiers_group_idx" ON "modifiers" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_events_user_idx" ON "order_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "order_item_modifiers_item_idx" ON "order_item_modifiers" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "order_item_modifiers_modifier_idx" ON "order_item_modifiers" USING btree ("modifier_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_key_unique" ON "orders" USING btree ("idempotency_key") WHERE "orders"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "orders_status_created_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "orders_cadet_status_idx" ON "orders" USING btree ("cadet_id","status");--> statement-breakpoint
CREATE INDEX "orders_approved_by_idx" ON "orders" USING btree ("approved_by");--> statement-breakpoint
CREATE INDEX "orders_station_idx" ON "orders" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "print_jobs_station_status_idx" ON "print_jobs" USING btree ("station_id","status");--> statement-breakpoint
CREATE INDEX "print_jobs_order_idx" ON "print_jobs" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "product_modifier_groups_group_idx" ON "product_modifier_groups" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_station_idx" ON "sessions" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "settlement_orders_order_idx" ON "settlement_orders" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "settlements_cadet_idx" ON "settlements" USING btree ("cadet_id");--> statement-breakpoint
CREATE INDEX "settlements_settled_by_idx" ON "settlements" USING btree ("settled_by");