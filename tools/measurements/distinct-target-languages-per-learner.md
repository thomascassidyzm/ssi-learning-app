# Distinct target languages per learner

Measured 2026-09-04 against the live shared Supabase (read-only, SELECT only). Purpose: give the per-language pricing ladder the consumer it lacks — nobody could say how many target languages one learner actually opens. **This is a measurement, not a recommendation. No pricing conclusion is drawn here.**

## The headline, in one sentence

Of the **181 real learners with any production activity**, **89 (49%) have touched exactly one target language and 92 (51%) have touched two or more** — but that is the most generous reading possible, and when you require real practice depth instead of a tap-in, the share touching two or more falls to **29% (12 of 41 learners)**.

Both numbers are small-N and both are upper bounds on ladder demand.

## Headline table — production, generous cut, test/demo learners excluded

"Generous" = a learner counts as having touched a target language if they have **either** a `course_enrollments` row for a course in that language **or** any `player_events` row against one. Anchored to rows in `learners` that are not in `test_learner_ids()`.

| Distinct target languages | Learners | Share |
|---|---|---|
| exactly 1 | 89 | 49.2% |
| exactly 2 | 43 | 23.8% |
| exactly 3 | 16 | 8.8% |
| 4 or more | 33 | 18.2% |
| **total with any activity** | **181** | 100% |

Denominator context: 1,321 learner rows exist; 974 are test/demo/internal/class-entity per `test_learner_ids()`; **347 real learners** remain; 181 of those have production activity.

The same cut **including** test/demo learners: N=1,090 — 930 / 79 / 27 / 54. The demo population is ~5x the real one and is overwhelmingly single-language, so including it would deflate the multi-language share to 15%. Excluding it is the honest cut; both are given so the difference is visible.

## Strict cut — the same learners, requiring practice depth

The enrolment depth columns are not reliably written (of 507 real enrolment rows only 43 have `total_practice_minutes >= 10` and 14 have `highest_completed_seed >= 1`), so depth is measured from **event volume per learner-course** instead. `audio_play` is 647k of 794k events; roughly three plays per learning cycle.

Production events, test/demo excluded:

| Threshold | N learners | 1 | 2 | 3 | 4+ | share ≥2 |
|---|---|---|---|---|---|---|
| ≥1 event (generous) | 164 | 103 | 32 | 8 | 21 | 37.2% |
| ≥50 events on a course (~15 cycles) | 62 | 40 | 10 | 5 | 7 | 35.5% |
| ≥200 events on a course (~60 cycles) | 41 | 29 | 4 | 3 | 5 | 29.3% |

**The gap between 51% and 29% is the sampling effect Tom warned about.** Half of learners open a second language; under a third of the learners who actually practise anything at depth have practised two languages at that depth. Note also that the population collapses from 181 to 41 as depth rises — most identified learners barely use the app at all.

## All-time vs 90 days

The `env` column only exists from **2026-06-18**, which is inside the 90-day window, so **the production 90-day figures and the production all-time figures are identical** (164 / 62 / 41 at the three thresholds). The window choice therefore makes no difference to the production headline.

All-env (production + staging + dev + 202,812 pre-column NULL rows), test excluded, generous:
- all-time: N=231 — 137 / 44 / 15 / 35
- last 90 days: N=212 — 138 / 36 / 11 / 27

The pattern is the same shape either way.

## Split 1 — registered vs guest

**Registered:** all 347 real learners have a non-null `user_id` (auth uid). There is no anonymous learner row; everything in the tables above is a registered learner.

**Guest: the distribution is uncountable by construction, and I am declaring that rather than inventing one.** 171,914 events (139,498 in production) have no learner identity at all. A guest has no durable id across sessions; `session_id` is not a person. Any "distinct languages per guest" figure would be a fabrication.

One line of context that IS countable, offered as a *within-session lower bound* only: of 1,685 production guest sessions, 1,328 touched one target language and 357 (21%) touched two or more **inside a single session**. That says guests browse the catalogue; it says nothing about how many languages one guest person opens over time, because the same person across three sessions is three rows here.

## Split 2 — paying vs not

**There are too few payers to split on. That is the finding.**

Across the whole estate `subscriptions` holds 16 rows: 4 active, 12 cancelled. Restricted to real (non-test) learners: **3 active, 4 cancelled**. A behavioural comparison over an N of 3 is not a comparison, and no percentage is computed over it.

Widening "paying" to "holds a paid entitlement by any route", with each route's N reported separately (real learners only, generous production cut):

