# The school average that said zero — Chepstow, 18 September 2026

Job #207. Read-only diagnosis against production, then a fix on `dev` and `staging`.
Tom, 12:44, on Chepstow's leader dashboard: *"The school average is the misleading one. It can't be
zero if the class I'm looking at has 8m."*

## The verdict in one line

The data was right, the cohort rule was right, the window was right. **The card rounded a real
fraction of a minute to a flat zero** — and did it with a formatter of its own, on the very screen
where the class page, which uses the estate's shared formatter, printed `8 min` for the same class.

## What Tom was looking at

`/org/<class>/insights` for 10P, **Class Insights week card** — `WeekNumbersCard.vue`, fed by
`GET /api/groups/:id/rate-compare?window=this_week`. Two columns: the class, and
`Ysgol Cas-gwent Chepstow School average · 33 classes`.

Captured live on staging before the fix, as an ssi_admin through the admin read-view
(`packages/player-vue/e2e/_job207-school-average-proof.mjs`):

```
window      This week            14–18 Sep
            10P                  Ysgol Cas-gwent Chepstow School average
Play as class          7m        0m
Students on their own  0m        0m
Total learning time    7m        0m
New phrases             1         1
            Ysgol Cas-gwent Chepstow School average · 33 classes
```

and the server payload behind it, in the same capture:

```json
"entity": { "classMinutes": 7.4, "pupilMinutes": 0, "totalMinutes": 7.4, "newPhrases": 1 },
"cohort": { "classMinutes": 0.4, "pupilMinutes": 0, "totalMinutes": 0.4, "newPhrases": 0.6,
            "size": 33, "sizeLabel": "33 classes" }
```

**The server sent 0.4. The card printed 0m.** `Math.round(0.4)` is 0.

## The numbers, reproduced

This week (Mon 14 Sep 00:00 BST → now, `Europe/London`, `api/_utils/schoolWeek.ts`), over the diary
minutes the shipped code reads — `loadScopedSessionRows` → `inAppTime.ts`, not any stored aggregate:

| class | play-as-class minutes this week |
|---|---|
| 10P | 7.4 |
| 9T | 1.5 |
| 10T | 1.1 |
| 10C | 0.8 |
| 11C | 0.5 |
| 11H | 0.4 |
| 9C | 0.1 |
| 10H | 0.1 |
| 7E | 0.02 |
| **school total** | **11.7** |

33 of Chepstow's 34 classes have ever played, so the denominator is 33 (the one that has not is
"Rachel Tiller Cleaves Personal"). **11.7 ÷ 33 = 0.354 of a minute.**

## The five candidates, each proved or ruled out

| | candidate | verdict |
|---|---|---|
| **(a)** | reads `course_enrollments.total_practice_minutes` or a stored aggregate | **Ruled out.** The week card's rows come from `loadScopedSessionRows` — the `analytics_class_sessions_scoped` RPC plus whole-class play sessionised off `player_events`. `api/groups/[id]/home.ts` *selects* `total_practice_minutes` but never reads it; only the enrolment cursor fields are used. `api/school/roster.ts` computes its minutes from seconds, not from that column. Job #205's "reads zero forever" risk is real but has not landed on this page. |
| **(b)** | rounding/flooring the average to 0 | **CONFIRMED, and it is the whole bug.** `WeekNumbersCard.vue` carried a private `mins()` doing `Math.round(n)`. 0.354 → `0m`. |
| **(c)** | cohort excludes classes that did not "start" this week | **Ruled out.** `cohortFor` includes every class that had started **by the end of the window** — 33 of 34, quiet ones counted at their true value. That is the ruled behaviour (2026-09-16) and it is right; it is also not what produced the zero. |
| **(d)** | school lane and class lane disagree on the week window or on `learner_id` vs `user_id` | **Ruled out inside the card** — the class column and the average column are computed from one `rows` array and one `weekRange`, so they cannot disagree. **But there is a real disagreement across pages**, below. |
| **(e)** | the average is over pupils, and Chepstow has none | **Ruled out.** Pupils are their own row ("Students on their own"), correctly `0m`. The lying zero was on "Play as class". |

## The real (d): two formatters, one class, two answers

