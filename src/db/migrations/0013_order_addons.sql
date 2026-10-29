CREATE TYPE "public"."addon_status" AS ENUM('pendiente_pago', 'confirmado', 'cancelado');--> statement-breakpoint
ALTER TYPE "public"."print_job_type" ADD VALUE 'additional';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_kind" ADD VALUE 'ajuste_pedido';--> statement-breakpoint
CREATE TABLE "order_addons" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"seq" smallint NOT NULL,
	"status" "addon_status" NOT NULL,
	"units" jsonb NOT NULL,
	"subtotal" integer NOT NULL,
	"idempotency_key" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by" integer,
	"confirmed_at" timestamp with time zone,
	"cancelled_by" integer,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "order_addons_order_seq_unique" UNIQUE("order_id","seq"),
	CONSTRAINT "order_addons_subtotal_nonneg" CHECK ("order_addons"."subtotal" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_sign";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_order_only_sales";--> statement-breakpoint
DROP INDEX "stock_movements_order_item_kind_unique";--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "addon_id" integer;--> statement-breakpoint
ALTER TABLE "order_addons" ADD CONSTRAINT "order_addons_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_addons" ADD CONSTRAINT "order_addons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_addons" ADD CONSTRAINT "order_addons_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_addons" ADD CONSTRAINT "order_addons_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_addons_idempotency_key_unique" ON "order_addons" USING btree ("idempotency_key") WHERE "order_addons"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "order_addons_created_by_idx" ON "order_addons" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "order_addons_confirmed_by_idx" ON "order_addons" USING btree ("confirmed_by");--> statement-breakpoint
CREATE INDEX "order_addons_cancelled_by_idx" ON "order_addons" USING btree ("cancelled_by");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_addon_id_order_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."order_addons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_addon_idx" ON "order_items" USING btree ("addon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_order_item_kind_unique" ON "stock_movements" USING btree ("order_id","item_id","kind") WHERE "stock_movements"."order_id" IS NOT NULL AND "stock_movements"."kind" IN ('venta','devolucion');--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sign" CHECK (("stock_movements"."kind"::text IN ('consumo','venta') AND "stock_movements"."qty_delta" <= 0) OR ("stock_movements"."kind"::text IN ('ajuste_inicial','ingreso','devolucion') AND "stock_movements"."qty_delta" >= 0) OR ("stock_movements"."kind"::text = 'ajuste_pedido' AND "stock_movements"."qty_delta" <> 0));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_only_sales" CHECK ("stock_movements"."order_id" IS NULL OR "stock_movements"."kind"::text IN ('venta','devolucion','ajuste_pedido'));