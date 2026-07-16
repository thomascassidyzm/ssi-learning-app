#!/bin/sh
# Nightly runner for scripts/insight-discovery.cjs — invoked by the
# com.ssi.insight-discovery launchd agent (~/Library/LaunchAgents).
#
# Root cause this exists to prevent: the discovery script was only ever run
# manually (ad hoc, June 2026) — no crontab/launchd/pm2/Vercel-cron job actually
# scheduled it, so the feed silently went stale with no error anywhere. This
# wrapper is the durable schedule; it must never fail silently either, so every
# outcome (success AND failure) is appended to the log.
#
# Runs on the real machine (not Vercel) because insight-discovery.cjs shells
# out to the `claude` CLI on the Pro Max subscription — that only exists here.
#
# CLAUDE_CONFIG_DIR is mandatory here: this machine's authenticated `claude`
# session lives under ~/.cs-accounts/account-1, not the CLI's default
# ~/.claude. Launchd agents start with a bare env (no CLAUDE_CONFIG_DIR), so
# without this line `claude -p` silently prints "Not logged in" and exits 1 —
# this was the actual failure mode that let the feed go stale with nothing to
# see in any error log (found by reproducing a launchd-clean env by hand).
set -u
REPO_DIR="/Users/tomcassidy/SSi/ssi-learning-app"
LOG_DIR="$REPO_DIR/scripts/.insight-discovery-logs"
LOG="$LOG_DIR/cron.log"
mkdir -p "$LOG_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export CLAUDE_CONFIG_DIR="/Users/tomcassidy/.cs-accounts/account-1"
NODE_BIN="/Users/tomcassidy/.nvm/versions/node/v22.15.0/bin/node"

cd "$REPO_DIR" || { echo "$(date -u +%FT%TZ) FAILED: cannot cd to $REPO_DIR" >> "$LOG"; exit 1; }

"$NODE_BIN" scripts/insight-discovery.cjs --write >> "$LOG" 2>&1
STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  echo "$(date -u +%FT%TZ) OK" >> "$LOG"
else
  echo "$(date -u +%FT%TZ) FAILED: insight-discovery.cjs exited $STATUS" >> "$LOG"
fi
