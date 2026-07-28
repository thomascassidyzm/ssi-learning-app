# Surfacing the VAD Signal Without Ever Gating Flow

*A design exploration, commissioned by Tom 2026-07-28 after the IME partner discussions. Thinking work, not a build — nothing here ships until Tom rules on it.*

**Status:** exploration for the founder's read.
**Author:** Fable (Claude), grounded in the live codebase 2026-07-28.
**Canon this sits under:** `docs/methodology/metrics-architecture.md` (Measuring Progress — the measurement model), `docs/adaptation/adaptation-v2-build-spec.md` (what the capture pipeline actually is), `docs/gamification-done-right.md` (the framing law), `docs/methodology/insight-engine.md` + `packages/player-vue/src/explainer/` (the delivery system for schools), `docs/methodology/layer1-listening-cups.md` (the listening machinery the priority list feeds).

---

## 0. The commission, restated as constraints

The VAD data is captured anyway. Explore surfacing it, under three non-negotiables:

- **(a) Nothing mid-flow.** No ASR, nothing that blocks or judges during speaking. The method guarantees pronunciation for everyone who puts in the time.
- **(b) No new activity types.** Learners spend time only on main flow (HISE + built-in listening) and pod listening.
- **(c) Improvement-only framing for learners.** Trajectory, never grades. A struggling learner must never see a deficit with their name on it.

One observation before anything else: these three constraints are not restrictions on the design space — they *are* the design. Every alternative below got better when I applied them harder. The places where I argue with the founder's own opening idea (the traffic light, §2) are exactly the places where the idea is in tension with his own constraint (c).

---

## 1. Ground truth: what the VAD actually captures today

Verified against the live code, not the docs (several docs describe earlier stages). Full trace with file:line evidence: `docs/the-view/voice-vad-capture-inventory.md`. Live DB row counts could not be checked from this environment — population claims below are code-inferred, flagged where uncertain.

### Per speaking opportunity (cycle), computed on the phone

`@ssi/core/audio/VoiceActivityDetector.ts` is energy-only — RMS-dB off the AnalyserNode, no pitch, no recording. Per cycle it produces a `SpeechTimingResult`:

| Number | Meaning |
|---|---|
| `response_latency_ms` | gap from pause start to confirmed speech start |
| `learner_duration_ms` | how long they spoke |
| `duration_delta_ms` | vs the model clip |
| `envelope` (WP-6 — coded + wired, **gated off** behind `stage2_enabled:false`) | `EnvelopeMetadata`: `durationMs`, `peakCount`, `peakToMeanRatio`, `meanPeakWidthMs`, `sampleCount` — syllable-scale envelope shape on a 20 ms grid |

Raw audio and raw sample arrays never leave the device; only these derived numbers survive the cycle. That privacy invariant is load-bearing for everything below, especially schools.

### The comparison substrate

- `course_audio_envelope` — model-voice envelope numbers per audio clip, one row per file, `extractor_version`-gated. Table and client batch-fetch exist (`useEnvelopeMetadataCache`); **population status needs confirming** — if the dashboard-repo pipeline (WP-7b) hasn't run over the mastered catalogue, the envelope-delta path silently no-ops per clip today. Whatever ships first below, backfilling this table is on its critical path.
- The delta producer (`composables/useEnvelopeEvidence.ts`) is wired into the cycle-complete path in `LearningPlayer.vue` (~line 1715) but sits behind the same `stage2_enabled:false` flag. So today the envelope side is **plumbed end-to-end and dark**: flipping the flag plus backfilling the model table turns it on with no further build. Adaptation v2 stage 1 (behavioural + latency evidence) runs live in shadow mode — computing and logging, applying nothing.

### What persists, and at what grain

| Store | Grain | Longitudinal? |
|---|---|---|
| `learner_lego_metrics` | per (learner, LEGO): mastery state, rolling mean latency, `recent_latency_samples` ring of 20, `evidence_series` ring of 20 (merged latency + behaviour + envelope difficulty) | **No — rings overwrite.** This is a *now* snapshot, by design (the adaptation engine wants curvature, not history) |
| `player_events` | append-only, timestamped: `phase_skip` (with elapsed-in-phase), `lego_skip`, `tap_skip`, `belt_skip`, `turbo_toggle`, `audio_play`, `round_complete` | Yes — but **carries no envelope numbers** |
| `response_metrics` / `spike_events` | per-response latency rows from the pre-SimplePlayer era | **dead code — confirmed**: the legacy write path never fires under SimplePlayer (`LearningPlayer.vue:1745-1760` guard) |

