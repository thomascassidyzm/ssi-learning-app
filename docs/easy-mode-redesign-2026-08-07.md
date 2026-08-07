# Easy mode redesign — landed on dev, 2026-08-07/08

Four things you asked for. Three are code and are live on dev. The fourth
(timing) was already done earlier tonight and was left alone.

---

## The one thing that needs you: how long an Easy round now is

Real numbers, generated from `fra_for_eng` on live data, median cycles per
round across rounds 20–120 — the early-course stretch Easy is actually for:

| | cycles per round | vs Fast |
|---|---|---|
| **Fast** | **22** | — |
| **Easy before tonight** (doubled phrase COUNTS only) | **29** | 1.3× |
| **Easy now** (doubled counts **and** every cycle played twice) | **56** | **2.5×** |
| Easy if you halve the counts back to Fast's | 42 | 1.9× |

So an Easy round is now about two and a half times a Fast round, not four —
the doubled counts don't multiply out fully because most LEGOs don't have
fourteen build phrases to give.

At roughly 11 seconds a cycle, plus Easy's bigger pauses, that is very
roughly **10 minutes per round** on Easy against 4 on Fast.

**I left the doubled phrase COUNTS exactly as they were** — `maxBuildPhrases`
14, `useConsolidationCount` 4, `maxSpacedRepPhrases` 24, `n1PhraseCount` 6.
Your new ruling gets its repetition from playing each phrase twice, so those
counts are now a second, older source of the same thing.

**My recommendation: halve them back to Fast's values** (7 / 2 / 12 / 3), which
lands Easy at 42 cycles a round — still nearly twice Fast, but with the extra
coming from *hearing each thing twice* rather than from *meeting twice as many
different things*, which is what you actually said you wanted. It is a DB row,
so it is a Supabase edit and no deploy either way.

One word — "halve" or "leave" — and it's done.

---

## What landed

**Easy now plays every practice phrase twice, back to back.** Every build
phrase, every review, every consolidate — heard, then heard again immediately.
Never three times. The introduction and the LEGO on its own still play once,
exactly as you said.

**Easy no longer filters build phrases at all.** They arrive whole, as
authored. The debut round is generous again.

**The 20-syllable ceiling from earlier tonight is gone**, replaced by what you
described: when a review or consolidate slot reaches into a LEGO's basket, it
prefers a phrase of at most 15 syllables **in the learner's own language** —
and only for the first 100 rounds. From round 101 the filter simply comes off.
Nothing is backlogged, nothing cascades. If a LEGO has nothing short enough,
it gets its shortest phrase rather than being skipped, and every phrase pulled
still contains the LEGO being practised.

**Fast is untouched** — proved by test, not asserted: a Fast script is
byte-for-byte identical to one generated with the whole feature absent.

Both thresholds (15 syllables, 100 rounds) are DB rows, so retuning by ear is
a Supabase edit, not a deploy. The live `easy_mode` row already carries them.

## Two defaults I chose, each correctable in one word

- **Listening, pod and bookend cycles are NOT doubled.** You named build, use,
  review and consolidate; these are none of those. Say "double listening too"
  and it's a one-line change.
- **Debut USE selection is NOT filtered** by the 15-syllable rule — only
  review and consolidate, as you specified. Say "debut too" to widen it.
- **Seed-phase production reviews are NOT doubled.** Those are already a
  four-cycle sandwich of one sentence, so doubling them would be four hearings
  of the same thing — which breaks the never-three-times rule.

## What failed

Nothing. Typecheck, the full 1,903-test suite and lint are all green.

## Gaps, honestly

- The Popty script that seeds these config rows
  (`scripts/learning-modes/create-mode-rows.cjs`) lives only on an **unmerged**
  branch in the dashboard repo, and still writes the old `maxPhraseSyllables`
  key with none of the three new ones. Whoever lands that branch needs to add
  them, or a future re-seed will quietly undo Easy. I did not edit another
  agent's in-flight branch.
- Verification on dev is that the deployed bundle carries the new code and the
  live config row carries the new values. The pedagogical judgement — does
  doubled-up actually feel right — is yours, by ear.

## Where to hear it

<https://ssi-learning-app-git-dev-zenjin.vercel.app> — add `?reset=1` once to
clear the old cached script, then switch to Easy.
