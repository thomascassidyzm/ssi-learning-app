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

## Known doc debt
Some `// AudioPrefetcher's …` comments inside `LearningPlayer.vue` still reference the removed module — non-functional, slated for a comment sweep.