**The headline gap:** the per-cycle envelope numbers are computed, used once for the adaptation delta, folded into a ring of 20, and then gone. Nothing anywhere links (learner, phrase, timestamp, envelope numbers) in an append-only record. This single fact drives §5 (the CEFR anchor) and shapes what §2–§4 can honestly claim.

**The adoption fact:** the metrics-architecture inventory (May 2026) put VAD opt-in at effectively zero. Whatever we design, "no speaking data for this learner/class" is the *common case* for a long while, not an edge case. Every surface below therefore has an honest-insufficiency mode as its default state, and growing opt-in (the Settings-as-discovery pattern, Measuring Progress §9) is silently the first feature of all of them.

---

## 2. The learner post-session surface

### The founder's floated shape: a rough traffic light on prosody-match variation + latency across the session

**Steelman first, honestly.** The instinct is right in four ways. It's post-session, so it never gates flow — constraint (a) is respected by construction. It's coarse — three buckets refuse the fake precision the canon bans. It's built from variation (consistency across the session's speaking opportunities), which is a genuinely better signal than absolute match: variation is at least partly baseline-free, pointing the same direction as read-curvature-not-level. And it answers a real hunger — the method asks learners to trust an invisible process for weeks; a glanceable mirror that says "your speaking is doing something" is trust the app currently doesn't earn back.

**Why I still think it's wrong for the learner, on the founder's own constraints:**

1. **A traffic light is a grade in costume.** Red-amber-green is the universal grammar of pass/warn/fail. A session that lands red is a deficit with the learner's name on it — a direct hit on constraint (c). Renaming the colours doesn't help; the *shape* carries the judgement.
2. **Red is unactionable inside the method — deliberately.** The method's answer to imperfect production is "keep going; listening will finish the job." So a red light demands an action the method refuses to prescribe. A grade with no lever is pure affect, all of it bad — and it lands hardest on exactly the struggling learner constraint (c) protects.
3. **Session grain is statistically dishonest.** One session is 40–80 speaking opportunities through a phone mic in an uncontrolled room. Capture quality, tiredness, and background noise move session-level prosody variation as much as speaking does. Measuring Progress's own discipline — smooth before you differentiate; a single cycle has no curvature — applies one level up: a single *session* barely has a trend. A tired learner goes red for showing up tired. That's the "you broke your streak" failure mode wearing a lab coat.
4. **It reads level, not curvature.** The canon is explicit that level is context and change is signal. A traffic light is the purest possible level-read.

**Where the instinct is right and should live instead:** aggregate. Three coarse buckets over a class-month, with no individual name attached, is honest — the noise averages out and nobody is graded. The traffic light isn't a bad idea; it's a *schools* idea (§4). For the individual learner, the same data should surface as movement and as closest-matches, never as state.

### Alternative A — "Your voice landed these" (the closest-phrases reel)

Post-session, show the 2–3 phrases where the learner's voice tracked the model most closely this session — smallest combined duration + envelope delta, quality-gated. Show the phrase *content itself* (both languages, per the position-display rule: content, never numbers), with a tap to replay the model audio from cache.

- **Improvement-only by construction:** every learner, including the one who struggled all session, has a top-3. The struggling learner sees their closest phrases — never their failures. This is constraint (c) made structural rather than editorial.
- No scores, no colours, no comparison. The phrase is the reward.
- Cheap: the deltas are already computed per cycle; keeping the session's best three in memory until `SessionComplete` is a few lines. Model audio is already cached.
- Risk to name honestly: "closest" is a relative frame, and a curious learner will infer the existence of "furthest". I think this is acceptable — the app never confirms the inference — but it's a taste call for Tom.

### Alternative B — the trajectory sentence (my recommendation for the headline)

This shape already has a shipped precedent: SessionComplete's response-time line ("{x}% faster / steady") is exactly this grammar — movement vs your own past, stated once, no grade. B extends the family rather than inventing one. One sentence, only when earned, computed on rolling multi-session windows — never within one session:

