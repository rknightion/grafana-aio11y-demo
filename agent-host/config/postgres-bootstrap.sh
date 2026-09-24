#!/usr/bin/env bash
# Idempotent Postgres setup for the Claude apps gateway, run as a one-shot compose service.
#
#   before-gateway  create/refresh the gateway role and database and the grafana_ro role
#   after-gateway   grant grafana_ro SELECT on the reporting tables only (REPORTING_TABLES), once
#                   the gateway's boot-time migrations have created them; every other gateway
#                   table (kv holds session state, _migrations) stays unreadable
#
# Passwords are read inside psql from the mounted secret files, never passed on a command line.
set -Eeuo pipefail

phase="${1:?usage: postgres-bootstrap.sh before-gateway|after-gateway}"
REPORTING_TABLES="spend spend_limits principal_emails admin_audit"
export PGHOST=postgres PGUSER=postgres
PGPASSWORD="$(cat /run/secrets/superuser_password)"
export PGPASSWORD

for _ in $(seq 1 60); do
  pg_isready -q && break
  sleep 2
done

case "$phase" in
  before-gateway)
    psql -v ON_ERROR_STOP=1 -d postgres <<'SQL'
\set gw_pw `cat /run/secrets/postgres_password`
\set ro_pw `cat /run/secrets/postgres_grafana_ro_password`
SELECT 'CREATE ROLE gateway LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gateway') \gexec
SELECT 'CREATE ROLE grafana_ro LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grafana_ro') \gexec
ALTER ROLE gateway WITH LOGIN PASSWORD :'gw_pw';
ALTER ROLE grafana_ro WITH LOGIN PASSWORD :'ro_pw';
ALTER ROLE grafana_ro SET default_transaction_read_only = on;
SELECT 'CREATE DATABASE gateway OWNER gateway' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'gateway') \gexec
REVOKE ALL ON DATABASE gateway FROM PUBLIC;
GRANT CONNECT ON DATABASE gateway TO gateway, grafana_ro;
\connect gateway
GRANT USAGE ON SCHEMA public TO grafana_ro;
-- Undo the blanket default privileges earlier versions set.
ALTER DEFAULT PRIVILEGES FOR ROLE gateway REVOKE SELECT ON TABLES FROM grafana_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE gateway IN SCHEMA public REVOKE SELECT ON TABLES FROM grafana_ro;
SQL
    echo "postgres-bootstrap: roles and database in place"
    ;;
  after-gateway)
    # The spend dashboards and alert rules read only these (see agent-host/SEAM.md).
    psql -v ON_ERROR_STOP=1 -d gateway -v tables="$REPORTING_TABLES" <<'SQL'
SELECT format('REVOKE SELECT ON ALL TABLES IN SCHEMA %I FROM grafana_ro', nspname)
  FROM pg_namespace
 WHERE nspowner = 'gateway'::regrole OR nspname = 'public' \gexec
SELECT format('GRANT SELECT ON %I.%I TO grafana_ro', schemaname, tablename)
  FROM pg_tables
 WHERE schemaname = 'public' AND tablename = ANY (string_to_array(:'tables', ' ')) \gexec
SQL
    granted="$(psql -At -d gateway -c "SELECT string_agg(table_name, ' ' ORDER BY 1) FROM information_schema.role_table_grants WHERE grantee = 'grafana_ro' AND privilege_type = 'SELECT'")"
    echo "postgres-bootstrap: grafana_ro can read: ${granted:-<none yet>} (wanted: $REPORTING_TABLES)"
    ;;
  *)
    echo "postgres-bootstrap: unknown phase $phase" >&2
    exit 2
    ;;
esac