| Route | Cohort N | With activity | 1 | 2 | 3 | 4+ |
|---|---|---|---|---|---|---|
| Active subscription (`learner_subscription_status.is_subscribed`) | 3 | 3 | 1 | 1 | 0 | 1 |
| Any subscription row, ever | 7 | 7 | 2 | 1 | 0 | 4 |
| Redeemed entitlement, unexpired (`user_entitlements`) | 50 | 40 | 12 | 14 | 4 | 10 |
| School/class attached (`user_tags`, not removed) | 76 | 40 | 23 | 13 | 2 | 2 |
| **Entitled by any route (union)** | **125** | **79** | 35 | 25 | 6 | 13 |
| **Not entitled by any route** | **222** | **102** | 54 | 18 | 10 | 20 |

Raw counts of the underlying tables: `user_entitlements` 95 rows (56 real learners); `entitlement_codes` 18 codes, 29 uses; `email_access_grants` 15 grants, 10 redeemers; `entitlement_grants` **2 rows, both with NULL `school_id` and NULL `class_id`** — they cannot be tied to any learner, so they contribute nothing and are excluded; `family_members` 0 rows.

Read literally: entitled learners with activity are 44/79 (56%) multi-language, non-entitled 48/102 (47%). **Do not quote that as a payer/non-payer difference.** The "entitled" cohort is dominated by redeemed comp codes and school attachments — testers, staff-adjacent people and school pupils — not by people who chose to spend money. Only 3 learners in this database have ever paid a live subscription and are still active.

## What this data cannot tell you

- **Opening ≠ valuing.** A learner who tapped into a second course for thirty seconds is counted in the generous headline. The paid tier is free through white and yellow belt in every market, so sampling a second language costs nothing. **Treat "opened a second language" as an upper bound on ladder demand.** The strict cuts above are the closest thing to a lower bound, and they say 29%.
- **The N is small and not a market.** 347 real learners, 181 with production activity, 41 with real depth. This is a pre-launch estate, not a customer base. Nothing here generalises to India or to any market at scale.
- **The active learner base skews to people close to the project.** Comp entitlements (50) and school attachments (76) together outnumber real subscribers (3) by 42:1. Multi-language behaviour in this population plausibly reflects staff and testers exercising the catalogue.
- **No revenue signal exists at all.** With 3 active subscriptions, willingness-to-pay for a second language is unmeasured and unmeasurable from this database today.
- **Guests are not counted per person** (see Split 1) — 139k production events, 1,685 sessions, no distribution.
- **Env history is short.** Production/staging/dev tagging starts 2026-06-18; 202,812 earlier events carry `env = NULL` and are included only in the all-env figures, never in the production headline.
- **65 activity identities (254 events, 0.04% of rows) appear in `player_events` with no matching `learners` row** — deleted or orphaned. They are excluded from the learners-anchored headline; including them raises the generous production N from 181 to 221 without changing the shape.

## Method notes and reversible defaults

Every one of these is a default I took where the brief left a gap; each is reversible in a word.

1. **Window:** 90 days *and* all-time both reported. Production figures are identical between the two because `env` tagging only began 2026-06-18.
2. **Generous definition:** enrolment row **or** any event. **Strict definition:** event volume per learner-course (≥50, ≥200), *not* the enrolment depth columns — those are barely written (43/507 real rows).
3. **Environment:** production-only is the headline; all-env reported beside it; 202,812 `env IS NULL` rows appear only in all-env.
4. **Test exclusion:** `test_learner_ids()` was callable and returned 974 learner ids. Unfiltered figures reported alongside.
5. **Identity column:** `player_events.user_id` and `player_events.learner_id` both hold **`learners.id`**, confirmed on a 2,000-row recent sample — 1,898 resolved against `learners.id`, **0 against `learners.user_id`**. Where both are populated they are always equal (613,263 rows). 8,881 rows have `user_id` but no `learner_id`, so the measurement groups on `coalesce(learner_id, user_id)`.
6. **Target language:** joined to `courses.target_lang`. Two course codes have no `courses` row — `cym_for_eng` and `cym_for_eng_north` — and fall back to the `<tgt>_for_<known>` prefix, giving `cym`, which is correct.
7. **Known-language side (one line, as instructed):** 6 learners reached the same target language through two different known-language routes. Not analysed further.

Top target languages by real production learners: zho 70, cym 40, deu 21, fra 14, ell 11, ara 10, hrv 10, jpn 10, afr 8, isl 8.

## Reproducing this

Scripts committed beside this file: `distinct-target-languages-per-learner.cjs` (headline + strict cuts) and `distinct-target-languages-splits.cjs` (entitlement splits). They require `pg`, resolved from the dashboard repo's `node_modules`; run them from `/home/tomcassidy/SSi/ssi-dashboard-v7-clean` with `DATABASE_URL` in `.env.psql`. They are SELECT-only.