> "Your responses this week are coming in quicker than last week."
> "Your rhythm on longer phrases is settling."

Fires only when the merged evidence series shows genuine movement (the same curvature machinery the adaptation engine already runs — the sensor exists, this is just a second consumer). When there's no signal: **silence**, not a neutral grade. Absence of the sentence is not a message, because the sentence has no fixed slot to be absent from — it appears among session-complete lines the way consistency-bonus glints already do in the gamification design.

- Trajectory, never state; movement, never position. This is constraint (c) as literally as it can be implemented.
- It composes with the Timeline ("evidence of transformation", gamification-done-right §8): each fired sentence is a timeline entry — *April 2: natural rhythm emerging* — which over months becomes the learner's own longitudinal story, assembled entirely from improvement moments.
- Sentences come from a small fixed template set mapped to specific detectable movements (latency trend, duration-match trend, variance shrinking). No free generation, no model calls; honest because each template is bound to a real measured turn.

### Alternative C — feed the points formula and change nothing visible (the frame-breaker)

Gamification-done-right already specifies latency bonuses and a duration-match "prosody proxy" bonus inside the hidden points formula. The VAD surface for learners may already be designed — it's called **"+7"**. Wire the envelope deltas into the existing hidden formula, add the occasional unattributed glint ("something in your speaking contributed"), and ship no new surface at all.

This is the cheapest option, fully canon-aligned, zero framing risk — and it's the strongest argument *against* building anything bigger: the philosophy's core line is "show the results of good behaviour, hide the mechanics." A visible prosody surface, however gently framed, is mechanics.

### My position

**C now, B next, A as the detail view; the traffic light never for individuals.** C is nearly free and pressure-tests nothing. B is the honest visible mirror and the one that compounds (Timeline). A is a lovely moment worth having once B's machinery exists. If Tom wants exactly one thing on the session-complete screen, it's B.

---

## 3. The listening priority list (the founder's favourite — and rightly)

The idea: phrases the learner isn't getting feed a personal listening queue. Weakness data converted into the method's own remedy — more listening, never repeat-speaking drills.

This is the best idea in the commission because it's the only one where the VAD data *does* something for the learner rather than *says* something to them. It never violates (c) because the learner never sees the weakness — they just hear more of the right input. And it needs **no new activity type**, because the listening machinery it feeds already exists and already runs every round.

### The mechanism, concretely

**The signal already exists.** `learner_lego_metrics.evidence_series` is a per-LEGO merged difficulty series (latency + behaviour + envelope), and `computeLocalDifficulty` already classifies each LEGO `warming_up | steady | struggling | easing`. "Phrases the learner isn't getting" = LEGOs currently reading `struggling`, mapped to the seeds that carry them (evidence lives on the ownership axis; seeds are the vehicles — the mapping is a join we already have).

**The consumer already exists.** The Layer-1 30-cup wheel (`layer1-listening-cups.md`, live on dev) pours ~a minute of comprehensible-input listening at the end of every round: each seed plays *target → known → target → target@2×*. Cup composition is a pure function with two parts — an **authored cluster** (Aran's templates, linguistic groupings) and **loose seeds** (currently recency-assigned).

**The design: bias the loose slots.** The loose part of each cup (up to 4 seeds) becomes the personal part: seeds carrying the learner's currently-struggling LEGOs get pulled into loose slots ahead of the default recency choice. The authored clusters are never touched — Aran's linguistic groupings stay sovereign, exactly as the cup model already rules (authored membership overrides). Implementation shape mirrors the existing `clusterProvider` injection: a `priorityProvider` reading the evidence snapshot the player already holds in memory. A seed leaves the priority pool when its LEGOs ease — self-healing, no ratchet, and the wheel stays resume-safe because the evidence snapshot is itself persisted.

Secondary consumer, same pattern: the spaced-rep review slots the round already plays (`spacedRepCap` ≤12) are the *speaking* echo of the same idea — but that's adaptation v2's existing territory (defer-and-return), already specced. The priority list is deliberately the **input-side** twin: more *hearing* of the hard material, zero additional production pressure. That asymmetry — struggle earns listening, never drilling — is the method's own pedagogy (consolidate/defer over drill; Aran's "wider listening is the key") expressed in code.

### Where it surfaces

Three options, in ascending visibility:

