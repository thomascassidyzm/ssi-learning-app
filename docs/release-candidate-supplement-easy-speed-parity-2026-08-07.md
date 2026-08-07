# Release candidate — supplement: the Easy speed fix is now IN

**7 August 2026, late.** Supplements the earlier proof document. That document described the candidate *before* this change and flagged the Easy-versus-Fast speed asymmetry as a thing to listen to. **It is now fixed and in the candidate, and re-verified against the candidate's own deployed build — not against dev.**

Nothing has been merged to main. Nothing has been deployed to production. Those remain separate decisions.

---

## What changed in the candidate

One fix, lifted on its own. Dev was **not** promoted wholesale — the other work on dev tonight has not been reviewed for this release and is not in the candidate.

**Easy no longer cancels the speed on-ramp.** Easy owned a private speed override that played the target language flat at full speed while Fast kept the belt ramp. So a beginner who chose **Easy** heard the new language *faster* than a beginner who chose **Fast** — backwards from what the names promise, and worst at white belt where it matters most. The override is deleted; both modes now read the one speed the round-builder bakes onto every cycle.

Easy's longer pauses, its extra repetitions, its beat of silence after the second voice and its shorter phrases are all untouched.

Three commits taken: the fix, the real-browser probe that proves it, and the writeup. Nine files, and every one of them belongs to this fix — nothing unrelated came along.

**One companion commit was deliberately left behind.** It is a test that reconciles this fix with the *other* listening ruling from tonight — the one holding Easy at 0.8× listening for as long as someone stays on Easy. That ruling is held on dev, so the option it tests does not exist in the candidate. Taking the test without the code it tests would have been theatre.

---

## The proof — driven against staging's own build, after the change deployed

The earlier proof ran against dev. That proved the fix works; it did not prove it survived the lift onto the candidate. So this is a fresh run: a real Chromium, on `staging.saysomethingin.app`, after the new build went live, recording the speed the browser was actually asked to play every single clip at — in each mode, in a full session including a listening lap. French, fresh learner, white belt. **Two minutes of real play per mode; 138 clips measured.**

| | target voice | pause before the learner speaks | listening / pod clips |
|---|---|---|---|
| **Fast** | 0.72× | 2401 ms | 0.72× |
| **Easy** | 0.72× | 3841 ms | 0.72× |

**Twelve checks, twelve passes.**

- Easy and Fast use the *identical* set of playback rates. Not similar — identical.
- Easy is never faster than Fast at white belt. This was the bug; it is gone.
- The ramp is genuinely on in both modes — the target voice plays below full speed, not flat.
- **Easy's longer pause survived**: 3841 ms against Fast's 2401 ms, 60% longer, exactly as before the fix.
- Listening and pod clips still ramp in both modes, and agree with each other at white belt.
- No page errors in either mode.

These are the same numbers the dev run produced — 0.72×, 2401 ms, 3841 ms — which is the cleanest possible evidence that the lift changed nothing and dropped nothing.

All the usual gates were run on the merged candidate before it went anywhere: type checking clean on both the app and the server, **1,834 app tests and 1,139 server tests green**, linting clean.

---

## What is IN tonight, and what waits

Checked by comparing actual content against the candidate, not by reading commit messages or assuming.

**IN — Easy and Fast replace Turbo.** The mode change learners see was already in the candidate before tonight: the resting screen offers Easy and Fast, Turbo is gone from the product, and the Turbo points multiplier is gone with it. Now joined by tonight's fix, so the two modes finally share one speed on-ramp.

**OUT — the Turbo clean-up.** A later pass sweeps the last of Turbo's dead code out of the app and its leftover rows out of the database. None of it is visible to a learner — Turbo is already gone from the product; this is tidying behind it. **Not in the candidate.** No reason it needed to be.

**OUT — the Easy phrase syllable ceiling.** The work that makes Easy skip any phrase over twenty syllables outright, on top of the existing "half the course's longest" rule. It is a real change to what an Easy learner is asked to say, it is new tonight, and it is **not in the candidate.** It waits for the next release.

**OUT — the Easy listening hold (0.8× for as long as you stay on Easy).** Also new tonight, also **not in the candidate**. What *is* in the candidate is the underlying ramp itself — a beginner already hears listening at 0.8× at white belt in this release, climbing with the belt from there. The held-back piece is only the refinement that stops it climbing while you stay on Easy.

---

## Explicit gaps

**Nobody has listened to this by ear.** Everything above is machine-measured — real clips, real playback rates, real gaps, on the real deployment. It proves the numbers are right. It does not tell you whether 0.72× at white belt *sounds* right, and that was always the check only you can make. This fix makes Easy slower than it was, never faster, so the risk direction is the safe one.

**One course does not ramp at all, and did not before this fix either.** The Spanish course plays every clip at full speed in both modes — that is the deliberate exemption for courses whose voices were recorded slow to begin with, so they are not slowed twice. Both modes agree there, so the fix holds; but it means "0.72× at white belt" is a French observation, not a universal one.

**Desktop Chrome only.** No real iPhone, no Safari, and this is a phone-first product. iOS audio behaviour is untested here.

**Guest path only.** All sessions ran signed-out inside the free preview window.

**Offline was not tested.** No airplane mode, no bulk download, no playback from the phone's stored audio.

---

## What has not happened

The candidate has not been merged to production, and nothing has been deployed to real learners. Both of those remain your call, separately.
