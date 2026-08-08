# Easy / Fast as one script — the rebase, what it costs, and what needs your call

**Branch:** `fix/easy-fast-play-time-rules-rebase-2026-08-08` · pushed, **not merged**, not deployed
**Date:** 2026-08-08

---

## The short version

The work you wanted rebased is back on a branch off the current dev tip, with the two
correctness defects it carried now fixed and covered by tests. It does exactly what you
asked for: **one script, two sets of play-time rules, toggle with impunity.**

Three things need you, and only one of them is really a question:

1. **Easy now skips long review phrases outright instead of choosing a shorter one.**
   On Spanish that is **28% of all use phrases**, course-wide, forever. That is the real
   decision on this page.
2. Two smaller Easy levers went dead in the same move — the "halve the longest phrase"
   cap, and the round-100 cutoff after which the length rule used to come off.
3. Nothing else. Fast is provably untouched.

---

## Did it rebase cleanly?

**There was never a conflict to resolve.** `origin/dev` is still sitting at the revert
(`99d16118`) with nothing landed since, and the merge that got reverted (`d0b2b5ed`) had
*already* merged the easy/fast work on top of the cold-start commit (`6ab70547`). So the
restoration is that merge's exact tree, reapplied.

**No rationale for the revert exists anywhere.** Not in the commit message, not in `docs/`,
not anywhere in the estate. The reflog shows it was made locally in the cold-start agent's
own clone within minutes of it pulling dev — consistent with someone wanting a clean
baseline to measure against, not with a discovered fault. Recorded here as an honest gap:
I could not find out why.

**And it does not collide with the cold-start work still in flight.** That agent's
uncommitted follow-up (the `warmFirstClip` extraction and the first-clip gating of the
background burst) applies cleanly on top of this branch — checked with `git apply --check`
against their live working diff, both files clean.

---

## What I verified

### Fast is provably unchanged — from the live config rows, not from a code comment

Read live from `algorithm_config`:

| | `scriptShape` | `maxPhraseLengthFraction` | `phraseRepeatCount` | `reviewMaxKnownSyllables` |
|---|---|---|---|---|
| `fast_mode` | `{}` | `1` | `1` | `0` |
| `easy_mode` | `{}` | `0.5` | `2` | `15` |

On dev, Fast passed `resolveScriptShape(global, {})`, which is `{...global}` — byte-identical
to the global `script_shape` row the new code passes. Every other lever Fast passed was
already off. **A learner who never toggles gets exactly today's script.**

### The engine gates

`typecheck` · `1955 tests` (up 5 — the new law tests) · `lint` **0 errors, 151 warnings —
the identical count to dev**, so this adds none · `typecheck:api` · `1148 API tests` ·
production build with the service worker.

### Two correctness defects found, reproduced, fixed

Both were in the restored work, not introduced by the rebase.

**1. The never-three-in-a-row law had quietly stopped holding.** Moving the doubling out of
the generator took it out from under the A-64 cap — and that ordering *was* the guarantee.
The repeat pass used to run immediately before `capConsecutiveRepeats`, so the cap saw the
doubles and clamped them. Now the cap only sees the undoubled script, and its own allowance
is a **pair**. A legal pair, doubled independently at each position, is **four hearings of
one prompt**. Reproduced against a round the cap passes through untouched. The
instant-playback path — the live default — has no duplicate-collapse pass at all, so a
duplicated phrase row in a basket arrives shaped exactly like that.

The APML had talked itself out of this: it said the combination was ruled out "because the
repeat clamps at 2". Clamping the repeat at 2 does not stop 2 × 2. That page is corrected.

**2. Three bookkeeping faults around the repeat count**, each with a failing test written
first:

- the count was anchored on the **array index**. `appendRounds`, `addRounds` and
  `replaceQueueFromCurrent` all splice rounds in behind the playing one and shift the index
  — routine work on the infinite-play expansion and the full-script handoff — so a
  half-spent count restarted and the learner heard a third rendition. Now anchored on the
  round *number*, which does not move.
- `stop()` reset the cursor without clearing the count, so a session ending mid-double ate
  the first repeat of the next one.
- the engine trusted whatever `getCyclePlayCount` returned. A floor that trusts its caller
  is not a floor; it clamps for itself now.

The law now lives at the cycle boundary, in renditions rather than script items: a run
counter over prompt identity, a one-position lookahead so a pair is never doubled into
three, and the ceiling applied to the override's own return value. Totals are preserved — a
suppressed repeat is a hearing the pair already provides, not a lost one.

---

## What it costs — the part that needs your call

