# Cold start & playback — how it actually works

> Traced from live code 2026-06-08 and kept in sync with it. **Supersedes `buffer-model.md`**, whose "two IndexedDB tiers (MP3 store + ruthless WAV window)" design was never built. If this doc and the code disagree, the code wins — fix this doc.

## The playback model (one cache-first player)

- **Online = offline = one path.** The audio source is `createAudioCacheSource(audioCache, courseCode, () => offlinePlaybackActive() || cachePlayOnline)` (`LearningPlayer.vue`), and `cachePlayOnline` is **default-ON** (`const cachePlayOnline = … && !URLSearchParams(...).has('stream')`). Every clip plays from the cache as a **WAV blob** decoded from cached MP3 (`AudioCache.getWavBlobUrl` → `bytesToWavBlob`), with the network URL only as the miss fallback. Pass `?stream=1` to force the old streaming path for comparison.
- **One IndexedDB store, two lifecycles** (`ssi-audio-cache-v2`): `persistent` (USE phrases, course-spanning, LRU size-cap eviction via `persistentEvictToTarget`) and `ephemeral` (per-LEGO build sets). WAV is **not** a persisted tier — it's an in-memory `wavUrlCache` decoded on demand.
- **One Spotify-style player** (`SimplePlayer` + `RealAudioController`) owns the single `<audio>` element and warms the next clip via `prefetchNextCycle()`. The cache is filled by the **rolling filler** (`fillBuffer` / `expandScript`), which warms ~20 min of cycles + pods + L1 ahead of the playhead, even while locked.
- **First clip** on a true cold cache streams from the network (instant), then the cache fills behind it.

> **Supply ≠ lock.** This doc is about *supply* (right audio available at the right moment). Holding the iOS locked-screen session alive is a *separate* concern (the `<audio>` element idles in PAUSE; an AudioContext silent oscillator below it). Never add element-level silent keepalive — see `CLAUDE.md`.

## Cold-start critical path (app launch → ready-to-play)

All in `onMounted` (`LearningPlayer.vue`). "Ready" = `setLoadingStage('ready')` after `await Promise.all([loadAllData(), runAnimationTimeline()])` then `warmFirstKnownAudio()`.

- **`loadAllData`** resolves the resume position (`getEnrollment` — the one Supabase read genuinely required before play), runs `instantPlayback.bootstrap()` (round-map + first-round cycles; **warm = 0 network** via localStorage caches, cold = 2 tiny fetches), builds the player's rounds, and applies the saved cycle cursor.
- **`runAnimationTimeline`** enforces a deliberate splash floor: `MINIMUM_ANIMATION_MS = isReturnUser ? 300 : 2800`. Return users (have played before) get 300 ms; first-ever visitors get a 2800 ms cinematic. When total-ready ≈ this floor, the **floor** is the gate, not data.
- **Off the critical path (fire-and-forget):** belt progress, adaptation engine, and Layer-1 listening hydration run concurrently in the background — each is a Supabase round-trip but none is needed for the first cycle. Consumers are null-safe with defaults (`getPauseMultiplier ?? 1.0`, belt computeds `?. ?? default`). Also `loadGlobalLegoTexts`, `getCourseFinalLego`, `ensureMainLoopMap`, `courseBundle.load`. Since 2026-07-02 the same applies at the App.vue layer: entitlements + subscription init, the offline-lease wiring (chained after subscription resolves), and `/api/access/claim` (single-flight per token) are all non-blocking — default-course picking can't depend on them because every live/beta course is at least previewable.
- **Exactly ONE full-course walk per course open** (2026-07-02): the deferred handoff in `LearningPlayer` (`generateScript` on idle, threading the live algorithm config) is the sole owner. App.vue no longer fires `eagerScript.preload` — it only runs `checkContentVersion` (immediately, before the player mounts, so the warm-start cache fast-path stays honest), and `useEagerScriptPreload.preload` is single-flight per course as a backstop. Previously three concurrent walks ran per open, starving the bootstrap.

**Resume is fast** because warm caches collapse bootstrap to ~0 network (localStorage round-map + cycles, IndexedDB WAV blobs) and the CACHE FAST PATH skips the network bootstrap entirely.

### Script freshness: stale-while-revalidate (founder ruling 2026-07-27)

