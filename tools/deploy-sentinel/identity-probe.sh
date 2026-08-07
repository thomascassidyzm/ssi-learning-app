#!/bin/sh
# identity-probe.sh — prove sentinel.mjs's postBoard() now carries a v2 session Cookie + Origin
# on a real needs-you POST, and proves fail-soft when the session file is missing — WITHOUT any
# card ever reaching Tom's board.
#
# Why a shim and not a live post: sentinel.mjs's needs-you alert only fires from inside a real
# 2h deploy-watch window, DEPLOY_GRACE_MS (20 min) after a push that never went live — a state
# that cannot be conjured against the real repo without either waiting on a real bad deploy or
# mutating tools/deploy-sentinel/state.json in place (which would corrupt the live sentinel's
# bookkeeping). So instead: a full THROWAWAY COPY of the tool, pointed at its own state.json
# (via REPO = HERE/../.. — copying the whole tools/deploy-sentinel dir under a fresh directory
# gives it a fresh REPO), with `git ls-remote origin main` answered by a local git remote
# pointed back at the real repo (so the real current sha is used, offline, with no network
# call), and globalThis.fetch replaced by a --require preload that INTERCEPTS every POST to
# localhost:4317 — recording the url + full headers and answering 200 OK — while passing every
# other fetch (prod GETs, the telemetry leg) straight through untouched. Nothing reaches the
# command surface; the script runs its own, real, unmodified code path end to end.
#
# The complementary claim — that the surface's access-gate actually ACCEPTS this header shape —
# is out of scope here (see command-surface's cron-identity-live.sh for that side); this file
# proves emission only.
set -eu

REAL_REPO=$(cd "$(dirname "$0")/../.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "== setting up throwaway copy at $TMP/sp =="
mkdir -p "$TMP/sp/tools"
cp -r "$REAL_REPO/tools/deploy-sentinel" "$TMP/sp/tools/deploy-sentinel"
rm -f "$TMP/sp/tools/deploy-sentinel/state.json" "$TMP/sp/tools/deploy-sentinel/sentinel.log"
git init -q "$TMP/sp"
git -C "$TMP/sp" remote add origin "$REAL_REPO"

REAL_SHA=$(git -C "$TMP/sp" ls-remote origin main | cut -f1)
if [ -z "$REAL_SHA" ]; then
  echo "GAP: could not resolve real main sha via offline ls-remote — cannot proceed"
  exit 1
fi
echo "   real main sha: $REAL_SHA"

cat > "$TMP/fetch-shim.cjs" <<'SHIM'
// Replaces global fetch: records POSTs to localhost:4317 (url + headers) to RECORD_FILE and
// answers 200 OK without leaving the process; every other fetch passes through untouched.
const fs = require('node:fs')
const RECORD_FILE = process.env.RECORD_FILE
const realFetch = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  if (opts && opts.method === 'POST' && u.startsWith('http://localhost:4317')) {
    fs.appendFileSync(RECORD_FILE, JSON.stringify({ url: u, headers: opts.headers || {} }) + '\n')
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  return realFetch(url, opts)
}
SHIM

write_state() {
  # $1 = fake window sha (never live => deploy-live leg never matches => grace expiry => alert)
  node -e "
    const sha = '$REAL_SHA', fakesha = '$1';
    const openedAt = Date.now() - 40 * 60 * 1000; // past the 20-min DEPLOY_GRACE_MS
    const state = {
      lastMainSha: sha, // == real remote sha, so no NEW window opens over ours
      window: { sha: fakesha, openedAt, deployLiveAt: null, closedAt: null,
                alerted: {}, probeFails: {}, lastTelemetryAt: 0, notes: [] },
    }
    require('fs').writeFileSync('$TMP/sp/tools/deploy-sentinel/state.json', JSON.stringify(state, null, 2) + '\n')
  "
}

run() {
  # $1 = record file, $2 = CS_SESSION_FILE value (real path or a nonexistent one)
  rm -f "$TMP/sp/tools/deploy-sentinel/sentinel.log"
  : > "$1"
  ( cd "$TMP/sp" && RECORD_FILE="$1" CS_SESSION_FILE="$2" \
      node --require "$TMP/fetch-shim.cjs" tools/deploy-sentinel/sentinel.mjs )
}

echo
echo "== step 1-4: real session file present -> POST must carry Cookie + Origin =="
write_state "1111111111111111111111111111111111aaaa"
REC1="$TMP/record-with-session.jsonl"
run "$REC1" "$HOME/.cs-cron-session" || true
if [ ! -s "$REC1" ]; then
  echo "GAP: no POST reached the shim — needs-you branch was not driven into. See $TMP/sp/tools/deploy-sentinel/sentinel.log"
  cat "$TMP/sp/tools/deploy-sentinel/sentinel.log" 2>/dev/null || true
  exit 1
fi
node -e "
  const fs = require('fs')
  const line = fs.readFileSync('$REC1', 'utf8').trim().split('\n')[0]
  const r = JSON.parse(line)
  const h = { ...r.headers }
  const cookieOk = typeof h.Cookie === 'string' && /^cs_user=v2\./.test(h.Cookie)
  const originOk = h.Origin === 'http://localhost:4317'
  if (h.Cookie) h.Cookie = h.Cookie.slice(0, 'cs_user=v2.XXXXXXXX'.length) + '...(truncated)'
  console.log('   recorded POST to', r.url)
  console.log('   headers:', JSON.stringify(h))
  console.log(cookieOk && originOk ? '   PASS: both Cookie (v2.*) and Origin present' : '   FAIL: missing an identity header')
  process.exit(cookieOk && originOk ? 0 : 1)
"

echo
echo "== step 5: missing session file -> POST must carry NEITHER header, script still completes =="
write_state "2222222222222222222222222222222222bbbb"
REC2="$TMP/record-no-session.jsonl"
set +e
run "$REC2" "$TMP/does-not-exist-session"
RC=$?
set -e
if [ "$RC" -ne 0 ]; then
  echo "FAIL: script did not exit cleanly (exit $RC) with a missing session file — fail-soft broken"
  exit 1
fi
if [ ! -s "$REC2" ]; then
  echo "GAP: no POST reached the shim on the fail-soft run — cannot confirm headers are absent"
  exit 1
fi
node -e "
  const fs = require('fs')
  const line = fs.readFileSync('$REC2', 'utf8').trim().split('\n')[0]
  const r = JSON.parse(line)
  const h = r.headers || {}
  const clean = !('Cookie' in h) && !('Origin' in h)
  console.log('   recorded POST to', r.url)
  console.log('   headers:', JSON.stringify(h))
  console.log(clean ? '   PASS: neither header present, script completed normally (exit 0)' : '   FAIL: a header leaked through despite a missing session file')
  process.exit(clean ? 0 : 1)
"

echo
echo "ALL PASS — postBoard() carries Cookie+Origin when the session file is readable, and neither when it is not; the sentinel always completes."
