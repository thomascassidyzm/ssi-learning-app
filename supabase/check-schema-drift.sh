#!/usr/bin/env bash
#
# check-schema-drift.sh — fail if supabase/schema.sql no longer describes the
# live database. Read-only: it dumps and compares, and NEVER writes to the DB.
#
# Usage:   ./supabase/check-schema-drift.sh
# Exit 0 = snapshot matches live. Exit 1 = drift, with the differing relation
# names printed. Exit 2 = could not check (no pg_dump >= 17, or no connection).
#
# NOT WIRED INTO CI, deliberately: .github/workflows/verify.yml has no database
# step, and giving it one would mean putting a live database credential into
# GitHub secrets next to the repo. Run this by hand after any live DB change,
# or from a nightly job on a machine that already holds .env.psql. The guard
# that DOES run in CI is api/schema-snapshot.test.ts — it needs no credential
# and catches the case that actually bit us (code querying a table the snapshot
# does not declare); this script is the wider check that only a live DB can do.
#
# Requirements and connection resolution are identical to snapshot-schema.sh:
#   pg_dump major >= server (PG17); DATABASE_URL, else $ENVPSQL, else the
#   sibling dashboard repo's .env.psql. The connection string is never printed.
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNAPSHOT="$HERE/schema.sql"

if [ -z "${DATABASE_URL:-}" ]; then
  ENVPSQL="${ENVPSQL:-$HERE/../../ssi-dashboard-v7-clean/.env.psql}"
  if [ -f "$ENVPSQL" ]; then
    line=$(grep -E '^(export )?DATABASE_URL=' "$ENVPSQL" | head -1 || true)
    val="${line#*=}"; val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    DATABASE_URL=$(printf '%s' "$val" | tr -d '\r\n')
  fi
fi
[ -n "${DATABASE_URL:-}" ] || { echo "SKIP: no DATABASE_URL — cannot compare against the live DB (set it, or ENVPSQL)" >&2; exit 2; }

PG_DUMP="${PG_DUMP:-/opt/homebrew/opt/postgresql@17/bin/pg_dump}"
[ -x "$PG_DUMP" ] || PG_DUMP="$HOME/.local/pg17/bin/pg_dump"
[ -x "$PG_DUMP" ] || PG_DUMP=pg_dump
command -v "$PG_DUMP" >/dev/null 2>&1 || { echo "SKIP: no pg_dump found (set PG_DUMP=/path/to/pg_dump, major >= 17)" >&2; exit 2; }

# Relation names (tables + views + matviews) declared by a schema dump.
relations() { grep -oE '^CREATE (TABLE|VIEW|MATERIALIZED VIEW) (IF NOT EXISTS )?public\.[a-zA-Z0-9_]+' "$1" \
  | sed -E 's/.*public\.//' | LC_ALL=C sort -u; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
"$PG_DUMP" "$DATABASE_URL" --schema=public --schema-only --no-owner > "$TMP/live.sql"

relations "$SNAPSHOT"    > "$TMP/declared"
relations "$TMP/live.sql" > "$TMP/live"

MISSING="$(comm -13 "$TMP/declared" "$TMP/live")"   # live has it, snapshot does not
EXTRA="$(comm -23 "$TMP/declared" "$TMP/live")"     # snapshot has it, live does not

if [ -z "$MISSING" ] && [ -z "$EXTRA" ]; then
  echo "OK: supabase/schema.sql declares the same $(wc -l < "$TMP/live" | tr -d ' ') relations as the live database."
  exit 0
fi

echo "DRIFT: supabase/schema.sql no longer matches the live database." >&2
[ -n "$MISSING" ] && { echo "  Live, but MISSING from the snapshot:" >&2; echo "$MISSING" | sed 's/^/    + /' >&2; }
[ -n "$EXTRA"   ] && { echo "  In the snapshot, but GONE from live:"  >&2; echo "$EXTRA"   | sed 's/^/    - /' >&2; }
echo "  Regenerate:  ./supabase/snapshot-schema.sh" >&2
exit 1
