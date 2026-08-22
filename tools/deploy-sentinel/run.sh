#!/bin/bash
# run.sh — the cron entrypoint for the deploy sentinel. Runs CURRENT code.
#
# Why this exists (2026-08-20): the sentinel's checkout on watson-1 was on `main`,
# 123 commits behind origin/main, and never pulled. It had been watching production
# with a weeks-old copy of itself — including a play probe that could never start
# playback, which paged Tom at 02:51 with "learners likely can't play" while
# production was entirely healthy. The fix for that probe landed on `dev` and was
# hand-patched into the checkout to get through the night. This script makes
# "the sentinel runs current code" a property of the system instead of a favour.
#
# Each tick, in this order:
#   1. fetch + hard-sync the checkout to origin/dev (detached HEAD — no branch
#      pointer is moved, so the clone's own branches and its worktrees are
#      untouched; untracked files are never swept).
#   2. if pnpm-lock.yaml changed since the last successful install, kick off an
#      install in the BACKGROUND and carry on. The tick is never blocked by it.
#   3. run sentinel.mjs.
#
# THE INVARIANT: an update failure NEVER silences the watchman. Every step above
# is allowed to fail; the sentinel runs regardless, on whatever code is on disk,
# and the failure is logged. A sentinel on slightly-stale code beats a sentinel
# that did not run.
#
# Which branch, and why dev not main: this only decides which version of the
# SENTINEL'S OWN code runs. It has no bearing on what the sentinel watches — it
# detects deploys with `git ls-remote origin main`, a REMOTE lookup, and probes
# production over HTTP. `dev` is this repo's default branch and auto-merge target,
# so it is where the sentinel's own tooling lands first; tracking `main` would
# have reverted the play-probe fix and restored the broken alarm.
#
# Deliberately NOT set -e: see THE INVARIANT.
set -uo pipefail

# Everything lives inside main() and is called at the very bottom: step 1 can
# replace THIS FILE while it is executing, and bash must parse a function whole
# before running it. Without this, a run.sh update could be read half-old,
# half-new mid-tick.
main() {

  HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  REPO=$(cd "$HERE/../.." && pwd)
  LOG="$HERE/sentinel.log"          # shared with sentinel.mjs (gitignored)
  STAMP="$HERE/.installed-lock"     # sha256 of the lockfile last installed (gitignored)
  LOCKDIR="$HERE/.install.lock"

  NODE=/usr/bin/node
  GIT=/usr/bin/git
  # pnpm is off PATH on this box; corepack's shim is the only invocable copy.
  PNPM=/usr/lib/node_modules/corepack/shims/pnpm
  TRACK_REMOTE=origin
  TRACK_BRANCH=dev

  log() { printf '%s run.sh: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$*" >>"$LOG" 2>/dev/null; }

  # Keep the shared log bounded — this runs every 3 minutes. Same convention as
  # command-surface/ops/trim-log.sh (no logrotate, no root).
  if [ -f "$LOG" ] && [ "$(wc -l <"$LOG" 2>/dev/null || echo 0)" -gt 20000 ]; then
    tail -n 8000 "$LOG" >"$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
  fi

  # --- 1. sync to origin/dev --------------------------------------------------
  if timeout 90 "$GIT" -C "$REPO" fetch --quiet "$TRACK_REMOTE" "$TRACK_BRANCH" 2>/dev/null; then
    target=$("$GIT" -C "$REPO" rev-parse FETCH_HEAD 2>/dev/null)
    current=$("$GIT" -C "$REPO" rev-parse HEAD 2>/dev/null)
    if [ -z "$target" ]; then
      log "SYNC SKIPPED: could not resolve FETCH_HEAD — running code on disk ($current)"
    elif [ "$target" != "$current" ]; then
      # -f discards tracked-file edits: this checkout is a machine's working copy,
      # not a place to author. Untracked files are left exactly as they are.
      if timeout 90 "$GIT" -C "$REPO" checkout -qf --detach "$target" 2>/dev/null; then
        log "synced ${current:0:7} -> ${target:0:7} ($TRACK_REMOTE/$TRACK_BRANCH)"
      else
        log "SYNC FAILED: checkout of ${target:0:7} failed — running code on disk (${current:0:7})"
      fi
    fi
  else
    log "SYNC FAILED: git fetch $TRACK_REMOTE/$TRACK_BRANCH failed — running code on disk ($("$GIT" -C "$REPO" rev-parse --short HEAD 2>/dev/null))"
  fi

  # --- 2. keep node_modules honest, cheaply -----------------------------------
  # The play probe needs @playwright/test out of this checkout's node_modules. If
  # the lockfile has not moved, this costs one sha256 and nothing else.
  if [ -f "$REPO/pnpm-lock.yaml" ]; then
    lock_now=$(sha256sum "$REPO/pnpm-lock.yaml" 2>/dev/null | cut -d' ' -f1)
    lock_prev=$(cat "$STAMP" 2>/dev/null || echo '')
    if [ -n "$lock_now" ] && [ "$lock_now" != "$lock_prev" ]; then
      if [ -z "$lock_prev" ]; then
        # First run under this wrapper: adopt the lockfile the existing (working,
        # verified) node_modules corresponds to. Installing 469 MB to prove a
        # no-op would be a poor trade on a 3-minute cadence.
        echo "$lock_now" >"$STAMP"
        log "adopted lockfile ${lock_now:0:12} — existing node_modules kept, no install"
      elif mkdir "$LOCKDIR" 2>/dev/null; then
        log "LOCKFILE CHANGED (${lock_prev:0:12} -> ${lock_now:0:12}) — background pnpm install started; THIS TICK RUNS WITH THE OLD node_modules"
        (
          trap 'rmdir "$LOCKDIR" 2>/dev/null' EXIT
          if timeout 1200 env PATH=/usr/bin:/bin "$PNPM" -C "$REPO" install --frozen-lockfile \
               >>"$HERE/install.log" 2>&1; then
            echo "$lock_now" >"$STAMP"
            log "pnpm install OK for ${lock_now:0:12}"
          else
            log "PNPM INSTALL FAILED for ${lock_now:0:12} — node_modules does not match the lockfile; the play probe may report unavailable (see install.log)"
          fi
        ) </dev/null >/dev/null 2>&1 &
        disown 2>/dev/null || true
      fi
    fi
  fi

  # --- 3. run the watchman ----------------------------------------------------
  exec "$NODE" "$HERE/sentinel.mjs"
}

main "$@"
