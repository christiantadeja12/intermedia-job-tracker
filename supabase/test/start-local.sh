#!/usr/bin/env bash
# Starts a throwaway local copy of the Supabase stack for `npm run test:supabase`:
#   PostgreSQL 16 (port 5433) -> PostgREST v12 (port 3001) -> supabase/test/local-gateway.mjs (port 54321)
# Needs: PostgreSQL 16 server binaries and a `postgrest` binary (set PG_BIN / POSTGREST if not on PATH).
# Then run:  SB_RESET_CMD="$(supabase/test/start-local.sh --print-reset)" npm run test:supabase
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
POSTGREST="${POSTGREST:-postgrest}"
DATA="${LO_PGDATA:-/tmp/little-ocean-pg}"
PSQL="psql -h 127.0.0.1 -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
RESET_CMD="$PSQL -d ocean -f $ROOT/supabase/test/reset.sql"
if [ "${1:-}" = "--print-reset" ]; then echo "$RESET_CMD"; exit 0; fi

as_pg(){ if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }

# Stop a stack left over from an earlier run
pkill -f "node supabase/test/local-gateway.mjs" 2>/dev/null || true
pkill -f "$DATA/postgrest.conf" 2>/dev/null || true
[ -f "$DATA/postmaster.pid" ] && as_pg "$PG_BIN/pg_ctl -D $DATA -m fast -w stop >/dev/null" || true
rm -rf "$DATA"; mkdir -p "$DATA"; [ "$(id -u)" = 0 ] && chown postgres "$DATA"
as_pg "$PG_BIN/initdb -D $DATA -U postgres -A trust >/dev/null"
as_pg "$PG_BIN/pg_ctl -D $DATA -o '-p 5433 -k /tmp' -l $DATA/log -w start >/dev/null"
$PSQL -d postgres -c 'create database ocean'
$PSQL -d ocean -f supabase/test/bootstrap.sql
$PSQL -d ocean -f supabase/schema.sql
for f in supabase/0*.sql; do case "$f" in *003_sample_data.sql) ;; *) $PSQL -d ocean -f "$f";; esac; done
$PSQL -d ocean -c "insert into public.staff (user_id, role, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'therapist', 'Test Therapist'),
  ('22222222-2222-2222-2222-222222222222', 'assistant', 'Test Assistant')"
$PSQL -d ocean -f supabase/003_sample_data.sql

SECRET="${JWT_SECRET:-local-test-secret-local-test-secret-123456}"
cat > "$DATA/postgrest.conf" <<EOF
db-uri = "postgres://authenticator:authenticator@127.0.0.1:5433/ocean"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = 3001
EOF
nohup "$POSTGREST" "$DATA/postgrest.conf" > "$DATA/postgrest.log" 2>&1 &
JWT_SECRET="$SECRET" nohup node supabase/test/local-gateway.mjs > "$DATA/gateway.log" 2>&1 &
sleep 2
echo "Local stack running. Reset command:"
echo "  $RESET_CMD"
