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
  live app). Status: **MIGRATED** (this tranche; cycleTextSync.test.ts).

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
- **Migration:** split the two roles: `preEngineRoundIndex`/`preEngineItemInRound`
  refs written only by the pre-engine paths (legacy resume labyrinth, course-change
  reset, preview seeding, legacy useCyclePlayback advancement — all of which run with
  no engine), and `currentRoundIndex`/`currentItemInRound` = computeds preferring
  engine truth once `simplePlayer.isInitialized` (new composable signal). Preview
  seeding routes through `jumpToRound` when the engine already exists — post-init,
  engine navigation is the only position writer (read-only computeds make scattered
  writers a compile error). The roundIndex watcher survives as an effect bridge only
  (persist + prefetch); the cycleIndex watcher is deleted. Two deliberate behaviour
  notes: (a) savePositionToLocalStorage's itemInRound fallback now reads the engine
  live — the mirror-lag it compensated for (Tom 2026-05-30) is structurally gone;
  (b) during a course switch with a live old engine, the derived position shows the
  old engine's index (not a reset 0) until the new course initializes — covered by
  the 'awakening' loading stage, and engine truth is the honest display anyway.
  Status: **MIGRATED** (tranche 4; roundPositionSync.test.ts). Dead
  `effectiveRoundIndex`/`effectiveItemInRound` aliases deleted with it.

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
  algorithms. Status: **MIGRATED** (this tranche; roundsQueueSync.test.ts).
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
  `isAnythingAudible`. Status: **MIGRATED** (this tranche).

### M9. Belt `playingSeedNumber` — multi-writer push into useBeltProgress

- **Where:** `useBeltProgress.ts:405`, pushed by 3 LearningPlayer sites (round
  completion ~1945, `updateBeltForPosition` ~4516, `deriveBeltFromLandedRound` ~4545).
- **Risk:** medium — a missed push shows a stale belt colour/readout; self-heals on
  next round completion. Mitigated already: `deriveBeltFromLandedRound` deliberately
  reads `simplePlayer.currentRound` (engine truth) not the loadedRounds mirror.
- **Migration:** ONE derived anchor: `beltAnchorSeed = computed(() => isInfPlayActive
  ? beltFreezeSeed : seed(visualLegoIdForRound(simplePlayer.currentRound)))`, bridged
  into the shared composable by a single immediate watcher (cross-surface sink =
  doctrine-approved effect bridge; `beltProgress` rides in the watch source so an
  anchor landing before the composable exists is re-delivered). The INF-PLAY freeze
  is kept as an explicit intent: entry/resume paths write `beltFreezeSeed` (course-end
  seed) instead of pushing into the composable; shape-only INF-PLAY with no anchor
  (audio-stripped rounds, guests without a ceiling) freezes with a null anchor → no
  write → the belt HOLDS, exactly the old skip-the-write behaviour; leaving INF PLAY
  clears the freeze. By the time of migration the push count had grown to ~15 sites —
  round completion, `updateBeltForPosition`, `deriveBeltFromLandedRound` (+5 callers,
  all deleted), 4 INF-PLAY entry/advance/back anchors, 5 resume paths, the deep-link
  jump. Two writers remain by design, both pre-engine: the boot-time splash seed
  (before any script exists) and `updateBeltForPosition`, now engine-guarded to serve
  only legacy-path boundaries + pre-engine preview. Timing note: the belt now updates
  when a round LANDS (becomes current) rather than when it completes — at a belt
  threshold the colour flips as the new belt's first round starts, which is the more
  truthful moment. Status: **MIGRATED** (tranche 4; beltPositionSync.test.ts —
  main-loop follow, freeze no-bounce, guest hold, exit unfreeze, late-attach,
  engine-agreement walk).

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

## Browser verification (2026-07-29, deployed dev build 351214e)

Tranche-4 probe (`e2e/pull-consistency-tranche4-probe.mjs`) — 12/12 PASS on the
deployed dev alias, guest flow:
- **M3 fresh cold start**: play persists a localStorage position (S0001L01).
- **M3 cold localStorage resume**: reload lands on the SAME saved LEGO (no reset
  to round 0), resumed playback shows real cycle text.
- **M3 deep-link jump** (`ssi-jump-to-seed`, the ?seed=/CourseBrowser path): cursor
  moved to seed 10 and back to seed 2, persisted correctly both ways.
- **M9 belt follows jumps** both directions: white → yellow (#fcd34d) at seed 10,
  back to white at seed 2 (pure derivation, no ratchet).
- **M9 belt steady across pod-lap audio** (`?podview=1`): colour constant over a
  10s sampled window while the lap played.

INF-PLAY entry/freeze: attempted via a free course + course-end walk
(`e2e/pull-consistency-t4-infplay-probe.mjs`). The belt derivation verified on
the second course too (deep-link to seed 300 → brown #a8856c, correct). Entry
itself proved unreachable for ANY guest on current dev content: premium courses
paywall course-end (by design), and every free course has content only to
S0300 against a 668-seed list — at that edge round-forward hits the
"next round unavailable — staying put" fallback because neither the canonical
round-map nor courseFinalLegoRef resolves on that path. Pre-existing behaviour
(none of that branch changed this tranche), logged as an observation: on the
300/668 courses forward-skip dead-ends at S0300 with no INF-PLAY offer. NOT
browser-verified (needs a signed-in account / complete course): INF-PLAY
entry+freeze, DB-cursor resume, INF-PLAY deterministic resume — all pinned by
unit tests (roundPositionSync.test.ts, beltPositionSync.test.ts).

Earlier (2026-07-28, deploys blocked that night, since verified by the tranche-3
probe + this pass): M1 welcome→first-cycle handoff, M2 phase pill + voice-2 text,
M5 mode buttons, M8 session timer.
