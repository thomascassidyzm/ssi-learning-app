# Deploy Sentinel — post-push production fallout watcher

Watches `main` (production, saysomethingin.app) from watson-1. When a new commit
lands on `main`, it opens a ~2h watch window and checks three legs:

1. **Deploy went live** — `https://saysomethingin.app/version.json` (`buildNumber`
   is the short git SHA, stamped by `vite.config.js` from `VERCEL_GIT_COMMIT_SHA`)
   must reach the pushed SHA. If it hasn't after 20 min, the GitHub deployments
   API (`gh api repos/…/deployments?environment=Production`) is consulted: no
   Production deployment for the SHA, or a `failure`/`error` status, means Vercel
   blocked or failed the build — alerted DISTINCTLY as "deploy never went live",
   not "app broken". A later recovery posts a note to the done board.
2. **Telemetry volume** — `player_events` where `env='production'`, window-so-far
   vs the same clock window over the 4 prior weeks. The reference is the
   **second-smallest** baseline week (NOT the median — late-night windows vary
   wildly week to week; a real 2026-08-01 false alarm had prior Fridays
   [0, 3, 177, 688] where the median cried crater while half the weeks were just
   as quiet). Crater = < 35% of that reference, only judged after ≥ 60 min of
   window and only when the reference ≥ 50 events (no 3am false alarms on tiny
   numbers). The tagged `sentinel_synthetic_probe` event type is excluded from
   counts.
   **Requires a Supabase service-role key** — from `SUPABASE_SERVICE_ROLE_KEY` in
   the environment or a `~/.ssi-sentinel.env` file (`SUPABASE_SERVICE_ROLE_KEY=…`).
   No key on the VM → the leg reports "inactive" honestly in the all-clear.
3. **Endpoint probes** — every tick: app shell, `/api/sw-config`,
   `/api/courses/available`, `/api/audio/<known-good id>`, and an OPTIONS on
   `/api/player-events` (no fake events are ever written). A probe alerts after
   2 consecutive failing ticks.
4. **Live play-through** — a real headless-browser session
   (`packages/player-vue/e2e/deploy-sentinel-play-probe.mjs`) loads production,
   clicks the real transport control (`.center-btn`), waits for the session
   clock to actually advance — i.e. proves playback *started* — and verifies
   zero JS errors + the client's telemetry POST returns 2xx.

   It reports a three-way `verdict`, and the distinction matters:
   `healthy` (playback ran, loop intact) · `broken` (genuinely failing for
   learners — **the only verdict that alerts**) · `inconclusive` (the probe
   could not drive the UI, which says nothing about learners and is logged,
   never alarmed). Before 2026-08-20 the probe had no such split and, worse,
   could never start playback at all: every selector it tried missed the real
   control, it clicked a `<p class="hero-known">` paragraph and swallowed the
   failure with `.catch(() => {})`. Its "passes" came from a page-load
   telemetry flush landing inside the 35-second wait, so the result was a race,
   not a test — and at 02:51 on 2026-08-20 the race lost and it paged Tom with
   "learners likely can't play" while production was entirely healthy.

   Runs once per window (~25 min after deploy-live) and again as
   the confirm/refute step whenever the volume check says crater — volume alone
   false-alarmed twice (2026-08-01 quiet Friday midnight; 2026-08-06 school
   learners finishing before lunch), because with a handful of concurrent users
   the volume signal is statistically meaningless at most hours. A passing
   play-through demotes a crater to a note; a failing one alerts loudly.
   Needs the playwright chromium under `~/.cache/ms-playwright` plus the
   nspr/nss libs in `~/.ssi-sentinel-libs` (extracted from the Ubuntu debs —
   no root needed); without them the leg reports unavailable and volume alerts
   stand un-gated.

## Outcome routing

- Clean window → ONE quiet card on the done board (`POST localhost:4317/api/done`).
- Fallout → loud card on the needs-you board (`POST localhost:4317/api/needs-you`,
  which also pushes to Tom's devices), **once per failure class per window** —
  never once per tick. The card names which leg failed, with numbers.

## Install

Cron line (every 3 min; the script is a fast no-op when nothing is happening):

```
*/3 * * * *  /usr/bin/node /home/tomcassidy/ssi-learning-app/tools/deploy-sentinel/sentinel.mjs >> /dev/null 2>&1
```

State: `state.json` next to the script (last seen main SHA, open window, alerted
flags). Log: `sentinel.log`. Both gitignored. First-ever run adopts the current
main SHA without opening a window.

## Manual test

Simulate a fresh push of the current main SHA:

```bash
node -e 'const f="tools/deploy-sentinel/state.json",s=require("./"+f);s.lastMainSha="0".repeat(40);delete s.window;require("fs").writeFileSync(f,JSON.stringify(s,null,2))'
node tools/deploy-sentinel/sentinel.mjs   # opens window, confirms deploy, probes
# fast-forward the window to force close + all-clear:
node -e 'const fs=require("fs"),f="tools/deploy-sentinel/state.json",s=JSON.parse(fs.readFileSync(f));s.window.openedAt-=2*3600*1000+60000;fs.writeFileSync(f,JSON.stringify(s,null,2))'
node tools/deploy-sentinel/sentinel.mjs   # closes window, posts all-clear
```

Stage 2 (client error beacon) design note: `docs/deploy-sentinel-error-beacon.md`.
