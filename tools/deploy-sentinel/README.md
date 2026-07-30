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
   vs the same clock window over the 4 prior weeks (median). Crater = < 35% of
   baseline median, only judged after ≥ 60 min of window and only when the
   baseline median ≥ 50 events (no 3am false alarms on tiny numbers).
   **Requires a Supabase service-role key** — from `SUPABASE_SERVICE_ROLE_KEY` in
   the environment or a `~/.ssi-sentinel.env` file (`SUPABASE_SERVICE_ROLE_KEY=…`).
   No key on the VM → the leg reports "inactive" honestly in the all-clear.
3. **Endpoint probes** — every tick: app shell, `/api/sw-config`,
   `/api/courses/available`, `/api/audio/<known-good id>`, and an OPTIONS on
   `/api/player-events` (no fake events are ever written). A probe alerts after
   2 consecutive failing ticks.

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
