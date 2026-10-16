-- The Burger Hause - PostgreSQL role + database.
-- Run ONCE as the postgres superuser:
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -f burgerhause-init.sql
-- It creates the role WITHOUT a password on purpose: a password given as a command-line variable would be
-- visible in `ps` and in the shell history. Set it afterwards, interactively (psql prompts twice, nothing is
-- echoed or logged):
--   sudo -u postgres psql -c '\password burgerhause'
-- Use letters and digits only (or URL-encode special characters in DATABASE_URL).
--
-- The role MUST be named like the OS user that runs the app and the backup (burgerhause): the backup connects
-- over the UNIX socket with peer authentication (Ubuntu default `local all all peer`), no password involved.
--
-- Also required in postgresql.conf:   listen_addresses = 'localhost'
-- and pg_hba.conf with only local lines (see docs/ops/runbook.md).

CREATE ROLE burgerhause LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

CREATE DATABASE burgerhause OWNER burgerhause ENCODING 'UTF8' TEMPLATE template0;

-- Nobody but the owner (and superusers) may even connect to it.
REVOKE ALL ON DATABASE burgerhause FROM PUBLIC;
GRANT CONNECT ON DATABASE burgerhause TO burgerhause;

\connect burgerhause
-- The app role owns the schema objects it migrates; keep the public schema private to it.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO burgerhause;
