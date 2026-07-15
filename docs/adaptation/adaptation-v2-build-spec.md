# Adaptation Engine v2 — Build Specification

**Status:** BUILD SPEC — ready for implementation by parallel sonnet agents.
**Date:** 2026-07-14. **Owner decisions of this date are binding** (see §1).
**Design authority:** `packages/player-vue/public/docs/metrics-vision.html` (the position paper). Where this spec and the paper conflict, **the paper wins**. Where the paper is silent, choices are marked **PROPOSED**.
**Companions:** `docs/methodology/metrics-architecture.md` (principles), `docs/methodology/adaptation-budget.md` (C-workstream design exploration this spec supersedes into build form), `docs/methodology/metrics-implementation-plan.md` (workstream map — this is workstream **C**, unblocked because B1/B4/A3 shipped).

---

## Executive summary (for the phone)

1. The engine stops being just a pause-timer and starts driving the **learning rate itself**: how fast new LEGOs arrive, how many practice phrases each one gets, and the BUILD / USE / CONSOLIDATE mix.
2. All evidence about the learner flows through **one narrow pipe** — taps and skips today, voice-envelope numbers tomorrow — so stage 2 plugs in later with zero rewiring.
3. The signal is the one from your paper: the **second derivative** of the learner-vs-model gap. Level and steady slope vanish; only genuine turns register.
4. The engine only ever **nudges, within hard bounds, via rolling averages** — no jump a learner could feel, and a one-flag kill switch in `algorithm_config`.
5. Early LEGOs resist deferral (introduction order = criticality); the budget leans consolidate-and-defer, drill reserved for the structurally critical.
6. Stage 1 (behavioural, ships first) needs **no microphone** — it consumes the skip/replay/pause events already being logged.
7. Stage 2 adds three envelope numbers per response — latency, length-vs-model, peak shape — computed **on the phone from the energy stream the VAD already reads**; raw audio never leaves the device.
8. Model-voice equivalents are precomputed once per audio file in the dashboard repo and stored in one small DB table.
9. Everything ships **shadow-mode first**: the engine computes and logs what it *would* do before anything is applied.
10. Build order: evidence pipe → behavioural producers + rate policy (parallel) → player wiring → shadow soak → flip on. Stage 2 runs as a parallel track.

---

## 0. Fresh-recon ground truth (2026-07-14) — what exists, verified

Implementers: trust this section over CLAUDE.md, which describes a stale play path.

**The live play path** is `generateLearningScript()` → `toSimpleRounds()` → `SimplePlayer.initialize()` (`packages/player-vue/src/providers/generateLearningScript.ts`, `providers/toSimpleRounds.ts`, `playback/SimplePlayer.ts`). The whole course is generated up front as a deterministic script of rounds; there is no `SessionController`/`CyclePlayer`/`PriorityRoundLoader` any more.

**The round shape** (one round per new LEGO): INTRO → DEBUT → BUILD ×≤7 (`scriptShape.maxBuildPhrases`) → SPACED-REP ×≤12 (`maxSpacedRepPhrases`, Fibonacci offsets `spacedRepOffsets`, N-1 gets `n1PhraseCount`=3) → CONSOLIDATE/USE ×2 (`useConsolidationCount`). All DB-tweakable via `algorithm_config.script_shape`.

**The play-time shaping precedent — the mechanism this spec reuses:** Turbo does NOT regenerate the script. The generator tags cull-candidate cycles (`turboOmit: true`); `SimplePlayer` consults a `SimplePlayerRuntimeOverrides.shouldSkipCycle(cycle)` predicate before starting any phase (`SimplePlayer.ts:19-27`). Toggling mid-round takes effect at the next cycle boundary. The overrides interface also carries `getPauseDuration(cycle)` and `getPlaybackSpeedMultiplier(cycle)`. **All v2 levers land through this same overrides surface** — no script regeneration, no discontinuity.

