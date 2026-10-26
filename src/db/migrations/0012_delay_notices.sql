CREATE TABLE "delay_notices" (
	"id" serial PRIMARY KEY NOT NULL,
	"extra_minutes" smallint NOT NULL,
	"reason" text NOT NULL,
	"started_by" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_by" integer,
	"ended_at" timestamp with time zone,
	CONSTRAINT "delay_notices_extra_minutes_valid" CHECK ("delay_notices"."extra_minutes" BETWEEN 5 AND 60 AND "delay_notices"."extra_minutes" % 5 = 0),
	CONSTRAINT "delay_notices_reason_len" CHECK (char_length("delay_notices"."reason") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "delay_notices" ADD CONSTRAINT "delay_notices_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_notices" ADD CONSTRAINT "delay_notices_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delay_notices_one_active" ON "delay_notices" USING btree ((true)) WHERE "delay_notices"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "delay_notices_started_by_idx" ON "delay_notices" USING btree ("started_by");--> statement-breakpoint
CREATE INDEX "delay_notices_ended_by_idx" ON "delay_notices" USING btree ("ended_by");