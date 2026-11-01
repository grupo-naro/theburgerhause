CREATE TABLE "stock_closings" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_date" date NOT NULL,
	"closed_by" integer,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "closing_id" integer;--> statement-breakpoint
ALTER TABLE "stock_closings" ADD CONSTRAINT "stock_closings_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_closings_business_date_unique" ON "stock_closings" USING btree ("business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_closings_idempotency_key_unique" ON "stock_closings" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "stock_closings_closed_by_idx" ON "stock_closings" USING btree ("closed_by");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_closing_id_stock_closings_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."stock_closings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_closing_idx" ON "stock_movements" USING btree ("closing_id");--> statement-breakpoint
CREATE INDEX "stock_movements_business_date_idx" ON "stock_movements" USING btree ("business_date","id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_closing_only_consumo" CHECK ("stock_movements"."closing_id" IS NULL OR "stock_movements"."kind"::text = 'consumo');