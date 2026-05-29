# Metrics Architecture for SSi: Measuring Fluency Without Speech Recognition

*A methodology specification for capturing, aggregating, and surfacing learner progress in the SSi platform — with a long-horizon path to language-agnostic, calibrated fluency estimates.*

**Status:** Design — not yet implemented beyond the components called out as existing.
**Date:** 2026-05-23 (rev. 2026-05-29).
**Authors:** Tom Cassidy and Claude (Opus 4.7; 2026-05-29 synthesis with Opus 4.8), in conversation.
**2026-05-29 revision:** added Principles 3–5 (read curvature not level; contextual difficulty + consolidate/defer/drill budget; measure the objective not a proxy, and earn richer signals before building them), expanded §4 with the trajectory/controller/budget treatment — resolving drill-vs-defer to *introduction order* (conversational impact, not frequency) and the return trigger to the existing spaced-repetition schedule — and gave §10 a realistic pilot-coupled CEFR timeframe and honest-claim boundary.

---

## Abstract

This document specifies the metrics layer for SSi's learning platform. The starting position is an unusually strong one: SSi has observed, across thousands of learners over seventeen years, that learners reach conversational ability after approximately 30 hours of in-app practice and B1-level fluency after approximately 100 hours. This is empirical ground truth requiring no external validation — but it is flat, the same number for everyone, with no per-learner finesse and no external cross-check. The architecture proposed here adds that finesse, while preserving everything the method already does. It rests on four load-bearing ideas. First, learner progress is captured along **two axes**: *difficulty* (where the learner is in the course — objective, trivial to measure) and *execution* (how closely their spoken response matches the model voice — measured by classical digital signal processing of pitch, rhythm, and spectral shape). Together these axes give every learner a 2D coordinate that evolves over time. Second, we **never use automatic speech recognition (ASR)**. ASR is poor for the long-tail languages SSi serves, biased against non-native accents, and measures the wrong thing — whether a phone can guess the words — rather than the things that actually constitute fluency: timing, prosody, rhythm, and acoustic plausibility. Third, formal CEFR-style levels are **discovered from the population**, not imposed from theory: as the platform accumulates learners spanning beginner to fluent, clusters emerge in the (difficulty, execution) plane, and the SSi-internal hour-based anchors (30 hours = entry-conversational, 100 hours ≈ B1) combine with a small external calibration sample to label those clusters retrospectively. The platform never outputs a hard level — only a confidence-weighted "best fit" with explicit uncertainty. Fourth, the information in every signal lives in its **rate of change**, not its level: each learner is a *trajectory* whose curvature (the second derivative — the differential of the difference) is the headline, so a stable-but-slow learner reads as no signal while a turning trend is the alarm; difficulty is treated as a contextual *(learner × unit)* interaction, and the engine answers it by reallocating a finite practice budget across *consolidate / defer / drill*, leaning to consolidate. The metrics layer described here is the foundation for tutor dashboards, schools-teacher dashboards, the adaptation engine, and the long-term population-level fluency estimates — all rendered from the same underlying coordinate.

---

## 1. Motivation

SSi already works as a learning method. What it does not yet do is help **teachers, tutors, and the SSi team** see what is happening across their learners. The schools dashboard has been built out (twelve views, full analytics), but the tutor dashboard is sparse, and neither audience has a principled way of asking the questions that actually matter:

- *Is this learner on track, or have they quietly stalled?*
- *Are they speaking with growing confidence, or just clicking through?*
- *Which specific phrases are too hard for them?*
- *How does this learner compare to the rest of the population?*

The naive answer would be "build more dashboards and dump more numbers onto them." We are deliberately not going to do that. The dashboards are downstream of a question we have not properly answered: **what should we be measuring in the first place, and how should the measurements compose?**

This document answers that question. It defines the underlying metrics architecture from which all dashboards — and the adaptive engine itself, and the future fluency-level estimates — are rendered.

---

## 2. The empirical baseline: what 17 years of SSi already tells us

After teaching language to thousands of learners over seventeen years, SSi has accumulated robust observational averages that this metrics architecture is designed to build on, not replace.

### Two anchor observations

- After approximately **30 hours of in-app practice**, learners can confidently get into conversations in the target language. They are not yet fluent, but the barrier to speaking has dropped.
- After approximately **100 hours of in-app practice**, learners are genuinely conversational at roughly B1 level — they can hold extended exchanges, handle unfamiliar topics, and recover from mistakes.

These are averages across the population, not promises to individuals. The variance within any individual learner is high, and a meaningful fraction of learners hit these milestones substantially faster or slower. But on the central tendency, this is what the SSi method produces. Critically, **this is empirical ground truth that requires no external validation**: SSi has observed it directly from its own learner population for nearly two decades.

### The methodological premise behind the numbers

A learner who already speaks at least one language has, by definition, a working internal map of how language works. They already have grammar, semantics, pragmatics — they know what language *is*. What they lack for their new target language is not the map; it is the **automatic memories** that connect their existing semantic structures to the target-language forms.

The SSi method is, in essence, a high-throughput memory-formation system for those connections. The four-phase cycle (prompt → pause → voice 1 → voice 2) is engineered to lay down exactly the right kind of automatic memory: a target-language form, fired in response to a known-language semantic prompt, repeated under spaced-repetition discipline until retrieval is fast and effortless. The hours-to-conversation observation falls out of how long that memory-formation process takes when run at SSi's intensity.

### What is missing from the current state

The 30/100-hour averages are flat. They are the same number for every learner. They do not respond to:

- Whether a particular learner is faster or slower than average.
- Whether their progression is steady or stalling.
- Whether their *execution* is keeping pace with their *difficulty* — i.e., whether they are forming the automatic memories at the rate that hours-on-task would predict.
- Whether external evidence (formal CEFR scores, language-school placements) matches the SSi-internal prediction.

The metrics architecture in this document does not change the underlying SSi method. It adds the finesse, individual resolution, and external validation that the bare hours-on-task average lacks. Concretely:

- The **execution axis** (§4 below) measures the rate of automatic-memory formation directly, via prosody match — so for any individual learner we can tell whether execution is keeping pace with hours-on-task.
- The **adaptation engine** (Principle 1, §3 below) does the per-LEGO finesse that lets individual learners deviate from the average rate without being held back or pushed too hard.
- The **CEFR-via-calibration layer** (§10 below) anchors the hours-to-level observations against external evidence: if our learners reach B1 after 100 hours on average *and* external CEFR scores agree, we have validated the methodology. If they disagree, we have learned something important.

The architecture's purpose is to take a method that **demonstrably works on average** and give it the resolution to work *for each individual* with confidence, while accumulating the data to externally validate what SSi has long believed.

---

## 3. The design principles that govern everything

These principles do most of the work and should be referred back to whenever a design decision feels ambiguous.

**Principle 1: Manual controls are the major dial. Adaptation is the elegant finesse.**

