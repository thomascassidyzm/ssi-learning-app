#!/bin/bash
set -a; . .env.local; . /home/tomcassidy/.ssi-sentinel.env; set +a
export TMPDIR=/home/tomcassidy/.cs-scratch/984-pw
mkdir -p "$TMPDIR"
export LD_LIBRARY_PATH=/home/tomcassidy/.pw-libs/usr/lib/x86_64-linux-gnu:/home/tomcassidy/.ssi-sentinel-libs
export CHROME_BIN=/home/tomcassidy/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome
D=audit/984-handbook-showme/results
for spec in "genuine desktop" "viewas desktop" "genuine phone" "viewas phone"; do
  set -- $spec
  echo "=== MODE=$1 WIDTH=$2 $(date -Is)"
  MODE=$1 WIDTH=$2 DEEP=1 OUT=$D/school-admin-$1-$2.json timeout 1500 node packages/player-vue/e2e/_985-school-admin-handbook-audit.mjs || echo "RUN FAILED/TIMED OUT: $1 $2"
done
echo "ALL DONE $(date -Is)"
