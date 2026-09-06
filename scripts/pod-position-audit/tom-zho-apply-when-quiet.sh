#!/usr/bin/env bash
# Job #706. Tom's own client overwrote the corrected counter within four
# minutes: usePodLapScheduler holds completed_pod_rounds in memory and
# persistRatchet() writes it back on every completed round, last-writer-wins,
# with no re-read. So a server-side correction cannot stick while a tab is
# open. This waits for his zho session to go quiet, then applies once.
#
# Run as a user service so it outlives the session that armed it:
#   systemd-run --user --unit=cs-long-706-zho-correct --slice=cs-workers.slice \
#     --working-directory="$PWD" bash -lc 'scripts/pod-position-audit/tom-zho-apply-when-quiet.sh'
set -euo pipefail
cd "$(dirname "$0")/../.."
QUIET_S=${QUIET_S:-360}
DEADLINE=$(( $(date +%s) + ${MAX_S:-36000} ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  age=$(node scripts/pod-position-audit/zho-quiet-age.cjs)
  echo "$(date -u +%H:%M:%S) last zho event ${age}s ago (need ${QUIET_S}s)"
  if [ "$age" -ge "$QUIET_S" ]; then
    echo "QUIET — applying"
    node scripts/pod-position-audit/tom-zho-apply.cjs --apply
    exit 0
  fi
  sleep 60
done
echo "DEADLINE reached — still active, nothing applied"
exit 3
