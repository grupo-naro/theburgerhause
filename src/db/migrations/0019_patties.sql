ALTER TABLE "order_items" ADD COLUMN "patties_snapshot" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "patties" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_patties_range" CHECK ("products"."patties" BETWEEN 0 AND 3);