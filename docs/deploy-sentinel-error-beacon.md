# Deploy Sentinel — stage 2 design note: client error beacon (NOT BUILT)

*2026-07-29. Design only — deliberately not implemented. Stage 1 (the watcher in
`tools/deploy-sentinel/`) can only see a client-side JS crash indirectly, as a
telemetry-volume crater. This note sketches the direct signal so building it later
is a mechanical job.*

## Gap being closed

A bad deploy that ships broken JS kills the app **before** any endpoint probe
would fail — the API stays green, the shell serves 200, but every learner's
session dies on an uncaught exception. Today that only surfaces as "player_events
volume dropped", which needs an hour of window and decent baseline traffic to be
trustworthy. A crash beacon turns it into a first-class, minutes-fast signal.

## Design: ride the existing telemetry rail — no new endpoint, no new table

**BSC narrative.** Better: crashes become directly observable with build number
attached, minutes after a deploy. Simpler: zero new server surface — reuse
`POST /api/player-events` (already batched, already env-tagged server-side,
already capped at 8KB/payload) with a new `event_type: 'client_error'`. Cheaper:
no new infra; the sentinel already knows how to count `player_events` rows.

### Client hook (player-vue)

A small composable/module, initialised once in `main.ts` before app mount:

- `window.addEventListener('error', …)` — uncaught exceptions (message, source
  file, line/col, truncated stack).
- `window.addEventListener('unhandledrejection', …)` — async failures.
- Vue's `app.config.errorHandler` — component-tree errors that Vue would
  otherwise swallow into the console.

Each handler pushes an event into the **existing** player-events buffer:

```
{ event_type: 'client_error',
  client_version: __BUILD_NUMBER__,        // already stamped by vite.config.js
  payload: { kind: 'error'|'rejection'|'vue',
             message, source, stack /* truncated ~2KB */ } }
```

Guards (all client-side, all cheap):
- **Rate cap**: max ~5 error events per session, then a single `suppressed: n`
  summary event — a render-loop crash must not flood the table.
- **Dedupe**: same message+source within a session sends once with a counter.
- **Fail-open**: the beacon itself is wrapped in try/catch; a broken beacon can
  never take the app down. If the buffer/POST machinery is itself what crashed,
  a last-resort direct `navigator.sendBeacon('/api/player-events', …)` is the
  fallback (sendBeacon survives page unload and never throws).

### Storage

`player_events` rows, `event_type='client_error'`, `env` derived server-side as
today. No schema change. Retention/volume: negligible next to `audio_play`.

### Sentinel consumption (stage-2 change to `sentinel.mjs`)

During a watch window, alongside the volume check: count
`player_events where event_type='client_error' and env='production'` in the
window, split by `client_version`. Verdicts:

- **Error spike on the NEW build** (`client_version == pushed sha`, count above
  a small absolute threshold, say >10 distinct sessions) → fallout alert
  "new build is throwing client errors", with the top message in the card.
- Errors only on OLD build numbers → stale-SW clients, not deploy fallout — note
  in the all-clear, don't alert.

The baseline problem volume-checking has (needs an hour, needs traffic) mostly
disappears: pre-deploy client_error rate is near zero, so an absolute threshold
works within minutes.

### Explicitly out of scope

Source-map symbolication, error grouping UI, non-crash console noise, staging/dev
alerting (rows land tagged anyway; the sentinel just filters production).
