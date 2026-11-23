#!/usr/bin/env bash
# Spins up a throwaway PostgreSQL, applies the Supabase stand-in, every migration
# in order, the seed, then runs the security tests. No Docker required.
# Usage: tests/db/run.sh            (must not run as root; PostgreSQL refuses)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PGPORT_TEST:-55432}"
DATA="$(mktemp -d)"
LOG="$DATA/server.log"

cleanup() { "$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

"$PG_BIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=''" -l "$LOG" -w start >/dev/null

PSQL=(psql -h "$DATA" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
QUIET_SETUP=(env PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -o /dev/null)

echo "Applying Supabase stand-in..."
"${QUIET_SETUP[@]}" -f "$ROOT/tests/db/supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$f")..."
  "${QUIET_SETUP[@]}" -f "$f"
done
echo "Applying seed..."
"${QUIET_SETUP[@]}" -f "$ROOT/supabase/seed.sql"
echo "Running tests..."
"${PSQL[@]}" -o /dev/null -f "${TEST_FILE:-$ROOT/tests/db/rls_test.sql}" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
