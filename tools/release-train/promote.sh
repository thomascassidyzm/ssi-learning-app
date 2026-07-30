#!/usr/bin/env bash
# promote.sh — staging → main, the Friday-morning half of the weekly release train.
#
# FOUNDER RULING (2026-07-30): production ships WEEKLY, FRIDAY MORNINGS, on Tom's explicit GO.
# THIS SCRIPT IS NEVER CRONNED. It runs only when a human (or Watson relaying Tom's word) types
# it, and it refuses to do anything without --go. There is deliberately no automation path here:
# the whole point of the mechanism is that the trigger is Tom's sentence, every week.
#
#   ./tools/release-train/promote.sh            # preview: what would ship, no writes
#   ./tools/release-train/promote.sh --go       # do it: merge staging into main and push
#
# Works in a throwaway git worktree, so it never touches the live working tree (an agent may be
# mid-branch in it) and never needs it clean.
#
# After the push: the deploy sentinel (tools/deploy-sentinel/, cron'd every 3 min on watson-1)
# opens a 2h watch window on the new main sha automatically — deploy-live, endpoint probes and
# production telemetry. Do not add a watch step here. Then post the done-board card as described
# in docs/RELEASE-TRAIN.md.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GO=0
[[ "${1:-}" == "--go" ]] && GO=1

cd "$REPO"
git fetch origin --quiet --prune

MAIN=$(git rev-parse origin/main)
STAGING=$(git rev-parse origin/staging)

if [[ "$MAIN" == "$STAGING" ]]; then
  echo "Nothing to promote — main and staging are the same commit ($(git rev-parse --short origin/main))."
  exit 0
fi

# main must be an ancestor of staging. If it is not, someone pushed to main directly (a hotfix
# that was never back-merged, per CLAUDE.md's hotfix lane) and this promote would either lose it
# or land a surprise merge. Stop and let a human reconcile.
if ! git merge-base --is-ancestor "$MAIN" "$STAGING"; then
  echo "REFUSING: origin/main is NOT an ancestor of origin/staging."
  echo "main has $(git rev-list --count origin/staging..origin/main) commit(s) staging does not."
  echo "Likely an un-back-merged hotfix. Back-merge main into staging (and dev) first — CLAUDE.md, hotfix lane."
  exit 1
fi

COUNT=$(git rev-list --count origin/main..origin/staging)
echo "Candidate: $COUNT commit(s), $(git rev-parse --short origin/main)..$(git rev-parse --short origin/staging)"
echo "Report:    tools/release-train/reports/  (latest Thursday candidate report)"
echo "Compare:   https://github.com/thomascassidyzm/ssi-learning-app/compare/main...staging"
echo

if [[ "$GO" -ne 1 ]]; then
  git log --oneline --no-merges origin/main..origin/staging | head -20
  echo
  echo "Preview only. Re-run with --go once Tom has said GO."
  exit 0
fi

WT=$(mktemp -d -t ssi-promote-XXXXXX)
cleanup() { git worktree remove --force "$WT" >/dev/null 2>&1 || true; git worktree prune >/dev/null 2>&1 || true; }
trap cleanup EXIT

git worktree add --quiet -B _promote_main "$WT" origin/main
git -C "$WT" merge --no-ff origin/staging \
  -m "promote: staging→main — weekly Friday ship, $COUNT commits ($(git rev-parse --short origin/staging))"
git -C "$WT" push origin HEAD:main

NEW=$(git -C "$WT" rev-parse --short HEAD)
git branch -D _promote_main >/dev/null 2>&1 || true

echo
echo "PROMOTED: main is now $NEW ($COUNT commits shipped)."
echo "The deploy sentinel opens its 2h watch window within 3 minutes — nothing else to run."
echo "Now post the done-board card (docs/RELEASE-TRAIN.md, 'Report the ship')."