1. **Invisible** — pure selection bias. The learner just notices, weeks later, that the phrases that used to trip them somehow feel familiar. This is peak SSi: "the best gamification is the kind you can't see."
2. **A receipt, not a queue** — a quiet line at session end: "Today's listening included some phrases worth another hearing." No list, no names of phrases, no deficit framing.
3. **A visible personal queue** — "Your listening picks." I recommend against this: a visible list of things-you're-not-getting is a deficit list however warmly labelled, and it invites learners to *manage* the queue, which creates exactly the new-activity-type surface constraint (b) forbids.

**Ship 1. Consider 2 later.** Never 3.

### Pods (Layer 2)

Pods are conversational content keyed by topic, not by LEGO, so per-phrase weakness can't steer them without new content metadata. Leave pods alone; the cup wheel is the right consumer. If pod metadata ever grows LEGO/vocab tagging in Popty, the same priorityProvider extends naturally — earn it then.

### BSC narrative

**Better:** the learner's hardest material gets more comprehensible input automatically, which is the method's own claimed remedy — the loop closes with zero learner-visible judgement. **Simpler:** no new surface, no new activity, no new tables — a selection-bias function injected into a wheel that already turns, reading a series that's already persisted. **Cheaper:** a pure-function change plus tests; no runtime cost, no content cost, no framing risk to manage. This is the strongest BSC story in the commission and my recommended first *learner-facing* consumer of the VAD data — precisely because it isn't facing them.

---

## 4. Schools: "actually generating understandable language" at class level

### What the data can honestly say — and the word it can't

The VAD is energy and timing. It can honestly support, at aggregate: *your students are actually speaking in the gaps, promptly, at model-like length and rhythm, and increasingly so*. It cannot honestly certify *understandable* — no words are ever recognised (Principle 2, deliberately). The honest claim family is **"speaking that tracks the model voice"**; understandability is the *inference* the method's 17 years license, and the copy should lean on the method, not the mic: "responding in Welsh, promptly and at natural length" — never "94% intelligible."

Four class-level metrics are honest, stable, and buildable from the capture:

| Metric | From | Honest claim |
|---|---|---|
| **Speaking participation** | voiced response present per opportunity | "the class is actually speaking, not clicking through" — the single most valuable fact for a teacher, invisible today |
| **Promptness trend** | response-latency trajectory vs the class's own past | retrieval getting automatic |
| **Duration-match trend** | learner-vs-model duration deltas | phrases coming out at full natural length, not fragments |
| **Rhythm-settling trend** | envelope-delta variance shrinking | production stabilising |

All four are **trajectory vs the class's own past** — never class vs class, never child vs child. Rankings of children are banned outright; the sovereign-comparison rule (entity vs aggregate, k-anonymity floor) is already enforced at the substrate.

### Sample sizes and stability floors

The calibration canon says ~30–50 cycles per learner before an individual signal stabilises. At class level the arithmetic is generous: 25 students × 2 sessions/week × ~60 speaking opportunities ≈ 3,000 voiced cycles/week *if capture is on*. Proposed floors, config-tunable: surface a class trend only with **≥8 learners contributing ≥30 quality-gated voiced cycles each in the window, windows of ≥2 weeks compared to ≥2 weeks**. Below the floor: the honest-insufficiency state the node surfaces already model well (the IME programme root does this today) — and crucially, the insufficiency copy is itself an *invitation to grow capture* ("speaking signal isn’t on for most of this class yet — here's what it unlocks"), which makes adoption the surface's own first job.

Two traps the canon has already named, restated because they will bite here:

- **Device class is load-bearing.** Class-play (one classroom device, twenty voices) yields *class-level* signal only and must never write into an individual learner's series; homework capture is the only honest per-student source. The "keeping up in class but no homework voice data" state is a legitimate, surfaceable fact — it's the one per-child line that's allowed, because it's a data-coverage fact, not a deficit.
- **Test/demo cohort exclusion** (`is_test` flags, the rate-compare lesson): demo classes must not pollute pilot aggregates, and the existing exclusion machinery already handles this if the new metrics ride the same rails.

### Delivery: the noticing-invitations layer, exactly as built

