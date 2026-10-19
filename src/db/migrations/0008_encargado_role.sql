-- Manager role `encargado`: operates Mostrador, Delivery, Caja/Despacho/Retiro and Cocina in every sector (no station needed).
-- The new enum value is not used in this migration (Postgres forbids using it in the transaction that adds it).
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'encargado';
