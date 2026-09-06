# The other seven zeroed pod ratchets — what happened, and what I did

Job #657, 2026-09-05. Applying Tom's Beuno ruling to the rest of its class.

## The short version

Five learners got their listening-pod position back. Two could not, because the
courses they were learning have **no pod content at all any more** — and that,
not the reset, is the thing worth Tom's attention. From tonight, a reset that
zeroes a pod ratchet writes a row saying so: the class can never again have to
be guessed at from a fingerprint.

## Before → after, one row per learner

All five applied live through `greatest()` so nothing could move backwards, and
every one verified by an **independent re-read** of the row afterwards, not by
the `RETURNING` clause.

| learner | course | ratchet before | ratchet after | derived from | pod it was mapped through |
|---|---|---|---|---|---|
| Tom | `zho_for_eng` | 0 | **460** | 17 completed laps, highest pod round 459 | `zho_for_eng:pod-1` (live) |
| Tom | `hrv_for_eng` | 0 | **224** | 4 completed laps, highest pod round 223 | `hrv_for_eng:pod-1` (live) |
| fransetter | `cym_s_for_eng` | 0 | **327** | 1 completed lap, highest pod round 326 | `cym_s_for_eng:pod-0` (held — see below) |
| jamesharvey1992 | `hin_for_eng` | 0 | **2** | 1 completed lap, highest pod round 1 | `hin_for_eng:pod-1` (live) |
| nba4191 | `hye_for_eng` | 0 | **2** | 1 completed lap, highest pod round 1 | `hye_for_eng:pod-0` (live) |

**`rounds_since_pod` is unchanged at 5 for all five** — #649's work-debt seeding
stands untouched. **No course cursor moved**: `highest_completed_seed`,
`highest_completed_lego_id` and `current_mode` were read before and re-read
after, and are identical. Asserted per row in the applied log at
`docs/pod-position-audit/pod-ratchet-restore-fleet-applied-log.json`, which is
also the rollback record.

The stored number is **sentences covered, not laps** — that is what the column
has always held. jamesharvey1992 completed one lap and the correct stored value
is 2, because the cold-start cohort is two sentences. Nobody's lap count was
written into the column.

## Did the class re-derive to seven?

Yes — exactly seven, the same seven, re-derived fresh rather than inherited.

The raw fingerprint catches 24 enrollments, but 17 of those have their last pod
lap **before 2026-06-12**, when the ratchet went live: their zero was never
persisted rather than zeroed, so they are not members of this class. That is
#656's filter and it still holds. The remaining seven are the ones above plus
the two below.

## The two I did not restore, and why

| learner | course | position their telemetry proves | why not restored |
|---|---|---|---|
| **paddyhardy** | `rus_for_eng` | pod round 134, last lap 2026-09-03 | `rus_for_eng` has **no `listening_pods` row at all** — not live, not held, none |
| **Stephen** | `afr_for_eng` | pod round 82, last lap 2026-08-01 | `afr_for_eng` has **no `listening_pods` row at all** |

This is not a technicality. There is no cohort partition to map their laps
through because there is no pod content to partition, and writing "sentence 135"
against content that does not exist would either mean nothing or, the moment
somebody authors a fresh pod for Russian, silently skip paddyhardy past 135
sentences he has never heard. The brief names exactly this as a legitimate
exclusion — *"a course whose live pod content no longer exists"* — and it is the
conservative direction, the same direction #656 chose for Beuno.

**The finding underneath it is bigger than the ratchet.** paddyhardy completed a
pod lap on Russian on 2026-09-03 at pod round 134. Two days later the course has
no pod rows whatsoever. Pod content for `rus_for_eng` and `afr_for_eng` has gone
missing between then and now, and there is no audit trail for that either.

One correction to the brief, offered plainly: paddyhardy is **not** losing
position every session — he has logged nothing at all on `rus_for_eng` since
that 09-03 lap, which is consistent with the course serving him no pods.

**Decision candidate for Tom, one line:** when pod content returns for
`rus_for_eng` and `afr_for_eng`, do we credit paddyhardy at 135 and Stephen at
83 against the new content, or do they start it clean like everyone else?

## Tom's three internal accounts

Two of the three restored (`zho_for_eng` → 460, `hrv_for_eng` → 224). The third,
`nba4191` on `hye_for_eng`, also restored — and the "internal" label on it is
inherited from #656 rather than proven. What the account actually looks like: a
distinct display name (not a `thomas.cassidy+…` address like the obvious test
accounts in the census), created 2026-03-24, **33 course enrolments** with a
minute or two of practice on most of them and eight on Lithuanian. That reads as
a real person sampling the estate, not a test rig. It changes nothing about the
action; it means the class is arguably **five real learners** rather than four.

## The reset audit trail — LIVE

