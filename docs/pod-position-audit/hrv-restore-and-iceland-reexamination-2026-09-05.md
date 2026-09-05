# Croatian restored; the Iceland dating re-examined; deu_at has no live pod

*Job #658, 2026-09-05. Companion to the applied log
`docs/pod-position-audit/hrv_for_eng-carry-restore-2026-09-05-applied-log.json`.*

---

## 1. Croatian — 180 rows given back

Replayed `docs/pods/hrv-pod0-switchover-applied-2026-08-22.json` through
`scripts/pod-position-audit/pod-carry-restore.cjs`, #651's method unchanged: re-key onto the
live slug, content-match where a slot's text moved, refuse changed split shapes, write through
`on conflict do update set exposures = greatest(existing, recorded)`.

The dry run reproduced #655's tally exactly — `{"MISSING":179,"present_ok":57,
"text_absent_today":4,"present_lower":1}`, live pod `hrv_for_eng:pod-1`, 231 sentences, 88
state rows before. 179 destroyed rows re-inserted, 1 under-credited row topped up, 180 total.
Nothing refused: no `split_shape_changed`, no `ambiguous_text`. The 4 `text_absent_today` rows
(all aran's) are sentences that left the canon at the 08-22 switchover — a legitimate drop,
not destruction, and correctly not written.

Per learner, read off `learner_pod_state` after the write:

| learner | rows before | rows after | exposures before | exposures after |
|---|---:|---:|---:|---:|
| aran | 42 | 185 | 104 | 596 |
| Stephen | 39 | 45 | 779 | 790 |
| Tom | 1 | 17 | 1 | 17 |
| stevej.kovacic | 1 | 8 | 5 | 68 |
| dannelbasic | 1 | 8 | 4 | 60 |
| forlorneretva | 4 | 4 | 9 | 9 |
| **total** | **88** | **267** | **902** | **1540** |

`forlorneretva` holds four rows earned after the switchover and appears in no carry record; they
were untouched, as they should be. Stephen's device had already rebuilt 12 split rows at counts
higher than the record — `greatest()` left every one of them alone and moved only the single row
the record credited higher (`SC04-S003:s2`, 2 → 3). Nobody moved backwards.

Re-running the diff after the write reads `{"present_ok":237,"text_absent_today":4}` —
MISSING 0, present_lower 0.

### On the record's `applied: false`

The JSON's top level says `"applied": false`, which is what a dry-run mapping says about
itself. The confirmation that the plan was executed is the sibling cutover record,
`docs/pods/hrv-pod-1-cutover-record-2026-08-22.md`, whose numbers were "read back out of the
production database after the move, not forecast before it":

> | Records carried | 241 | **241** |

and 835 exposures carried, 142 dropped, against the same forecast. The record we replayed
carries exactly 241 carry actions and 142 drops. That is the file the switchover ran.

### The second copy

`/home/tomcassidy/SSi/ssi-dashboard-v7-clean/docs/pods/hrv-pod0-switchover-2026-08-22-prospective.json`
(173,459 bytes) exists only in the second dashboard checkout. Compared action-by-action against
the applied record: **identical carry sets** — 241 carries and 142 drops each, zero carry keys
in one and not the other. It differs only in wrapper metadata (`note`, `generated`, scene and
per-learner summaries); its own note says "NOTHING WAS WRITTEN" and that it supersedes an older
2026-08-14 mapping. It is the same plan, re-serialised on 08-24 with commentary attached. It
changes nothing and was not merged or used.

## 2. The glob — an absence that was a filename

#651's carry audit constructed exactly one path,
`<code>-pod0-switchover-prospective-2026-08-22.json`, and so reported Croatian as having no
record while `hrv-pod0-switchover-applied-2026-08-22.json` sat in the same directory as the
sixteen it did find.

Discovery now reads the directory instead of building a name: any
`<code>-pod0-switchover-*.json`, which covers all three orderings seen on disk. If more than one
candidate matches it prints them and prefers the **applied** record, saying which it used. It
reads the canonical checkout only (`/home/tomcassidy/ssi-dashboard-v7-clean/docs/pods`) — the
git-tracked one, and the one the script's `DASH` constant has always meant — and it *reports*
any record shape present only in the second checkout rather than silently using it. Merging two
checkouts' records would recreate exactly the ambiguity the tool refuses everywhere else.

Proof, recorded in `docs/pod-position-audit/record-discovery-2026-09-05.txt`: `--discover` run
against every course with a listening pod resolves **17 records** — the 16 that already worked,
each to the same file as before, plus `hrv → hrv-pod0-switchover-applied-2026-08-22.json`.
`--course=hrv` with no `--prospective` flag now runs the diff end to end. `--course=gle` fails
loudly with "no pod0-switchover record on disk" instead of pretending.

**None of #655's other five courses gains a record.** `deu_at`, `fra_ca`, `gle`, `hin` and `nld`
have zero files matching the switchover family under any shape, in either checkout. Their 08-24
logs exist in quantity — splices, repoints, waivers — but no 08-22 switchover mapping. #655's
verdicts for them stand on their own evidence, unchanged.

## 3. Iceland — the dating does not hold; the wound does

#651 wrote:

> Iceland was wounded by its own flip, not the 08-24 batch. isl is absent from the 08-24 flip
> record (it flipped separately after a render failure), yet lost 40 of 52 carried rows — so the
> destroying code path ran in more than one flip event. The 08-24 `*-split-progress-forward`
> dry-run logs (isl's found 0 whole-turn rows to fan forward — because the rows were already
> gone) date the destruction to before 12:10Z that day.

**What survives.** Iceland was wounded by its own flip. `docs/pods/pod1-flip-record-2026-08-24.md`
lists the 08-24 batch as 21 named courses — `ara ara_eg deu deu_at eus fra fra_ca gle hin hrv
ita jpn kor nld por por_br ron spa spa_mx swe zho` — and isl is not among them; the held list is
empty, so it was not deferred, it was simply not in that run. isl nonetheless lost 40 of 52
carried rows. Two flip events, one destroying code path: that conclusion needs no telemetry
field at all and it stands.

**What does not.** The 12:10Z dating rests entirely on `whole_turn_state_rows_found: 0` in
`isl_for_eng-split-progress-forward-2026-08-24-dryrun-log.json`, and that field cannot carry it.
Reading the field across all 20 courses that have such a log, together with the `plan` payloads
those logs contain, settles what it counts: each plan entry is a **whole-turn** key fanning out
to its `:sN` split keys (`from: "eus_for_eng:pod-1:SC03-S010"` → `to: [":s0", ":s1"]`), so the
field counts learner rows sitting on *un-split* keys and awaiting fan-out. It says nothing
whatever about `:sN` rows — and `:sN` rows are precisely what the re-flip destroyed (German's
forensics: "14 of 17 carried rows deleted, all `:sN` split-unit keys").

The calibration confirms it. The field reads 0 for `kor`, `ron`, `spa`, `zho` — all courses #651
did find destroyed rows in and did restore — and reads 1–5 for `eus`, `fra`, `ita`, `swe`, which
also lost rows. It does not discriminate wounded from healthy in either direction, because it is
not measuring that. A 0 for isl is the expected reading whether or not anything had been
destroyed.

There is a second, simpler problem with the inference: the 08-24 flip ran 08:30–08:36 UTC, and
every one of these dry runs is stamped 12:07–12:51Z (gle's at 20:43Z). They all run *after* the
batch flip. Even a field that did discriminate could only date destruction to before its own
timestamp, which is hours after the event it was being used to exclude.

**Blast radius.** One conclusion, one document. A grep for `whole_turn_state_rows_found` across
#651's branch returns no other use; #655's mention is the calibration itself. Nothing else in
#651 leans on the field, and **no restored course's rows depend on it** — every restore was
driven by the carry-record diff, not by this telemetry. Nothing needs re-opening.

**What would date it.** The row-level audit trail on `learner_pod_state` (#657's trigger) is the
instrument that would answer this going forward, but it did not exist on 08-24. For the
historical event the honest candidates are the flip tooling's own per-run apply logs in
`ssi-dashboard-v7-clean` (they carry timestamps and row counts), and the `updated_at`
distribution of the rows that survived isl's flip. Neither was run here — the question is not
load-bearing for any restore, and #651's substantive finding survives without it.

## 4. `deu_at_for_eng` — no live pod (report only)

Confirmed live: `deu_at_for_eng` has **two pods, both `held`** —
`deu_at_for_eng:pod-0-retired-2026-08-24` (231 sentences) and `deu_at_for_eng:pod-1` (266
sentences). Zero live. Every other flipped course serves one. It is in the 08-24 flip record's
list of 21 that went live, so it went live and was subsequently held.

It also holds **zero `learner_pod_state` rows**, which is why there was nothing for #655 to
restore and nothing for this job to write. So this is content availability, not learner
progress: Austrian German learners currently get no listening pod, and no learner position is at
risk. Worth noticing that its `pod-1` carries 266 sentences where every other course's carries
231 — a different canon, and plausibly why it was held. Explicitly out of scope to fix.