The learner already owns the big decisions in the SSi player: they can skip forward, skip back, and toggle Turbo mode. These are the major dials, and they are doing the heavy lifting of "I find this too easy" or "I find this too hard". The adaptation engine should never try to compete with the learner's own judgement. Its job is the millisecond-level finesse the learner could not be bothered to do manually: shave 50 ms off a pause when the last five responses were quick, schedule a struggled-with LEGO to return slightly sooner, mark a phrase confident when the prosody match has been stable for three exposures. The learner should never *feel* the adaptation. Like a good piano accompanist following a soloist — when it is working, the soloist just feels in flow.

A useful corollary: anything the engine wants to do that the learner *would* notice from outside the session — re-ordering the curriculum, dropping a course, surfacing a remedial sub-track — is not for the engine to decide silently. It is for the engine to surface to the human (tutor or teacher) and let them act on it at a higher level. **The dashboards are partly the place where signals the engine would otherwise act on silently get rendered for humans to see.**

**Principle 2: No automatic speech recognition.**

ASR is the wrong tool for what we want to measure. Its accuracy is poor for the long-tail languages that are SSi's wheelhouse (Welsh, Manx, Irish, Cornish, Catalan, Galician, etc.). It is biased against non-native accents — exactly the population we are serving. And, most importantly, it is answering the wrong question: ASR measures *whether a machine can guess the words you said*. Fluency is not that. Fluency is timing, rhythm, prosody, acoustic plausibility, and confidence — all of which can be measured directly from the audio signal using classical digital signal processing, without ever needing to know what words the learner said.

The discipline here matters. As the platform grows, contributors will be tempted to bring ASR or phoneme classifiers back in — to "improve" pronunciation feedback, to "add" word-level scoring. **This is the wrong direction.** Phoneme accuracy is not fluency. The system measures what fluency actually is: does this person sound like someone who can speak this language.

**Principle 3: Read curvature, not level.**

The absolute value of any metric carries little information — a learner who consistently responds at 2.5× the model's length, saying things nicely, is simply where they are. What matters is *change*, and specifically the **rate of change of the rate of change** — the second derivative, the differential of the difference. Differentiate any signal twice and two things vanish automatically: the constant (the level) and the steady slope (a learner improving at an even pace). What remains is only the *inflection* — the moment the trend itself turns. This is exactly the discrimination we want: a stable-but-slow learner reads zero (no alarm — correctly), while a learner who suddenly starts taking three or four times as long, or stops getting through the sentence in time at all, lights up. Because the second derivative is baseline-free by construction, we never need to estimate and store a per-learner baseline to subtract — a simplification as much as a sharpening. Two disciplines follow: a signal must be **smoothed before it is differentiated** (a single cycle has no curvature — this is why we measure patterns, never instances) and gated on a minimum number of cycles; and we **stop at the second order** (jerk, the third derivative, is noise for human behaviour). The level is context; the acceleration is the alarm.

**Principle 4: Difficulty is contextual; adapt by reallocating the practice budget, leaning to consolidate.**

Difficulty is not a property of a phrase — it is a property of *(this learner × this unit), now*, and it moves as the learner's map fills in. We discern it by running the curvature sensor (Principle 3) **locally** — per LEGO, per word, and especially per *boundary*, the join between units, where retrieval-while-still-producing tends to catch people. A session is a finite **practice budget**, and the engine's real lever is not how hard to push any single item but how to spend that budget across three moves: *consolidate* (reinforce what they are already good at), *defer* (reduce a hard item now, let it rest until its surrounding context is richer), and *drill* (increase a hard item). SSi's lean — against the mainstream drill-your-weakness instinct — is **default to consolidate and defer; reserve drill for the structurally critical few.** A hard item is usually blocked by a thin surrounding map, not by lack of exposure to itself; grinding it in isolation produces brittle memorisation and risks the *drown* wall, whereas consolidating strengths builds the confidence that keeps the learner in the session (the *bored* wall is affective as much as cognitive) and thickens the semantic map that makes the deferred item land almost for free on return. Drill earns its place only when an item is genuinely load-bearing — high-frequency, blocking much downstream — where the cost of not having it outweighs its poor transfer. The control objective is to keep the learner in the channel between *drown* and *bored*, where rate of progress is maximised.

**Principle 5: Measure the objective, not a convenient proxy — and earn richer signals before building them.**

Every time we reach for an off-the-shelf measure it mismeasures exactly what makes SSi work: ASR scores word-guessing, not fluency (Principle 2); drill-the-weakness optimises coverage, not rate of progress (Principle 4); and corpus or in-course *frequency* ranks the wrong LEGOs, because the methodology front-loads by **conversational impact** — the rare-but-pivotal meta-communication layer ("I'm not sure how to say…", "can you say that again") that gets a learner into and staying in a conversation, where competence is finessed. The objective is confident interaction — *as understandable as possible, as quickly as possible* — and we measure against that, never against a generic stand-in. Its better×simpler×cheaper corollary: do not build a richer signal before the consumer that needs it exists. Prefer the primitive already in the data — **introduction order** as the conversational-impact / criticality signal (the author already sequenced by impact), the **spaced-repetition schedule** as the return trigger for deferred items — and earn a fancier version (an explicit layer tag, graph centrality) only when the data shows the primitive failing. The level humility this implies for the CEFR layer is its own commitment: never a hard level, always a range with confidence (§10).

---

## 4. The two-axis model

Every learner is described by a coordinate in a two-dimensional plane that evolves over time. The two axes are:

**Difficulty (x-axis)** — where the learner is in the course. This is monotonically non-decreasing as they progress. It is trivially measurable from objective state: which LEGO they last completed, what belt they hold, how many seeds they have introduced. The natural unit is the same as the existing belt system in `useBeltProgress.ts` (White → Yellow → Orange → Green → Blue → Purple → Brown → Black at seed thresholds 0/8/20/40/80/150/280/400), or for finer resolution, the seed-completion count.

**Execution (y-axis)** — how closely the learner's spoken responses match the model voice, as measured by VAD-derived prosody features. This is *not* monotonic — it can rise and fall. A learner having a tired session might execute worse than they did last week. Over a rolling window of recent cycles, the average gives the current execution score.

The two-axis framing is borrowed loosely from Olympic diving, where *difficulty* and *execution* are scored separately and combined. The same shape works for language learning. A learner who is far along the course and executing well is fluent. A learner who is far along but executing poorly has been clicking through. A learner who is early in the course but executing well is being thorough. A learner who is early and executing poorly is, plainly, struggling — and the dashboard should put them at the top of the tutor's "needs attention" list.

This coordinate is the common substrate for every learner. Every dashboard surface, every audience view, the adaptation engine itself, and the long-term CEFR estimates are all rendered from it. But the coordinate is not a static point — it is a *trajectory*, and per Principle 3 the headline signal is the trajectory's **curvature**, not its position.

### The trajectory, not the point

The same coordinate is read three ways, and they carry very different amounts of information:

- **Level** — where the learner is. Mostly context. The 2.5×-length learner is just there.
- **Velocity** — the direction and speed they are moving. A mild signal: are they trending up or down.
- **Acceleration** — whether that movement is itself turning. **This is the leading indicator**, and the earliest reliable warning. By the time the *level* has visibly moved you are late; by the time *velocity* changes sign they have already turned; acceleration tells you a turn is coming.

Worked example. A learner sitting at 2.5× the model's response length, stable: velocity ≈ 0, acceleration ≈ 0 → no alarm, correctly. If they drift toward 4× over a handful of cycles, acceleration spikes positive → *something in that combination tripped them up — surface it.* If 4× then holds, acceleration falls back to zero → it is the new normal, the engine has likely already responded, and it is no longer an emergency. The acceleration is what catches the **event**.

### Sensing difficulty locally

The curvature sensor runs not just on the learner's global coordinate but **locally**, at the finest unit that carries a stable enough signal: per (learner, LEGO), per word, and per *boundary*. Boundaries are often where the real difficulty lives — a hesitation that lands on the *join* between two units (rather than on either unit itself) points to a co-articulation or retrieval-sequencing problem, which is a different intervention from "they don't know this word." The per-(learner, LEGO) row in Layer 1 (§8) is the natural home for this local difficulty estimate.

This reframes the adaptation engine as a **controller whose job is to damp acceleration** — to keep each learner's local execution-vs-flow curvature near zero, nudging the pause multiplier (a ratio to model-sentence length) and the repetition schedule *before* a developing struggle becomes a crash. A well-tuned controller is exactly Principle 1's "invisible finesse": the learner never feels it. And the dashboard's "dig deeper here" is, formally, just the set of points where |acceleration| is high relative to that learner's own noise.

### The defer / drill / consolidate budget

When the sensor flags a hard (learner, unit), the response is not a single dial but an allocation of the finite session budget across the three Principle-4 moves, with the lean toward consolidate-and-defer. Two questions make this operational — *drill or defer?* and *when does a deferred item return?* — and the better×simpler×cheaper answer to both is **use primitives that already exist, and build richer signals only when the data earns them.**

- **Drill vs defer → introduction order.** "How critical is this unit?" is *not* corpus frequency and *not* in-course reuse — both systematically under-rank the highest-impact material. The SSi methodology front-loads by **conversational impact**: the meta-communication layer ("I'm not sure how to say…", "can you say that again", "I want to try") is rare in any corpus but is exactly what gets a learner *into and staying in a conversation*, where competence is finessed. The author's **sequencing already encodes this judgement** — early = high impact, by design — so the existing introduction order (`seed_number` / LEGO index) is the criticality signal, for free, with no new tag or taxonomy. Consequence: a hard *early-layer* LEGO **resists deferral** (drill or hold) even though it is "rare", because deferring it delays the conversational unlock — the opposite of a frequency-based gate.
- **Return trigger → the existing spaced-repetition schedule.** Deferral is timing, not abandonment, and we do not need a separate "semantic-neighbourhood-consolidated" computation to manage it. Deferring *is* letting the Fibonacci spaced-repetition engine (§13) space the item out; it resurfaces naturally once the surrounding map has filled, which spacing already approximates.

The discipline (a BSC corollary of the no-proxy lesson): the consumer of these signals — the defer/drill engine — does not exist yet, so building an explicit `communication_layer` tag, graph-centrality, or neighbourhood-readiness now would be the wrong cost shape. **Add a richer criticality signal only if population/pilot data later shows the order proxy actually mis-deferring something.** Earn it; don't speculate it.

Because the metric layer captures all of this, the consolidate-lean is **falsifiable**: as the population and (eventually) school-pilot data accumulate, we can test whether defer-and-consolidate actually beats drill-the-weakness for rate of progress. Given seventeen years of method, the expectation is that it confirms the lean — but the architecture gets to check its own pedagogy rather than assert it.

---

## 5. The self-assessment calibration signal

The SSi player's **phase pill** is a small UI element showing the four phases of the current cycle (PROMPT / PAUSE / VOICE_1 / VOICE_2), each as a clickable icon. Learners can click any phase to advance directly to it. This is, on the surface, a low-friction in-cycle navigation control.

It is also a continuous stream of **self-assessment data**, and capturing it gives us a third signal stream that runs alongside difficulty and execution.

### What phase-pill clicks mean

Each click during a cycle is a small moment of self-assessment. The learner is implicitly answering "do I have this?":

| Action | What it signals |
|---|---|
| Click VOICE_1 during PAUSE | "I have my answer, play the model so I can check." |
| Click VOICE_2 directly from PAUSE (skipping VOICE_1) | "I'm confident enough to want both voices in succession — let's verify quickly and move on." |
| Click PROMPT during PAUSE | "Wait, let me hear that again — I'm uncertain." |
| Let PAUSE run to completion | The default. No strong signal either way; learner is following the cycle as designed. |

These are not all equally common, and the population-level distribution will be worth watching — but each is a useful per-cycle signal. Aggregated over a session or a rolling window, they give us a *confidence proxy* per learner.

### The diagnostic: self-assessment accuracy

The confidence proxy by itself is interesting. Combined with the VAD-derived execution score for the same cycles, it becomes something much more powerful: a measurement of how accurately the learner is judging their own performance.

Four diagnostic combinations:

| Confidence (phase-skips forward) | Execution (VAD match) | What this learner is |
|---|---|---|
| High | High | Well-calibrated and fluent |
| High | Low | Overconfident — may benefit from challenging material or gentle correction |
| Low | High | Underconfident — needs reassurance; could be pushed |
| Low | Low | Appropriately cautious — staying with what they know |

This calibration signal matters at every layer of the architecture:

- **Tutors** can see whether a particular student needs confidence-building or reality-checking. These are very different coaching interventions, and getting the wrong one is actively counterproductive.
- **Schools teachers** can see whether a class is collectively over- or under-confident, which informs pacing decisions and which students to focus attention on.
- **The adaptation engine** can adjust per-learner: an overconfident learner might be quietly served slightly harder material; an underconfident learner might be served slightly more reinforcement of what they already know, to build trust in their own judgement.
- **The population layer** can discover patterns in how calibration accuracy evolves over time across all learners. Does it improve with practice? Is there a "calibration plateau" that distinguishes successful learners from stalling ones?

This is also a signal almost no other language-learning platform captures. Most platforms either don't expose in-cycle controls, or they treat clicks as pure UX events rather than psychological data.

### Event capture

Two new Layer 0 event types are needed (these appear in the full schema in §8 too):

```typescript
phase_skip_forward: {
  cycleId, legoId,
  fromPhase: 'PROMPT' | 'PAUSE' | 'VOICE_1',
  toPhase:   'PAUSE'  | 'VOICE_1' | 'VOICE_2',
  elapsed_in_phase_ms,    // how long they were in fromPhase before skipping —
                          // shorter = more confident
}

phase_skip_back: {
  cycleId, legoId,
  fromPhase: 'PAUSE' | 'VOICE_1' | 'VOICE_2',
  toPhase:   'PROMPT',    // typically to re-hear the known-language prompt
  elapsed_in_phase_ms,
}
```