**The existing engine (stage-1 pause lever, live):** `composables/useAdaptationEngine.ts` — VAD latency → `MetricsTracker` (rolling normalized latency) → `SpikeDetector` → `MasteryStateMachine` (acquisition/consolidating/confident/mastered) → `getPauseMultiplier(legoId)` (ladder 1.2/1.0/0.85/0.7), consumed in `LearningPlayer.vue:8179`. Persists via `LegoMetricsStore` (`@ssi/core/persistence`) — batch every 10 cycles + pagehide — including a **bounded 20-sample normalized-latency series per LEGO** (`recent_latency_samples` on `learner_lego_metrics`, live since migration 20260613/14) explicitly reserved for the curvature consumer this spec now defines.

**The sensor stack (shipped, unconsumed by any controller):** `@ssi/core/learning/curvature.ts` (B1 — trailing local quadratic fit; level/velocity/acceleration; own-noise z-score alarm; `minSamples` gate) and `learning/localDifficulty.ts` (B4 — per-unit curvature → `warming_up | steady | struggling | easing`, `unitKind: 'lego' | 'word' | 'boundary'`). Pure functions, tested. **This spec's controller is the consumer they were built for.**

**The VAD** (`@ssi/core/audio/VoiceActivityDetector.ts`): energy-only — `AnalyserNode.getByteFrequencyData` → RMS → dB, sampled in a `requestAnimationFrame` loop. Continuous mode marks phase transitions and returns `SpeechTimingResult` incl. `response_latency_ms`, `learner_duration_ms`, `duration_delta_ms` vs model. It already **accumulates `energySamples: number[]` per cycle** (`analyzeLoop` / `continuousAnalyzeLoop`) but discards everything except peak/average. No pitch analysis; no audio recorded or uploaded. **That must remain true: only derived numbers ever leave the browser.**

**Behavioural events logged today but consumed by nothing** (`LearningPlayer.vue` `logEvent` → `player_events`): `phase_skip` (with `direction`, `elapsed_in_phase_ms`), `lego_skip`, `tap_skip`, `belt_skip`, `tap_pause`/`tap_play`, `turbo_toggle`, `audio_retry`, `round_complete`, `cold_start`.

**Config/kill-switch home:** `composables/useAlgorithmConfig.ts` reads the `algorithm_config` table ("everything is a parameter"); `script_shape` and `turbo_boost` already live there.

---

## 1. Owner decisions (2026-07-14, binding)

