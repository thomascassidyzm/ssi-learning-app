# Pull-Consistency Map — remaining push-mirrors of engine state in the player UI

*Written 2026-07-28 (tranche 3 of the behemoth unpick). Companion to commit `878246ff`
(transport play-state made pull-consistent) and `apml/playback/player-conductor.apml`.*

## The doctrine (from 878246ff)

UI state that REPRESENTS engine state must be **derived** (a `computed` reading the
engine's current truth), never a **writable mirror** (a `ref` synced by an
edge-triggered watcher and/or scattered manual assignments, forwarded over emit hops).
A mirror desyncs whenever an edge is missed, reordered, or manually overwritten — and
stays wrong until the next engine toggle happens to re-fire the watcher. A derivation
cannot disagree with the engine, because it has no state of its own.

What this doctrine does NOT outlaw:

- **Watchers as bridges to imperative external sinks** (wake lock, `navigator.mediaSession`,
  analytics events). Those APIs are set-call-shaped; a watcher on a *derived* signal is
  the correct bridge. Post-878246ff the wake lock and mediaSession watchers key off
  `isAudioPlaying` (derived) — correct.
- **Genuine accumulators** (folds over history that current engine state cannot reproduce):
  `lastMainLoopLegoId` (max main-loop LEGO seen), `playedIntroductions`,
  `hasEverStarted`, persistence cursors (`highestCompletedLegoId` etc.). These are their
  own source of truth, not mirrors of one.
