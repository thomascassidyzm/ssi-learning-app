# Easy mode redesign — landed on dev

Amended 2026-08-08 with your three clarifications: just double, everything a
setting, and a basket contains its own LEGO by definition.

---

## Round length, as ruled

Real numbers from `fra_for_eng` on live data, median cycles per round across
rounds 20–120 — the early-course stretch Easy is for:

| | cycles per round | vs Fast |
|---|---|---|
| **Fast** | **22** | — |
| Easy as it stood an hour ago (doubled counts + doubled cycles) | 56 | 2.5× |
| **Easy now — just double** | **42** | **1.9×** |

The phrase-count inflation is gone. An Easy round is the **same phrase set as
Fast**, with each build, review, use and consolidate cycle played twice. The
extra time now comes from hearing the same thing again, not from meeting more
different things.

## Everything is a setting

Nothing about Easy is hardcoded any more. Six knobs, all `algorithm_config`
rows, all editable per mode on the admin **Speaking** page — the same page as
the timing knobs:

| Knob | Easy | Fast |
|---|---|---|
| Repetitions per practice cycle | twice | once |
| Which cycles repeat | BUILD, REVIEW, USE/consolidate | same list, inert at once |
| Phrase-count multiplier (`scriptShape`) | none | none |
| Filter BUILD phrases | leave them whole | filter |
| Review phrase length, known language | 15 syllables | no filter |
| …and the round it stops applying at | 100 | — |

Two is a **ceiling, not a default**: a row hand-edited to say three is clamped
back to two by the player and says so in the console, because that is your
rule rather than a preference. The introduction and the bare LEGO are off the
repeat list by your ruling, and either can be switched on from that page
without a deploy.

The admin page also loses the old "Maximum phrase syllables" control — it
counted the target side, applied to the whole script rather than the review
pull, and never lifted. Any stale value is deleted from the row on load, so it
cannot outlive the knob that set it.

## What else landed

**Easy plays every practice phrase twice, back to back** — build, review,
consolidate. Never three times. Introduction and the LEGO on its own play once.

**Easy no longer filters build phrases at all.** They arrive whole, as
authored.

**The review pull filter**, as you described it: when a REVIEW or CONSOLIDATE
slot reaches into a LEGO's basket it prefers a phrase of at most 15 syllables
**in the learner's own language**, for the first 100 rounds; past that the
filter simply comes off, nothing backlogged and nothing cascading. A LEGO with
nothing short enough gets its shortest phrase rather than being skipped.

**No "phrase contains its LEGO" check exists** — per your clarification, a
basket is that LEGO's own BLD and USE phrases, so it is true by definition. The
test that pretended to prove it is deleted.

**Fast is untouched**, proved by test rather than asserted: byte-for-byte
identical to a run with the whole feature absent.

## One thing I found and fixed

The doubling as first landed would have missed the rounds you actually hear
first. The start of every session is served by a separate, deliberately
mode-blind fast path — the instant-playback cycles endpoint — which never
touches the script generator. Easy would have played round one undoubled and
then started doubling mid-session, out of nowhere. Both paths now share one
rule and one setting. Worth naming because the same blind spot silently
swallowed the phrase-length cap before it.

## What failed

Nothing. Typecheck, the full 1,916-test suite and lint are all green.

## Gaps, honestly

The Popty script that seeds these config rows
(`scripts/learning-modes/create-mode-rows.cjs`) lives only on an **unmerged**
branch in the dashboard repo and still writes the old target-syllable key with
none of the new ones. Whoever lands that branch needs to add them, or a future
re-seed will quietly undo Easy. I did not edit another agent's in-flight
branch.

## Where to hear it

<https://ssi-learning-app-git-dev-zenjin.vercel.app> — add `?reset=1` once to
clear the old cached script, then switch to Easy.