The mechanism (`explainer/evaluateRules.ts` + `pack.json`) evaluates declarative rules against the node-home payload the page has already fetched — zero new queries, zero model calls, invitations never missions. Three canon facts pin how the extension must be shaped (canon brief: `docs/the-lens/ime-preflight/voice-vad-design-canon-brief.md`):

- **The layer is leader/admin-only, node-home-only, by founder ruling** ("learner surface: nothing, ever"). This design complies: §2's learner surfaces deliberately do not ride it; only the class/school aggregates do.
- **The rule schema can't express trends** — no field-vs-field comparison, no time-series shape. So the trend computation lives **server-side**: the payload carries a categorical verdict (`improving | steady | insufficient`), and the pack.json rule is a plain `eq` check. New metric = payload field + rule entry, exactly as the mechanism intends; no rule-engine change.
- **"Voice" is a taken term** in the lens vocabulary (grammatical perspective on cards, pinned by e2e checks). The payload block and all copy here use **"speaking"**, never "voice", to avoid the collision.

Extension is two steps, both small:

1. **Payload:** add a `speaking` aggregate block to the node-home API response (participation rate, the three trends, sufficiency flags) — computed server-side on the same scope-resolution path as the existing measures.
2. **Rules:** pack.json entries, celebration-framed, firing on improvement and on milestones only. Sketches:
   - *node* rule: `speaking.promptnessTrend = improving` → "This class's spoken responses have been coming quicker over the last month — they're finding the words faster. Worth celebrating out loud." CTA → insights.
   - *node* rule: `speaking.participation ≥ 0.9` → "Nearly every speaking gap is getting a spoken answer in this class — that's the method working exactly as designed."
   - *node* rule: sufficiency false → the adoption invitation above.
   - **No perChild deficit rules, ever.** The only per-child shape permitted is the homework-coverage gap, and even that lands as "we can't see X's speaking yet", not "X is behind."

This is also where the founder's traffic-light instinct lands legitimately: a three-bucket read (growing / steady / not-enough-data — note the third bucket is *data-sufficiency*, never "declining" as a resting display) over class-month aggregates is honest in a way the per-learner-per-session version isn't. Whether even the aggregate wants a "declining" state surfaced, or whether declines route to the teacher privately via insights rather than the shared node-home — that's a taste call for Tom; my lean is declines belong in Lens-B territory (what should we do), not on the celebratory node-home (Lens A), and the two must never share a screen.

For IME specifically: this surface is demonstrable *before* real capture exists — the honest-insufficiency state plus one demo-world class with synthetic voiced data shows partners both the celebration shape and the honesty discipline, which is itself the differentiator ("we show you only what we can defend").

---

## 5. The CEFR/IELTS anchor: park the claim, start the corpus

The claim stays parked — Measuring Progress §10 already sets the honest posture (speaking-pattern similarity, never certification, pilots as the calibration engine, 2027+ for the first confidence-weighted bands). Nothing in this commission changes that timeline. What this commission *can* change is whether the data that timeline needs **exists when it arrives**.

### Today's capture cannot support the study

A longitudinal validation study needs, per learner, a time-series of *(when, what phrase, how spoken)* spanning months. Today: envelope numbers live for one cycle, then collapse into a ring of 20 per LEGO. Rings overwrite; the longitudinal record is destroyed at write time. `player_events` is append-only but carries no envelope payload. **The corpus the 2027 pilots need is not being accumulated, even for the learners who already have the mic on.** Every month this stays true is a month cut off the front of the validation dataset.

### The minimal schema: one append-only row per usable voiced cycle

The canon already specifies this — it's the `cycle_prosody` Layer-0 event (Measuring Progress §8), reduced to the envelope-era field set:

```
occurred_at, learner_id, course_code, session_id,
lego_id, cycle_id, audio_id,                       -- stable phrase identity
device_class,                                       -- class_play | homework | tutor_session
response_latency_ms, learner_duration_ms,
peak_count, peak_to_mean_ratio, mean_peak_width_ms, -- the learner envelope
model_audio_envelope ref = audio_id,                -- model side joins via course_audio_envelope
extractor_version, capture_quality (sample_count)
```

**Where it lands — two options:**