- **Time-based animation effects** (the speak-gap ring's rAF loop) — inherently
  imperative; the fix is to key their *triggers* off engine truth, not to make the
  animation a computed.
- **Deliberate display latches** with documented UX reasons: `displayedKnownText` /
  `displayedTargetText` hold-last-good (B5: never blank the prompt card on a transient
  source dropout). The latch derives *from* a derived source; the latch itself is a fold.

## The inventory

Ranked by desync-bug likelihood × severity. "Writers" counts every place that pushes
into the mirror — the multi-writer count is the risk metric (isPlaying had ~7).

### M1. `currentCycle` — the TEXT/AUDIO pairing mirror ⚠ highest severity

- **Where:** `LearningPlayer.vue:5126` (`const currentCycle = ref<Cycle | null>(null)`)
- **Writers (2):** watcher on `simplePlayer.currentCycle` (line ~2178, converts to a
  legacy Cycle shape, **early-returns on null so a stale cycle persists**); legacy
  `startCyclePlayback` (line ~5218, the pre-SimplePlayer `useCyclePlayback` path).
- **Consumers:** `currentPhrase` (line ~6071 — the hero text display) and the
  second phrase computed at ~6422. This is the pair of texts shown WHILE the engine
  plays audio for its own idea of the current cycle.
- **Risk:** a missed/reordered watcher flush shows text from cycle N while audio plays
  cycle N+1 — the zero-tolerance schools bug class ("mismatched audio is not").
- **Migration:** derive: `currentCycle = computed(() => engine cycle when round-based
  playback is live, else legacyCycle ref)`. The legacy path keeps its own ref; the
  computed prefers engine truth whenever `useRoundBasedPlayback` (i.e. always, in the
  live app). Status: **QUEUED this tranche** (cycleTextSync.test.ts).

### M2. `currentPhase` — the phase mirror (voice-2 text visibility, voice indicators, gap ring gate)

- **Where:** `LearningPlayer.vue:5357` (`const currentPhase = ref(Phase.PROMPT)`)
- **Writers (3):** watcher on `pendingPhase` (~5316) — where `pendingPhase` is itself a
  callback-pushed mirror of `simplePlayer.phase` (`onPhaseChanged` → ref, line ~1612):
  a TWO-hop push chain; watcher on legacy `cyclePlaybackState.phase` (~5265); legacy
  `handleCycleEvent` (~6889).
- **Consumers:** `showTargetText` (~6129 — **voice-2 text visibility**, one of
  Jonathan's symptoms), the four phase-pill `is-active` classes (voice indicators,
  template ~14000-14038), hero-pane/control-pane classes, ring-progress gating
  (~6443/6449 — the gap bar), interjection logic, `phaseEnteredAt` metric stamp.
- **Risk:** identical shape to pre-fix `isPlaying`. A missed hop leaves the phase pill
  and voice-2 text frozen while audio moves on.
- **Migration:** `currentPhase = computed()` mapping `simplePlayer.phase` directly when
  round-based playback is live, falling back to the legacy-pushed value otherwise. The
  ring-start side effect stays an edge (it starts an animation) but keys off
  engine phase. Status: **MIGRATED** (this tranche; phaseDisplaySync.test.ts).

### M3. `currentRoundIndex` / `currentItemInRound` — the position mirrors

- **Where:** `LearningPlayer.vue:1344-1345` ("We need writable refs because legacy code
  assigns to these directly").
- **Writers (~20):** watchers on `simplePlayer.roundIndex` / `cycleIndex` (~1425/1514)
  PLUS manual assignments across the resume paths (~12752-12933), jump handling
  (~13095), reset (~13333), and legacy `handleCycleEvent` (~6976).
- **Consumers:** `currentRound` computed (line ~3112) — which **cross-indexes the
  component-level `loadedRounds` mirror with the engine-derived index** (the exact
  shape of the 2026-07-21 belt-skip fencepost bug); `sessionProgress`; splash/resting
  position display; aliases `effectiveRoundIndex`/`effectiveItemInRound`.
- **Nuance:** the resume-path manual writes happen BEFORE the engine is initialized —
  they pre-seed the splash/resting display. A blind computed would read 0 until init.
- **Migration:** split the two roles: a `preEngineResumeIndex` ref written only by the
  resume paths, and `currentRoundIndex = computed(() => engine initialized ?
  simplePlayer.roundIndex : preEngineResumeIndex)`. Same for the cycle index.
  Status: **DEFERRED** — ~20 write sites across the resume labyrinth; needs its own
  focused pass with the resume matrix (fresh/localStorage/DB/deep-link/preview ×
  instant-playback/legacy) exercised. Highest-value next step after this tranche.

### M4. `roundsRef` — the QUEUE mirror with re-implemented engine algorithms

- **Where:** `useSimplePlayer.ts:109`, mirrored again at component level as
  `loadedRounds`/`cachedRounds`.
- **Writers:** `addRounds`, `appendRounds`, `replaceQueueFromCurrent` each
  **re-implement SimplePlayer's insertion/splice logic by hand** ("IMPORTANT: Must use
  same insertion logic as SimplePlayer to keep arrays in sync!"). Three duplicated
  algorithms = three chances to drift; `replaceQueueFromCurrent`'s mirror already
  caused one shipped text/audio desync (see its own comment re the INF-PLAY handoff).
- **Migration:** SimplePlayer exposes a `roundsSnapshot` getter; the composable
  assigns `roundsRef.value = player.roundsSnapshot` after every queue-mutating request
  instead of re-computing what the engine just did. Deletes all three duplicated
  algorithms. Status: **QUEUED this tranche** (roundsQueueSync.test.ts).
  (The component-level `loadedRounds` mirror remains — collapsing it into the
  composable's `roundsRef` is a follow-up; it currently has independent writers on the
  instant-playback path.)

### M5. Container mode mirrors — `isListeningMode` / `isPronunciationMode`

- **Where:** `PlayerContainer.vue:96/101`, fed by `@listeningModeChanged` /
  `@pronunciationModeChanged` emit hops from 7 emit sites in LearningPlayer, each
  hand-paired with a `showListeningOverlay`/`showPronunciationOverlay` write.
- **Risk:** same emit-hop shape 878246ff deleted for play state; a missed pairing
  leaves BottomNav's mode button lying about the overlay.
- **Migration:** expose derived `isListeningMode`/`isPronunciationMode` computeds on
  the player; container pulls via the template ref (the 878246ff pattern); delete both
  events and all 7 emit sites. Status: **MIGRATED** (this tranche).

### M6. `bufferingPromptVisible` — watcher mirror of `phase === 'buffering'`

- **Where:** `LearningPlayer.vue:5284-5288`.
- **Migration:** one-line computed. Status: **MIGRATED** (this tranche).

### M7. Dead `playStateChanged` emit

- **Where:** `LearningPlayer.vue:5528` + `defineEmits` entry. 878246ff removed the
  container's listener but left the emitter. Dead code that reads like a live event
  contract. Status: **REMOVED** (this tranche). The window-level `ssi-play-state`
  broadcast stays — it serves out-of-tree consumers (InstallBanner, update banner);
  note it is itself edge-shaped for late attachers, logged for a future look.

### M8. Session-timer gate — hand-ORed duplicate of the audio signal

- **Where:** `LearningPlayer.vue:~13135`: the tick gate ORs 5 flags by hand —
  exactly `isAudioPlaying` minus `isPreparingToPlay`. A future audio source added to
  one list but not the other silently freezes (or over-counts) the timer.
- **Migration:** name the derived signal once (`isAnythingAudible` = the 5-flag OR),
  make `isAudioPlaying = isAnythingAudible || isPreparingToPlay`, gate the timer on
  `isAnythingAudible`. Status: **QUEUED this tranche**.

### M9. Belt `playingSeedNumber` — multi-writer push into useBeltProgress

- **Where:** `useBeltProgress.ts:405`, pushed by 3 LearningPlayer sites (round
  completion ~1945, `updateBeltForPosition` ~4516, `deriveBeltFromLandedRound` ~4545).
- **Risk:** medium — a missed push shows a stale belt colour/readout; self-heals on
  next round completion. Mitigated already: `deriveBeltFromLandedRound` deliberately
  reads `simplePlayer.currentRound` (engine truth) not the loadedRounds mirror.
- **Migration:** derive playing position from `simplePlayer.currentRound` +
  `visualLegoIdForRound` (the INF-PLAY anchor), with the INF-PLAY freeze kept. Blocked
  on care: `useSharedBeltProgress` is shared across surfaces and the INF-PLAY belt is
  deliberately NOT derived from the landed round. Status: **DEFERRED** — needs its own
  pass with the INF-PLAY belt semantics in hand.

### M10. `instantPlayback.setCurrentLegoId` — cursor push into the prefetch service

- **Where:** roundIndex watcher (~1440) pushes the engine cursor into
  useInstantPlayback (tier-3 prefetch anchor; its `roundMap`-derived `currentRound`
  computed also reads it).
- **Verdict:** push into a *service* (prefetch is an effect, not display state), but
  the composable's own computeds reading the pushed cursor is mirror-shaped. LOW
  desync stakes (worst case: prefetch anchors one round behind). Status: **LOGGED,
  no action** — revisit if the composable's cursor ever drives UI.

## Already pull-consistent (verified, no action)

- `isPlaying` / `isAudioPlaying` / container play state — 878246ff.
- `useSimplePlayer.internalState` — fed by `state_changed` events that carry the FULL
  state (not edges) emitted synchronously by the engine; computeds derive from it.
  `initialize()` now also seeds it from `player.currentState` (belt-and-braces landed
  with M4 so a subscriber can never read the pre-init default).
- Wake lock & mediaSession playbackState — imperative sinks watching derived signals.
- `displayedKnownText`/`displayedTargetText` hold-last-good latches — deliberate folds
  (B5), sources now fully derived via M1/M2.
- `ringProgressRaw` — rAF animation; its gate (~6443) reads derived phase + isPlaying
  every frame, so a stale ring cannot outlive the phase that started it.
- `playingBelt` colour tokens — computed chain off beltProgress state (M9's push is
  the residual).

## Test pattern

Per-mirror regression tests follow `transportStateSync.test.ts`: reproduce the exact
wiring (engine → events/computed chain), then drive late-attach, same-tick bursts, and
the mirror-wedging interleave (manual write with no subsequent engine toggle), and
assert the derived value CANNOT disagree with `player.currentState` / the engine's
rounds. Planned files this tranche: `phaseDisplaySync.test.ts`, `cycleTextSync.test.ts`,
`roundsQueueSync.test.ts`.

## What still needs a browser pass (deploys blocked 2026-07-28)

Unit/simulation coverage is thorough but the following want a real-device look once
Vercel deploys resume: welcome→first-cycle text handoff (M1), phase pill + voice-2
text through a full round (M2), listening/pronunciation mode button sync from
BottomNav (M5), INF-PLAY queue handoff with the M4 snapshot pull, session timer
across pod laps (M8).