The `elapsed_in_phase_ms` field is crucial: a learner who skips VOICE_1 after 200 ms of PAUSE is much more confident than one who skips after 3,500 ms. Confidence is not just *whether* they skipped, but *how quickly*.

### Derived metric

In Layer 2 (`learner_metrics`), the rolling diagnostic:

```sql
self_assessment_calibration  REAL  -- correlation between confidence-skip
                                   -- behaviour and execution-score over a
                                   -- rolling window of recent cycles
```

A value near +1 means confidence tracks execution accurately (the learner skips when they actually do well, waits when they actually do poorly). Near 0 means uncorrelated. Negative means inverse — the learner is consistently confident exactly when their execution is poor (the classic overconfident pattern).

This is computed from the joint distribution of phase-skip events and execution scores across recent cycles. It needs at least 30-50 cycles of data before it stabilises; before that, surface as "calibration not yet established."

> **State as of May 2026:** phase-pill click events are not currently captured to telemetry. The click handlers exist (the navigation works) but they do not emit `player_events` rows. This is the single smallest piece of wiring with the largest payoff in the whole architecture — once added, the calibration signal has data behind it for every learner from day one, with no opt-in required. See §12 Phase 1a.

---

## 6. The no-ASR principle and what it asks of the prosody layer

Refusing ASR means leaning on classical DSP, which is a feature, not a limitation. Five families of acoustic features can be computed from raw audio with no language-specific model and no transcription:

**F0 contour (pitch over time).** The fundamental frequency of the voiced segments — what we hear as the rise and fall of speech. Computed via autocorrelation or YIN. Normalised per learner (children, adults, and vocal-range outliers must be compared on a relative scale). Dynamic Time Warping (DTW) aligns the learner's contour against the model's even when the learner is slower or faster overall — what we are matching is the *shape*, not the absolute timing.

**Amplitude envelope.** The energy over time — how the syllables wax and wane. A learner saying *"good morning"* with the wrong stress pattern will have an envelope that diverges sharply from the model. DTW again gives a distance score.

**Voiced/unvoiced segmentation timing.** Where speech starts, stops, restarts. Captures things like missing initial consonants, inserted pauses, missing word-final sounds. Computed from zero-crossing rate and energy thresholds.

**Spectral centroid trajectory and rough formant tracking.** The acoustic neighbourhood of vowels. We do not need to label the learner's vowels as /i/ or /ɪ/ — we just need to know whether the energy is distributed across the spectrum in the same way as the model. If the model has a high-front vowel and the learner's spectrum looks low-back, that is a meaningful divergence even without naming what they got wrong.

**Tempo and pause structure.** Syllable rate, internal pauses, ratio of voiced to silent time. Captures rushing, hesitation, and the rhythmic feel of the utterance.

These can all be computed in the browser using the Web Audio API and a small WebAssembly or JavaScript DSP library (e.g., `essentia.js`, or a hand-rolled subset). Per-cycle computation cost is well under 100 ms on a modern phone. No server round-trip is required for the per-cycle scoring; the features are computed locally and posted to telemetry alongside the existing audio_play events.

The five features collapse into a single scalar **execution score per cycle**:

```
execution_score = w_f0  * (1 - normalize(f0_dtw_distance))
                + w_env * (1 - normalize(envelope_dtw_distance))
                + w_seg * (1 - normalize(voiced_segment_offset))
                + w_spec * (1 - normalize(spectral_centroid_drift))
                + w_tem * (1 - normalize(tempo_deviation))
```

The weights `w_*` are tunable; sensible defaults (0.3, 0.25, 0.15, 0.2, 0.1) reflect that pitch contour and envelope carry the most fluency information. The score is in [0, 1] where 1 is a perfect match to the model.

A learner's **rolling execution score** is the mean of recent per-cycle scores, weighted by recency. This is the y-coordinate on the two-axis plane.

---

## 7. Device topology: three classes, one learner

SSi serves three quite different physical setups, each of which produces audio data with different properties. The metrics architecture has to keep these separate.

**Class Play (schools).** A teacher at the front of a classroom drives the experience from their computer. Speakers project the model voice to the whole class. The class repeats together — twenty or thirty voices overlapping. A single classroom microphone captures the collective response. This is the *aggregate* case: there is no way to attribute the captured audio to individual students, and we should not pretend otherwise. The metrics extracted here belong to the *class*, not to any student in it.

**Homework (schools homework, or any individual learner studying alone).** The student is on their own device — phone, laptop, or tablet — in their own acoustic environment, with the device microphone capturing only their voice. This is the standard individual case. The metrics belong to that learner.

**Tutor session (Anyone Can Teach / ACT).** Functionally identical to homework — individual device, individual learner — but tagged differently because the tutor may want to know which metrics came from sessions they were present for versus async homework the learner did between sessions.

Every captured cycle carries a `device_class` field with one of `{class_play, homework, tutor_session}`. **This field is load-bearing**: it is what stops aggregate class data from polluting individual learners' execution scores. A student who attends school every day but never does homework will accumulate difficulty (their teacher is moving them through the course) but will have no individual execution data. That is a legitimate state, and worth surfacing to the teacher in the dashboard: *"Maria is keeping up in class but has no homework data — we cannot tell how she is actually speaking."*

For class play specifically, the metrics are computed on the collective signal and feed *class-level* dashboards — they tell the teacher things like "the class as a whole is responding faster on greetings than on questions" or "energy is dropping after twenty minutes — consider a break". The teacher gets aggregate insight they could not otherwise get; no individual student is misrepresented.

---

## 8. Layered architecture

The metrics layer has four logical levels. Each is a transformation of the level below it.

```
┌────────────────────────────────────────────────────────────────────┐
│  Layer 4: AUDIENCE VIEWS                                           │
│  ───────────────────────                                           │
│  Tutor dashboard, schools dashboard, population view, adaptation   │
│  engine inputs — all rendered from layers 2 and 3.                 │
├────────────────────────────────────────────────────────────────────┤
│  Layer 3: COHORT ROLLUPS                                           │
│  ──────────────────────                                            │
│  Per-class aggregates (schools), per-cohort distributions          │
│  (population), per-LEGO difficulty across all learners             │
│  (curriculum hot spots).                                           │
├────────────────────────────────────────────────────────────────────┤
│  Layer 2: PER-LEARNER ROLLUPS                                      │
│  ────────────────────────────                                      │
│  The (difficulty, execution) coordinate. Belt + progress.          │
│  Baseline latency and variance type. Streak / sessions-per-week.   │
│  Engagement trajectory.                                            │
├────────────────────────────────────────────────────────────────────┤
│  Layer 1: PER-(LEARNER, LEGO) STATE                                │
│  ──────────────────────────────────                                │
│  Exposure count, rolling latency, rolling prosody match, skip      │
│  count, current mastery stage, next-due timestamp. One row per     │
│  (learner, LEGO).                                                  │
├────────────────────────────────────────────────────────────────────┤
│  Layer 0: RAW EVENTS                                               │
│  ──────────────────                                                │
│  Audio plays, user actions (skip, turbo), session start/stop,      │
│  per-cycle prosody features. Append-only telemetry.                │
└────────────────────────────────────────────────────────────────────┘
```

