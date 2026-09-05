# Stranded pod positions — what the rows say

*2026-09-05. Every number below was read from the production database today, by SELECT only.
Nothing was repaired, migrated or written. Documents were used only as claims to test.*

## The headline

**Tom is right in substance and wrong only about which flip did it.** The 2026-08-22 pod-0 → pod-1
cutover DID run its learner-position migration — the carried rows carry the switchover's own
transaction timestamp (`2026-08-22T18:01:28.653891Z`, identical to the archived pod's `created_at`,
which is the in-same-transaction fingerprint the protocol promises). What the records do NOT say is
that **German was flipped a second time on 2026-08-24** (old `pod-1` → `pod-1-retired-2026-08-24`,
new `pod-1` promoted from `pod-1-staged-2026-08-23`), and **that second flip destroyed 14 of the 17
positions the first one had carried.**

Beuno's app looked fine to Beuno. Nothing orphaned, nothing errored. Exactly the failure shape Tom
named: *a learner carries a position that resolves to nothing, and nothing renders as a course with
no listening exercises in it* — except here the position doesn't even resolve to nothing; it was
deleted, which no orphan check can ever see.

## 1. The stranded count — stated per unit, because the unit is the finding

| Unit | Count | Population | Verdict |
|---|---|---|---|
| `learner_pod_state` rows whose key does not exist in the pod their course serves today | **0** outside Welsh | all 954 rows, 30 courses, fleet-wide | the "zero orphans" claim re-ran true — but see below for why it is the wrong instrument |
| Rows stranded because their course serves **no pod at all** | **102 rows, 4 learner-courses** (cym_n ×3 learners, cym_s ×1) | Welsh only | positions parked behind a deliberately `held` pod-0 — recoverable the day Welsh goes live, not lost |
| Carried positions **DELETED** at the 2026-08-24 re-flip (German, proved row-by-row) | **14 rows / 24 exposures / 2 learners** — Tom 7 of 8, Beuno 7 of 9 | deu_for_eng | **wrongful.** Every destroyed row is a `:sN` split-unit key; every one points at a sentence that exists in today's canon with identical text and identical split shape |
| `completed_pod_rounds` ratchets rebased across a 142→231 canon change | 3 non-zero German ratchets; fleet number is #646's ground | — | cannot orphan, can only be silently wrong; forward-only design caps the harm at replayed content |

**The frame nobody had stated:** the fleet "zero orphans" check (08-22 record, and my re-run) can
only see a key that fails to resolve. The two real harms are invisible to it by construction —
a **deleted** row (no key left to check) and a **bare-integer ratchet** (no key at all). A pod
migration can therefore pass every orphan check ever written and still have destroyed progress.
That is what happened.

## 2. The mechanism, proved from rows

**08-22 (ran, correct).** Prospective log `deu-pod0-switchover-prospective-2026-08-22.json`: 17
carries across exactly 2 learners — Tom (`81987d60`, 8 rows) and Beuno (`884a23bf` = `beunollyn`,
9 rows, 2 dropped on a genuine wording change). Every carried row's target and exposure matches
what stood in the DB after the flip. Verdict: the protocol executed, in-transaction, as documented.

**08-24 (ran again, undocumented for German, destructive).** `pod1-flip-record-2026-08-24.md`
flips 21 courses including deu — the deu-specific cutover record of 08-22 never mentions this and
no per-course row-level log survives (`scripts/flip-d7255a65/apply/` was scratch, never committed).
Today deu_for_eng holds **8 rows across 4 learners**; only 3 rows still carry the 08-22 stamp:

- Survivors: exactly the **whole-turn keys** — Tom `SC01-S001`, Beuno `SC01-S001` + `SC02-S001`.
- Destroyed: exactly the **fourteen `:sN` split-unit keys** (`SC01-S002:s0/:s1`, `SC01-S003:s0/:s1`,
  `SC01-S004:s0/:s1/:s2` for both learners).
- Today's served pod-1 contains `SC01-S002` (2 splits), `SC01-S003` (2 splits), `SC01-S004`
  (3 splits) with the **same texts and same split shapes** as the retired pod they were heard in.
  Beuno had heard "Guten Morgen. Wie geht es dir?" three times; that sentence is in today's canon
  unchanged, and his position on it is gone.

The perfect `:sN` correlation says the 08-24 migration pass mishandled split-unit keys for German —
`pod-state-migrate.cjs` itself carries splitId() handling, so the failure is in how the flip's
migration was invoked/sequenced (the flip record's own Dutch finding shows the same family of
defect: the archive rename re-keys the old canon before matching, after which *nothing* matches and
the plan is wholesale drops). Without the per-course apply log the exact code path can't be named;
the row outcome is unambiguous.

**Fleet exposure (explicit gap):** the 08-24 record claims 214 rows / 4,247 exposures carried
across 21 courses. Whether other courses lost split-key rows the same way is NOT provable from
disk — the per-course logs were never committed, and `updated_at` gets bumped by later play, so a
vintage census can't separate "destroyed then re-earned" from "carried then re-touched". Swedish is
the loudest suspect: the record claims 72 rows / 2,505 exposures carried, and today not one Swedish
row carries a pre-08-25 timestamp. Needs its own audit (the repair spec covers it).

## 3. Beuno's silent German — the real cause, named

Aran's report is true and is **three defects stacked, none of which is the cadence trigger** (per
the brief: not re-opened; the every-5-rounds gate is working as Tom intended):

