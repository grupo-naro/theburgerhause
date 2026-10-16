ALTER TABLE "settlements" ADD COLUMN "received_amount" integer;--> statement-breakpoint
UPDATE "settlements" SET "received_amount" = "amount";--> statement-breakpoint
ALTER TABLE "settlements" ALTER COLUMN "received_amount" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_received_nonneg" CHECK ("settlements"."received_amount" >= 0);--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_received_le_amount" CHECK ("settlements"."received_amount" <= "settlements"."amount");