### Layer 0 event schema (concrete)

Layer 0 events live in `player_events` (already exists, currently captures `audio_play`). The schema adds the following event types:

```typescript
// Existing
audio_play: { url, role, legoId, cycleId, cycleType, playbackSpeed }

// New — user actions (load-bearing for Principle 1)
skip_forward:   { fromCycleId, toCycleId, legoId }     // whole-cycle skip
skip_back:      { fromCycleId, toCycleId, legoId }     // whole-cycle skip
turbo_toggle:   { enabled: boolean, sessionPaceMsBefore, sessionPaceMsAfter }
session_start:  { courseCode, deviceClass, initialSettings }
session_end:    { sessionDurationMs, cyclesCompleted, completionReason }

// New — phase-pill self-assessment events (feeds calibration metric, §5)
phase_skip_forward: {
  cycleId, legoId,
  fromPhase: 'PROMPT'|'PAUSE'|'VOICE_1',
  toPhase:   'PAUSE'|'VOICE_1'|'VOICE_2',
  elapsed_in_phase_ms,    // shorter = more confident
}
phase_skip_back: {
  cycleId, legoId,
  fromPhase: 'PAUSE'|'VOICE_1'|'VOICE_2',
  toPhase:   'PROMPT',
  elapsed_in_phase_ms,
}

// New — prosody per cycle (the execution-axis raw signal)
cycle_prosody: {
  cycleId, legoId, role,           // which audio they were responding to
  response_latency_ms,              // already in MetricsTracker — keep
  f0_dtw_distance,                  // new
  envelope_dtw_distance,            // new
  voiced_segment_offset_ms,         // new
  spectral_centroid_drift,          // new
  tempo_deviation_ratio,            // new
  execution_score,                  // computed from the above, in [0,1]
  capture_quality_flag,             // confidence in the capture (noise, etc.)
  device_class,                     // class_play | homework | tutor_session
}
```

Every event carries the standard `user_id, course_code, session_id, occurred_at` columns already present on `player_events`.

### Layer 1 state

Layer 1 is one row per `(learner_id, lego_id)`. This is the materialised view from which both the adaptation engine and the dashboards read. It is updated by triggers (or a low-latency scheduled job) off the Layer 0 event stream.

```sql
CREATE TABLE learner_lego_state (
  learner_id        UUID NOT NULL REFERENCES learners(id),
  lego_id           TEXT NOT NULL,
  exposure_count    INT  NOT NULL DEFAULT 0,
  mean_latency_ms   REAL,                          -- rolling, recency-weighted
  mean_exec_score   REAL,                          -- rolling, recency-weighted
  skip_back_count   INT  NOT NULL DEFAULT 0,       -- learner judgement signal
  skip_forward_count INT NOT NULL DEFAULT 0,
  mastery_stage     TEXT NOT NULL DEFAULT 'acquisition'
                    CHECK (mastery_stage IN ('acquisition','consolidating','confident','mastered')),
  last_seen_at      TIMESTAMPTZ,
  next_due_at       TIMESTAMPTZ,                   -- spaced rep schedule
  device_class_mix  JSONB,                         -- counts by device class
  PRIMARY KEY (learner_id, lego_id)
);
```

The adaptation engine (`AdaptationEngine.ts`) already maintains some of this state internally. The change here is to **persist it**, so dashboards can query it and so the engine's state survives across devices and sessions.

### Layer 2 state

Layer 2 is one row per learner — the headline figures the tutor/teacher sees at a glance.

```sql
CREATE TABLE learner_metrics (
  learner_id              UUID PRIMARY KEY REFERENCES learners(id),
  difficulty_coordinate   REAL,                    -- 0..1, seed_completion / course_total
  execution_coordinate    REAL,                    -- 0..1, rolling mean across recent cycles
  belt                    TEXT,                    -- White..Black
  seeds_introduced        INT,
  baseline_latency_ms     REAL,                    -- from LearnerTempoProfile
  variance_type           TEXT,                    -- 'consistent' | 'variable'
  current_streak_days     INT,
  sessions_last_7d        INT,
  sessions_last_30d       INT,
  last_active_at          TIMESTAMPTZ,
  total_practice_minutes  INT,
  self_assessment_calibration REAL,                -- correlation of confidence-skips vs execution score
                                                   -- in [-1, +1]; null until ~30-50 cycles
  attention_score         REAL,                    -- rule-based, see §9
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The `attention_score` is the rule-based "this learner needs human attention" score described in §9 — used by tutor dashboards to surface who to message first.

### Layer 3 state

Layer 3 is cohort-level. Per-class for schools (already partly in `useAnalyticsData.ts`), per-cohort for tutors, and population-wide for the SSi team. These can be live SQL views rather than materialised tables — read frequency is low and freshness matters more than performance.

Key derived metrics at Layer 3:

- **Class distribution** — for a given class, the distribution of (difficulty, execution) coordinates across its students.
- **Population scatter** — every learner's coordinate plotted together. Tutors see their students overlaid on this.
- **Curriculum hot spots** — LEGOs that produce the lowest population-wide mean execution scores or the highest skip-back rates. Feed back to the Popty content team as content-quality signals.
- **Cluster discovery** — over time, density patterns in the population scatter that become the basis for the CEFR-via-calibration layer (§10).

---

## 9. Audience views

Three audiences read the metrics. The same underlying data feeds each, but the shapes differ.

### Tutor (ACT private)

The tutor's question is: *who needs my attention this week?* Their dashboard is a sortable list of their students, with each student shown as:

- Name and last-seen.
- Their current (difficulty, execution) coordinate, rendered as a small inline glyph or position on a mini-plane.
- A trajectory arrow showing where they have moved in the last 7 / 30 days.
- An attention score (rule-based) that defaults the sort order.

The attention score is a simple rule sum, not a model:

```
attention_score = +3 if no activity in past 7 days
                + 2 if execution_coordinate dropped > 0.1 in past 14 days
                + 2 if skip_back_count_last_session > 3
                + 1 if sessions_last_7d == 0
                + 1 if subscription_status in ('past_due', 'cancelled')
                + 0 otherwise
