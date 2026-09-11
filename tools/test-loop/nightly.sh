#!/usr/bin/env bash
# Report-only wrapper for tools/test-loop/run.mjs. Runs one cycle against an
# explicit ref, copies the cycle JSON and console log somewhere durable, and
# exits with the runner's ADVISORY exit code. Nothing may consume that code as
# a gate; a person reads latest.json. Same command by hand and from the timer.
set -uo pipefail
SRC="${TEST_LOOP_SOURCE:-$HOME/SSi/ssi-learning-app}"      # git objects + node_modules to borrow
REF="${TEST_LOOP_REF:-origin/dev}"                         # the TESTED commit, explicit
REPORTS="${TEST_LOOP_REPORTS:-$HOME/SSi/test-loop-reports}" # durable; never scratch
export CS_SCRATCH="${CS_SCRATCH:-$HOME/.cache/ssi-test-loop}"
export TEST_LOOP_SOURCE="$SRC"
mkdir -p "$CS_SCRATCH/tmp" "$REPORTS"
rm -rf "$CS_SCRATCH"/tmp/test-loop-*   # earlier clones; their reports were already copied
stamp=$(date -u +%Y%m%dT%H%M%SZ)
log="$REPORTS/$stamp.log"
nice -n 15 node "$(dirname "$(readlink -f "$0")")/run.mjs" --ref "$REF" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}
report=$(grep -o '^REPORT .*' "$log" | tail -1 | cut -d' ' -f2-)
if [ -n "$report" ] && [ -f "$report" ]; then
  sha=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).sourceCommit.slice(0,12))" "$report")
  cp "$report" "$REPORTS/$stamp-$sha.json"
  mv "$log" "$REPORTS/$stamp-$sha.log"
  ln -sfn "$stamp-$sha.json" "$REPORTS/latest.json"
  ln -sfn "$stamp-$sha.log" "$REPORTS/latest.log"
  echo "ARCHIVED $REPORTS/$stamp-$sha.json"
else
  echo "NO REPORT PRODUCED; console log kept at $log"
fi
echo "EXIT $code (advisory: 0 all caught, 1 misses, 2 gaps or execution failure; nothing gates on this)"
exit "$code"