- **A — What the engine drives:** the learning **rate**, wholesale — rate of introduction of new LEGOs; practice-phrase count per new LEGO before spaced rep; the BLD/USE/CONSOLIDATE mix — plus the existing pause multiplier. The mastery ladder extends outward from pacing into scheduling.
- **B — Learner-side signal (stage 2):** deliberately simple envelope metadata, no waveforms: (1) response latency (built); (2) duration similarity vs model; (3) volume-envelope peak analysis — peak count (highest-to-average ratio method) and peak thickness/sharpness. Computed from the same AnalyserNode energy stream the VAD reads. Model equivalents precomputed offline into the DB (pipeline job in the dashboard repo).
- **C — Fitness function:** the **second differential of the delta** between model metadata and learner metadata (the position paper's Principle 3). Deltas correlated across phrases sharing a LEGO (per-LEGO aggregation; per-boundary where data allows).
- **D — Invisibility:** rolling averages only; no discontinuity a learner could feel; nothing interrupts flow.

---

## 2. The evidence stream — one narrow wire (WP-0)

Everything the scheduler learns about the learner arrives as one typed event. Stage-1 behavioural evidence and stage-2 envelope evidence are just two producers on the same wire; the scheduler cannot tell them apart and never needs a change when stage 2 lands.

**New module: `packages/core/src/learning/evidence.ts`** (pure, no Vue/Supabase):

```typescript
/** One observation about one unit. The ONLY way evidence reaches the scheduler. */
export interface MasteryEvidence {
  unitId: string                       // LEGO id (canonical); boundary key later
  unitKind: 'lego' | 'boundary'        // matches localDifficulty.UnitKind
  source: 'latency' | 'behaviour' | 'envelope'
  /**
   * The difficulty-bearing value, HIGHER = MORE STRUGGLE — the localDifficulty
   * input convention, enforced at the producer. Producers normalise into a
   * common [0..~3] band (see §3/§5 per-producer mapping) so series mix sanely.
   */
  value: number
  /** Producer's confidence in this observation, [0..1]. Weights the series merge. */
  weight: number
  cycleId?: string
  occurredAtMs: number                 // performance.now() epoch of the session
}

export interface EvidenceSink {
  record(e: MasteryEvidence): void
}
```

**The aggregator** (`evidence.ts`, same WP): maintains per-`unitId` bounded, weight-merged difficulty series (ring of 20 — same cap as `recent_latency_samples`), exposes them to the sensor:

```typescript
export interface EvidenceAggregator extends EvidenceSink {
  /** Time-ordered merged difficulty series for a unit (for computeLocalDifficulty). */
  getSeries(unitId: string): { values: number[]; x: number[] }
  /** All units with ≥ minSamples, for the per-round policy sweep. */
  readyUnits(minSamples: number): string[]
  /** Snapshot for persistence (WP-4). */
  snapshot(): Map<string, { values: number[]; x: number[] }>
  hydrate(data: Map<string, { values: number[]; x: number[] }>): void
}
```

Merge rule (**PROPOSED**): evidence landing within the same cycle for the same unit collapses to one sample, `value = Σ(vᵢ·wᵢ)/Σwᵢ`; across cycles, samples append in time order. Keeps one series per unit regardless of how many producers fire — which is exactly what `computeLocalDifficulty` wants.

The existing latency path becomes producer #1: `useAdaptationEngine.recordCycle` emits `{source:'latency', value: normalized_latency, weight: 1.0}` into the aggregator *alongside* its current MetricsTracker/mastery flow (which stays untouched — the pause ladder keeps working even if v2 is killed).

---

## 3. Stage 1 — behavioural producers (WP-1)

Consume the already-logged event set into the evidence stream at the **emit site** (the `logEvent` call sites in `LearningPlayer.vue` — no round-trip through `player_events`; the DB copy remains the dashboard/analytics record).

New composable `packages/player-vue/src/composables/useBehaviouralEvidence.ts`: exposes `onPlayerEvent(type, payload, currentCycle)` — called with one line added beside each existing `logEvent` — and maps to evidence. The mapping (**PROPOSED** values; all in the higher-=-struggle convention, tuned to sit in the same [0..~3] band as normalized latency):

| Event | Reading | value | weight |
|---|---|---|---|
| `phase_skip` forward, `elapsed_in_phase_ms` < 40% of pause | confident — "I have it" | 0.3 | 0.6 |
| `phase_skip` forward, slow (≥ 40%) | mild confidence | 0.6 | 0.4 |
| `phase_skip` back / `replay` (re-hear PROMPT) | uncertainty | 1.8 | 0.8 |
| `tap_skip` (whole-cycle skip) during a cycle | avoidance/boredom — ambiguous | 1.2 | 0.3 |
| `lego_skip` back (restart round) | struggle with the round's LEGO | 2.0 | 0.8 |
| `lego_skip` forward | "got this / too easy" | 0.4 | 0.5 |
| `tap_pause` mid-PAUSE then `tap_play` | processing time needed | 1.4 | 0.5 |
| `turbo_toggle` on | global boredom signal — see below | — | — |
| `audio_retry` | infrastructure, NOT learner evidence | dropped | — |
| `belt_skip` | manual dial (Principle 1) — dial state, not evidence | dropped | — |

Rules baked into the producer:

- **Manual controls are the major dial** (paper Principle 1): `belt_skip` and `turbo_toggle` are the learner outranking the engine. They do not enter unit series; instead they set a session-level `manualOverrideActive` flag the policy reads (§4) to widen its dead-zone — the engine yields to the learner's own judgement rather than fighting it.
- Evidence attaches to the **cycle's `legoId`** (ownership axis, not position — `docs/position-and-ownership-model.md`).
- Guest/VAD-less learners produce behavioural evidence fine — this is what makes stage 1 mic-free.
- **Boundary evidence is deferred** (paper: "per-boundary where the data allows"). Behavioural taps can't be attributed to a boundary; boundaries arrive with stage 2 (§5). The `unitKind` field is already on the wire, so no interface change later.

---

## 4. The rate policy — consolidate / defer / drill over the levers (WP-2)

**New module: `packages/core/src/learning/ratePolicy.ts`** — pure, heavily unit-tested; this is the heart of v2.

### 4.1 Inputs, per round boundary

- `computeLocalDifficulty(series, opts)` for every ready unit (B4 — gives `steady | struggling | easing | warming_up` + own-noise `accelerationZ`). **The second-differential fitness function (owner decision C) is exactly this call** — the series being differentiated is the merged evidence delta, and B1's quadratic fit already implements "smooth before differentiating, stop at second order".
- `MasteryStateMachine` state per unit (live).
- Unit criticality = **introduction order** — the LEGO's ordinal in the course walk (paper §04: never corpus frequency).
- `manualOverrideActive` (§3), and the round about to play (its LEGO + phrase inventory).

### 4.2 Output — one `RoundPlan`, the entire lever surface

```typescript
export interface RoundPlan {
  /** BUILD phrases to actually play this round (of the ≤7 in the script). */
  buildCount: number
  /** CONSOLIDATE/USE phrases to play (of the scripted 2, +injected repeats). */
  consolidateCount: number
  /** Spaced-rep review cap for this round (of the scripted ≤12). */
  spacedRepCap: number
  /** Insert a consolidation-only breather round BEFORE the next debut? (§4.4) */
  insertBreather: boolean
  /** Per-LEGO pause multipliers (existing ladder, now curvature-nudged). */
  pauseMultiplier: (legoId: string) => number
}
```

### 4.3 The budget logic (paper §03)

Per struggling unit, in order:

1. **Criticality guard.** If the unit's introduction ordinal is in the earliest `criticalFrontloadFraction` (**PROPOSED: first 15%** of the course's LEGO ordinals — open question 3 in `adaptation-budget.md`; ship behind config, Tom tunes) → **never defer**: hold its phrase counts at scripted values and let pause + N-1 review do the work (drill = the SR schedule already drills N-1 at 3×; we add no extra drilling machinery — reuse, don't build).
2. **Defer** (the default for non-critical struggling units): reduce now — trim this round's `buildCount` toward the floor and let the **existing Fibonacci SR schedule** be the return trigger (deferral is timing, not abandonment — no new scheduling machinery).
3. **Consolidate** (the lean): spend the freed budget on strengths — raise `consolidateCount` (repeat already-mastered USE phrases; `generateLearningScript` already allows USE reuse) and/or `insertBreather`.

If the *current round's own LEGO* is the struggling unit, deferring means: slow its arrival — full `buildCount`, raised `consolidateCount`, and `insertBreather` before the **next** debut. New material never gets starved of its own practice; the rate lever works between rounds, not by gutting a debut.

### 4.4 The introduction-rate lever — breather rounds

Slowing the wholesale rate of new LEGOs = occasionally playing a round with **no new LEGO** before the next debut: a breather assembled at play time from the learner's own mastered USE inventory + due spaced-rep items (both already in the script's phrase pools — no new content, no fetch). Speeding up = the existing cull direction (fewer BUILD/CONSOLIDATE plays — turbo's mechanism, gentler numbers).

**PROPOSED bounds:** at most 1 breather per 3 rounds (sustained struggle); breather length = a normal round's spaced-rep + consolidate section (~8–12 cycles). A breather is indistinguishable from a generous review section — that's the invisibility.

### 4.5 Hysteresis and rolling behaviour (owner decision D)

- Every lever moves **at most one step per round boundary** (one BUILD phrase, one consolidate slot, 0.05 on a pause multiplier).
- A lever changes state only when the B4 signal has persisted ≥ 2 consecutive reads (`struggling`→trim needs two flags; `easing`→restore needs two).
- Dead-zone: `|accelerationZ| < alarm threshold` (B1's own-noise gate) → no movement. `manualOverrideActive` widens the dead-zone ×2 for the rest of the session.
- Levers decay back to scripted defaults over ~5 rounds of `steady` — the engine's resting state is "do nothing".

### 4.6 Hard bounds (safety rails — enforced in the policy, asserted in tests)

| Lever | Floor | Ceiling | Scripted default |
|---|---|---|---|
| `buildCount` | 3 | 7 | 7 |
| `consolidateCount` | 1 | 4 | 2 |
| `spacedRepCap` | 6 | 12 | 12 |
| breather rounds | 0 | 1 per 3 rounds | 0 |
| `pauseMultiplier` | 0.7 | 1.4 | mastery ladder 0.7–1.2 |

All **PROPOSED**, shipped as `algorithm_config.adaptation_v2.bounds` so every number is Tom-tunable without a deploy. The floors mean the engine can never hollow a round below Turbo's own proven-playable shape (`buildKeep` 3 / `useKeep` 1).

---

## 5. Stage 2 — envelope metadata (WP-6..9)

### 5.1 Client-side extractor (WP-6)

**Verified feasible:** the continuous VAD loop already collects an RMS-dB sample per animation frame into `energySamples[]`; it currently keeps only peak and mean. The extractor consumes this same array — **no second AnalyserNode, no new audio path, no recording.**

One required fix first: rAF cadence is display-locked and throttle-prone, so samples need timestamps. Change `energySamples: number[]` → `{t: number, db: number}[]` (timestamps already computed as `now` in the loop — currently discarded).

**New module: `packages/core/src/audio/envelopeMetadata.ts`** (pure functions over the timed sample array):

```typescript
export interface EnvelopeMetadata {
  durationMs: number          // learner_duration_ms — exists, carried through
  peakCount: number           // syllable-scale energy peaks (integer)
  peakToMeanRatio: number     // max linear RMS / mean linear RMS, speech region only
  meanPeakWidthMs: number     // mean full-width-at-half-prominence of the peaks
  sampleCount: number         // capture-quality guard
}
```

Extraction spec (**exact, PROPOSED constants**):

1. Take samples between confirmed speech start and speech end (the VAD's existing boundaries).
2. Convert dB → linear (`10^(db/20)`); resample onto a fixed **20 ms** grid (linear interpolation over the timestamps) — this is the windowing; it makes the metrics cadence-independent.
3. Smooth with a **3-tap (60 ms) moving average** — syllable-scale, kills frame flicker.
4. `peakToMeanRatio` = max/mean over the speech region.
5. **Peaks** = local maxima with prominence ≥ **25% of (max − mean)** and minimum separation **120 ms** (faster than any syllable rate). Count them.
6. **Width** per peak = time span where the envelope stays above (peak − prominence/2); `meanPeakWidthMs` = mean. Sharp staccato syllables → narrow; mumbled/merged syllables → wide.
7. `sampleCount < 10` (~a fifth of a second of usable envelope) → discard the cycle (`weight 0` — the capture-quality gate).

Wire-up: `stopContinuousMonitoring()` gains an optional `SpeechTimingResult.envelope?: EnvelopeMetadata` computed at cycle end (< 1 ms of arithmetic on ≤ a few hundred samples). **Raw samples are then discarded; only `EnvelopeMetadata` survives the cycle — the raw array never leaves `VoiceActivityDetector`.**

### 5.2 Model-voice metadata — DB schema (WP-7 here; pipeline job in the dashboard repo)

The model equivalents are computed **offline, once per audio file**, in the dashboard repo (ssi-dashboard-v7-clean), which masters all model audio — flag as a work package there (§7 WP-7b). Schema (this repo ships the migration; **PROPOSED**):

```sql
CREATE TABLE course_audio_envelope (
  audio_id            UUID PRIMARY KEY,       -- = course_audio.id / the UUID the player already holds per cycle
  duration_ms         INT  NOT NULL,
  peak_count          INT  NOT NULL,
  peak_to_mean_ratio  REAL NOT NULL,
  mean_peak_width_ms  REAL NOT NULL,
  extractor_version   INT  NOT NULL DEFAULT 1, -- constants above may be retuned; version gates comparability
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Read-only content data, same posture as course_audio: RLS on, anon SELECT allowed.
```

The pipeline job MUST use **the same algorithm and constants** (§5.1 steps 2–6) on the mastered files — decode to PCM, RMS over 20 ms windows, then identical smoothing/peak logic. Ship the constants as a small shared JSON (`envelope-extractor-v1.json`) both repos read, so client and pipeline can't drift.

Client fetch: batch `SELECT ... WHERE audio_id IN (...)` for the visible round's target1 ids, cached alongside existing cycle metadata (a few hundred bytes/round).

### 5.3 The delta producer (WP-8) and second-differential correlation (WP-9)

Per cycle with both sides present, compute the **delta vector** learner-vs-model:

```
d_dur   = |learner.durationMs − model.duration_ms| / model.duration_ms
d_peaks = |learner.peakCount − model.peak_count| / max(model.peak_count, 1)
d_shape = |log(learner.peakToMeanRatio / model.peak_to_mean_ratio)|
        + |log(learner.meanPeakWidthMs / model.mean_peak_width_ms)|
```

Emit one evidence event: `{source:'envelope', unitId: cycle.legoId, value: w_d·d_dur + w_p·d_peaks + w_s·d_shape, weight: 0.8}` (**PROPOSED** weights 0.5/0.3/0.2 — duration carries the most fluency signal per the paper's 2.5×-length example; all in config).

**Per-LEGO cross-phrase correlation (owner decision C) falls out of the aggregator for free:** every phrase sharing a LEGO emits to the same `unitId`, so its merged series *is* the cross-phrase delta series, and the B4 curvature read on it *is* the second differential of the delta. The constant offset of a learner who is simply 2.5× slower vanishes in the fit; only inflections flag.

**Boundary series (WP-9):** for M-LEGO cycles, when the learner's envelope has ≥ 2 peaks and the model's `peak_count` matches the component count, an anomalous inter-peak gap (> 2× the learner's median inter-peak gap for that phrase family — **PROPOSED**) emits evidence on `unitId = boundary:{legoId}:{gapIndex}`, `unitKind:'boundary'`, low weight (0.4). This is the paper's "boundaries are where difficulty lives", gated exactly as it prescribes — only where the data allows. **The policy consumes boundary series for sensing only in v2** (they sharpen the LEGO-level read); no boundary-specific lever exists yet (earn it).

---

## 6. Safety rails (WP-5)

1. **Kill switch:** `algorithm_config` row `adaptation_v2`: `{ enabled: false, shadow: true, stage2_enabled: false, bounds: {...}, weights: {...} }`. Read via `useAlgorithmConfig` at player init and on its existing refresh; `enabled:false` → the policy returns scripted defaults unconditionally (the v1 pause ladder keeps running untouched). Ships **disabled, shadow on**.
2. **Shadow mode** (the evidence bar from `adaptation-budget.md` Q4): with `shadow:true` the full pipeline runs — evidence, curvature, `RoundPlan` — but nothing is applied; every round boundary logs an `adaptation_plan` event to `player_events` (`{roundNumber, legoId, plan, difficultyStates, applied:false}`). Flip `shadow:false` only after the logs look sane over real sessions (visible in the existing admin insights surface).
3. **Bounds enforcement is structural:** `ratePolicy.ts` clamps every output; unit tests assert no input sequence can exceed §4.6; `SimplePlayer` overrides re-clamp defensively (belt-and-braces, same values).
4. **Graceful degradation:** guest / mic-denied / VAD-unavailable → stage 1 runs on behavioural evidence alone (the wire doesn't care); no evidence at all → `warming_up` everywhere → scripted defaults. Aggregator persistence unavailable (guest) → in-memory only, same as v1's model.
5. **No-discontinuity verification** (owner decision D, testable): (a) unit tests assert max one lever-step per round and monotone decay-to-default; (b) shadow logs are diffed for step-size violations before enabling; (c) dev cheat `?adaptdebug=1` renders a small overlay of live plan + lever positions on the dev deployment (pattern of existing `?fc=1`/`?stream` cheats) so a human can play a session and confirm nothing is feelable; (d) `adaptation_plan` events keep logging after enable (`applied:true`), so any learner report of weirdness is reconstructible cycle-by-cycle.
6. **Privacy invariant (stage 2):** the only new data leaving the browser is `EnvelopeMetadata` (5 numbers) and evidence values. Code-review gate for WP-6/8: no sample arrays in any network payload or store. The raw energy array must not escape `VoiceActivityDetector`'s cycle scope.

---

## 7. Work packages

Sized for one sonnet agent each. Feedback loops before every commit: `pnpm --filter @ssi/core test`, `pnpm --filter player-vue typecheck && test && lint`. Every functional WP updates the matching `apml/` spec in the same commit (`apml/learning/`; add `apml/learning/adaptation-v2.apml` in WP-0).

| WP | What | Files | Tests expected | Depends | Effort |
|---|---|---|---|---|---|
| **0** | Evidence stream + aggregator (§2): types, merge rule, ring buffers, snapshot/hydrate | new `packages/core/src/learning/evidence.ts` + `.test.ts`; export from `learning/index.ts`; new `apml/learning/adaptation-v2.apml` | merge weighting, ring cap, per-cycle collapse, hydrate round-trip | — | sonnet |
| **1** | Behavioural producers (§3): mapping table, manual-dial flag | new `composables/useBehaviouralEvidence.ts` + test; one-line hooks beside each `logEvent` site in `LearningPlayer.vue` | each event type → expected (value, weight); dropped types; override flag | 0 | sonnet |
| **2** | Rate policy (§4): budget logic, criticality guard, hysteresis, bounds, breather decision | new `packages/core/src/learning/ratePolicy.ts` + `.test.ts` (uses `localDifficulty`, `MasteryStateMachine` types) | bounds unbreakable; guard (early unit never deferred); two-flag hysteresis; decay-to-default; golden scenario traces on `syntheticSeries` | 0 (types only — parallel with 1) | **sonnet-high** (the pedagogical core) |
| **3** | Player wiring (§4.2/4.4): extend `useAdaptationEngine` to own aggregator + policy; apply `RoundPlan` via `shouldSkipCycle` tags (`adaptOmit`, same family as `turboOmit`) + breather-round assembly at the round boundary; `getPauseDuration` nudge | `useAdaptationEngine.ts`, `SimplePlayer.ts` (overrides only), `toSimpleRounds.ts` (tag pass-through), `LearningPlayer.vue` round-boundary handler | player tests: skip-tag honoured mid-round; breather insertion doesn't break round numbering/resume; turbo+adapt compose | 1, 2 | **sonnet-high** (touches the live player — smallest possible diff, overrides surface only) |
| **4** | Persistence: aggregator snapshot into `learner_lego_metrics` (extend `LegoMetricsStore.upsertSeries` pattern — new `evidence_series` JSONB column, isolated upsert like `recent_latency_samples`); migration to `supabase/migrations/` **for Tom to apply, never ad-hoc** | `packages/core/src/persistence/LegoMetricsStore.ts` + test; one migration (explicit RLS posture: own-row, matching the table's existing policies; `NOTIFY pgrst`) | store round-trip; pre-migration column-missing degrades silently (existing pattern) | 0 | sonnet |
| **5** | Safety rails (§6): `adaptation_v2` config row + `useAlgorithmConfig` typing; shadow-mode logging (`adaptation_plan` event); `?adaptdebug=1` overlay | `useAlgorithmConfig.ts`, `useAdaptationEngine.ts`, `LearningPlayer.vue`, seed SQL for the config row | kill switch returns defaults; shadow applies nothing but logs; clamps | 2, 3 | sonnet |
| **6** | Envelope extractor (§5.1): timestamped samples, `envelopeMetadata.ts`, `SpeechTimingResult.envelope` | `packages/core/src/audio/VoiceActivityDetector.ts`, new `audio/envelopeMetadata.ts` + `.test.ts` (synthetic envelopes: flat, n-peak, mumbled), `audio/types.ts` | peak count on synthetic fixtures; resampling under jittered timestamps; quality gate; raw-array containment | — (parallel from day 1) | sonnet |
| **7a** | Model-metadata schema + client batch fetch/cache (§5.2); shared `envelope-extractor-v1.json` constants | migration; small fetch composable or extension of the existing cycle-metadata fetch | fetch batching; cache; missing-row → stage-2 no-op for that cycle | — | sonnet |
| **7b** | **Dashboard-repo pipeline job** (ssi-dashboard-v7-clean): decode mastered mp3 → PCM → same algorithm/constants → upsert `course_audio_envelope`; backfill + hook into Phase-8 mastering | dashboard repo (own brief — write it from §5.1/5.2 + the shared constants file) | golden-file: same clip → same numbers as `envelopeMetadata.ts` within tolerance | 7a (schema) | sonnet |
| **8** | Delta producer (§5.3): fetch model row, compute deltas, emit envelope evidence | small module in `packages/player-vue/src` + hook in the cycle-complete path next to `recordCycle` | delta math; weight config; missing-model no-op; extractor_version mismatch → skip | 0, 6, 7a | sonnet |
| **9** | Boundary sensing (§5.3): inter-peak gap analysis → boundary-unit evidence (sensing only) | extends WP-8 module | gap detection on synthetic multi-peak envelopes; count-mismatch no-op | 8 | **sonnet-high** (genuinely gnarly signal-quality judgement; timebox, ship behind `stage2_enabled`) |

**Dependency order / parallelism:**

```
Stage 1:  WP-0 ──▶ WP-1 ──┐
              └──▶ WP-2 ──┼──▶ WP-3 ──▶ WP-5 ──▶ shadow soak ──▶ enable
              └──▶ WP-4 (any time after 0)
Stage 2:  WP-6 ─────────┐            (fully parallel with stage 1)
          WP-7a ─▶ WP-7b ┼──▶ WP-8 ──▶ WP-9 ──▶ behind stage2_enabled
```

Start simultaneously: **WP-0, WP-6, WP-7a** (no deps), then WP-1/2/4 the moment WP-0's types merge. Stage 2 plugs into the running stage-1 scheduler with zero scheduler changes — that property is WP-0's acceptance test: WP-8's producer must compile and run against the WP-0 interface with no edits outside its own files.

---

## 8. What this spec deliberately does not build (BSC / earn-it)

- No new criticality taxonomy — introduction order only (paper §04), until pilot data shows it mis-deferring.
- No boundary-specific *lever* — boundary series sharpen sensing only.
- No script regeneration path — all shaping is play-time overrides.
- No pitch/F0/spectral features — owner decision B is envelope-only; the full prosody stack (metrics-architecture §6) remains workstream F, separate.
- No dashboard surfaces — `adaptation_plan` events land in `player_events` where the existing admin insights read; teacher-facing rendering stays workstream D.
- No merging with the v1 pause ladder — v1 stays live and independent as the fallback the kill switch reverts to.
