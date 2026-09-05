# Pod positions — restored, and the fleet audit

*2026-09-05, job #651, executing R1/R2/R4 of the stranded-positions audit (job #648) on Tom's GO.
Every restore went through `exposures = greatest(existing, recorded)` — no learner's maturity can
have gone backwards. Every write has a per-row applied log committed beside this document.*

## The two numbers

**20 learners across the fleet were affected. 459 rows were restored** — 276 destroyed rows
re-inserted, 183 rows whose exposure count had been silently demoted topped back up.

**It was the class, not the instance.** German's 14 destroyed rows were the specimen; the same
wound ran through 12 of the 16 courses that have an 08-22 prospective log. The restore is applied
to the live production database and verified per course: every recorded carry now resolves against
the canon the course serves today, with exposures at least what the record says the learner earned.

## Per-course table

| Course | Destroyed rows re-inserted | Exposure top-ups | Learners | Verify |
|---|---|---|---|---|
| deu | 14 | 0 | 2 (Tom, Beuno) | PASS |
| swe | 0 | 38 | 1 (Stephen) | PASS |
| fra | 38 | 64 (+4 merges) | 6 | PASS |
| por | 74 | 0 | 2 | PASS |
| isl | 40 | 0 | 3 | PASS |
| ron | 21 | 55 | 2 | PASS |
| spa | 21 | 0 | 2 | PASS |
| jpn | 17 | 0 | 1 | PASS |
| zho | 17 | 0 (+1 merge) | 2 | PASS |
| por_br | 13 | 0 | 2 | PASS |
| kor | 9 | 0 | 1 | PASS |
| ita | 7 | 6 | 1 | PASS |
| eus | 4 | 16 | 1 | PASS |
| ara, ara_eg, spa_mx | 0 | 0 | — | clean |

Affected learners include Beuno, Tom, Catrin, Aaron, Meredith Cane, Stephen, Dave, Imdad,
mark.hinton, stephie.bordier — real people, not fixtures. Beuno's position on
"Guten Morgen. Wie geht es dir?" — heard three times, destroyed on 08-24 — exists again.

## Courses that could NOT be checked — an unrecoverable gap, reported, not papered over

**deu_at, fra_ca, gle, hin, hrv, nld have no 08-22 prospective log on disk**, and the 08-24
per-course apply logs lived in scratch (`scripts/flip-d7255a65/apply/`) and were never committed.
There is no record to diff these six courses against; whatever the 08-24 flip did to them cannot
be audited, only observed. What observation says today: deu_at, fra_ca and hin hold zero state
rows; gle holds 7 (oldest stamp 08-24, the flip's own carry); nld holds 21 (the job-#227 in-flight
repair plus later play); **hrv holds 88 rows with 08-22-era stamps surviving** — the flip record
claimed 46 carried for hrv and the surviving vintage is consistent with that, which is mildly
reassuring but is not proof. A reconstruction of a carry-set from `content_audit_log` replay
(`pod-state-migrate.cjs --from=@<iso>`) is technically possible; per the commission it was not
used — a reconstruction treated as evidence is how audits start lying.

## Why every earlier check said "fine" — the instrument, named

An orphan check cannot see this harm, by construction. A deleted row leaves no key to fail
resolution; a rebased ratchet integer has no key at all. The fleet "zero orphans" claim re-ran
true on 09-05 while 275 rows sat destroyed. Counting is the instrument deletion cannot fool —
which is what R4 now enforces (below).

## Two findings from the diff worth knowing

1. **The client's own resync masks destruction.** Swedish showed zero missing rows yet 38 rows
   each sat exactly ONE exposure below the 08-22 record, with fresh 09-04 timestamps — the
   learner's device appears to have re-synced its local ledger after the 08-24 destruction,
   rebuilding the rows minus one lap of history. Destruction on an active learner heals itself
   into a smaller, invisible wound; on an inactive learner (Beuno) it stays total. Fleet health
   checks that read "rows exist" will therefore under-report this incident class forever.
2. **Iceland was wounded by its own flip, not the 08-24 batch.** isl is absent from the 08-24
   flip record (it flipped separately after a render failure), yet lost 40 of 52 carried rows —
   so the destroying code path ran in more than one flip event. The 08-24
   `*-split-progress-forward` dry-run logs (isl's found 0 whole-turn rows to fan forward —
   because the rows were already gone) date the destruction to before 12:10Z that day.

## Held out, deliberately

- **12 recorded `:sN` positions whose sentence today has NO splits** (fra 10, zho 2 — the split
  arrays were removed by later canon work). Restoring the `:sN` key would create an orphan.
  Applied instead as the protocol's own MERGE rule (max of split exposures onto the whole-turn
  key, `greatest()` protected): 5 writes, logged in `split-merge-restore-2026-09-05-applied-log.json`.
- **Beuno's ratchet (R3): untouched**, per the commission — `completed_pod_rounds = 0` and
  `pod_activation_round = null` still carry the course-reset fingerprint and wait on Aran
  confirming whether the reset was intentional. His restored exposure rows already floor his
  per-sentence maturity. No new evidence either way surfaced in this job.

## R4 — the class is closed in the tooling

On `ssi-dashboard-v7-clean` branch `cs/651-pod-flip-conservation`, `pod-switchover.cjs` now:

1. **Asserts count conservation in-transaction**: the course's `learner_pod_state` row count
   after the migration must equal the count before, minus exactly the planned drops and
   converged carry targets — anything else throws and rolls the entire flip back. The orphan
   check stays; it is insufficient, not wrong.
2. **Writes its per-row apply log to `docs/pods/`**, never scratch, and says so in its output —
   the uncommitted 08-24 logs are the whole reason six courses are unauditable today.

The assertion is a pure zero-dependency module (`tools/pods/podStateConservation.cjs`) and was
**proven RED before being trusted green**: fed the real 08-24 German numbers (17 rows before,
3 after, 0 planned drops) it throws "14 row(s) DESTROYED unplanned"; fed the real 08-22 numbers
(19 before, 17 after, 2 deliberate drops) it passes. Test: `node tools/pods/podStateConservation.test.cjs`,
bare node, no install — 5/5.

## Reproduction and rollback

`scripts/pod-position-audit/pod-carry-restore.cjs --course=<code>` re-runs any course's diff
read-only (it re-ran clean after the restores, everywhere, except the 12 held-out split-shape
rows above). The tool was proven by rediscovering German's known 14 before anything was written.
Every applied log in this directory names each inserted/updated key with its before-state — the
logs are the rollback.
