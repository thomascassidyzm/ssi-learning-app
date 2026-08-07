# Easy mode: the absolute max-syllables phrase skip

**Date:** 2026-08-07 · **Branch:** `claude/easy-phrase-syllable-cap` · **Status:** built, gated, not merged, not deployed

Tom's ask, verbatim: *"And no longer phrases. In fact we should probably just skip all
phrases that are more than X number of syllables."*

Implemented as a config value. No pedagogy invented beyond that.

---

## The number: **20 syllables**

Fast has **no limit**. Easy caps at **20**. Mirror this into the DB row
`algorithm_config.easy_mode.maxPhraseSyllables = 20` so Popty seeds it identically.

## How 20 was measured

Every non-component practice phrase of two covered courses, counted with the canonical
per-language counter, compared against what today's Easy 0.5 **character** cap already removes.

| course | n | p25 | p50 | p75 | p90 | p95 | max | char cap removes |
|---|---|---|---|---|---|---|---|---|
| `spa_for_eng` | 15,205 | 8 | 12 | 18 | 22 | 25 | 48 | **5.56%** (0.5 × 138 chars) |
| `fra_for_eng` | 14,118 | 6 | 8 | 11 | 14 | 15 | 27 | **9.12%** (0.5 × 98 chars) |

Share of phrases removed by a strictly-greater-than syllable threshold:

| threshold | spa removed | fra removed | mean |
|---|---|---|---|
| >13 | 43.62% | 10.16% | 26.9% |
| >16 | 30.08% | 3.39% | 16.7% |
| >18 | 21.99% | 1.63% | 11.8% |
| **>20** | **15.40%** | **0.65%** | **8.0%** ← closest to 7.34% |
| >22 | 9.87% | 0.23% | 5.1% |
| >24 | 5.66% | 0.09% | 2.9% |

The character cap removes 5.56% / 9.12%, mean **7.34%**. `>20` gives mean **8.0%** — the
closest integer. It is also a round, human number that reads exactly like the ask.

Split by role, at 20: spa BUILD 1.97% / USE 22.25%; fra BUILD 0.18% / USE 0.91%. The cap
does its work on USE phrases, which is where the long sentences are.

## The honest finding: no single number matches both courses

Taken alone, spa wants ~24 and fra wants ~13. That is not a tuning failure — it is what an
absolute cap *is*. The character cap is course-**relative** (a fraction of that course's own
longest phrase), so it self-adjusts; an absolute syllable ceiling does not. The two courses'
distributions genuinely differ: spa tops out at 48 syllables, fra at 27, and Spanish carries
~1.33 target syllables per English syllable against French's ~1.21.

So **20 bites hard on Spanish and is near-inert on French.** That unevenness is inherent, it
is stated in the code comment next to the constant, and it is a DB row — retuning by ear is a
Supabase edit, not a deploy. If you want French capped too, the number is ~13–14, and Spanish
would then lose ~44% of its phrases.

## What was built

| Piece | Where |
|---|---|
| Canonical counter, ported verbatim into core | `packages/core/src/text/syllables.ts` |
| Its fixtures, ported so equivalence is provable (15 pass) | `packages/core/src/text/syllables.test.ts` |
| `maxPhraseSyllables` on ModeConfig + `normalizeMaxPhraseSyllables()` | `useAlgorithmConfig.ts` |
| One resolver for a phrase's syllable count | `makePhraseSyllableResolver()`, same file |
| The cap, in the one place the length rule lives | `capPhrasesByLength()`, same file |
| Course `target_lang` fetch + threading | `generateLearningScript.ts` |
| Both mode call sites | `LearningPlayer.vue` |

**Composition.** The character cap **stays exactly as it is** and remains the universal
backstop. A phrase is dropped if it exceeds **either** cap.

**Inert, never silent.** The counter registry covers 9 languages / 45 of 99 courses. On the
other 54 (kor, ara, zho, jpn, tha, …) the syllable cap does not apply, warns once per course
on the console, and returns `syllableCapApplied: false` on the generator result. That is
deliberate: the previous syllable attempt failed by computing a ceiling from an all-1s
heuristic and silently doing nothing.

**The starvation guard still wins.** The methodology floors (≥4 BUILD / ≥5 USE) are a hard
rail. An over-tight syllable cap degrades to the shortest N; it can never empty a round.

**Fast is provably unchanged.** Fast sets no syllable cap, and a test asserts its whole
generated script is byte-identical to the run with the argument absent entirely.

## Known debt, named not resolved

`packages/core/src/text/syllables.ts` and
`ssi-dashboard-v7-clean/tools/lib/syllable-counters.cjs` are **two copies across a repo
boundary**, with no build-time link. Both files carry a mirror-image header saying so. A rule
changed on one side and not the other silently diverges the player's phrase-skip from Popty's
content tooling. The fix, when someone pays for it, is to make one of them the package the
other consumes. Until then: any change to either must be mirrored, fixtures included.

The only change made in the Popty repo was adding that header comment.

## Tests

- `packages/core/src/text/syllables.test.ts` — 15, the twin's own fixtures
- `packages/player-vue/src/providers/maxPhraseSyllables.test.ts` — 21, unit rules
- `packages/player-vue/src/providers/syllableCapEndToEnd.test.ts` — 11, through the generator:
  Fast byte-identical · Easy drops above / keeps below · kor inert + warns, never throws ·
  starvation guard returns the floor

## Gates

All six run and green: core build · player typecheck · player test (1,908) · player lint
(0 errors on changed files) · api typecheck · api test (1,139).
