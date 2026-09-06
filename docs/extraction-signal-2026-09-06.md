# What a signal of extraction would look like

*Position piece, 2026-09-06. Read against the live player code and the live course and prosody data on that date. Sources are named inline; every number is from a query run that day. Where I am guessing I say so in the text, and the guesses are collected in §7.*

---

## 1. The question, in the method's own terms

The method works by contrast. The learner hears *quiero* alone, then *quiero aprender*, then *estoy intentando hablar*, and is never told what an infinitive is. The bet is that the distinction gets **extracted** from the contrast and becomes a **generator**: a thing that can produce forms the learner has never heard as whole strings. Producibility is the test.

The app today knows what it played and, for a minority of learners, when a voice started and stopped. It does not know whether extraction happened. Recall-shaped answers (a quiz, a self-report, a mastery model over exposures) are ruled out because they measure whether a string came back, and a lookup table returns strings perfectly well.

So the question is: **where does a generator behave differently from a lookup table, in ways the app can see without hearing the words?**

## 2. The position

**Extraction is visible as the learner's performance being predicted by the units, not by the strings.**

A learner who has memorised phrase-to-phrase gets faster on a phrase in proportion to how often they have met *that phrase*. A learner who has extracted the distinction gets faster on a phrase in proportion to how often they have met *its parts*, regardless of whether this particular assembly has ever been heard. The course already manufactures the test material: every USE phrase and every spaced review is a recombination of known LEGOs, and a large share of them are recombinations the learner has never heard as a string. The app knows which. That is the whole lever.

Everything below is a way of reading that one divergence off data the app has or could cheaply have. Nothing below asks the learner anything, and nothing below scores a string coming back.

## 3. What the app actually sees today (verified 2026-09-06)

Per speaking cycle, for learners who have consented to the mic, the player writes one `cycle_prosody` row to `player_events` (`LearningPlayer.vue`, the block after `endTimingCycle`). The row carries: LEGO id, cycle type (debut, build, use, spaced_rep), the voice-1 audio id (which identifies the exact phrase through `course_practice_phrases.target1_audio_id`), speech onset and offset relative to prompt start, prompt-end and voice-1-start marks, learner utterance duration and its delta from the model duration, a started-during-prompt flag, a still-speaking-at-voice-1 flag, and a peak-normalised energy contour on a 20 ms grid with peak count, peak-to-mean ratio and mean peak width.

Per cycle for everyone, mic or not: `audio_play` events (cycle id, LEGO id, role), and the behavioural events `phase_skip` (with direction and elapsed time in phase), `tap_skip`, `lego_skip`, `tap_pause` and `tap_play`. `useBehaviouralEvidence.ts` already maps replays and back-skips to a struggle reading.

Per LEGO, persisted: the adaptation engine's rolling normalised latency ring and mastery state (`learner_lego_metrics`), and the evidence series that feeds the curvature engine (`packages/core/src/learning/curvature.ts`), which reads the second derivative of a unit's difficulty series.

Volume: 8,145 prosody rows in total across 11 learner identities. One guest on the Polish course accounts for 1,654 of the most recent 2,000. One signed-in Spanish learner has 673 rows across 8 sessions. Everything else is single or double digits.

**The state of that corpus, honestly.** For the Spanish learner the median utterance runs about 7 seconds longer than the model. For the Polish guest it runs 11 to 12 seconds longer, and the median onset on repeat exposures is roughly a second *before the English prompt has finished*. The still-speaking-at-voice-1 flag is true on 98 percent and 89 percent of rows respectively. The code already knows about this failure (the comment about "whole-cycle ~17.5 s utterances in the live corpus" and the post-voice-1 clamp in `VoiceActivityDetector.stopContinuousMonitoring`). The reading is that on most rows the mic is picking up the app's own prompt and target audio through the speaker, and the utterance end is the clamp, not the learner. A minority of rows look like real speech: onset 300 to 1,200 ms after prompt end, duration within a second of the model, a few peaks. Those are the rows any of this can be built on, and there is no flag today that separates them from the rest.

So the first deliverable of any extraction work is not a model. It is a **capture-validity gate**: a row counts only if its duration is within some band of the model's, its onset is after prompt end, and its offset is before voice-1 start. Until that gate exists, the corpus measures the room.

## 4. Four signatures, ranked by how much I would trust them

