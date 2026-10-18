-- Business-day cutoff (HH:MM, America/Argentina/Buenos_Aires): order numbering and business_date roll over here instead of at midnight.
-- Existing orders keep their business_date; the first sale after the deploy continues the current day's counter or starts a new one.
INSERT INTO "settings" ("key", "value") VALUES ('business_day_cutoff', '"06:00"'::jsonb) ON CONFLICT ("key") DO NOTHING;
