-- Kitchen screen (KDS): the `cocina` role (sees only /cocina) and the clock thresholds (minutes in preparation before yellow / red).
-- The new enum value is not used in this migration (Postgres forbids using it in the transaction that adds it).
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'cocina';--> statement-breakpoint
INSERT INTO "settings" ("key", "value") VALUES ('kds_warn_minutes', '8'::jsonb), ('kds_late_minutes', '15'::jsonb) ON CONFLICT ("key") DO NOTHING;