10P did 7 min 22 s this week. On the estate's shared formatter
(`composables/schools/practiceMinutes.ts`, which **ceilings** — Tom's ruling 2026-09-14, "learners
who start playing and do 20-30s are showing as 0 mins") that is **`8 min`**, which is the number
Tom read on the class page. On the insight card's private `Math.round` it was **`7m`**. The same
minute, written two ways on two pages, and a third answer — `0m` — for the average.

That file's own header already said it: *"Every school view formats through this file; a second
formatter is the bug."* There were three.

## The fix

Landed on `dev` and `staging` as `e6f98cc2a` (+ `7a8eec580` / `e2314dd61` merges).

- **`practiceMinutes.ts` gains the band it never had.** More than nothing and less than a minute
  reads `<1 min` — never the `0 min` that denies practice, and never a ceilinged `1 min` that
  claims three times the practice there was. Everything from a minute up keeps the existing
  ceiling, so 7 min 22 s is `8 min` on every page.
- **The compact `8m` / `<1m` / `1h 25m` form moved into that same file.** Two columns on a phone
  have no room for `1 h 14 min`, and that was the only honest reason the cards had their own.
- **`WeekNumbersCard.vue` and `ClassWeekList.vue` delete their private copies.** Phrases take the
  same law: a cohort mean of 0.6 phrases is `<1`, not `1`; 0.4 is `<1`, not `0`.
- **`rateCompare.ts` gets `round1NonZero`** so a real mean is never flattened to zero *before* it
  reaches the client. A 300-class school with one 90-second lesson used to hand the card a literal
  `0` — the client could not have rescued that.
- **The caption already named its denominator** ("… average · 33 classes") and is now pinned by a
  test, so it cannot quietly go missing.

Red first, on the pre-fix code: the card rendered `Play as class 7m 0m`. Green after:
`Play as class 8m <1m`. Regression tests are Chepstow-shaped — class accounts, no pupils, 33 of 34
started, 11.7 minutes — in `WeekNumbersCard.test.ts`, `practiceMinutes.test.ts` and
`api/_utils/rateCompareWeek.test.ts`.

## Who else this hid practice from, measured today

A read-only sweep of every school in the estate, this week, under the old rendering:

**School averages that read a lying `0m`:**

| school | course | classes | started | week minutes | average |
|---|---|---|---|---|---|
| Ysgol Cas-gwent Chepstow School | cym_s_for_eng | 34 | 33 | 11.7 | 0.4 |

**That is the only one.** Chepstow's is *structural*, not a one-off: 34 classes and any quiet week
reproduces it, which is why it was worth fixing rather than waiting out.

**Individual class rows that read `0m` for a week they genuinely practised** — seven, across two
schools:

| school | class | minutes |
|---|---|---|
| Ysgol Cas-gwent Chepstow School | 11H | 0.4 |
| Ysgol Cas-gwent Chepstow School | 10H | 0.1 |
| Ysgol Cas-gwent Chepstow School | 9C | 0.1 |
| Ysgol Cas-gwent Chepstow School | 7E | 0.02 |
| Ysgol Gyfun Trefynwy / Monmouth Comprehensive School | 9AWI | 0.4 |
| Ysgol Gyfun Trefynwy / Monmouth Comprehensive School | 7LJO | 0.4 |
| Ysgol Gyfun Trefynwy / Monmouth Comprehensive School | CEV 9 | 0.03 |

## Does it warrant a production hotfix today?

**My read: yes.** It is a leader-facing number, on the flagship Welsh school, on the first Friday
after launch, and it says the opposite of the truth — "nobody practised" to a head who can see on
the next page that somebody did. The change is display-layer plus one rounding guard, four files,
no schema, no API contract change, green through `pnpm test:premerge`. `main` is branch-protected
and production ships on Tom's word, so this is staged, not taken: `staging` is `main` plus this fix
and the week's release-train tooling commits, so `./tools/release-train/promote.sh --go` is the
whole action whenever he says go.

## Gaps, stated plainly

- Everything above is measured through the server's own shipped modules and, for the card,
  through a real browser session. What I could **not** mint is Angharad's own school-leader
  session — the capture is an ssi_admin looking at the same class through the admin read-view, so
  it renders the same components off the same endpoint, but it is not literally her login.
- Job #205's separate open question stands untouched and unanswered here: ten of this week's
  Chepstow sessions are one `tap_play`, one audio clip and a `tap_pause` seconds later. That is
  either teachers opening the app and stopping, or playback dying after one clip, and the diary
  cannot tell those apart. It is not this bug and this fix does not address it.
