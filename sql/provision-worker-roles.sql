\set sync_role hetang_sync_rw
\set sync_password CHANGE_ME_SYNC_PASSWORD
\set analysis_role hetang_analysis_rw
\set analysis_password CHANGE_ME_ANALYSIS_PASSWORD
\set db_name hetang_ops

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'sync_role') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', :'sync_role', :'sync_password');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'analysis_role') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', :'analysis_role', :'analysis_password');
  END IF;
END
$$;

GRANT CONNECT ON DATABASE :"db_name" TO :"sync_role";
GRANT CONNECT ON DATABASE :"db_name" TO :"analysis_role";
GRANT USAGE ON SCHEMA public TO :"sync_role";
GRANT USAGE ON SCHEMA public TO :"analysis_role";

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"sync_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"analysis_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"sync_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"analysis_role";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"sync_role";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"analysis_role";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"sync_role";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"analysis_role";

COMMENT ON ROLE :"sync_role" IS
  'Hetang sync worker role. Use with refresh functions or owner-owned matview refresh wrappers.';

COMMENT ON ROLE :"analysis_role" IS
  'Hetang analysis worker role. Intended for analysis queue processing and read-heavy marts.';
