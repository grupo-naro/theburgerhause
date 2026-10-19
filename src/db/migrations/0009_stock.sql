CREATE TYPE "public"."stock_item_kind" AS ENUM('bebida', 'materia_prima');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_kind" AS ENUM('ajuste_inicial', 'ingreso', 'consumo', 'venta', 'devolucion');--> statement-breakpoint
CREATE TYPE "public"."stock_unit" AS ENUM('kg', 'u', 'l');--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "stock_item_kind" NOT NULL,
	"unit" "stock_unit" NOT NULL,
	"min_qty" integer DEFAULT 0 NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_items_min_qty_nonneg" CHECK ("stock_items"."min_qty" >= 0),
	CONSTRAINT "stock_items_unit_whole" CHECK ("stock_items"."unit" <> 'u' OR "stock_items"."min_qty" % 1000 = 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"kind" "stock_movement_kind" NOT NULL,
	"qty_delta" integer NOT NULL,
	"business_date" date NOT NULL,
	"user_id" integer,
	"order_id" integer,
	"note" text,
	"idempotency_key" text,
	"superseded_value" integer,
	"edited_by" integer,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_sign" CHECK (("stock_movements"."kind" IN ('consumo','venta') AND "stock_movements"."qty_delta" <= 0) OR ("stock_movements"."kind" IN ('ajuste_inicial','ingreso','devolucion') AND "stock_movements"."qty_delta" >= 0)),
	CONSTRAINT "stock_movements_order_only_sales" CHECK ("stock_movements"."order_id" IS NULL OR "stock_movements"."kind" IN ('venta','devolucion')),
	CONSTRAINT "stock_movements_note_len" CHECK (char_length("stock_movements"."note") <= 200)
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "stock_item_id" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "stock_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_stock_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_name_unique" ON "stock_items" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_idempotency_key_unique" ON "stock_movements" USING btree ("idempotency_key") WHERE "stock_movements"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_order_item_kind_unique" ON "stock_movements" USING btree ("order_id","item_id","kind") WHERE "stock_movements"."order_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "stock_movements_item_idx" ON "stock_movements" USING btree ("item_id","id");--> statement-breakpoint
CREATE INDEX "stock_movements_user_idx" ON "stock_movements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stock_movements_edited_by_idx" ON "stock_movements" USING btree ("edited_by");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_stock_item_unique" ON "products" USING btree ("stock_item_id") WHERE "products"."stock_item_id" IS NOT NULL;