# Blast radius — who else is hearing immersion-only pods

Job #704, 2026-09-06. Read-only census off the live Supabase. **dev, staging and production share
one database, so every figure below is a statement about real production learners.**

## Answer in three lines

- **51 learners** have a live pod ratchet (`completed_pod_rounds > 0`) across **107** enrollments.
- **7 learners / 11 enrollments** have any pod sentences sitting at the terminal immersion-only
  stage. **One is fully immersion-only: Tom, on Chinese.**
- Of those, only **Tom (zho, hrv)** and **fransetter (cym_s)** have a counter that outruns their
  own played laps. Everybody else's terminal sentences are backed by more real laps than counter,
  i.e. genuinely earned. Nobody is hearing something they should not be.

## Method

A cohort reaches the terminal stage `['ps2x']` — one bare target clip at 2×, for ever — once it has
been *alive* for 33 laps (live `pods` row: stage 1 lasts 2 laps, stages 2–7 five each). "Alive" is
derived from the course-wide counter, so cohort ordinal `k` is terminal when
`completed_pod_rounds − k + 1 ≥ 33`. Sentence counts are the per-sentence split units of each
course's served pod (slug `pod-1` then `pod-0`, `pod_type=core`, `visibility=live` — mirrors
`servedPod.ts`). Real laps = completed `player_events.pod_lap_end` rows for that learner+course
(3,659 such rows exist in total; all were read).

## Every enrollment with terminal-stage sentences, plus the courses with no live pod

| Learner | Course | Counter | Sentences | Terminal | % of alive | Real completed laps | Last practised |
|---|---|---|---|---|---|---|---|
| Tom | `zho_for_eng` | 461 | 367 | 367 | 100% | 43 | 2026-09-06 |
| Tom | `hrv_for_eng` | 224 | 403 | 192 | 86% | 14 | 2026-08-22 |
| Stephen | `fra_for_eng` | 87 | 398 | 55 | 63% | 133 | 2026-09-04 |
| jackbrooks_25 | `ron_for_eng` | 83 | 403 | 51 | 61% | 61 | 2026-08-27 |
| Stephen | `swe_for_eng` | 80 | 395 | 48 | 60% | 175 | 2026-09-05 |
| Steak & Eggs | `isl_for_eng` | 61 | 403 | 29 | 48% | 83 | 2026-09-05 |
| mark.hinton | `eus_for_eng` | 59 | 403 | 27 | 46% | 134 | 2026-09-05 |
| wlfgnggbln | `fra_for_eng` | 47 | 398 | 15 | 32% | 113 | 2026-09-01 |
| prussell36 | `spa_for_eng` | 43 | 396 | 11 | 26% | 56 | 2026-08-30 |
| Stephen | `hrv_for_eng` | 39 | 403 | 7 | 18% | 61 | 2026-09-05 |
| wlfgnggbln | `ita_for_eng` | 35 | 402 | 3 | 9% | 106 | 2026-09-04 |
| fransetter | `cym_s_for_eng` | 327 | no live pod | — | n/a | 1 | 2026-08-22 |
| Morgan | `cym_n_for_eng` | 82 | no live pod | — | n/a | 232 | 2026-09-06 |
| stormhborum | `cym_n_for_eng` | 12 | no live pod | — | n/a | 12 | 2026-08-03 |
| danielwithington91 | `cym_n_for_eng` | 2 | no live pod | — | n/a | 1 | 2026-08-31 |
| michael204351 | `cym_n_for_eng` | 1 | no live pod | — | n/a | 1 | 2026-06-16 |

## What the table says

- **Tom / zho_for_eng** is the only 100% case, and its counter (461) sits at ten times his completed
  laps (43). Diagnosed in the companion document: inherited from the old position-coupled model and
  restored faithfully by #657.
- **Tom / hrv_for_eng** is the same pattern one step behind — 86% terminal, counter 224, 14 laps.
- **Stephen, jackbrooks_25, Steak & Eggs, mark.hinton, wlfgnggbln, prussell36** are all *earned*:
  each has more completed laps than their counter, so their mature cohorts have genuinely been
  heard dozens of times. Their pods are mid-ladder, which is the design working.
- **The five `cym_n` / `cym_s` rows have no live core pod at all**, so their counters address
  nothing that is being served. fransetter's 327 (restored by #657 from a *held*, overridden pod)
  is the loudest of these. This is a separate question from #704 and worth someone's attention:
  either those learners should be hearing Welsh pods and are not, or the counters are addressing
  retired content.

## Nothing was written

Read-only throughout. No learner's progress position was touched by this job.
