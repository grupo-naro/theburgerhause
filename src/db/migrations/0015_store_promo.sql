CREATE TABLE "store_promo" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"image_path" text,
	"title" text,
	"active" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_promo_single_row" CHECK ("store_promo"."id" = 1),
	CONSTRAINT "store_promo_window_order" CHECK ("store_promo"."starts_at" IS NULL OR "store_promo"."ends_at" IS NULL OR "store_promo"."ends_at" > "store_promo"."starts_at")
);
