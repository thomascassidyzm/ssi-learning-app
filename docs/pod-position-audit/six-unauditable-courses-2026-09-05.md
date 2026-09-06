# The six unauditable courses — harmed, intact, or unknowable

*2026-09-05, job #655. Read-only. Nothing in this document was executed; no row was written.
It exists to inform one decision: whether to commission a restore for any of these six courses,
in the shape job #651's R1/R2 took.*

---

## The two headlines

**1. One of the six was never unauditable.** `hrv` has a committed 2026-08-22 carry record on
disk. Job #651 missed it because it is named `hrv-pod0-switchover-applied-2026-08-22.json`, not
`hrv-pod0-switchover-prospective-2026-08-22.json` — a filename glob, not an absence. Its numbers
are independently confirmed by the human-written cutover record beside it, which reports
**"Records carried: forecast 241, actual 241."** So #651's own tool can be run against Croatian,
and it was, read-only.

**Croatian is HARMED: 180 rows across 5 real learners, including aran.** That contradicts both
Tom's prior ("hrv 88 rows against 31 enrollments… looks intact") and #651's "mildly reassuring".
The 88 surviving rows are not survival — they are mostly one learner's client rebuilding itself
after the fact.

**2. The wound has a mechanism, and it is now proven twice.** The 2026-08-24 flip destroyed
**split-keyed** positions (`…:sN`) and left **whole-turn** positions untouched:

| hrv, 2026-08-22 recorded carries | recorded | present today | destroyed |
|---|---:|---:|---:|
| whole-turn keys | 46 | **46** | 0 |
| split keys (`:sN`) | 195 | 12 | **183 (94%)** |

#651 proved this same shape on German ("14 of 17 carried rows deleted, **all `:sN` split-unit
keys**"). It is now proven on Croatian. This turns the remaining courses from guesswork into
pattern-matching against a known mechanism.

---

## Verdicts

| Course | Verdict | Rows at stake | Learners |
|---|---|---:|---|
| `hrv_for_eng` | **HARMED** — proven against a committed record | **180** | aran, Tom, stevej.kovacic, dannelbasic, Stephen |
| `gle_for_eng` | **HARMED** — proven by mechanism + calibrated telemetry floor | **~17–24** | lea.weber94 |
| `hin_for_eng` | **UNKNOWABLE** — but the exposure is at most 1 row | ≤1 | alisonpest |
| `nld_for_eng` | **INTACT** — one exposed learner, already repaired under #227 | 0 | — |
| `fra_ca_for_eng` | **INTACT — no exposure.** Nobody ever reached a pod | 0 | — |
| `deu_at_for_eng` | **INTACT — no exposure.** Nobody ever reached a pod | 0 | — |

Tom's six enrollment/row pairs were re-measured from the live DB and **every one of his numbers
is correct**: gle 104/7, hrv 31/88, nld 24/21, hin 13/0, fra_ca 7/0, deu_at 6/0.

---

## The instrument, and how it was proven before use

**Reproduce-first gate (mandatory, and it passed).** The reader was run against two courses whose
answers are already settled before it was pointed at anything unknown:

- `deu_for_eng` — 22 rows present, all resolving on the live pod, **14 of them stamped
  2026-09-05T19:20:14Z**, millisecond-apart: #651's restore, visible with its fingerprint on it.
  Beuno's and Tom's original 2026-08-22 carries also still visible at their 08-22 stamps.
- `swe_for_eng` — the subtle shape renders: Stephen's 41 rows stamped 2026-09-04T08:01 (his own
  device's resync) sitting beside 38 rows topped back up at 2026-09-05T19:21 (#651's exposure
  restore).

A reader that could not see rows demonstrably there would make every zero it reported meaningless.
It could see them.

**The identity trap was checked, not assumed.** `player_events.user_id` is a uuid holding
`learners.id`: on a 2,000-row sample, **2,000 matched the learner PK and 0 matched the auth uid**.

### Two candidate instruments were built, tested against controls, and thrown away

This matters more than the ones that worked, because each would have produced a confident wrong
answer.

