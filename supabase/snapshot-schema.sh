#!/usr/bin/env bash
#
# snapshot-schema.sh — regenerate supabase/schema.sql, the canonical snapshot
# of the live database's `public` schema (the source of truth for DB state).
#
# Usage:   ./supabase/snapshot-schema.sh
# Run this after applying ANY change to the live DB (new table, RPC, policy,
# grant, index, trigger) so the committed schema.sql tracks reality.
#
# Requirements:
#   - A pg_dump whose MAJOR version >= the server (currently PG17).
#     Defaults to Homebrew postgresql@17; override with PG_DUMP=/path/to/pg_dump
#   - A connection string, resolved in order:
#       1. $DATABASE_URL
#       2. $ENVPSQL  (path to an .env.psql containing DATABASE_URL=...)
#       3. ../../ssi-dashboard-v7-clean/.env.psql  (the sibling dashboard repo)
#     The connection string is read but NEVER printed or committed.
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/schema.sql"

if [ -z "${DATABASE_URL:-}" ]; then
  ENVPSQL="${ENVPSQL:-$HERE/../../ssi-dashboard-v7-clean/.env.psql}"
  if [ -f "$ENVPSQL" ]; then
    line=$(grep -E '^(export )?DATABASE_URL=' "$ENVPSQL" | head -1 || true)
    val="${line#*=}"; val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    DATABASE_URL=$(printf '%s' "$val" | tr -d '\r\n')
  fi
fi
[ -n "${DATABASE_URL:-}" ] || { echo "ERROR: no DATABASE_URL (set it, ENVPSQL, or place .env.psql in the sibling dashboard repo)" >&2; exit 1; }

PG_DUMP="${PG_DUMP:-/opt/homebrew/opt/postgresql@17/bin/pg_dump}"
[ -x "$PG_DUMP" ] || PG_DUMP=pg_dump

# Strip volatile lines so re-dumps diff only on real schema changes:
#   "-- Dumped on <timestamp>"   — changes every run
#   "\restrict / \unrestrict <token>" — pg_dump 17 emits a random token per run
{
  cat <<'BANNER'
--
-- ============================================================================
-- SSi Learning App — CURRENT DATABASE SCHEMA  (canonical source of truth)
-- ============================================================================
-- Schema-only snapshot of the live Supabase Postgres `public` schema: every
-- table, function/RPC, RLS policy, grant, index and trigger exactly as it
-- exists in production right now. This file IS the record of current DB state.
--
-- Regenerate after ANY applied DB change:   ./supabase/snapshot-schema.sh
--   (runs `pg_dump --schema=public --schema-only` against the live DB)
--
-- The supabase/migrations/ directory is retained as HISTORY. Read current
-- state from THIS file, not by replaying migrations.
-- ============================================================================
--
BANNER
  "$PG_DUMP" "$DATABASE_URL" --schema=public --schema-only --no-owner \
    | grep -vE '^(-- Dumped on |\\(un)?restrict )'
} > "$OUT"

echo "Wrote $OUT ($(wc -l < "$OUT") lines)"