Each is defined on material the learner has never heard as a string, which is what makes it a test of a generator rather than of a store.

### S1. The novelty gap closing (my main position)

For every speaking cycle the app can label, read-side and retroactively, two things it does not label today:

- **novelty**: has this learner met this exact phrase before (count of prior `cycle_prosody` or `audio_play` rows with the same voice-1 audio id), and
- **assembly count**: how many LEGO chunks the phrase tiles into (`course_practice_phrases.decomposition` length).

Then, per LEGO, keep two latency series instead of one: onset latency on phrases containing this LEGO that the learner has heard before, and onset latency on phrases containing this LEGO that they are meeting for the first time. Both normalised by assembly count, so a five-chunk sentence is not penalised against a two-chunk one.

- A **lookup learner** shows the seen series falling and the unseen series flat. Each new assembly is a fresh miss. The gap between the two series stays wide or widens.
- A **generator** shows the two series converging. First-exposure recombinations of a LEGO cost roughly what a seen one costs, plus a small per-chunk assembly cost.

The signal of extraction is **the gap closing**, not either series on its own. A learner who is fast on everything might be a fast memoriser; a learner whose unseen-latency tracks their seen-latency has a generator, because nothing else could make an unheard string cheap.

This is the signature I would bet on because it needs no new capture, only a read-side join the data already supports, and because the course guarantees a steady supply of first-exposure recombinations for every LEGO through its USE and review rounds. The Spanish learner's 180 usable rows already split as 142 first exposures to 34 second exposures. The numbers are too few and too polluted to read, but the shape of the experiment is already in the table.

Mic-free version: `phase_skip` forward during PAUSE carries `elapsed_in_phase_ms`, which is the learner's own declaration of "done" and therefore a self-timed latency with no microphone. Only learners who tap produce it, and it is coarse, but the same seen-versus-unseen split applies to it unchanged.

### S2. The sign of the cross-effect when the second member of a contrast arrives

A contrast pair is two LEGOs that differ in the feature the learner is meant to extract. In the live Spanish course, *hablar* (S0001L02) against *hablando* (S0005L03); *quiero* (S0001L01) against *voy a* (S0005L02) and *estoy intentando* (S0002L02), which all take the same slot; and for construction-features, the contrastive-twin debut the methodology prescribes.

When the second member lands, the first member's series does one of three things:

- **Goes worse.** Retroactive interference: the two forms are stored as undifferentiated blobs and the new one is now colliding with the old one. The distinction has not been extracted. Latency on *hablar* rises for a few cycles right after *hablando* debuts.
- **Does nothing.** Two independent lookups, no relationship noticed either way.
- **Goes better.** The contrast sharpened both. This is what extraction predicts: the second member gives the first its edges.

The curvature engine already computes exactly the quantity needed, the second derivative of a unit's difficulty series at its trailing edge. The proposal is to evaluate it on the **first member at the moment the second member debuts**, and to read the sign. This is a pair-level use of a unit-level tool, and it costs a lookup table of which LEGOs form contrast pairs, which the course structure already implies (same slot, same seed family, or declared twins).

I trust this less than S1 because the effect is small and the window is short, and because a learner might be worse on *hablar* after *hablando* for reasons of fatigue that have nothing to do with the pair. It needs the pair effect to be compared against the learner's own baseline on unrelated LEGOs in the same window.

### S3. Left-to-right anticipation on first-exposure phrases

`started_during_prompt` is true when the learner began speaking before the English prompt finished. On a phrase they have heard before, that is recall of a string and says nothing. On a phrase they are meeting for the first time it can only mean one thing: they mapped the first chunk of the English while the rest was still being spoken and started producing the target incrementally. A lookup table cannot begin a string it does not hold. Incremental, chunk-by-chunk production is the operating signature of a generator.

The flag exists and is written on every row. Its problem is the one in §3: on the Polish guest's data it is true in a way that can only be speaker bleed. Once the capture gate exists this becomes a clean binary per cycle, and its **rate on novel phrases per LEGO** is a second reading of the same thing S1 reads with latency.

### S4. The pre-model restart (self-correction with an internal criterion)

The envelope contour can show a restart: a short burst, a gap, then a full-length utterance whose duration matches the model. A learner who does that has rejected their own first attempt **before hearing the model**. Rejecting your own output requires a criterion, and the criterion is the distinction. A learner who has not extracted it has nothing to reject with; whatever came out stays out.

