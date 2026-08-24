# Chopped-clip census — how much is still broken, and where

**2026-08-06.** Answers Aran's field report: German clips are still chopped after the repair pass.
Data analysis only. No app code, no course data and no audio was modified.

---

## The three answers, up front

| Question | Answer |
|---|---|
| **Q1. German clips still chopped and unrepaired** | **7,254 flagged** out of 46,277 unrepaired (15.7%). Corrected for the detector's measured 46% recall, the true figure is **~15,100 clips, roughly a third of the course**. |
| **Q2. Do the other paid courses have it?** | **22 of 88 courses carry it; 66 are clean.** It is NOT estate-wide. Crucially the flagship paid courses — Spanish, Italian, Portuguese, Japanese, Korean, Chinese-for-English — are **clean**. The two paid courses that are badly hit are **German (15.5%)** and **French (8.6%)**. |
| **Q3. Why did the repair miss them?** | The repair pass never looked at them. **1,024 of 47,267 German clips (2.2%) ever entered the repair funnel.** Aran's two bad clips have no candidate row at all — never proposed, not rejected. The pass is a paced scan at ~1.7 s/clip that was still running this morning and had covered 2% of one course. |

**Ready to be live?** For most of the estate, yes. For **German and French, no** — and those are paid Big-10 courses. The honest headline is that this is a two-course emergency, not a fleet-wide one.

---

## The detector, and its honest precision

**What it measures.** A properly-finished utterance decays into silence. A clip cut mid-sound ends while
the speech is still loud. The metric is `final_db` — the RMS of the last speech frame before the trailing
silence, relative to the clip's own peak (20 ms windows, silence gate at −40 dB). Higher = cut off harder.

**How it was calibrated.** All 978 repaired German clips were fetched at **both** revisions through the
production proxy (`/api/audio/<id>.v1` and `.v2`) and measured — 1,956 files, giving matched
before/after pairs on identical text and, verified, **the identical voice** (eve→eve, ara→ara, leo→leo).

| | median `final_db` | flagged at −16 dB |
|---|---|---|
| **v1, pre-repair** | −20.0 dB | 36.5% |
| **v2, post-repair** | −34.3 dB | **0.7%** |

Holds within every voice separately — pre 35.6–38.3%, post 0.3–1.4%. It is not a voice artefact.

**Operating point (threshold `final_db > −16 dB`):**

| | value |
|---|---|
| Recall | **46.1%** |
| False-positive rate | **0.72%** |
| Precision at the observed German rate | **~94%** |

Other points on the curve: `> −12 dB` gives 26% recall at **0.00%** false positives (3,957 German clips —
a zero-doubt subset); `> −20 dB` gives 62% recall at 3.2% false positives (11,160 German clips).

### What this means — read this before quoting a number

**Every count in this report is a floor.** At 46% recall the detector finds fewer than half of them.
The "estimated" columns divide by recall to correct for that, and carry the wider uncertainty.

---

## Explicit gaps and weaknesses

- **Recall is only 46%.** The flagged counts are floors; the estimates are the honest figures and they
  have real uncertainty. Do not treat 7,254 as "the number of broken German clips" — treat ~15,000 as
  the central estimate and 7,254 as the number I can point at individually today.
- **It misses one of Aran's own two examples.** The German `so oft wie möglich` target2 clip
  (`6eb603fc`, −16.6 dB) is flagged. The English `as often as possible` known clip (`4b3fb29d`,
  −26.5 dB) is **not** flagged at the headline threshold, despite Aran hearing it as chopped. That is a
  measured miss on the motivating case, and it is the clearest evidence that recall is genuinely
  partial rather than conservatively stated.
- **No human has listened to a flagged clip.** Every verdict here is instrument-based. The instrument
  is anchored to human judgement only indirectly: Tom accepted 247 of the repairs by ear
  ("excellent work across all samples"), and those replacements measure clean where their originals
  measured hot. A listening pass on ~20 flagged-but-unrepaired clips would settle it in ten minutes and
  is the single highest-value next check.
- **This is a different defect from the one the emergency doc chased.** That was *missing words*
  (25–45% of the clip deleted). This is *the final sound cut short* — tens of milliseconds. Proven:
  cross-voice duration pairing does **not** separate flagged from passed clips (10.0% vs 9.9% are ≥15%
  shorter than their clean twin), and unprimed whisper hears the full text in flagged clips. So the
  two classes are largely independent and **both** are live. The word-loss counts and these counts do
  not overlap much and should not be added together casually.
- **Per-course figures are samples, not censuses.** 420 clips per course, so ±1–3.5% on the flag rate.
  Only German was scanned exhaustively (all 46,277 unrepaired clips).
- **`presentation` clips are under-represented in the German list** (140 flagged). The repair tool
  refuses `role=presentation` by design — that gap is already documented and is unchanged.
