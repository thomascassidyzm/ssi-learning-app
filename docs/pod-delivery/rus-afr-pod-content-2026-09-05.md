# Where Russian and Afrikaans pod content went

**Answer: nowhere. It was never made.** Neither course has ever had a listening pod,
neither learner has ever heard one, and nothing was deleted. What paddyhardy and
Stephen were lapping was a different exercise entirely — a Layer-1 seed cup, built
from their own course material — which fires down the same code path and logs under
the same event name. That is the whole reason this looked like a disappearance.

Established 2026-09-05, read-only against production, job #659.

---

## 1. What the record actually says

Five independent lines of evidence, all pointing the same way.

**a. Zero pod rows, zero sentence rows, ever.** `listening_pods` has no row for
`rus_for_eng` or `afr_for_eng` on any slug at any visibility, and
`listening_pod_sentences` has none either. *How I know this is the database's answer
and not my query's:* the same query, run against `deu_at_for_eng` as a control,
returns its two held pods with 231 and 266 sentences; against `cym_n_for_eng` it
returns three. The reader works.

**b. No audit trail, because there was nothing to audit.** `content_audit_log` carries
`AFTER DELETE` and `AFTER UPDATE` triggers on both pod tables, live since
2026-07-16/17, and holds 254 pod deletions and 13,021 sentence deletions with full
`old_row` snapshots. It has **not one row of any kind** for a `rus_for_eng` or
`afr_for_eng` pod key — while carrying 545 practice-phrase and 436 course-row audit
entries for those same two courses. So the trigger sees these courses fine; it has
simply never had a pod change to record on them.

**c. Every lap either learner ever played was a Layer-1 cup, not a pod.** This is the
decisive one. A real pod lap plays intro and outro bookends and logs `audio_play`
rows with roles `pod_intro` / `pod_outro` (and often `ps2x`). Across **all time**,
`rus_for_eng` and `afr_for_eng` have exactly two non-main-cycle roles between them:
`ps` (43 + 9) and `trans` (14 + 3). **Zero `pod_intro`. Zero `pod_outro`. Ever.**
And `ps` / `trans` are precisely the Layer-1 markers — the counts reconcile lap by
lap, 3 `ps` + 1 `trans` per four-play lap, matching every `playsExpected: 4` in the
telemetry. Control: `fra_for_eng`, `hrv_for_eng`, `spa_for_eng` and `deu_for_eng` all
show `pod_intro` / `pod_outro` over the same period.

**d. No pod cast exists for either language.** `app_config.pod_voice_pools` holds 50
languages. `rus` and `afr` are not among them — not empty, absent. Popty's own
2026-08-17 cast resolution record (`docs/pods/t21-resolved-cast-{before,after}.json`)
names both courses explicitly, before *and* after the fix, with the same error:
`No target voice available: pod_voice_pools["rus"]["f"] is empty`. The pod pipeline
could not have cast, recorded or generated these pods at any point. Nothing to lose.

**e. Nothing on disk, nothing in git.** No pod source file, switchover record,
prospective or applied log for either course exists in either dashboard checkout
(`~/ssi-dashboard-v7-clean`, `~/SSi/ssi-dashboard-v7-clean` — 908 and 906 files under
`docs/pods/`, matched loosely, not by a narrow glob). Git history in both repos
carries no pod commit for either language.

**The 2026-09-03 lead is a dead end, honestly reported.** Somebody was operating on
pod tables that night (audit UPDATEs to 23:45, scaffolding-course DELETEs on the 3rd
and 4th). Russian was not in the blast radius: it has no audit rows at all, and its
2026-09-03 lap was a Layer-1 cup, flagged `isLayer1: true` by the boolean added on
2026-08-31 for exactly this ambiguity.

**The one thing I cannot close.** Pod rows created before 2026-07-16 and deleted
before the audit trigger existed would leave no trace. I can bound it but not erase
it: the earliest Russian lap on record, 2026-07-08, was already a Layer-1 cup with no
pod bookends, so Russian had no pod by then either; Afrikaans has no pod-shaped
activity before 2026-08-01, also Layer-1. Combined with (d) — no voice cast, ever —
"deleted silently in the pre-trigger window" would require a pod recorded with a cast
that does not exist. I am calling it never created.

---

## 2. How wide it is

**Class A — learner listening history, no pod row at all.** Exactly two courses.
Re-derived independently of the briefing pass and agreeing with it.

| Course | Completed laps | Learners | Last lap | Pod rows | Sentence rows | Voice pool |
|---|---|---|---|---|---|---|
| `rus_for_eng` | 12 | 1 (paddyhardy) + 1 guest | 2026-09-03 | 0 | 0 | **none** |
| `afr_for_eng` | 3 | 1 (Stephen) | 2026-08-01 | 0 | 0 | **none** |

Both have the same disease and it is not lost data: **the content was never authored,
and cannot be until Russian and Afrikaans get a pod voice cast.**

**Class B — pod rows exist, none live.** Exactly three courses. Different disease:
the content is present and merely held. Content availability, not data loss, and not
mine to fix.

| Course | Pods held | Sentences |
|---|---|---|
| `cym_n_for_eng` | pod-0, pod-0-gated-2026-08-06, senedd-s4c-steve | 231 / 0 / 567 |
| `cym_s_for_eng` | pod-0, pod-0-gated-2026-08-06 | 231 / 0 |
| `deu_at_for_eng` | pod-0-retired-2026-08-24, pod-1 | 231 / 266 |

**Context worth having:** 67 courses carry pod rows, 64 of them serve a live
`pod-0`/`pod-1`. Estate-wide, **35 courses have no pod voice pool at all** and
therefore no pod — Russian and Afrikaans are simply the only two of those with a
learner who got far enough to notice.