Easy's script genuinely changes. That is inherent to what you asked for (mode can't be baked
into a cached script and also switch live), but three live DB values stop being read, and
one of them matters.

### The one that matters: long review phrases are now skipped, not swapped

The 15-syllable rule used to be a **pull preference with a starvation guard**: when choosing
a use phrase for a review or consolidate slot, prefer one at or under 15 known syllables, and
if a LEGO's basket held nothing short enough, give it the **shortest phrase anyway**. The
LEGO was always reviewed.

As a **play-time skip** there is no guard. A cycle over the limit is passed over, and its
slot yields nothing.

Measured against the live phrase tables, counting the known side with the app's own syllable
counter:

| Course | LEGOs with USE phrases | LEGOs that lose review entirely | Use phrases over 15 syllables |
|---|---:|---:|---:|
| spa_for_eng | 1,317 | 47 (3.6%) | **2,828 / 10,072 (28.1%)** |
| deu_for_eng | 1,368 | 73 (5.3%) | **1,251 / 8,566 (14.6%)** |
| fra_for_eng | 1,400 | 6 (0.4%) | 240 / 9,008 (2.7%) |
| cym_s_for_eng | 276 | 4 (1.4%) | 45 / 1,360 (3.3%) |
| cym_n_for_eng | 251 | 2 (0.8%) | 56 / 1,364 (4.1%) |

Whole LEGOs going dark is rare — under 5% everywhere. The number to look at is the right-hand
column: **an Easy learner on Spanish now has more than a quarter of their review and use
cycles silently passed over**, German a seventh, and it never lifts. Welsh and French are
genuinely negligible on both axes.

**Three ways to go, my recommendation first:**

- **(a) Put the starvation guard back at play time** — if skipping would leave a LEGO's
  review slot empty, play it anyway. Keeps your ruling ("the longest ones are skipped"),
  keeps the toggle instant, and stops a quarter of Spanish review disappearing. Small,
  contained change.
- **(b) Ship as is.** Defensible if you meant the skip literally and unconditionally. It is
  a real pedagogical change to Easy on Spanish and German, not a rounding error.
- **(c) Retune the threshold per course** from the DB row — 15 is a first-pass guess and
  Spanish English-side prompts are evidently longer than French ones.

I would do (a). It is the only one where nothing about Easy gets quietly worse.

### The two that are just bookkeeping

- **`maxPhraseLengthFraction: 0.5`** — Aran's "halve the longest possible phrase". A character
  cap on the phrase pool is generation-time by nature, so it could not survive a mode that
  switches live. Easy learners will now meet the long phrases in build and debut rounds that
  the cap used to hide. Reversible only by a different mechanism, not by re-enabling the row.
- **`reviewSyllableFilterMaxRound: 100`** — the length rule used to come off after round 100,
  on your reasoning that "once you get to 100 and 101, all these space repetitions is complete
  nonsense". The play-time skip has no cutoff and runs course-wide forever.

Both rows are still in the DB and are now silently ignored. Nothing on the admin Speaking page
exposes them, so nothing is actively lying to you — but editing them by hand would do nothing.
I have annotated them in code as inert rather than deleting them, so the row shape stays valid.

---

## Docs that are now stale

Auditing against these produces false alarms; they describe the pre-2026-08-08 design and are
not marked superseded:

- `docs/easy-fast-modes-2026-08-06.md` — the doubled phrase counts (14/4/24/6), the old pause
  numbers, `phrase_length_preference: longest`, and the character cap as live design.
- `docs/easy-fast-toggle-placement-2026-08-06.md` — same generation.
- `docs/easy-mode-redesign-2026-08-07.md` — still carries the round-100 cutoff in its knob
  table with your rationale, still describes "a LEGO with nothing short enough gets its
  shortest phrase rather than being skipped", and still presents the instant-path doubling fix
  as what makes Easy work from round one.
- `docs/easy-phrase-syllable-cap-2026-08-07.md` — "the character cap stays exactly as it is",
  and "it can never empty a round".

I have not rewritten these. Which way they get rewritten depends on your answer above — that
is the point at which it is worth doing once rather than twice.

---

## Still in flight

Live browser verification of the toggle — starting a course in Easy, confirming the doubling,
flipping to Fast mid-session with no cache clear and watching it stop on the next phrase, then
flipping back. The engine-level proof of exactly that behaviour is in the test suite and
passing; the browser run is confirmation on the real article, and it is still running.

---

## Landing

Branch `fix/easy-fast-play-time-rules-rebase-2026-08-08`, four commits, pushed to origin.
**Not merged** to dev, staging or main. **Not deployed** anywhere. Yours to call.
