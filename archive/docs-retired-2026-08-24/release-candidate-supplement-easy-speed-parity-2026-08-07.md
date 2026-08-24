# Release candidate — supplement: what the candidate now contains

**7 August 2026, late.** Supplements the earlier proof document, which described the candidate before tonight's two lifts. **Two pieces of Easy-mode work are now in, and both have been verified against the candidate's own deployed build — not against dev.**

Nothing has been merged to main. Nothing has been deployed to production. Those remain separate decisions, yours.

---

## What is in the candidate that was not in the earlier proof

Two fixes, each lifted on its own. Dev was **not** promoted wholesale — the rest of tonight's dev work has not been reviewed for this release and is not in the candidate.

### 1. Easy no longer cancels the speed on-ramp

Easy owned a private speed override that played the target language flat at full speed while Fast kept the belt ramp. So a beginner who chose **Easy** heard the new language *faster* than a beginner who chose **Fast** — backwards from what the names promise, and worst at white belt where it matters most. The override is deleted; both modes now read the one speed the round-builder bakes onto every cycle.

One companion commit was deliberately left behind: a test reconciling this fix with the *other* listening ruling from tonight, which is held on dev. Taking a test without the code it tests would have been theatre.

### 2. Easy skips phrases above twenty syllables

Fast is uncapped. Easy now drops any phrase over twenty target syllables, on top of the existing character cap — a phrase goes if it exceeds either. The number was measured, not guessed: it removes about the same share of phrases as the character cap already did.

Easy's longer pauses, extra repetitions and beat of silence after the second voice are untouched by both changes.

---

## The proof — driven against staging's own build, after both changes deployed

**Twenty-two checks across two probes, twenty-two passes.** Both run in a real Chromium against `staging.saysomethingin.app`, on the build that is live right now.

### Speed and pauses — French, fresh learner, white belt, two minutes per mode

| | target voice | pause before the learner speaks | listening / pod clips |
|---|---|---|---|
| **Fast** | 0.72× | 2401 ms | 0.72× |
| **Easy** | 0.72× | 3841 ms | 0.72× |

Easy and Fast use an *identical* set of playback rates — not similar, identical. Easy is never faster than Fast. **Easy's longer pause survived both changes**: 3841 ms against Fast's 2401 ms, 60% longer, unchanged from before either fix. Listening and pod clips still ramp in both modes and agree at white belt. No page errors.

### The syllable cap — Spanish, the whole generated course

Reading the phrases off the screen during a session **cannot** prove this, and that is worth stating rather than discovering twice. A round shows about seven phrases, chosen shortest-first, and a beginner starts where every phrase is short: four minutes of real play in each mode surfaced a maximum of ten syllables in *both*, so the cap had nothing to bite on. The deep link that would jump deeper into a course does not work for a signed-out learner, so that route is closed too.

So the probe reads what the cap actually acts on: **the entire generated course script each mode writes to its own storage after boot** — 3,924 rounds, every phrase, not the handful a short session reaches. That is the real output of the deployed build, per mode, and it is what the player plays from.

| Spanish, whole course | Fast | Easy |
|---|---:|---:|
| distinct phrases | 14,681 | 13,119 |
| phrases over twenty syllables | 2,147 | 581 |
| share over the cap | 14.6% | 4.4% |
| rounds | 3,924 | 3,924 |

**Easy removes 73% of the over-cap phrases. Fast keeps every one of them.** The course is not gutted: Easy keeps all 3,924 rounds.

**On the 581 that remain in Easy — this is the design, not a miss.** The methodology floors outrank the cap on purpose: every LEGO must keep at least four build phrases and five use phrases, so when the cap would starve one, the shortest available are kept even if they are still long. I checked all 581 against the live content database: **553 are exactly that floor doing its job**, and 13 are not practice phrases at all. That leaves **15 phrases in 13,119 — one in nine hundred — that the floor does not explain.** I could not account for those tonight; they are most likely arriving through the spaced-repetition path rather than the phrase-selection path. Flagging it, not fixing it, and it is far too small to hold a release.

---

## Turbo — corrected framing

**Turbo was already gone for learners before tonight.** The button had already been removed and course progression already replaced it. Nothing about Turbo changes for any learner in this release, and the earlier document overstated this — it read as though learners lose a feature tonight. They do not.

**No part of the Turbo clean-up is in the candidate.** That work — sweeping dead code out of the app and leftover rows out of the database — sits on its own branch. It is invisible to learners either way.

**Nobody is on Turbo, and nobody ever was.** I checked the live database directly rather than take it on report: zero learner records have Turbo switched on, zero learner records still carry the setting at all, and the old Turbo configuration row is gone. That clean-up was applied to the live database earlier today, independently of any release.

**One residual, verified first-hand and stated plainly: the database still mints the dead setting onto every new learner.** The column default was never updated — I read it live tonight and it still contains the Turbo key. So every learner created from now on is born carrying a dead setting again, and the sweep quietly undoes itself one learner at a time. It is harmless — the key does nothing and no code reads it — but it is real, **this release does not fix it**, and it needs a database change applied by hand by someone with direct access.

---

## Known follow-ups — named, not built

**The syllable cap is absolute, and one number does not fit every course.** Twenty bites hard on Spanish and is nearly inert on French, because the two languages' phrase lengths genuinely differ. A course-relative cap would self-adjust. That question is **open and deliberately not for tonight** — the cap stays at twenty. It is a database value, so retuning by ear is an edit, not a deploy.

**The Turbo database default**, above — a hand-applied change, not part of any release.

**Fifteen over-cap phrases in Easy** that the methodology floor does not explain, described above.

---

## What is in tonight, and what waits

Checked by comparing actual content against the candidate, not by reading commit messages.

- **IN** — Easy and Fast as the two modes. Already in the candidate before tonight.
- **IN** — Easy and Fast share one speed on-ramp.
- **IN** — Easy skips phrases above twenty syllables.
- **OUT** — the Turbo clean-up, code and database. Invisible to learners.
- **OUT** — the Easy listening hold. The ramp underneath it *is* in: a beginner already hears listening at 0.8× at white belt in this release, climbing with the belt. Only the "stop climbing while on Easy" refinement waits.

---

## Explicit gaps

**Nobody has listened to this by ear.** Everything above is machine-measured on the real deployment. It proves the numbers are right. It cannot tell you whether 0.72× at white belt *sounds* right, or whether Easy's shorter phrases feel better — and those are the checks only you can make. Both changes move Easy in the gentler direction, never the harsher one.

**The cap was proven at course level, not by hearing a long phrase get skipped in a session.** The reason is above and it is a real limitation of what a session can show.

**One course does not ramp at all**, in either mode, and did not before these fixes: the Spanish course plays every clip at full speed. That is the deliberate exemption for voices recorded slow to begin with. So "0.72× at white belt" is a French observation, not a universal one.

**Desktop Chrome only.** No real iPhone, no Safari, and this is a phone-first product.

**Guest path only**, signed out, inside the free preview window.

**Offline was not tested.** No airplane mode, no bulk download, no playback from stored audio.

---

## What has not happened

The candidate has not been merged to production, and nothing has been deployed to real learners. Both remain your call, separately.