```

Students with score ≥ 3 are bubbled to the top. The tutor opens the dashboard once a day or so, sees the three students at the top, and acts on them. No more, no less.

In addition to attention score, each student in the tutor view carries a small **calibration indicator** (overconfident / underconfident / well-calibrated / no data yet) drawn from `self_assessment_calibration`. This shapes the *kind* of intervention a tutor should reach for. An overconfident student needs gentle reality-checking and slightly harder material; an underconfident student needs reassurance and a deliberate stretch. Same execution score, opposite coaching response.

For tutors with five students, a daily check is plenty. For tutors with fifty, weekly with the attention score doing the triage. The view adapts to student count automatically.

### Schools teacher

The teacher's question is: *is my class on track?* Their view is class-level first, individual second:

- A scatter plot of the class on the (difficulty, execution) plane. Students cluster naturally. Outliers — students drifting away from the cluster — are visually obvious.
- A class-aggregate "today" panel showing engagement, average session length, collective execution score from this week's class-play sessions (the Collier-VAD case).
- A class-level calibration summary: is the class collectively over- or under-confident? This informs pacing and which students to focus attention on (overconfident classes are vulnerable to nasty wake-up calls; underconfident classes are leaving capability on the table).
- A drill-down list of individual students by attention score, mirroring the tutor view but scoped to the class — including each student's calibration indicator.
- For students with no recent homework data: an explicit "no execution data — encourage homework" indicator, not a misleading score.

The schools admin and govt-admin views are aggregations of the teacher view — same data, wider scopes.

### Population

A view for the SSi team only. The scatter of all learners on the plane. Cluster boundaries (once they have been discovered). Curriculum hot-spot ranking — which LEGOs are population-wide problem children. Time-series of average difficulty and execution per cohort. Population-wide calibration distribution — does self-assessment accuracy improve with practice, and if so, on what timescale?

This is the dashboard from which content-quality decisions are made, and from which the CEFR-calibration layer is operated.

### Methodology explainer pages (admin-gated initially)

A fourth audience, structurally different from the others: not a dashboard for routine use, but a set of pages that explain *why* the architecture is shaped the way it is, with working visualisations demonstrating each principle using real (anonymised) learner data. Lives at `/methodology/*` routes in the learning app itself, gated to admin users initially with the intention of opening selected pages to all learners over time.

The pages are simultaneously three things:

- **A specification by demonstration.** Each page renders a working example of a principle in the spec — the (difficulty × execution) plane with real trajectories, the four diagnostic combinations of the calibration signal, the empirical 30/100-hour curves, the per-LEGO mastery progression. If we cannot render a principle as a working visualisation, the principle is not yet well-enough understood to ship.
- **A handoff artefact for the Colombo team.** When external developers take over the engineering work, they read the spec and look at the demos. Twenty interpretive decisions per visualisation are pinned down by reference, not by prose.
- **A trust and education surface for learners.** SSi's audience is unusually primed for explanation — language activists, methodology-curious learners, teachers. Opening these pages to the public over time turns them into a brand asset: "here is the kind of organisation that explains its work." This is consistent with SSi's long-held position that the methodology is not a commercial secret.

**The Settings-as-discovery-surface pattern.** Every toggle in the Settings screen should link directly to the relevant methodology explainer page. *"Personalised pacing"* → "Learn what this measures" link → `/methodology/personalised-pacing` → working demo of how pause timing adapts → return with an informed choice. This pattern serves two purposes simultaneously: it converts the Settings screen from a mysterious switchboard into a curated discovery surface, and it directly drives VAD opt-in (and other meaningful choices) by replacing "what does this toggle do" with "here is what we measure, and here is what you get back when you turn it on." This is the primary mechanism through which VAD adoption is intended to grow — see §12 Phase 2.

The pages also serve as the implementation pressure for the rest of the architecture: building them forces the underlying data to be queryable and the visualisations to be implemented as reusable Vue components. There is no parallel implementation — the demo pages use the same `FrostCard`, `AtmosphereBackdrop`, and analytics composables as the production dashboards. They break when production breaks, which is the right kind of coupling.

---

## 10. CEFR-via-calibration: a research roadmap

The long-term ambition is to produce a calibrated "best fit" fluency level for each learner — something like *"Your speaking patterns are most similar to learners around B1-B2 level, based on 47 sessions. Confidence will increase as you do more sessions."* We are explicit that this is not a CEFR assessment in the formal sense. It is a population-derived cluster label, calibrated against a small external ground-truth sample.

The roadmap has five steps. Step 1 starts immediately and benefits indefinitely; subsequent steps depend on accumulated data.

**Step 1 — Capture, today.** Ship the prosody-feature pipeline to every learner. No labels needed; just start accumulating cycle-level execution data into Layer 0. Cost: implement the DSP pipeline once. Benefit: every downstream layer in this architecture works; the corpus accumulates; population analysis becomes possible later.

**Step 2 — Anchor the scale at the top.** Capture native speakers (the SSi team, Aran's contacts, friends of the project) running the same cycles as control data. Their (difficulty, execution) coordinates anchor the top of the scale — by definition C2. Cost: a few hours of recording per anchor person, opportunistically.

**Step 2a — Anchor the scale internally using SSi's own observed averages.** This step is unique to SSi and unlocks a calibration source that no external assessment provides. SSi has, over seventeen years, observed that:

- Learners around **30 hours of in-app practice** can confidently get into conversations.
- Learners around **100 hours of in-app practice** are genuinely conversational at roughly B1 level.

These are population averages and are not promises to individuals (see §2), but they give us **anchor points along the difficulty × hours-on-task axis that do not require external CEFR scores at all**. Once enough learners have accumulated >100 hours, we can:

- Tag the population at the 30-hour mark and label that cluster "entry-conversational".
- Tag the population at the 100-hour mark and label that cluster "B1-conversational".
- Cross-reference these SSi-internal anchors with the external CEFR labels in Step 4 to see whether they agree. If they do, the methodology is doubly validated. If they diverge, we have learned something important about where SSi's internal averages and external assessments differ — which itself is a valuable finding.

Cost: zero engineering — these anchors emerge automatically from `learner_metrics.total_practice_minutes` once the population accumulates. Notably, this anchor depends only on time-on-task, not on prosody data, so it produces a first calibration result before VAD adoption has had time to grow.

**Step 3 — Cluster discovery.** When enough population data has accumulated (probably months to years), run cluster analysis on the (difficulty, execution) trajectories. Look for emergent groupings of learners with similar progression patterns. This is unsupervised, not predictive.

**Step 4 — External calibration.** Find 20–50 learners with known formal CEFR scores (from exams, language-school placements, or self-reported with corroboration). Their (difficulty, execution) trajectories label the clusters discovered in step 3. Cross-validate against the Step 2a SSi-internal anchors. Could be incentivised with a free month of Premium for opt-in.

**Step 5 — Confidence-weighted output.** Surface the "best fit" label only when cluster membership is robust — never as a hard level, always with a range and an explicit confidence indicator that tightens with data. Never call it a CEFR assessment; always call it "speaking-pattern similarity".

The crucial property: **step 1 is the only step that needs implementing now**, and it benefits every other layer of this architecture immediately. The CEFR layer is dessert. The metrics layer is the meal.

### What "absolute competence" claims — and does not

Everything else in this document is about *derivatives* (velocity, acceleration) and drives the **adaptation** engine. The CEFR layer is the opposite reading of the same coordinate: the *level* — the integral — and it drives the **assessment** story. Derivatives adapt; the level certifies. Both render from one coordinate.

The discipline is to claim exactly what we measure and no more. SSi measures **speaking-production fluency** (timing, prosody, rhythm) plus **course coverage**. A formal CEFR assessment measures four skills, including reading, writing, listening comprehension, and spontaneous interaction. So the honest output is a **speaking-fluency proxy aligned to CEFR-equivalent bands**, surfaced as a continuous, low-friction **screening / progress indicator** — *not* a certification, and SSi is *not* an exam board. This is both legally safe and, for a school, more useful than a point-in-time exam: it is always-on and trend-aware. It also honours the level humility of Principle 5 (§3) and Step 5 below: never a hard level, always a range with confidence.

### Realistic timeframe (the 2026 numbers)

Grounding against reality: ~5,000 learners, mostly Welsh and Spanish, net acquisition ~100/month; VAD/execution adoption ~0% today; school pilots planned for **2026–27 in Wales and Ireland**. Two facts shape the timeline. First, app populations are bottom-heavy — the lower-to-mid bands (A1–B1) will calibrate years before B2+, which stays sparse. Second, the **school pilots are the calibration engine**: they supply institutional authority, a captive spread of learners across levels, and — crucially — *paired external assessment* (the schools' own CEFR-aligned judgements). All three pilot/target languages already sit against CEFR-aligned national frameworks (Welsh via the National Centre for Learning Welsh; Irish via TEG; Spanish via DELE/SIELE), which gives ready-made anchors.

| Window | What ships | Depends on |
|---|---|---|
| **2026 H2 (now)** | The flat hours-based band, surfaced honestly and admin/tutor-gated: "~30h ≈ entry-conversational; ~100h ≈ ~B1." Crude but real; enough to make assessment a credible talking point with schools. | Nothing new — it is the existing 17-year anchor (§2/Step 2a), time-on-task only, no VAD. |
| **2026–27 pilots (Wales, Ireland)** | Calibration-data collection: pair each learner's internal coordinate with the school's CEFR-aligned assessment / teacher judgement. Validate the flat anchor per cohort. Welsh first (most learners + cleanest framework). Not yet certifying. | The pilots themselves; this is Step 4 happening with authority. |
| **2027 → 2028 (~12–24 mo)** | First calibrated, confidence-weighted band for the lower-to-mid range, Welsh then Spanish: "most consistent with A2 / low B1, confidence widening." B2+ flagged low-confidence. | Pilot pairs + maturing VAD coverage (Phase 2 adoption). |
| **2028+** | Robust cluster discovery, sharper estimates across more bands and languages; possible formal-alignment conversations with assessment bodies. | Population scale + non-trivial VAD coverage. |

The bottom line for planning: a credible, honestly-bounded CEFR-aligned indicator for **Welsh, lower-to-mid bands, is a 2027 deliverable coupled to the pilots**, with a crude hours-based version surfaceable now and multi-band/multi-language sharpening running 2028+. The pilots are simultaneously the reason to build it and the data source that makes it possible — which is why the assessment story and the schools rollout are the same roadmap, not two.

---

## 11. Open research questions

These are the things we do not yet know. None block step-1 implementation; all should be tracked as the corpus grows.

- **Vocal range normalisation.** A nine-year-old's F0 contour cannot be compared raw to an adult model voice. Proposal: the first 30 seconds of a learner's first session calibrates their pitch baseline, and all subsequent F0 features are normalised against it.
- **Background noise robustness.** Class-play in a primary school is acoustically very different from a bedroom at midnight. Either preprocess with noise suppression, or use a capture-quality flag to drop low-quality cycles from the rolling average. Probably both.
- **Cold start.** A new learner has no prosody history. The execution coordinate should display as "warming up" with a session counter, not as a misleading score below a meaningful threshold.
- **Cross-language transfer.** A learner studying their second SSi language — does their established prosody baseline transfer? Almost certainly partly. Worth measuring once the corpus supports it.
- **Privacy and consent.** "We capture prosody features (not your words) to help measure your progress" is a defensible message, but it needs explicit consent and careful framing, especially for schools where children's audio is involved. The class-play case is particularly sensitive — no individual identification, but collective recording, which has its own legal-framing requirements.

---

## 12. Implementation plan

### Current state (May 2026)

A data inventory on 2026-05-23 gave us empirical ground for what follows:

| Element | State | Implication |
|---|---|---|
| Total learners on .app | 1,372 | A genuine population, not a test cohort. |
| Active in last 30 days | 47 | Small but real — enough to ship to. |
| `subscriptions` rows | **0** | The Paddle bottleneck is total. Nobody has subscribed on the new app. Known; not surprising. |
| `player_events` (all-time) | 26,813 | Telemetry pipeline is healthy. Captures `audio_play`, `tap_pause`, `tap_play`, `tap_skip`, `round_complete`, `audio_failed`, `pod_lap_start/end`, `commentary_start/end`, `session_complete`. |
| Phase-pill click events | **None captured** | Calibration signal (§5) has zero data behind it today. Wiring gap, not a fundamental problem. |
| `learner_lego_metrics` rows | **0** | Either nobody has Personalised Pacing on, or the engine isn't writing. Either way, no execution data has ever flowed. Inferred VAD opt-in: ~0%. |
| Behavioural signals (skip / pause / round_complete / audio_play) | Rich | The behavioural-tier execution proxy described in §6 has substantial existing data. |

The implication for phase ordering: the doc was implicitly ordered "prosody first, behavioural as fallback." Reality is the inverse. The behavioural tier has data today and can power the first round of dashboards and explainer pages immediately. Prosody is a Phase 2 effort, paced by adoption rather than by build time.

### Phase 1a — Wire the phase-pill events (days)

Smallest unlock, biggest architectural payoff. The phase-pill component already handles clicks for navigation; we add a one-line `emit('phase_skip_forward', ...)` (and equivalent for skip-back) that posts to `/api/player-events`. Migration adds nothing — `player_events.payload` is JSONB and accepts the new event types directly.

Once landed, the calibration signal from §5 has data flowing for every learner from day one. Confidence-vs-execution correlation is computable as soon as we have a few sessions per learner.

### Phase 1b — Behavioural execution proxy + persisted Layer 1/2 (weeks)

1. Implement the behavioural-tier execution score as described in §6 — derived from phase-pill skip latency, skip-back frequency, round-completion rate, turbo usage, and streak signals. All inputs exist in `player_events` today.
2. Create the `learner_lego_state` table (Layer 1) and populate via a scheduled rollup off `player_events`. The existing `learner_lego_metrics` table is a good starting point — extend its schema rather than create a parallel one.
3. Create the `learner_metrics` table (Layer 2) including the behavioural execution coordinate, baseline latency, streak, calibration correlation, and attention score. Refresh on a 5-minute schedule.
4. The existing `AdaptationEngine` and `MetricsTracker` continue running unchanged. Phase 1b is additive.

### Phase 1c — Methodology explainer pages, admin-gated (weeks)

Build the `/methodology/*` routes described in §9. First page: `/methodology/difficulty-execution` — the 2D plane with real anonymised learner trajectories. Subsequent pages in priority order: calibration, empirical-baseline (30/100-hour curves), LEGO mastery progression. Each page uses production components, gated to `platform_role = 'ssi_admin'` initially.

Wire each Settings toggle to the relevant page via a "Learn what this measures" link, as described in §9.

### Phase 2 — Prosody/VAD push (weeks–months, paced by adoption)

The prosody/execution tier described in §4 and §6 is the architecture's most novel content, but it has 0% data coverage today. Two things move it forward simultaneously:

1. **Capture infrastructure.** Implement the per-cycle prosody-feature computation in `packages/player-vue/src/lib/prosody/` — the DSP module computing F0 contour, envelope, voiced segmentation, spectral centroid, tempo, and the derived execution score. Post as `cycle_prosody` events. Hook into the existing `CycleOrchestrator`. This can ship before adoption: the moment a learner turns Personalised Pacing on, data starts flowing.
2. **Adoption push.** The primary mechanism is the Settings-as-discovery-surface pattern in §9 — every Settings toggle links to a methodology explainer page demonstrating what's measured and what's gained. For Personalised Pacing specifically, the explainer page shows the (difficulty × execution) plane with the toggle off versus on, so the user sees concretely what they gain. Secondary mechanisms worth piloting: default-on for tutored learners (the tutor needs the data to coach), a "speaking confidence growing" indicator that only appears for VAD-on users, and a VAD-lite tier (binary "did sound happen during pause") with lower friction.

The point of Phase 2 is to grow VAD coverage from ~0% to whatever level the methodology pages can drive it to. The architecture beneath it is ready; the question is purely UX-and-trust.

### Phase 3 — Tutor + schools dashboards on Layer 2 state (months)

1. Build the tutor dashboard MVP using Layer 2 state — student list ordered by attention score, individual drill-down to Layer 1 state. Five to seven views; mostly straightforward Vue + Supabase queries.
2. Extend the schools dashboard with the (difficulty, execution) plane visualisation as a class-level chart. Use existing `useAnalyticsData.ts` composable patterns.
3. Surface engine signals — where the adaptation engine wants to do something visible-from-outside (switch courses, drop a track, surface a remedial sub-track), have it write to a `surface_to_human` queue that the relevant dashboard reads.

### Phase 4 — Population layer + CEFR calibration (months–years)

1. Build the population view for the SSi team. Mostly Layer 3 SQL views and a single dashboard surface.
2. Begin native-speaker anchor capture opportunistically.
3. SSi-internal anchors from `total_practice_minutes` are queryable today (the 30/100-hour milestones) — these provide the first calibration signal without needing VAD adoption to mature first.
4. When the corpus is large enough (informally: "at least a thousand learners with at least fifty cycles each, with VAD coverage non-trivial"), begin cluster discovery — this is research work, not engineering.
5. External calibration against formal CEFR scores — opt-in survey, small reward.
6. Surface the "best fit" label, with the discipline of always giving a range and a confidence indicator.

---

## 13. Relationship to existing code

This document is a forward-looking specification; the following components already exist in the repo and are referenced rather than redefined here.

- `packages/core/src/learning/AdaptationEngine.ts` — the existing engine. Continues to do per-session adaptation. Reads Layer 1 state once Layer 1 is persisted; writes back to it.
- `packages/core/src/learning/MetricsTracker.ts` — captures response latency and timing data. The prosody-feature module added in Phase 1 sits alongside it and feeds the same MetricsTracker for session-level rollups.
- `packages/player-vue/src/components/ProsodyFeedback.vue` — existing UI for live prosody feedback to the learner. Should consume the new execution score directly.
- `packages/player-vue/src/composables/useBeltProgress.ts` — already computes belt and seed-completion-count; feeds the difficulty axis directly.
- `packages/player-vue/src/composables/schools/useAnalyticsData.ts` — existing schools analytics composable; extended in Phase 2 to read Layer 2 state.
- `docs/ADAPTATION_ENGINE_SUMMARY.md`, `docs/ADAPTIVE_LEARNING_OVERVIEW.md`, `docs/ADAPTIVE_LEARNING_FEATURES.md` — existing methodology docs for the adaptation engine. This document complements them at the metrics-architecture level.
- `apml/learning/adaptation-engine.apml` — existing APML spec for the engine. May want a new `apml/learning/metrics-architecture.apml` spec as a companion to this document.

---

## Appendix A: Glossary

- **CEFR** — Common European Framework of Reference for Languages; the A1/A2/B1/B2/C1/C2 scale. We do not use CEFR formally; we discover similar clusters from population data and label them retrospectively.
- **DSP** — Digital Signal Processing; in this context, classical (non-learned) algorithms operating on raw audio.
- **DTW** — Dynamic Time Warping; an algorithm for aligning two sequences (e.g., two pitch contours) that may vary in speed but follow the same shape.
- **F0** — Fundamental frequency; the lowest frequency of a periodic waveform. In speech, what we perceive as pitch.
- **Formant** — A concentration of acoustic energy around a particular frequency in the speech wave. The first two formants (F1, F2) largely determine vowel identity.
- **LEGO** — In SSi terminology, a learning unit (a phrase or word). A-type LEGOs are atomic (single words). M-type LEGOs are molecular (multi-word phrases with internal structure).
- **Prosody** — The rhythm, stress, and intonation of speech, as distinct from the phonemic content. The thing this architecture measures.
- **VAD** — Voice Activity Detection; broadly, any technique for analysing voice signal. In this document, used loosely to mean "the prosody-and-timing capture pipeline."

## Appendix B: Why this is novel

Five things are unusual about this architecture, taken together:

1. **It refuses ASR**, where most modern language-learning platforms lean on it heavily. This is a methodological commitment, not a limitation.
2. **It uses a 2D coordinate (difficulty × execution) as the primary representation** of every learner, rather than a single scalar progress number or a battery of separate metrics. This carries information that scalars cannot.
3. **It treats CEFR-like levels as discovered, not imposed.** The platform never asserts a level; it surfaces a similarity-to-population cluster, with explicit uncertainty, calibrated against a small external sample.
4. **It builds on seventeen years of observational ground truth.** The 30-hour and 100-hour milestones are not theoretical — they are population averages SSi has accumulated over a long period of running a working method. Few language-learning systems can match this depth of historical observation, and fewer still can use it as an internal anchor for calibrating fluency estimates without depending on external assessment frameworks.
5. **It measures self-assessment accuracy as a first-class signal.** By treating phase-pill clicks as confidence data and correlating them with execution scores, the system can distinguish overconfident from underconfident learners — diagnoses that require opposite coaching responses. To our knowledge no other language-learning platform exposes this kind of psychological-calibration measurement.

Each of these is defensible alone. Together they describe a measurement system for fluency that scales to long-tail languages, respects the learner's own judgement (via Principle 1), and produces increasingly meaningful estimates as the platform grows — without ever needing language-specific models, transcription, or formal assessment infrastructure.