1. **"rows ≈ podRound + 1."** It held beautifully across every healthy learner in the six. Run
   against ten courses the 08-24 flip never touched, it collapsed: `ell` richardbuck reached
   podRound 639 and holds 0 rows; `cat` richardbuck 597 → 1 row. Discarded.
2. **"distinct sentences heard ≫ rows held = harm."** Also collapsed on the control: `cat`
   richardbuck heard 132 distinct pod sentences and holds 1 row, on a course nothing touched.
   Discarded **as a standalone claim** — see below for what rescued it.

## What made the telemetry floor usable: calibration against a known record

`audio_play` events with `cycleType='pod_play'` carry `sentenceIdx`, naming the pod sentence
heard. Croatian's committed 08-22 record says how many rows each learner *actually held*. Putting
them side by side calibrates the floor:

| hrv learner | rows actually held 08-22 | distinct sentences heard (telemetry) |
|---|---:|---:|
| Stephen | 37 | **37** |
| stevej.kovacic | 13 | **13** |
| dannelbasic | 12 | **12** |
| Tom | 32 | 20 *(listening predates full telemetry)* |
| aran | 289 | 180 *(same)* |

Where telemetry covers a learner's whole history, **rows held equals distinct sentences heard,
exactly.** The ledger does not prune. The control-course anomalies were those courses' own
recasts and drops, not pruning — which is why the floor is sound *when* the telemetry window
covers the learner, and worthless when it does not.

**The confound that governs everything below:** `learner_pod_state` was created by migration
`20260705_learner_pod_state.sql` and its earliest row anywhere in the estate is
**2026-07-08**. Pod laps go back to 2026-05-08. **A learner whose pod listening predates
2026-07-05 could not have held rows, and lost nothing.** This alone disposes of most of the
apparent casualties: Tom's 17 Irish laps, his 29 Croatian and 4 Dutch laps, michael204351's
Irish laps, maarten.reul's Dutch — all pre-ledger.

---

## Per-course evidence

### `hrv_for_eng` — HARMED. 180 rows, 5 learners.

Run of #651's `pod-carry-restore.cjs` against the committed 08-22 record, read-only, no `--apply`:

```
hrv_for_eng — live pod hrv_for_eng:pod-1 (231 sentences), recorded carries 241, state rows today 88
tally: {"MISSING":179,"present_ok":57,"text_absent_today":4,"present_lower":1}
destroyed rows: 179, under-credited rows: 1, learners affected: 5
```

| Learner | recorded carries | destroyed | exposures lost |
|---|---:|---:|---:|
| **aran** | 189 | **147** | **500** |
| Tom | 17 | 16 | 16 |
| stevej.kovacic | 8 | 7 | 63 |
| dannelbasic | 8 | 7 | 56 |
| Stephen | 19 | 6 (+1 under-credited) | 11 |

The 4 `text_absent_today` rows are legitimate drops, not destruction. Every destroyed key is a
`:sN` split key; all 46 whole-turn keys survive. **Croatian's 88 rows today read as health only
if you count rows.** 39 of them are Stephen's, all stamped 2026-09-04 — his device rebuilding
after the fact, the Swedish wound exactly. Tom's Croatian holding is one row, `SC02-S001`,
exposures 1, against 17 recorded carries.

### `gle_for_eng` — HARMED. One learner, roughly 17–24 rows.

No 08-22 record exists (Irish staged on `pod-0-unrecorded`; its pod-0 → pod-1 move *was* the
08-24 event). The verdict rests on three independent things agreeing:

1. **The flip's own writes carry the destruction signature.** It wrote exactly 4 rows at
   2026-08-24T08:34:08.480Z — **4 whole-turn, 0 split** — on a pod where **99 of 231 sentences
   have splits**. On Croatian, where the record exists, that same shape means 94% of split keys
   destroyed.