- **Option 1: a `cycle_prosody` event type in `player_events`.** No migration (JSONB payload), the write path and batching exist, append-only and timestamped by construction, and the analytics/Insight-Engine readers already point at this table. Cost: JSONB rows are queryable but unindexed on the payload fields; a future study does one extraction pass — fine for research use.
- **Option 2: a dedicated `response_envelopes` table.** Typed columns, indexable, RLS own-row like the learner-data spine. Cleaner for the study; costs a migration and a new write path.

**My read: Option 1.** The consumer is a research corpus read in batch, years out — typed indexes now are cost without a consumer. Volume is small (only quality-gated voiced cycles from the VAD-on population; at current adoption, hundreds of rows a day, not millions), and the row is ~200 bytes of derived numbers — the privacy invariant (numbers only, never samples) holds unchanged. If pilot-era volume or query pain ever argues for a table, the JSONB history migrates forward losslessly. Ship Option 1 now; earn Option 2.

One flank to cover regardless: **retention policy.** If `player_events` ever gains a pruning window, `cycle_prosody` rows must be exempt — the whole point is that they outlive everything. Worth one line in the migration/config now, so a future cleanup pass can't silently eat the corpus. And one prerequisite shared with everything else: `course_audio_envelope` must actually be populated for the pilot-language courses, or the model side of every comparison is missing.

On Principle 5 ("never build a signal before its consumer exists"): the canon itself carves this exact exception — §10 Step 1, "Capture, today," ships before any consumer because *the corpus is the consumer* and it cannot be built retroactively. This is the one place where waiting is the expensive choice.

### What NOT to do

No CEFR copy anywhere in the product now — not "on track for B1", not a percentile against a level. The flat hours-based anchor (30h ≈ entry-conversational, ~100h ≈ B1, admin/tutor-gated, honestly framed) remains the only level-shaped output until the pilots pair internal coordinates with external assessments. IELTS specifically: same posture, and note IELTS measures four skills — the honest long-term claim will always be a *speaking-fluency* band-similarity, and the partner conversation should be framed that way from the first slide.

---

## 6. Sequencing: what to build first and why

**0. Backfill `course_audio_envelope` (dashboard-repo pipeline run) + flip `stage2_enabled` on.** Prerequisite for everything, and cheap: the envelope path is already plumbed end-to-end and dark — this step is a pipeline run plus a config flag, not a product build.

**1. The longitudinal capture (§5, Option 1).** Smallest diff in the whole commission — the numbers are already in hand at cycle end; this adds one `logEvent`. It has the highest cost-of-delay: corpus lost now is unrecoverable, and the 2027 pilot story depends on it. It also quietly powers everything else: the trajectory sentence, the schools trends, and the eventual study all read the same rows.

**2. The listening priority list (§3), invisible.** The founder's favourite, the best BSC story, zero framing risk, and it makes the VAD data *do* something for learners within weeks. Also the best adoption argument we'll ever have for the mic toggle: "with the mic on, your listening quietly tunes itself to you" is a concrete, honest benefit — Settings-as-discovery finally has something real to point at.

**3. Schools speaking aggregates via noticing invitations (§4).** Ship with the honest-insufficiency state from day one (IME-demonstrable immediately); real trends light up as pilot capture grows. Rides entirely on rails that exist (node-home payload + pack.json).

**4. The learner post-session surface (§2), last — C then B.** Wire envelope into the hidden points formula whenever convenient (it's invisible). The trajectory sentence waits until step 1's rows give it multi-week windows to be honest over. The closest-phrases reel is a fast-follow if Tom wants it.

The quiet thread through all four: **adoption is the real first feature.** Every surface degrades honestly to "no speaking data yet", and every step makes turning the mic on more obviously worth it. The traffic light, as floated, ships nowhere — but its instinct ships everywhere: coarse, honest, glanceable reads of a signal we were already capturing, placed only where the framing can never put a deficit next to a name.

---

## Open questions for Tom

1. **§2 verdict:** C-then-B as the learner surface, traffic light never for individuals — agree, or do you want the light anyway? If so, I'd want the third state to be "not enough signal", never red.
2. **§3 visibility:** invisible bias (my rec) vs the session-end receipt — is the receipt worth the framing exposure?
3. **§4 declines:** should a genuinely declining class trend appear on node-home at all, or only in the teacher's insights drill (my lean)?
4. **§5 blessing:** one new `player_events` event type, `cycle_prosody`, quality-gated, retention-exempt — go?
