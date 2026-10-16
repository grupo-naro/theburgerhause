DROP INDEX "settlement_orders_order_idx";--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "note" text;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_orders_order_uniq" ON "settlement_orders" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "settlement_orders" ADD CONSTRAINT "settlement_orders_amount_nonneg" CHECK ("settlement_orders"."amount" >= 0);--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_amount_positive" CHECK ("settlements"."amount" > 0);--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_note_len" CHECK (char_length("settlements"."note") <= 200);