`supabase/migrations/20260905_pod_ratchet_reset_audit.sql`, **applied to
production**. One table, `pod_ratchet_reset_audit`, and one `AFTER UPDATE`
trigger on `course_enrollments` that fires only when `completed_pod_rounds`
falls from a positive value to zero, recording the learner, the course, the
previous ratchet, the previous work-debt counter, the previous cursor lego, the
database role that did it, and the time.

In the database rather than in the two call sites, deliberately: **two** writers
zero this column — the service-role Settings reset (`api/account/reset-progress.ts`)
and the client-side scheduler reset (`usePodLapScheduler.ts`, running as
`authenticated` through PostgREST) — and a trigger catches both, catches the
third writer somebody adds next month, and needed no client change and no deploy
to take effect.

Posture, explicit at creation per RLS doctrine: RLS **on**, **no policies**,
service-role only, `anon`/`authenticated` revoked. The trigger function is
`SECURITY DEFINER` — named here as a deliberate DEFINER object — with
`search_path` pinned to `pg_catalog, public`, because without it the client-side
reset would hit a table it has no INSERT right on and turn a learner's "reset my
course" button into a 500. The INSERT is additionally wrapped so that any failure
inside the audit write is downgraded to a warning: an audit trail must never be
able to break the thing it audits.

**Canary result — green, run in a transaction that was rolled back in full
before the DDL was committed cleanly:**

- zeroing the ratchet writes **exactly one** audit row, carrying the previous value ✓
- an unrelated `UPDATE` on the same enrollment writes **none** ✓
- **raising** the ratchet writes none ✓
- zero → zero does not re-fire ✓
- the real client path — `authenticated` role, real JWT claim, real RLS — both **succeeds** (1 row updated, no throw) and **writes its audit row** through `SECURITY DEFINER` ✓
- `authenticated` has neither `SELECT` nor `INSERT` on the audit table ✓
- no progress value moved ✓

Verified live after commit: trigger `trg_log_pod_ratchet_reset` present and
enabled, `relrowsecurity = true` with **0** policies, `prosecdef = true` with the
pinned search_path, audit table at **0 rows** (no backfill — historical resets
are gone, and reconstructing them would be invention).

## The 30 "enrollment-less" learner-courses — read, not repaired

They are not 30 people. **All 30 carry `player_events.user_id = NULL`**, which
is what a **guest** session looks like, and grouping on a null id collapses every
guest on a course into one row. So the honest count is 30 **courses**, covering
**244 completed pod laps across 185 distinct guest sessions**.

The other candidate readings are ruled out rather than assumed:

- *deleted enrolments / unresolvable learner ids* — **no**: zero `pod_lap_end`
  events carry a non-null `user_id` that fails to resolve in `learners`.
- *a renamed or retired course code* — **no**: every one of the 30 codes is a
  live course code that other, enrolled learners also play.
- *guest sessions whose enrollment was never created* — **yes**, and by design:
  `usePodLapScheduler` short-circuits the enrollment read for a guest
  (`isGuestLearner`) and keeps the pod counter in memory only.

Nothing is owed and nothing is broken. **Repaired nothing**, as instructed.

## Method notes

- Started from #656's script and generalised it rather than writing a new one:
  `--learner <uuid|display_name> --course <course_id>`, dry-run by default,
  `--apply` to write, `--fleet` for the read-only census, per-row applied log.
- **Known-answer check, as required:** re-ran the lap derivation against
  beunollyn / `deu_for_eng`, where the answer is known — it reproduces three
  completed `pod_lap_end` events (pod rounds 1/2/3, Aug 6/7/8) mapping to a
  stored value of **4**. The instrument is sound, so its zeros mean something.
- **One correction to #656's instrument.** It picked the pod with
  `visibility = 'live' ORDER BY pod_order`, which is not the serving rule and
  happened to be right for German by luck. The real rule lives in
  `composables/servedPod.ts`: slug `pod-1` then `pod-0`, `pod_type` core,
  visibility live — and a **held** pod is deliberately indistinguishable from an
  absent one to a learner. The script now mirrors that exactly.
- The one place I overrode it is fransetter: `cym_s_for_eng:pod-0` is held, but
  it is the *actual content she heard* (created 2026-08-11, she lapped it
  2026-08-22) and it is still on disk. Mapping her position through the real pod
  she met beats mapping it through nothing. She sees no pods today either way;
  the value is correct the moment that pod is published.
- `course_enrollments.updated_at` was useless for dating any of this: every one
  of the seven reads `2026-09-05T19:11:04.008Z` to the millisecond, because
  #649's work-debt seeding touched all 1,464 enrolments this evening. Which is
  precisely the argument for the audit trail above.

## Nothing failed

No blocked steps, no credential gaps. The two unrestored rows are a deliberate
judgement stated above, not a failure.