1. **His listening maturity was destroyed** — 7 of his 9 carried positions deleted on 08-24 (above).
2. **His pod ratchet was reset.** He completed pod laps 1, 2, 3 on Aug 6/7/8 (telemetry:
   `pod_lap_start/end`, `abortReason: completed`, podRound persisting across days — so the writes
   worked). Today `completed_pod_rounds = 0` AND `pod_activation_round = null` — jointly the
   course-reset fingerprint (the reset writer zeroes exactly this pair), consistent with his
   telemetry replaying from round 0 on 08-07 and 08-31.
3. **Delivery has silently failed or been unreachable ever since.** Since 08-09 he has crossed
   exactly ONE firing boundary (round 10, on 08-31, 93s after cold start) — and it produced no lap,
   no event, no error. `shouldFireLapAt` returns false silently whenever the scheduler isn't
   initialized or its sentence list is empty; every degradation path in this stack is
   designed to render as "no pods today". His sessions since then sit inside rounds 11–15, which
   contain no firing boundary until round 15 *completes* — today he paused 19 seconds into round 15
   and went to the Listening tab (17:24, `listening_tick view=pods`), where the telemetry shows
   **zero audio plays**. Whether the client failed or he never pressed play cannot be
   distinguished from the server side; a device-side look (or one `?pod=1` session on his phone)
   would settle it.

The wider German number, handed to #646 rather than chased: **of 18 German enrollments past pod
activation, 16 have never received a single pod lap** (`completed_pod_rounds = 0`). Only two real
learner laps have fired in German since 08-10 (michael 08-26, Stephen 09-03 — both delivered fine,
so the machinery works post-cutover when a session actually crosses a firing boundary healthy).
Delivery reach, not position mapping, is the bigger hole — and it is #646's census to size.

## 4. Documents corrected by the rows (one line each)

- `deu-pod-1-cutover-record-2026-08-22.md`: "17 rows across 2 learners" was true on 08-22 and is
  false today (3 remain); the record is silent about the 08-24 re-flip that falsified it.
- `pod1-flip-record-2026-08-24.md`: "zero orphans at commit" is true in its unit and hides 14
  German deletions (deletion is not orphaning); "214 rows carried" is unverifiable, logs uncommitted.
- The fleet-wide "zero orphans" claim: re-ran today, holds in its unit, wrong instrument for the harm.

## 5. Repair — specified for a separate job, not run

**R1 — restore the destroyed German positions.** Source of truth exists on disk:
`deu-pod0-switchover-prospective-2026-08-22.json` lists every carried row (learner, key, exposures).
Repair = for each of the 14 destroyed rows, re-key its recorded target (`pod-0-unrecorded:…` →
today's `pod-1:…`, suffix preserved), verify the sentence id exists in today's canon (all 14 do —
verified above), then UPSERT into `learner_pod_state` with `exposures = greatest(existing, recorded)`
so nothing goes backwards. ~14 writes, 2 learners. Verify: re-read, assert 17 rows, assert every key
resolves. Reverse: delete the inserted rows (log their keys). Cost: minutes.

**R2 — audit the other 20 courses of the 08-24 flip for the same wound.** For the 16 courses with
08-22 prospective JSONs, diff each recorded carry-set against today's rows (key-present, exposures ≥
recorded). Swedish first. Output = per-course destroyed-row list in the same shape as R1's input;
R1's mechanism then repairs them identically. Read-only until the diff says otherwise.

**R3 — Beuno's ratchet.** Do NOT hand-set it. If Aran confirms the reset was unintentional, set
`completed_pod_rounds` from his lap history (3 completed laps ⇒ the sentence-boundary of cohort 3);
otherwise leave it — the restored exposure rows (R1) already floor his per-sentence maturity, which
is the part that matters pedagogically.

**R4 — make the flip protocol split-key-safe and keep its evidence.** Two rules for the next flip:
the per-course apply log is committed (a migration whose row-level record lives in scratch is
unauditable by design), and the post-flip check asserts *carried-row count survives*, not merely
*zero orphans* — count-conservation is the check deletion cannot pass.

**R5 — none needed for Welsh**: the 102 parked rows resolve the day a Welsh pod goes live; just make
sure whichever slug goes live is content-matched from `pod-0` per the protocol.

## Explicit gaps and taste-flags

- **Gap:** the 08-24 per-course migration logs do not exist on disk; the exact code path that
  dropped the `:sN` rows is inferred from the perfect split-key correlation, not read from a log.
- **Gap:** fleet-wide destruction count (R2) not computed here — deliberately, to stay off #646's
  fleet ground and because German answers the instance-vs-class question for the mechanism.
- **Gap:** Beuno's 08-31 non-firing boundary and today's silent Listening tab cannot be pinned to a
  specific client failure from server data; needs one device-side session.
- **Flag (default taken):** "Beuno" = learner `beunollyn` (`884a23bf`), the account with the German
  enrollment and the pod history; a second account "Beuno" (`e4bce0cc`) exists with zero enrollments.
- **Flag (default taken):** scope held to German + one fleet-wide single-table orphan census;
  no fleet delivery census run.

## Reproduction

`orphan-census.py` in this directory re-runs the fleet orphan count (service key from
`~/.secrets/ssi-dashboard.env`). All other queries are plain PostgREST SELECTs quoted in the
conversation log of job #648.