2. **The calibrated telemetry floor.** `lea.weber94` heard **27 distinct pod sentences**, all
   between 2026-07-30 and 2026-08-07 — entirely inside the ledger era, entirely pre-flip. The
   calibration says she therefore held ~27 rows on 2026-08-24. She holds **3**, all whole-turn
   (`SC01-S001` ×6, `SC02-S001` ×4, `SC04-S001` ×2).
3. **Content continuity bounds the legitimate loss.** 104 of the retired pod's 142 sentences
   (73%) are present in today's canon by known-text. So of ~27 rows, roughly 7 would drop
   legitimately and ~20 should have carried. Three did.

**Floor: ~17 rows destroyed. Likely ~24.** `justin` (2 heard, 1 row held) is within legitimate-drop
range and is not counted as harm. `richardbuck`'s 3 rows are post-flip play (08-25) and are fine.
Tom's and michael204351's Irish listening is pre-ledger — **Irish learners did lose positions, but
not the ones the enrollment count suggests: 104 enrollments, and exactly one person was harmed.**

### `hin_for_eng` — UNKNOWABLE, and the exposure is at most one row.

Two learners ever played a Hindi pod: `jamesharvey1992` (2026-06-25, pre-ledger, could hold
nothing) and `alisonpest` (2026-08-19, ledger era, **2 distinct sentences heard**). Hindi holds
zero rows today. The flip record states **"`hin` dropped one row"** — so Hindi held at least one
row, and the record calls that drop legitimate under protocol rule 5 (the sentence left the canon).
Only 91 of the retired pod's 142 sentences (64%) survive into today's canon, so a drop is the more
likely reading of a 2-row holding going to 0 — but with no per-row record, **whether alisonpest's
remaining row was legitimately dropped or destroyed cannot be decided.** One row, one learner,
one 20-minute listen. The honest verdict is unknowable; the honest footnote is that it is small.

### `nld_for_eng` — INTACT.

Exactly one learner had ledger-era pre-flip Dutch pod exposure: `jackbrooks_25` (13 distinct
sentences). Every other learner with Dutch pod laps — Tom, maarten.reul, attackedbywolves,
nba4191, mckenzie3000, michael204351 — listened in May and June, before the ledger existed, and
so held nothing to lose. jackbrooks_25 was the in-flight-session casualty named in the flip
record and was repaired under job #227; he holds **21 rows today, max exposure 20**, against 21
distinct sentences heard post-flip. Nothing is outstanding.

**This verdict survives the Swedish test only partially, and that limit is stated rather than
hidden:** all 21 of his rows carry a single timestamp, 2026-09-04T08:07:53.966Z — the repair's own
write. A resync-healed one-exposure-low wound underneath that repair would be invisible to me,
because there is no pre-flip record of his exposure counts to compare against. What I can say is
that no row is *missing*.

### `fra_ca_for_eng` and `deu_at_for_eng` — INTACT, no exposure.

Established, not assumed: **zero `player_events` of any pod type — no `pod_play`, no `pod_intro`,
no `pod_lap_start` — have ever been recorded on either course.** Not "no rows", which would be the
absence-reasoning trap; positive evidence of the play that never happened. `fra_ca` has 86 player
events total, last one 2026-07-12; `deu_at` has 280, but none of them pod. No enrollment on either
course has `pod_activation_round` set, `completed_pod_rounds > 0`, or a
`highest_completed_round_index` above 5. Nobody crossed a pod boundary. There was nothing to lose.

> **Separate live finding, outside this brief but found on the way and worth a look:**
> **`deu_at_for_eng` has no live pod at all.** Its `pod-1` is `visibility='held'` and its
> `pod-0-retired-2026-08-24` is held too — zero live pods, where the other 20 flipped courses each
> have exactly one. The 2026-08-24 flip record lists deu_at among the 21 flipped. Something
> un-flipped it, or it never took. That is a content-availability question, not a progress
> question, and it is not this job's to fix.

---

## The specified restore — for Tom's ruling. NOT RUN.

### Croatian — specified fully, ready to execute

Exactly #651's R1/R2 shape, with the same tool that produced the diff above:

