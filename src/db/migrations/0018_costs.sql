ALTER TABLE "modifiers" ADD COLUMN "cost" integer;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD COLUMN "cost_snapshot" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "unit_cost_snapshot" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "cost" integer;--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_cost_nonneg" CHECK ("modifiers"."cost" IS NULL OR "modifiers"."cost" >= 0);--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_remove_no_cost" CHECK ("modifiers"."kind" <> 'remove' OR "modifiers"."cost" IS NULL);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_cost_nonneg" CHECK ("products"."cost" IS NULL OR "products"."cost" >= 0);