-- The Burger Hause - PostgreSQL role + database (TEMPLATE).
-- Run ONCE as the postgres superuser, after replacing the password placeholder:
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -v app_password="'THE_REAL_PASSWORD'" -f burgerhause-init.sql
-- (psql substitutes :app_password; keep the inner single quotes. Use letters and digits only, or URL-encode
--  special characters in DATABASE_URL.)
--
-- Also required in postgresql.conf:   listen_addresses = 'localhost'
-- and pg_hba.conf with only local lines (see docs/ops/runbook.md).

CREATE ROLE burgerhause LOGIN PASSWORD :app_password
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

CREATE DATABASE burgerhause OWNER burgerhause ENCODING 'UTF8' TEMPLATE template0;

-- Nobody but the owner (and superusers) may even connect to it.
REVOKE ALL ON DATABASE burgerhause FROM PUBLIC;
GRANT CONNECT ON DATABASE burgerhause TO burgerhause;

\connect burgerhause
-- The app role owns the schema objects it migrates; keep the public schema private to it.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO burgerhause;