The timing boundary matters absolutely. A restart before `voice1_start_ms` is an internal criterion. Anything after voice-1 is echo of the model and is not evidence of anything, and it is also physically unreadable today because the model is playing through the same speaker the mic hears.

I am guessing most here. A 20 ms energy contour with no alignment to the words cannot tell a restart from a cough or a two-word phrase with a natural gap. The shape test (short segment, gap, long segment approximating the model duration) is plausible but untested, and the rate of genuine pre-model restarts in real data is unknown. I would build S1 through S3 first and only look for S4 in rows that have already passed the capture gate, as a bonus rather than a load-bearing signal.

## 5. What I looked at and rejected

**Hesitation position inside the utterance.** The idea that a generator hesitates *at the boundary of the new element* while a memoriser hesitates *at the start* is attractive and probably true. The contour cannot deliver it. Locating the longest inter-peak gap against chunk boundaries needs an alignment between the learner's audio and the model's chunk timings that does not exist and would be a speech-recognition-shaped thing to build. Parked.

**Error patterns across the pair.** The brief asks about them and the honest answer is that the app cannot see an error. The only trace is duration: if the learner produced the wrong member of the pair, their duration delta would track the wrong model. That is far too weak to use on its own, and I would not report it.

**Mastery state as it stands.** `learner_lego_metrics.mastery_state` is a rolling latency band per LEGO. It is level, not divergence, and it counts seen and unseen phrases together. It answers "is this LEGO fast" and cannot in principle answer "is this LEGO generated". It is not wrong, it is orthogonal.

## 6. Why this passes the method's own test

Each signature is a statement about **producibility on material the learner has not stored**. S1 measures cost on unheard strings against heard ones. S2 measures whether a new form sharpens or collides with its neighbour. S3 measures whether production starts before the string is complete. S4 measures whether the learner can reject their own output unaided. None of them can be scored by a lookup table, and none of them require the learner to be told they are being measured. The learner just keeps speaking; the course keeps handing them recombinations it has never played; and the question "did it happen" is answered by whether those recombinations got cheap.

## 7. Where I am guessing

- **That the minority of clean prosody rows is large enough to use.** I read roughly a quarter of the Spanish learner's rows as real speech by eye. The capture gate might leave far fewer. If it does, S1 falls back to the `phase_skip` proxy and to bigger populations.
- **That assembly count is the right normaliser.** Chunk count from `decomposition` is a proxy for cognitive assembly cost. Syllable count or model duration might normalise better. The choice affects whether the gap "closes" or merely narrows.
- **That the S2 window is a few cycles.** Interference could act over a session or two rather than the next few exposures; the curvature window default of seven samples may be wrong for this.
- **That `started_during_prompt` can be made trustworthy.** It depends on the VAD's prompt-audio rejection actually rejecting the app's own speaker output on real phones. The Polish data says it currently does not.
- **The restart shape (S4) entirely.**

## 8. What it would take, and my recommendation

Nothing new gets captured; the first pass is read-side over existing rows. In order:

1. **Capture-validity gate** on `cycle_prosody`: duration within a band of the model, onset after prompt end, offset before voice-1 start. A view or a read-side filter, no writes. Without it every downstream number is a number about the room.
2. **Novelty and assembly count** labelled read-side by joining voice-1 audio id to `course_practice_phrases` and counting the learner's prior rows on that audio id. Retroactive over all 8,145 rows.
3. **S1 as a per-LEGO pair of series** (seen, unseen) and the gap between them. This is the extraction signal. It needs no new consumer to be built to be validated; it is validated by whether the gap behaves differently across learners and across LEGOs in the way §4 predicts.
4. **S2 and S3** as second readings once S1 has shown the gate leaves enough rows.

Better, simpler, cheaper: better because it measures the thing the method actually claims rather than recall; simpler because it is one join and one subtraction on data already persisted, reusing the curvature engine rather than adding a model; cheaper because there is no new capture, no new table, no new UI, and the first result is a query. The floor I hit is physical and named: the microphone hears the speaker. Until the capture gate exists, no signal of extraction can be read from the live corpus, and I would not want anyone to build a dashboard on it before that gate is in.