---

## 3. What was restored — nothing, and that is the right answer

There is no replay available: no `old_row` to replay from, no source file, no backup
named anywhere in the record. Restoring these pods means **authoring them from
scratch**, and the first blocker is upstream of authoring: neither language has a pod
voice cast, so `pod_voice_pools` needs `rus` and `afr` before a pod can be cast,
recorded or generated.

I have written nothing to the database.

---

## 4. paddyhardy and Stephen — nothing was lost, so nothing to credit

`completed_pod_rounds = 0` on both learners' enrollments is **correct, and has never
been anything else.** The ratchet advances only in `markLapCompleted()`, and the
Layer-1 branch in `LearningPlayer.vue` never calls it — the code says so in as many
words: `await playPodLap(l1LapToPlay, false) // L1 has no ratchet — nothing to
persist.` Every lap either learner played was Layer-1. The counter was never bumped,
never zeroed, and #657's new `pod_ratchet_reset_audit` table (live, 0 rows) confirms
no reset has been seen.

So the numbers from #657 — paddyhardy at sentence 135, Stephen at 83 — **do not
survive contact with the evidence.** Those were derived from `podRound` in the lap
telemetry, which is the learner's MAIN round number, not a pod position: paddyhardy's
134 is round 134 of Russian, and the guest lap on the same course reads `podRound:
323`. Writing 135 would have skipped paddyhardy past 135 Russian sentences he has
never heard, the moment somebody authors them.

**No credit written, for either learner.** Their listening position is 0 because they
have never been served a listening pod. When the content exists, they start at the
beginning, which is where they actually are.

---

## 5. The detector

**I extended the nightly `pod-delivery-detector` rather than adding a trigger, and
took the brief's taste-safe default deliberately:** a DELETE trigger already exists
on `listening_pods` and it did not catch this, because nothing was ever deleted. The
thing that went undetected is a state, not an event.

But the existing detector had its own blind spot, and Afrikaans is the specimen.
Its census only sees a course while somebody is still burning rounds inside the
window: Russian fires RED today because paddyhardy played two days ago, but Stephen
stopped on 2026-08-01, so `afr_for_eng` **does not appear in the detector's output at
all**. That is the failure mode silence causes — the learner gives up, and their
giving up hides the defect.

The addition is one window-independent pass: every course that has EVER logged a pod
lap for a real learner and has no live pod row today, minus whatever the windowed
census already printed. New verdict `RED dormant-no-servable-pod`, folded into the
same notice, on the same 06:20 timer, in the same script.

**Better × Simpler × Cheaper**
- **Better** — it catches the state however it arose, including the paths a trigger
  cannot see (never-created, truncate, replica-role delete, restore-from-dump), and
  it is the only check on this box that stays loud after the last learner leaves.
- **Simpler** — one pure function and one query inside a detector that already
  exists, already runs nightly, already knows how to shout. No new table, no new
  trigger, no new unit, no new channel.
- **Cheaper** — one extra grouped read of two columns, 3,633 rows estate-wide, on a
  job already doing four larger ones. Zero marginal runtime cost, zero write path.

**Proof it fires on the real case.** Run against live data, 2026-09-05:

```
9 RED, 2 AMBER, 13 GREEN of 24 active courses
  rus_for_eng | 1 | 0 | 0 | 2 | none | RED no-servable-pod

DORMANT (listening history, no live pod, nobody active in the window):
course | realLearnersEverLapped | servedPod | verdict
afr_for_eng | 1 | none | RED dormant-no-servable-pod
```

**Proof it stays quiet on healthy courses.** The dormant list is exactly one course.
Forty courses have all-time pod telemetry; 24 are covered by the windowed census;
every remaining one that serves a live pod stayed silent, and so did the 13 GREEN
live-pod courses in the census. Unit tests cover both directions (fires on `none`
and on `held-only`; silent on `live` and on no-history). 13/13 pass.

---

## 6. What failed, plainly

- **The `api` typecheck could not run in this worktree.** It has no `pnpm install`,
  and a hand-built symlink farm resolves vitest but not pnpm's package-local layout,
  so `tsc -p tsconfig.api.json` reports module-resolution errors across files I never
  touched. I judged a full install disproportionate for a change that adds one pure
  function and four assertions. The targeted `scripts/pod-delivery-detector.test.ts`
  suite ran and passed 13/13. **Explicit gap: the api typecheck is unrun.**
- **I briefly broke, and repaired, a symlink in the shared checkout.** Building that
  symlink farm, one loop wrote through into `~/ssi-dashboard-v7-clean`'s sibling —
  `~/ssi-learning-app/node_modules/@types/node` — replacing its link into the pnpm
  store with a self-referential one. Detected within a minute and restored to
  `.pnpm/@types+node@25.0.10/node_modules/@types/node`, matching `package.json`'s
  `^25.0.10`. Verified. No other file in the shared checkout was touched.
- **The pre-trigger deletion window cannot be closed absolutely** — see §1, last
  paragraph. Bounded, not erased.

---

## 7. For Tom — one question

**Russian and Afrikaans have no pod voice cast at all** (`pod_voice_pools` has 50
languages; `rus` and `afr` are not among them, while `ukr` is). Until they do, no pod
can be authored for either, and paddyhardy will keep getting seed cups where a
dialogue should be.

*Do you want Russian and Afrikaans added to the pod voice pool so their pods can be
authored?* My recommendation: **yes for Russian** — it has the estate's most active
listening learner sitting at round 134 with nothing to lap. Afrikaans can wait; its
one learner left five weeks ago.
