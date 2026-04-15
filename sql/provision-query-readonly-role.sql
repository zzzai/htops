\set query_role hetang_query_ro
\set query_password CHANGE_ME_QUERY_PASSWORD
\set db_name hetang_ops

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'query_role') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', :'query_role', :'query_password');
  END IF;
END
$$;

GRANT CONNECT ON DATABASE :"db_name" TO :"query_role";
GRANT USAGE ON SCHEMA public TO :"query_role";

GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"query_role";
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO :"query_role";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO :"query_role";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO :"query_role";
