# Sector mode, and the first helix thread

**2026-09-01.** The shell a nurse taps, the state behind it, the scheduler that interleaves it, and
the first segment registered against the gate. Everything below is on branches off `origin/main`,
pushed, **not merged**.

---

## The point, and whether it is met

Tom: *"I'm a nurse and I want rn to be learning things that relate to my work - not after I've done
30 hours of core content SEEDS that all learners get."* The helix is about **immediacy**, so the
success criterion was never "a learner can pick a sector" — it was **a nurse gets nursing material in
her first sessions.**

Measured, on real rows, by the shipped merge scheduler:

> **first health chunk at total round 6: "anything that isn't clear"**

Not thirty hours. Round six of her first session, while the core course is still on its second seed.
The artefact that prints that line is a test
(`packages/player-vue/src/playback/sectorMerge.artefact.test.ts`) so the claim cannot rot into a
screenshot, and it runs the shipped `mergePreview`, not a re-implementation.

## The interleave, round by round, on real data

Core is live `spa_for_eng` read on the day; health general is HG01–HG14 parsed from the canonical
seed set's own cut lines. **The health column is an em dash in every row and that is the honest
state of the estate: no sector segment has a target realisation anywhere, in any pair.**

```
  total  thread  round  lego      known                                    target
    1    core      1    S0001L01  I want                                 quiero
    2    core      2    S0001L02  to speak                               hablar
    3    core      3    S0001L03  Spanish                                español
    4    core      4    S0001L04  with you                               contigo
    5    core      5    S0001L05  now                                    ahora
    6    sector    1    S0001L02  anything that isn't clear              —   <- listening lap due, sector pod stream
    7    sector    2    S0001L04  I'll say it again                      —
  ·············································································· <- seed boundary
    8    core      6    S0002L01  to learn                               aprender
    9    core      7    S0002L02  I'm trying to                          estoy intentando
   10    sector    3    S0002L01  this isn't my first language           —
   11    sector    4    S0002L03  if you have any trouble understanding  —   <- listening lap due, sector pod stream
   12    sector    5    S0002L05  I'll explain myself more clearly       —
   13    sector    6    S0002L06  it's really important that you underst —
  ·············································································· <- seed boundary
   14    core      8    S0003L01  how                                    cómo
   15    core      9    S0003L02  frequently                             frecuentemente
   16    core     10    S0003L03  as frequently as possible              lo más frecuentemente posible   <- lap, core stream
   17    sector    7    S0003L02  I can call someone                     —
   18    sector    8    S0003L03  who speaks it more confidently than me —
```

Everything the design ruled is visible and asserted: stints are **whole seeds** (core 5, health 2,
core 2, health 4, core 3, health 2 — deliberately asymmetric in rounds); **round numbering inside
each thread is untouched**; laps fire off the **total** counter at 6, 11, 16, 21 … and land mid-seed,
alternating pod stream with the thread whose seed is in play; and with no sector thread the merge is
the core thread **unchanged**, which is the whole-population no-strand guarantee.

One measurement the design listed as unknown, now known: of the 48 cut chunks in HG01–HG14, **16
enter as `is_new = false`** — a third of the segment's chunks make no round. That is the
authoring-time dedupe, visible in real cuts rather than asserted.

## What shipped

| Piece | Where |
|---|---|
| SECTOR row in the mode tray, between Listening and Offline | `components/ModeTray.vue` |
| The walk chooser and the role step, general preselected | `components/SectorPicker.vue` |
| The mount-site glue: open, load, choose, park, resume | `containers/PlayerContainer.vue`, `components/BottomNav.vue` |
| The catalogue endpoint | `api/courses/[code]/sectors.ts` |
| The learner's thread state endpoint | `api/me/threads.ts` |
| The composable both sides read | `composables/useSectorThread.ts` |
| The two-thread merge: seed-boundary swapping, total-round lap counter | `playback/sectorMerge.ts`, `composables/useSectorMerge.ts` |
| The tables | `supabase/migrations/20260901_sector_helix.sql` |

**The walk list ships empty, and that is correct.** The one registered walk is `draft` — it has no
content — and the endpoint serves only `live` to learners. Verified against the live registry:

```
spa_for_eng                -> 200 {"sectors":[]}
spa_for_eng?include=draft  -> 200 health / spa_health_for_eng / ["general"] / draft
                                  / anchor S0001L01  "I want" -> "quiero"
fra_for_eng                -> 200 {"sectors":[]}
```

## Migrations applied, plainly

Two tables, additive, in one transaction on the live database:

- **`course_sectors`** — schema verbatim from the SQL that had been deliberately left unapplied.
- **`enrollment_threads`** — per-thread scheduling state only: cursor, ceiling, cycle index, pod
  ratchet, plus `active` and `role`. No ownership, no review state.

Both are RLS-on with no policies, `anon`/`authenticated` revoked, `service_role` granted — every
access goes through a server endpoint that already holds the service key, which is the deliberate
alternative to authoring clever policies for a table whose only client is our own server.
`course_enrollments` held **1612 rows before and 1612 after**; no existing learner row changed.

Round-trip probe on the new table (rows created, exercised, then deleted; table back to zero):
create → park with the cursor at round 7 → resume with the cursor **still** at round 7 → duplicate
refused by `unique(enrollment_id, sector_course_code)`. Parking is not destructive, which is the
property the toggle depends on.

Then one registry row: `spa_for_eng` + `health` → `spa_health_for_eng`, roles `["general"]`,
role_map `{general: [1…57]}`, anchor `S0001L01`, pod slug null, status `draft`.

## The anchor, and the two things the census found

The canonical set fixes the anchor functionally: scene 0 complete, plus the Appendix A inventory
owned. A read-only census tried to bind that to a lego id in `spa_for_eng` and found **both halves
unbindable today**:

1. **Scene 0 does not exist.** W1201–W1204 are in no content table under any course code, and their
   hallmark strings match nothing in the estate.
2. **Appendix A coverage never gets steep**: 0/169 at seed 1, 3.0% at seed 13, 16.6% at seed 144,
   **26.0% at the end of 668 seeds**. 125 of 169 chunks are never owned anywhere in the course.

So there is no later position worth waiting for, and waiting is the one thing the helix exists to
prevent. The anchor is the earliest lego in the course; the shortfall is authored in-segment as
`is_new = true`, which is what the canonical set prescribes. **The honest consequence, stated rather
than buried: for `spa_for_eng` today the second thread is not cheap** — the design's cheapness came
from shared chunks entering `is_new = false` against a trunk that has not been authored into the
content tables yet.

## Decisions taken, one line each

- **Anchor `S0001L01`** — the earliest lego, because the census shows no later position buys
  anything and the anchor IS the immediacy.
- **Registered as `draft`** — the segment has no content, so no learner may be offered the walk;
  the ZUT gate does not filter on status, because a gate that only wakes at `live` arrives after
  the damage.
- **`roles: ["general"]` only** — roles are projections, and only the general projection is
  authored; listing nurse would advertise content that does not exist.
- **`sector_pod_slug: null`** — no health overlay pod exists for this course, and a slug naming a
  pod that isn't there is a lie the lap scheduler would act on.
- **Both new tables service-role-only** — no new RLS policies to get wrong; the server is the only
  client.
- **The merge is a module plus its seam, NOT spliced into live playback** — no segment has content
  to interleave, so wiring it into every learner's session today is pure risk for no benefit; the
  later diff is small and named in the scheduler's own report.
- **The sector row's toggle parks and resumes; only the label opens the picker** — one tap out, one
  tap back, same shape as the Listening row.
