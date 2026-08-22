# The VAD was measuring the app, not the learner

*Diagnosis and fix, 2026-08-20. Follows the read-only probe `per-cycle-raw-survival-probe.md`, which found the symptom. This document finds the mechanism, fixes it, and says plainly what the fix costs.*

---

## The finding in one paragraph

The microphone gate was never on a scale where its threshold meant anything. `energy_threshold_db: -45` reads like "quiet", but the number it is compared against is not an acoustic dB — it is a **log of an average of numbers that were already logs**. On that scale, −45 means "very nearly digital silence across the entire spectrum", which ordinary room tone clears, let alone a phone speaker playing the app's own prompt audio 30 cm from the microphone. The timing window opens at **prompt-audio start**, so the mic is live and detecting for the whole cycle while the app plays prompt, voice 1 and voice 2. The first thing to clear that gate owned the entire measurement, permanently, with no way to re-arm. That first thing was almost always the app hearing itself, at 32 ms.

The fix replaces the absolute gate with a **relative** one: measure the playback-plus-room floor on this device, at this volume, in this room, during the first 400 ms of the prompt, and require the learner to clear it by 9 dB. A relative margin is scale-independent by construction, so it does not depend on the broken dB units being fixed.

---

## The evidence, re-measured

Service-role SELECT against live `player_events`, 2026-08-20, restricted to real player-written rows (`env is not null`, which excludes the 4784 seeded ones).

| Measure | Value | What it means |
|---|---|---|
| Real rows | **1433** | 4 identities, 20 sessions — testers, not learners |
| `startedDuringPrompt = true` | **1193 (83.3 %)** | reproduces the probe exactly |
| `responseLatencyMs` p10 / p50 / p90 | **16.6 / 32.5 / 3020 ms** | a 32 ms median is not a human response |
| Latency < 400 ms | **878 (61.3 %)** | inside the new calibration slice — physically impossible as responses |
| `learnerDurationMs` p50 / p90 / max | **14 414 / 20 163 / 25 555 ms** | the median "utterance" lasts **fourteen seconds** |
| Duration > 10 s | **1128 (78.7 %)** | whole-cycle spans: speech that never "ends" |
| Latency ≥ 400 ms **and** duration ≤ 10 s | **207 (14.4 %)** | the most that could plausibly be real |

The median tester "utterance" being fourteen seconds long is the tell that settles it. No one speaks a practice phrase for fourteen seconds. The mic simply never dropped below the gate, because the app kept playing.

---

## Four defects, not one

### 1. The threshold is on a meaningless scale

`getCurrentEnergy()` calls `getByteFrequencyData`, which has **already** mapped each bin's dBFS into 0–255 across `[minDecibels, maxDecibels]` — by default `[−100, −30]`. The code then treats those bytes as *linear amplitude*, takes their RMS, and logs it again. A bin sitting at a genuinely quiet −70 dBFS maps to byte ≈ 109 → normalised 0.43 → "energy" ≈ −7 dB. That is 38 dB above the −45 threshold while representing near-silence.

So no value of `energy_threshold_db` was ever going to separate a learner from playback. Tuning that number is not the fix, and would have looked like the fix while changing nothing. This is why the requested `echoCancellation` flags are a red herring too: even perfect AEC leaves room tone, and room tone clears this gate.

### 2. The onset could never re-arm

`firstSpeechStartAbsolute` was set once and never cleared within a cycle. Three consecutive rAF frames — about **48 ms** — above the gate established the onset for the whole cycle. Nothing the learner subsequently did could be recovered from that row.

`min_speech_duration_ms` was declared in `ContinuousVADConfig`, defaulted to 100, and passed through by `SpeechTimingAnalyzer` — **and never read by any code**. The sustain check it exists to express was simply absent.

### 3. The end was clamped to the cycle, not to the learner

`stopContinuousMonitoring` finalised a still-open utterance at *cycle end*. Combined with playback keeping the mic hot through voice 1 and voice 2, that is exactly the 78.7 %-of-rows, 14-second-median signature.

### 4. A per-call config could not reach the gate

`continuousAnalyzeLoop` read `this.config.energy_threshold_db` and `this.config.min_frames_above`, but `this.continuousConfig.speech_end_debounce_ms`. So a threshold passed into `startContinuousMonitoring(config)` landed in `continuousConfig` and was **silently ignored**. Anyone attempting to tune the gate from the call site would have seen no effect and drawn the wrong conclusion. Independent defect, confirmed, fixed.

---

## The fix

Four changes in `packages/core/src/audio/VoiceActivityDetector.ts`, all confined to continuous mode; the legacy PAUSE-only `analyzeLoop` is untouched.

**Adaptive floor.** The first `calibration_window_ms` (400 ms, or until `PROMPT_END` if the prompt is shorter) of the cycle is a calibration slice. No onset may be established inside it. Its **median** energy becomes the measured floor; the gate is `max(absolute threshold, floor + 9 dB)`.

Median, not mean or max, and this is the load-bearing choice: playback runs *continuously* through the prompt, so the median lands on it. A learner's burst is short relative to the slice, so it cannot drag the floor up over their own speech. If fewer than `calibration_min_samples` (6) arrive — rAF throttled, tab backgrounded — the measured floor is discarded and the absolute threshold governs, rather than trusting a floor built on two frames of noise.

