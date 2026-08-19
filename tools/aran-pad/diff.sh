#!/usr/bin/env bash
# See exactly what Aran changed in the How This Works copy.
#
#   ./tools/aran-pad/diff.sh            unified diff + word-level diff, original -> Aran's current text
#   ./tools/aran-pad/diff.sh --export   the same, and also writes docs/htw-copy-for-aran.edited.md
#                                       so a mapping worker has a normal file to work from
#
# Original (frozen seed)  : ~/aran-pad-data/original.md
# Aran's live text        : ~/aran-pad-data/current.md
# Every save is versioned : ~/aran-pad-data/versions/<iso>.md
set -u

DATA="$HOME/aran-pad-data"
ORIG="$DATA/original.md"
CUR="$DATA/current.md"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

[ -f "$ORIG" ] || { echo "missing $ORIG" >&2; exit 1; }
[ -f "$CUR" ]  || { echo "missing $CUR" >&2; exit 1; }

if cmp -s "$ORIG" "$CUR"; then
  echo "No edits yet — Aran's text is byte-identical to the original."
else
  echo "=== unified diff (original -> Aran) ==="
  git diff --no-index --no-color -- "$ORIG" "$CUR"
  echo
  echo "=== word-level diff ==="
  git diff --no-index --no-color --word-diff=color -- "$ORIG" "$CUR"
fi

echo
echo "saves recorded: $(ls -1 "$DATA/versions" 2>/dev/null | wc -l)  (latest: $(ls -1 "$DATA/versions" 2>/dev/null | tail -1))"

if [ "${1:-}" = "--export" ]; then
  cp "$CUR" "$REPO/docs/htw-copy-for-aran.edited.md"
  echo "wrote $REPO/docs/htw-copy-for-aran.edited.md"
fi
