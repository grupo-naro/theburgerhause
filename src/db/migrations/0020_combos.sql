CREATE TABLE "combo_items" (
	"combo_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" smallint NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "combo_items_combo_id_product_id_pk" PRIMARY KEY("combo_id","product_id"),
	CONSTRAINT "combo_items_quantity_range" CHECK ("combo_items"."quantity" BETWEEN 1 AND 20),
	CONSTRAINT "combo_items_not_self" CHECK ("combo_items"."combo_id" <> "combo_items"."product_id")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "combo_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_combo_id_products_id_fk" FOREIGN KEY ("combo_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "combo_items_product_idx" ON "combo_items" USING btree ("product_id");