**Sustained onset, re-armable.** A burst above the floor becomes a *candidate*; it is promoted to the real onset only after it sustains for `min_speech_duration_ms` (100 ms) — finally reading the config field that already existed. On promotion the burst's **start** is credited, not the moment it qualified, so the sustain test does not inflate latency. A burst that dies early is discarded and the next one gets a fresh chance.

**Onset window closes at VOICE_1.** A *new* utterance cannot begin once the app is playing target audio: the invitation to speak has passed, and a latency measured against it would be meaningless anyway. Speech already in progress is unaffected — which is precisely what keeps `still_speaking_at_voice1` measurable.

**End clamped to VOICE_1 + 1500 ms.** A still-open utterance is finalised at `min(cycle end, voice1 + grace)` instead of cycle end.

One bug found while writing the tests and fixed with them: an unsustained pre-onset burst could set `confirmedSpeechEnd` via the debounce timer *before* the real speech started, surviving to the result as a `speech_end` earlier than `speech_start`. Promotion of a real onset now clears any end recorded before it.

### Two properties deliberately preserved

**`startedDuringPrompt` stays honest, not suppressed.** A learner who genuinely speaks over the prompt is a confident learner jumping in early — real, interesting, worth capturing. Their voice *adds* to playback, so the mixture clears the 9 dB margin and the early start is recorded with a correct latency. There is a pinned test for exactly this. The bug was playback being mistaken for a learner, not early starts being recorded, and the fix does not touch the latter.

**Raw marks over derived fields.** Nothing here changes the meaning of `responseLatencyMs`.

---

## What the fix costs — the corpus narrowing, stated plainly

**This fix will reduce the number of `cycle_prosody` rows, on some devices sharply, and that number could be large.**

On the tester devices as configured, at most **207 of the 1433 existing rows (14.4 %)** are even plausibly real by latency and duration. The other ~86 % are the app hearing itself. Under the new gating those cycles emit **no row at all**, because `speech_detected` is false and the emission is guarded on it.

So on a device with this failure mode, expect **up to ~85 % fewer rows**. Every one of those rows was garbage that would have poisoned any rolling average or z-score computed over it, so this is a corpus getting *smaller and true* rather than large and false. But it is a real narrowing and nobody should be surprised by it.

It also **worsens an existing bias the probe already named**: silence is missing from the denominator. A learner who says nothing generates no row, so the hardest cycles — the ones where the learner could not produce the phrase — are exactly the ones absent from the series. This fix removes more rows, so the surviving series is conditioned harder on the learner having spoken. Logging silent cycles (probe fix #3, not done here) is the thing that closes it, and it matters more now than it did yesterday.

Two safety valves exist if the narrowing proves too aggressive in the field: `adaptive_margin_db` (9) can come down, and `adaptive_floor_enabled: false` restores the previous behaviour exactly. Both are per-call config on `startContinuousMonitoring` — which, since defect 4 is fixed, now actually works.

---

## Verification, and its limit

**Eight acceptance tests** in `packages/core/src/audio/VoiceActivityDetector.playbackRejection.test.ts` drive synthetic energy timelines through a full 17.5-second cycle on a virtual clock, with rAF and the debounce timer sharing it. They assert:

- the live failure signature (energy above the old threshold from 30 ms, never dropping) now yields **no detection at all** rather than a 32 ms onset;
- a genuine utterance at 3000 ms still yields a latency of 3000 ms;
- a learner speaking **over the prompt** at 900 ms is still detected, with `startedDuringPrompt` true;
- a never-ending utterance is clamped, while `stillSpeakingAtVoice1` survives;
- a 48 ms transient is discarded and the real utterance 1.5 s later owns the measurement;
- an onset after VOICE_1 is ignored;
- a per-call threshold now reaches the gate (defect 4);
- the starved-calibration fallback reproduces the **old** behaviour — this one is the suite's differential control, so the seven passing tests above cannot pass vacuously.

**The limit, stated honestly: I could not verify live capture behaviour.** This is a headless box with no microphone. Every number above about *behaviour* comes from stored rows and from synthetic timelines, not from a real session with a real voice. The synthetic model assumes speech sits above playback by more than 9 dB at the microphone — true for a phone held normally, and the reason the margin is configurable rather than baked in. **A single real session on a phone is the one thing that would confirm it, and it takes a minute.**

### The one-minute check

1. Open **https://ssi-learning-app-git-dev-zenjin.vercel.app** on a phone (not desktop — the whole point is a speaker and a mic in the same room).
2. VAD capture is **consent-gated and defaults OFF**. Turn it on in the learner settings — the adaptation/voice-capture consent toggle. Without it there is no VAD, no timing window and no row.
3. Play a handful of speaking cycles. Answer some normally, deliberately stay silent on one or two, and jump in early over the prompt on one.
4. What you should see: the cycles you answered produce sane latencies (hundreds of ms to a couple of seconds, not 32 ms) and utterance durations of a second or two, not fourteen. The one where you jumped in early should still come through as an early start. The silent ones produce nothing — that is the known gap, not a new one.

---

## Not done here — the probe's other six, listed only

Out of scope for this job, unchanged, and still worth doing: a raw per-cycle read endpoint; logging silent cycles; filtering demo rows out of `api/admin/vad-prosody.ts`; aligning the demo seeder's contradictory `responseLatencyMs` definition; the always-null `seedId`; and the colliding `cycleId`.

---

*Live figures are as of 2026-08-20, service-role SELECT only — no writes, no migrations, no RLS changes.*
