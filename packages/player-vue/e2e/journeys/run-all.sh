#!/usr/bin/env bash
# The full baseline matrix, SEQUENTIALLY — parallel runs on one box contend
# for CPU and bandwidth and would corrupt the very latency numbers this
# exists to produce.
set -u
BASE_URL="${BASE_URL:-https://staging.saysomethingin.app}"
OUTROOT="${OUTROOT:-${CS_SCRATCH:-/tmp}/journeys}"
run () { # journey net runs
  echo "=== $1 / $2 / $3 runs ==="
  BASE_URL="$BASE_URL" JOURNEY="$1" NET="$2" RUNS="$3" \
    OUT_DIR="$OUTROOT/$1-$2/" node "$(dirname "$0")/run.mjs" \
    > "$OUTROOT/$1-$2.log" 2>&1
  echo "  exit=$? log=$OUTROOT/$1-$2.log"
}
mkdir -p "$OUTROOT"
run j1 good 5;  run j1 fast3g 4; run j1 slow3g 3
run j3 good 4;  run j3 fast3g 3
run j2 good 4;  run j2 fast3g 3
run j4 good 4;  run j4 fast3g 3
run j5 good 3;  run j5 fast3g 3
run j1 highlatency 3
run j6 intermittent 3
echo "ALL DONE — summaries: $OUTROOT/*/summary.json"
