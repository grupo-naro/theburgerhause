CREATE TABLE "stock_movement_edits" (
	"id" serial PRIMARY KEY NOT NULL,
	"movement_id" integer NOT NULL,
	"previous_delta" integer NOT NULL,
	"new_delta" integer NOT NULL,
	"edited_by" integer,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_movement_edits" ADD CONSTRAINT "stock_movement_edits_movement_id_stock_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_edits" ADD CONSTRAINT "stock_movement_edits_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movement_edits_movement_idx" ON "stock_movement_edits" USING btree ("movement_id","id");--> statement-breakpoint
CREATE INDEX "stock_movement_edits_edited_by_idx" ON "stock_movement_edits" USING btree ("edited_by");