A `courses.content_stamp` move (any learner-visible content fix) used to DROP the cached script, forcing the next open to regenerate the whole course before playing (~3s median, 20-24s observed on device). Now `checkContentVersion` only **marks** the entry stale (`getScriptStaleness`): the session hydrates from the stale cache instantly, `runSwrRevalidation` (LearningPlayer) regenerates on idle and writes the fresh script for the **next** session, which then shows a small transient "Your course was updated" notice. Corrections land one session later — accepted trade. A `content_version` bump (audio regenerated) still hard-clears. With no usable cache at all, start is progressive: the `/cycles` (or `/infplay-cycles`) bootstrap plays the playhead segment in ~1-2s and the full walk runs behind playback — the uncached deterministic INF-PLAY resume no longer builds synchronously (one session of random-sampled revival, deterministic again next open once the idle warm has cached the build). Any remaining blocking walk (legacy fallback only) types an honest "Updating your course…" on the awakening screen. `cold_start` telemetry carries `scriptPath` (`cache|swr|progressive|infplay_cache|full`); each background regeneration emits `script_revalidated`.

### Instrumentation
On ready, the console logs `[ColdStart] launch→ready Xms total (incl. app-shell+auth) | Yms in onMounted | animFloor Z | returnUser`. `performance.now()` is from navigation start, so it captures the full budget (JS bundle parse + auth restore + onMounted); `Date.now()-startTime` isolates the onMounted portion. Compare with `[LearningPlayer] Data loading complete in …` to see whether data or the splash floor dominated.

## What is NOT in the audio path (removed / never built)

- **`AudioPrefetcher`** — removed 2026-06-08. Its `onRoundChanged` had been a no-op since 2026-05-23; nothing acquired ephemeral sets, so it did nothing. The filler fills the cache, not a prefetcher.
- **`BundleDownloader`** (always-on full-course download) — removed 2026-06-08; never fired. A future "Download for offline" button can deep-fill on demand.
- **`PriorityRoundLoader`** (legacy upfront-load lazy loader) — removed 2026-06-08; `INSTANT_PLAYBACK_ALL = true` means it was never instantiated.
- **Service worker as audio server** — the SW caches the app shell only; it is never an audio server.

## Still live (do not mistake for dead)

- `generateScript` — used by skip / INF-PLAY legacy fallback / Course Explorer.
- `getCachedScript` — the returning-visitor cache fast path.
- `instantPlayback.prefetchTier3` — next-round cycle metadata.
- `audioCache.persistent.ensure` — direct cache warming from pods, L1, `warmFirstKnownAudio`, and prep-cycle races.

## Listening playback is ONE mode (Tom, 2026-08-07)

Every listening phrase — Layer-1 seed cups and Layer-2 pod laps alike — plays
exactly four clips: **target · known · target · target**, all four at the **same
speed**. The nine-stage pod ladder that varied the pattern per stage is retired,
and with it the 1.5×/2× stretch reps and the Phase-0 explainer slot.

Speed ramps over a phrase's **exposures**, never above **1.0**:

| mode | 1st hearing | next four | thereafter |
|------|-------------|-----------|------------|
| Easy | 0.7 | 0.8 | 1.0 |
| Fast | 1.0 | 1.0 | 1.0 |

The course `globalSpeed` still multiplies in and can only slow a clip down
(French 0.95 → a first Easy hearing is 0.665). **1.0 is clamped in code**, not
just in the default config: the configs are live `algorithm_config` rows that
override code defaults at runtime, so a row asking for 1.5 still plays at 1.0.

Every number is a config key — the pattern, the ramp table, the ceiling, and
which axis decides the speed. Per-mode ramps live on `easy_mode` / `fast_mode`
(`listeningSpeedRamp`); the mode-agnostic pattern, ceiling and speed source live
on the `listening` row.

Two things are kept and restorable **by config alone, no deploy**:
`listening.speedSource: 'belt'` brings back the 2026-08-06 belt curve, and
`listening.listeningUseStagePlaylist: true` brings back the nine-stage ladder.

Code: `packages/player-vue/src/playback/listeningExposureRamp.ts` (the one home)
· `useLayer1Scheduler` · `usePodLapScheduler` · spec in
`apml/learning/listening-layers.apml` · locked by
`packages/player-vue/src/playback/listeningOneMode.test.ts`.

## Known doc debt
Some `// AudioPrefetcher's …` comments inside `LearningPlayer.vue` still reference the removed module — non-functional, slated for a comment sweep.