- **Sampling covers courses with ≥1,200 clips.** Very small courses were not sampled.

---

## Q2 — the per-course table

Full machine-readable version: [`per-course.json`](./per-course.json). Courses with any signal above the
0.72% false-positive baseline:

| course | clips | sampled | flagged | est. affected rate | est. clips (95% range) |
|---|---:|---:|---:|---:|---:|
| deu_for_eng | 47,267 | 420 | 15.5% | 32.0% | **15,130** (11,583–18,676) |
| zho_for_hin | 39,461 | 420 | 15.7% | 32.5% | **12,835** (9,856–15,814) |
| fra_for_eng | 51,369 | 420 | 8.6% | 17.0% | **8,749** (5,765–11,732) |
| eng_for_ben | 49,356 | 420 | 8.3% | 16.5% | 8,151 (5,321–10,981) |
| eng_for_hin | 51,279 | 420 | 7.1% | 13.9% | 7,144 (4,405–9,884) |
| eng_for_tam | 55,618 | 420 | 4.3% | 7.7% | 4,302 (1,965–6,639) |
| eng_for_tel | 40,952 | 420 | 5.2% | 9.8% | 4,014 (2,121–5,906) |
| eng_for_kan | 44,689 | 420 | 4.3% | 7.7% | 3,457 (1,579–5,334) |
| eng_for_mar | 39,373 | 420 | 3.8% | 6.7% | 2,639 (1,075–4,202) |
| zho_for_tam | 32,166 | 420 | 3.6% | 6.2% | 1,990 (751–3,228) |
| eng_for_guj | 53,263 | 420 | 2.4% | 3.6% | 1,919 (234–3,604) |
| por_br_for_eng | 47,733 | 420 | 1.9% | 2.6% | 1,227 (0–2,580) |
| eng_for_urd | 47,140 | 420 | 1.9% | 2.6% | 1,211 (0–2,547) |
| eng_for_pan | 51,248 | 420 | 1.4% | 1.5% | 788 (0–2,024) |
| fra_ca_for_eng | 61,030 | 420 | 1.2% | 1.0% | 623 (0–1,930) |
| kor_for_hin | 43,425 | 420 | 1.2% | 1.0% | 443 (0–1,373) |
| cym_s_for_eng | 20,770 | 420 | 1.7% | 2.1% | 427 (0–966) |
| cym_n_for_eng | 19,915 | 420 | 1.7% | 2.1% | 409 (0–926) |
| eng_for_sin | 51,473 | 420 | 1.0% | 0.5% | 259 (0–1,283) |
| spa_mx_for_eng | 43,748 | 420 | 1.0% | 0.5% | 221 (0–1,091) |
| zho_for_eng | 40,956 | 420 | 1.0% | 0.5% | 206 (0–1,021) |
| ita_for_jpn | 19,818 | 420 | 1.0% | 0.5% | 100 (0–494) |

**The other 66 courses measured at or below the 0.72% false-positive baseline** — indistinguishable from
clean. That includes `spa_for_eng` (0.5%), `ita_for_eng` (0.0%), `por_for_eng` (0.0%), `jpn_for_eng`
(0.0%), `kor_for_eng` (0.7%), `ara_for_eng` (0.5%), `tur_for_eng` (0.0%), `nld_for_eng` (0.0%),
`pol_for_eng` (0.0%), `rus_for_eng` (0.0%).

**Estate total across affected courses: ~76,000 clips**, of which ~37,000 sit in the top five.

### What the affected courses have in common: the voice, not the course

The flagged clips concentrate on specific TTS voice families — the xAI voices (`xai_ara`, `xai_eve`,
`xai_leo`, `xai_bedd6226`, `xai_gfzdpspr5fdp`) and the `eve`/`ara`/`leo` set, plus `legacy_import` in
Welsh. Courses built on other providers are clean. Within German the rate splits by voice too:
`ara` 20.3%, `eve` 13.8%, `leo` 13.7%, `gfzdpspr5fdp` **0.0%** (n=233).

That is the lead for the permanent fix: this looks like a **render/mastering trailing-trim behaviour
specific to certain voice pipelines**, not a per-course authoring problem. It is also why it did not
break out by month — the flag rate is 6.5–20.8% across every month from January to August with **no
break at the 2026-08-05 15:40 Z tail-repair fix**. So this defect is *not* the `repairTailDefect` bug
that the first-five-seeds emergency chased, and it was **not** fixed by deleting that capability.

---

## Q3 — why the repair pass missed them

**Primary cause: the pass has covered 2% of one course.** It is not a filter bug.

| | |
|---|---|
| German clips in the course | 47,267 |
| Clips that ever entered the repair funnel (`audio_repair_candidates`) | **1,024 (2.2%)** |
| Candidates accepted | 981 |
| Superseded | 117 |
| **Still pending, undecided** | **46** |
| Candidate rows for any course other than German | **0** |
| First proposal | 2026-08-05 21:45 Z |
| Last proposal | 2026-08-06 08:42 Z — i.e. it was still running this morning |