```
node scripts/pod-position-audit/pod-carry-restore.cjs \
  --prospective=/home/tomcassidy/ssi-dashboard-v7-clean/docs/pods/hrv-pod0-switchover-applied-2026-08-22.json \
  --apply
```

- **What is written:** 179 destroyed rows re-inserted and 1 under-credited row topped up, into
  `learner_pod_state`, keyed `(learner_id, 'hrv_for_eng', hrv_for_eng:pod-1:<slot>[:sN])`.
- **Through what shape:** `on conflict do update set exposures = greatest(existing, recorded)` —
  no learner's maturity can go backwards, including Stephen's, whose device has already rebuilt 12
  split rows at higher counts than the record.
- **What is not written:** the 4 `text_absent_today` rows — the sentence left the canon, a
  legitimate drop. Any `:sN` key whose split shape changed is reported and refused, never restored.
- **Verification:** re-run the same command without `--apply`; the tally must read
  `MISSING: 0, present_lower: 0`. A per-row applied log lands in `docs/pods/`, and that log is
  the rollback.
- **Blast radius:** 5 learners, one course, one table, reversible from its own log.

### Irish — needs one decision from Tom first, because there is no record to restore *from*

There is nothing to replay: no 08-22 log, no 08-24 apply log. The only way to give lea.weber94
her position back is to **derive** it — reconstruct her ~24 rows from her `audio_play`
telemetry (`sentenceIdx` + count per sentence, 2026-07-30 to 2026-08-07) and write those.

**I am not recommending that, and the reason is the commission's own rule.** A reconstruction
treated as evidence is how audits start lying — and a reconstruction *written into the learner
ledger* is worse, because the next audit cannot tell it from a real carry. My recommendation is
the cheap honest one: **restore Croatian, and leave Irish alone.** One learner, ~24 rows, costs
her some re-listening on sentences she will meet again anyway; the pod re-exposes content by
design. If Tom wants her made whole regardless, the derivation is straightforward and I will
specify it — but it should be written with a marker that says it was derived, not carried.

---

## What would have had to exist for the five to be knowable

Named specifically, because "better logging" is not a finding:

1. **A committed per-course prospective carry log for every flip**, at
   `ssi-dashboard-v7-clean/docs/pods/<code>-pod0-switchover-prospective-<date>.json`. Sixteen
   exist; `gle`, `hin`, `nld`, `deu_at`, `fra_ca` have none. This is the single artefact that
   made Croatian answerable and the other five not.
2. **A committed per-row apply log for the 2026-08-24 flip.** It was written to
   `scripts/flip-d7255a65/apply/` — scratch — and is gone. Verified absent on disk today.
   **#651's R4 already closes this**: `pod-switchover.cjs` now writes its apply log to
   `docs/pods/` and asserts row-count conservation in-transaction.
3. **A pre-flip `learner_pod_state` count per course**, recorded in the flip record itself. The
   record states "214 rows carried, zero orphans at commit" — an intent-and-orphan claim. It
   cannot answer "how many rows existed before", which is the only question that matters here.
   A single `select course_code, count(*)` before and after, committed, would have made all six
   answerable in one query.

**And one honest gap in this document.** The `*-split-progress-forward-2026-08-24-dryrun-log.json`
files record `whole_turn_state_rows_found: 0` for `gle` and `hin`, and #651 used that same field to
date Iceland's destruction. **I could not use it and did not:** the tool that emitted it is not on
disk anywhere in the estate, so its semantics cannot be verified, and calibrating the field across
all nine courses that have one shows it reading 0 for `kor`, `ron`, `spa` and `zho` — all courses
#651 *did* restore — and 1–2 for `eus` and `ita`, which also lost rows. It does not discriminate.
It is consistent with the gle/hin readings above and it is not evidence for them.

`content_audit_log` does not cover `learner_pod_state` — it tracks 11 content tables and no
learner table — so there is no deletion record to appeal to, for any course, and no reconstruction
route from it either.

---

*Method: one read-only reader, proven on two courses with known answers before use; six courses
read; two candidate instruments built, controlled, and discarded. No row written. No test suite
run — this job touched no application code.*