**Aran's clips, specifically.** Of the three:

| clip | id | revision | in candidates table? |
|---|---|---|---|
| `so oft wie möglich` target1 | `414ebf08` | 2, repaired | yes — proposed 2026-08-05 23:32, accepted |
| `so oft wie möglich` target2 | `6eb603fc` | 1 | **no row at all** |
| `as often as possible` known | `4b3fb29d` | 1 | **no row at all** |

Never proposed, never rejected — the scan had not reached them. This distinction matters for the fix:
there is nothing to un-reject and no threshold to loosen. The queue simply has to be run.

**Why it is so slow.** The selector is `tools/audio-word-loss-scan.cjs`. It runs unprimed whisper on the
deployed bytes at **~1.7 s/clip at concurrency 4**; its own header says a 50,000-clip course is "several
hours". `legoFirst()` (line 169) orders LEGO-reachable clips first, which is what produces the "campaign
tier 1/2/3" strings in the ledger. Ordering was sensible; throughput is the problem.

**A secondary, forward-looking concern — the selector cannot see this defect class.** That same file's
header records a deliberate decision to **abandon tail-based selection** because it flagged too many
healthy clips, in favour of measuring missing words. But the defect Aran is reporting *is* the tail
class: unprimed whisper hears the full text in his clips, including in the chopped `v1` of the one that
got repaired. So a scan selecting on word-loss will not queue these clips **however long it runs**.

I want to be careful not to over-claim this. It is **not** the proven cause of Aran's specific miss —
both the human-accepted tail-queue phase and the machine word-loss phase repaired populations with
essentially identical edge profiles (37% vs 36% edge-clipped), so in practice both were picking up
similar clips. The proven cause is coverage. But going forward, word-loss selection alone will not
converge on this class, and the detector in this directory is the missing selector.

**Also worth knowing:** nothing populates the six `veracity_*` columns on `course_audio` — still zero
rows with a recorded verdict across 2.54 M clips. Every audit has to re-measure from scratch.

---

## The re-repair list

[`deu-still-chopped.json`](./deu-still-chopped.json) — **7,254 German clip ids**, complete for the course
(all 46,277 unrepaired clips were measured, not sampled), sorted worst-first by `final_db`.

Each item carries `audio_id`, `course_code`, `role`, `voice_id`, `language`, `duration_ms`, `text`,
`final_db`, `tail_ms` and the render month. Format feeds `audio-repair.cjs propose --targets`.

Role split: target1 3,036 · known 2,103 · target2 1,942 · presentation 140 · pod 33. **Both sides are
hit, which is exactly what Aran reported** — "in English AND German".

Suggested order of attack, since 7,254 re-renders is not a single sitting:
1. The **3,957 clips above −12 dB** — the zero-false-positive subset. Nothing in here is a wasted render.
2. The rest of the German list.
3. Re-run the detector across `fra_for_eng` in full (~51k clips, about 25 minutes) and repair from that.
4. `zho_for_hin` and the `eng_for_<Indic>` family.

[`edge-clip-detector.py`](./edge-clip-detector.py) is the measurement worker, so any course can be
scanned the same way. It reads clip ids on stdin, fetches through the production proxy and emits
`id, duration_ms, trailing_silence_ms, final_db, decay_slope`. Throughput is ~30–40 clips/s at
concurrency 10 — a whole course in under half an hour, against several hours for the whisper scan.

```bash
cat ids.txt | xargs -P 10 -n 60 sh -c 'printf "%s\n" "$@" | python3 edge-clip-detector.py' _ > out.tsv
awk -F'\t' 'NF>=5 && $4 > -16 {print $1}' out.tsv   # flagged ids
```

---

## Method notes

- DB read directly via `pg` using `DATABASE_URL` from `ssi-dashboard-v7-clean/.env.psql`. No `psql`
  binary on this box; PostgREST times out on unindexed sorts over `course_audio` as warned.
- Audio fetched through the **production proxy** `https://saysomethingin.app/api/audio/<id>`, so every
  measurement is of the bytes a learner actually receives, not of storage.
- 84,238 clips measured in total: 1,956 calibration (978 × 2 revisions), 46,277 German census,
  36,961 estate sample (420 × 88 courses). One fetch failure.
- Duration-vs-text-length detection was tried first and **rejected**: at zero false positives it recalled
  only 19%, and the ledger's duration deltas turned out not to be a clean label — only 483 of 978
  repairs lengthened the clip by ≥15%, and repaired clips run 33% slower per character than the course
  median, so re-render pacing confounds the delta. That approach is not usable and is recorded here so
  nobody spends a day rediscovering it.
