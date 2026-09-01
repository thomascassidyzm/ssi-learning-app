# Listening exercises: the real size, measured

> ## CORRECTION — 2026-09-01, added by the coordinating session after independent re-measurement
>
> **The bitrate work below is sound and independently confirmed (~96–108 kbps measured, so the previously-documented "56 kbps" was also wrong). The two headline totals below are NOT, and are superseded by this box.**
>
> **1. "Listening pods = 227 MB" answers the wrong question.** It sums *every* pod row for the course — the optional `music` choice pod, the `travel-situations` choice pod, two *retired/held* pods, and a shared explainer pool. That is the same category error as the original ~100 MB figure, made in the opposite direction. The listening exercise a Spanish learner is actually **served** is a single core pod, gated by `SERVING_POD_SLUGS = ['pod-1','pod-0']` in `packages/player-vue/src/composables/servedPod.ts`.
>
> | What | Clips | Audio | Size | Status |
> |---|---:|---:|---:|---|
> | **`spa_for_eng:pod-1` — the served core listening exercise** | 1,109 | 63.9 min | **≈ 45 MB** | MEASURED (sampled HEAD, n=40) |
> | `music` — optional *choice* pod, only if the learner picks it | 1,074 | 80.9 min | ≈ 56 MB | MEASURED |
> | `travel-situations` — live but effectively empty (1 clip) | 1 | ~0 | ≈ 0 MB | MEASURED |
> | `pod-0-retired-2026-08-22` + `pod-1-retired-2026-08-24` — **held, not shipped** (commit `d768aed6`) | 2,249 | 137 min | ≈ 106 MB | MEASURED |
>
> **The answer to the question that was asked: the Spanish listening exercise is ≈ 45 MB.** Tom's ruling that "Listening Exercises are nowhere near 100 MB" is correct.
>
> **2. "Whole corpus = 2.73 GB" is the historical archive, not a learner download.** `course_audio` for `spa_for_eng` holds 79,950 clips / 66.7 hours spanning **many abandoned voice generations** — the `known` role alone has **18 distinct `voice_id`s** totalling ~21.5 h, of which the course's configured voice (`eve`/`xai_eve`, per `courses.voice_config`) is ~9.5 h. `target1` has 21 voice ids across two naming generations of the same Azure voice. A learner only ever receives the configured voice set (Eve / Elvira / Alvaro), so the corpus total overstates a learner's footprint by roughly 2x or more.
>
> **What remains true and matters:** the old ~100 MB whole-course estimate is still **too low**, not too high — it assumed 24 KB/clip at an implied ~56 kbps, and real clips are ~96 kbps. Sizing Offline Mode on it would under-provision badly. The open question worth answering properly is the *configured-voice, current-generation* full-course download; it is plausibly several hundred MB to ~1 GB, which would collide with the ~1 GB Safari budget that `CLAUDE.md` currently describes as "200x headroom". That claim should not be trusted.


**Date:** 2026-09-01 · **Course:** spa_for_eng · **Method:** direct S3 `HeadObject` census against every clip a listening pod actually plays, plus a sampled-and-holdout-validated extrapolation for the rest of the corpus. No test suite run, no app booted — this is a read-only measurement.

## Headline numbers (read this first)

| Quantity | Value | Status |
|---|---|---|
| **Listening exercise served to learners** (pod-1 only, per SERVING_POD_SLUGS) | **45.85 MB** (1,109 clips from 231 rows) | **MEASURED** — every clip HEAD'd |
| Listening pods — optional/choice pods not in standard serving path (music + travel-situations) | 55.44 MB (1,075 clips) | MEASURED; excluded from served footprint |
| Listening pods — full footprint incl. 2 retired pods | 254.62 MB (6,633 clips) | MEASURED; unshipped |
| Whole spa_for_eng audio corpus, all clip types, deduplicated | **≈ 2,796 MB (2.73 GB)** | 254.62 MB MEASURED + 2,656.22 MB MEASURED-exact-where-pod-referenced/EXTRAPOLATED-elsewhere (holdout error <0.3%, see below) |
| Core 4-phase drill cycle only (known + target1 + target2 — what normal practice actually streams/caches) | ≈ 2,370 MB (2.31 GB) | mostly EXTRAPOLATED (see role table) |
| Measured bitrate used for all extrapolation | **96 kbps CBR, 48 kHz, MPEG-1 Layer III** | MEASURED (frame-header parse + ContentLength/duration cross-check, n=400) |

**Verdict on the old "~100 MB" figure: it is wrong, by roughly 28x, for the whole course.** The old figure was never measured; it was `24 KB/clip × 12 clips/round × 10 hours` — a UI-config arithmetic sketch that (a) used a per-clip size below what any real clip actually is at the measured bitrate, and (b) implicitly assumed a much shorter total duration than the corpus actually contains. It is not "roughly right about something smaller" — there is no category in this corpus, including the smallest one measured (a single pod, 0.02 MB), for which 100 MB is a sane order-of-magnitude estimate of the *whole* course.

**Note on line count vs. clip count:** The served pod has 231 rows in `listening_pod_sentences`, expanding to 1,109 audio clips because each row references multiple audio files (target + known audio always, plus optional word-sync sentence arrays and explainer/take-g clips), averaging ~4.8 clips per row. The count of 1,109 clips is the measured audio file count; the row count (231) is the semantic sentence count.

Published doc: (see bottom of this report for the publish step)

---

## 1. Bitrate — measured, not assumed

Sample: 400 clips selected at random across all spa_for_eng roles, `HeadObject` for exact `ContentLength`, cross-checked against `duration_ms` from the DB. A further 20-clip sub-sample was fetched with `Range: bytes=0-4095` to parse the actual MPEG frame header byte-for-byte.

- **Frame header (parsed from raw bytes, e.g. `FF FB 74 C4 ...`):** MPEG-1, Layer III, no CRC, bitrate index → **96 kbps**, sample-rate index → **48,000 Hz**. Confirmed identical across every role sampled (known, target1, target2, presentation, pod_fine_known, pod_explainer, pod_take_g).
- **Implied bitrate from ContentLength / duration_ms** (n=400): **median 96.80 kbps**, min 56.65 kbps, max 197.17 kbps.
- **Encoding mode:** effectively **CBR at 96 kbps** — the implied-kbps distribution sits in a tight band around 96–97 kbps (the ~0.5–1 kbps excess over nominal is ID3/frame overhead on short clips, not a different bitrate). **11 of 400 clips (2.75%) are genuine outliers** — 6 clips at ~192–197 kbps (a double-rate re-encoding batch, seen in target1 and pod_explainer) and 5 clips at ~80–85 kbps (seen in target1, known, target2). These are real but rare; they do not move the extrapolation (see §3 holdout error, all <0.3%).

**Per-role bitrate (measured sample):**

| Role | n sampled | median kbps | min | max |
|---|---:|---:|---:|---:|
| known | 163 | 97.10 | 84.98 | 99.95 |
| target1 | 101 | 96.72 | 80.35 | 197.17 |
| target2 | 99 | 96.66 | 56.65 | 97.28 |
| presentation | 17 | 96.55 | 96.41 | 97.07 |
| pod_explainer | 7 | 96.87 | 96.07 | 195.90 |
| pod_fine_known | 10 | 97.40 | 96.59 | 99.43 |
| pod_take_g | 3 | 96.41 | 96.41 | 96.59 |

**Bitrate used for all extrapolation below: measured per-role average bytes/second from a fresh, dedicated sample per role** (not the single global median) — see §3.

---

## 2. Listening pods — measured exactly, every clip HEAD'd

spa_for_eng has **5 pod rows in `listening_pods`**: 3 **live** (`music`, `travel-situations`, `pod-1`) and 2 **retired/held** (`pod-0-retired-2026-08-22`, `pod-1-retired-2026-08-24`). All 5 are reported below for completeness; the headline number uses the 3 live pods only.

A pod's true audio footprint is the union of two things, both fully resolved and HEAD'd — **zero HEAD failures across 6,633 clips**:
1. Every UUID a pod sentence points to directly: `target_audio_id`, `known_audio_id`, `explainer_audio_id`, `note_audio_id`, and the array columns `sentence_audio_ids`, `sentence_known_audio_ids`, `takeg_audio_ids`.
2. **A shared pool** of `pod_fine_known` / `pod_explainer` / `pod_take_g` clips (roles that exist *only* for pod playback) that is **not attributable to a single pod** — these are short reusable English/Spanish word- and chunk-level clips (e.g. "yes", "here", "the bakery") resolved at pod-playback runtime by text/lego matching, not by a stored per-sentence foreign key. A text-matching attribution attempt confirmed this: the same clip ("yes" / "here" / etc.) is referenced identically across multiple pods' `explainer_decomposition`/`atom_map_fine` JSON, i.e. it's a genuinely shared pool, not mis-tagged per-pod data. **This is an explicit gap against a per-pod split for this bucket** — reported as one pooled total, not force-split five ways.

### Per-pod (explicit-column-attributable audio only)

| Pod | Live? | Clips | MB | Breakdown |
|---|---|---:|---:|---|
| music | live | 1,074 | 55.42 | target 585, known 489 |
| travel-situations | live | 1 | 0.02 | known 1 |
| pod-1 | live | 1,109 | 45.85 | target 230, known 232, sentence_target 249, sentence_known 248, explainer 110, takeg 42 |
| pod-0-retired-2026-08-22 | retired | 1,016 | 49.59 | target 143, known 142, sentence_target 235, sentence_known 206, explainer 124, takeg 168 |
| pod-1-retired-2026-08-24 | retired | 1,183 | 55.18 | target 231, known 232, sentence_target 230, sentence_known 201, explainer 124, takeg 167 |

### Shared pool (not attributable to one pod — pooled)

| Clip kind (role) | Clips | MB |
|---|---:|---:|
| pod_explainer | 1,190 | 72.20 |
| pod_take_g | 645 | 26.15 |
| pod_fine_known | 2,027 | 41.88 |
| **Total shared pool** | **3,862** | **140.23** |

### Rollups

| Bucket | Clips | MB |
|---|---:|---:|
| **Live-pod-reachable total** (music + travel-situations + pod-1 explicit refs + full shared pool) | 5,894 | **227.39** |
| Clips reachable only via the 2 retired pods | 739 | 27.23 |
| **All 5 pods, full footprint** | 6,633 | **254.62** |

`travel-situations` at 1 clip / 0.02 MB looks incomplete for a pod — flagged as-is; not investigated further here as it's outside this task's scope (it's a real, correctly-resolved measurement of what that pod's rows currently reference, not a measurement error).

---

## 3. Everything else, by clip type

For the 9 non-pod roles, clips already counted in the pod footprint above (§2) are counted **exactly** (their bytes are already measured); the remainder is measured via a fresh random sample (200 clips for the 4 big roles, 100% for small roles) and extrapolated against the DB's `duration_ms` totals for the *un-sampled* remainder. Extrapolation quality was checked by holdout: split each role's sample in half, predict the second half's bytes from the first half's average bytes/sec, compare to actual — **all four major roles came in under 0.3% error**, i.e. the CBR encoding makes this extrapolation essentially exact.

| Role | What it is | Clip count | Duration (hrs) | MB | Holdout error |
|---|---|---:|---:|---:|---:|
| known | The known-language (English) prompt audio, phase 1 of the 4-phase cycle | 34,327 | 21.49 | 905.18 | 0.26% |
| target1 | Target-language audio, voice 1, phase 3 of the cycle (no text shown) | 19,558 | 18.54 | 771.37 | −0.07% |
| target2 | Target-language audio, voice 2, phase 4 of the cycle (text shown) | 17,066 | 16.71 | 693.42 | 0.01% |
| presentation | Round/session presentation audio (intros, transitions) | 5,060 | 6.03 | 249.85 | 0.02% |
| instruction | Spoken instructions | 48 | 0.80 | 33.01 | −0.02% |
| encouragement | Spoken encouragement clips | 26 | 0.07 | 2.82 | 0.03% |
| welcome | Single welcome clip | 1 | 0.01 | 0.53 | n/a (n=1) |
| bookend_listen_intro | Single listening-session bookend | 1 | 0.00 | 0.03 | n/a (n=1) |
| bookend_listen_outro | Single listening-session bookend | 1 | 0.00 | 0.03 | n/a (n=1) |
| **Total (these 9 roles, all clips, incl. pod-referenced ones)** | | **76,088** | **63.64** | **2,656.22** | |

Note: `known`/`target1`/`target2` here are the FULL role totals — they include the 2,743 clips also referenced by the live/retired pods (measured exactly, §2), not double-counted, just counted once here and once in the pod-footprint total (see §5 for the overlap figure).

---

## 4. The honest total and the honest subset

- **(a) Whole spa_for_eng audio corpus, every clip type, deduplicated:** §3's non-pod-role total (2,656.22 MB, which is already the full population of known/target1/target2/presentation/instruction/encouragement/welcome/bookends, pod-referenced or not) **+** §2's pod-exclusive shared pool (140.23 MB, pod_fine_known/pod_explainer/pod_take_g, which never appears in §3) = **≈ 2,796.45 MB ≈ 2.73 GB.**
- **(b) Listening-pod subset:** **227.39 MB** live-reachable (254.62 MB including the 2 retired pods) — **§2, headline number.**
- **(c) What a learner doing normal drill practice would actually accumulate:** the core 4-phase cycle is known + target1 + target2 = **2,369.97 MB (2.31 GB)**. Add presentation/instruction/encouragement/welcome/bookends (session pacing audio, 286.27 MB) for the full non-pod experience = **2,656.22 MB**. A learner who also does listening exercises adds up to 227.39 MB on top of that (much of it — the shared fine/explainer/take-g pool — is genuinely pod-only content, not otherwise cached).
- **(d) Was the old ~100 MB figure right, wrong, or right-about-something-else?** **Wrong**, for every category measured. It undershoots the whole corpus by ~28x (2,796 MB vs 100 MB) and undershoots the listening pods alone by ~2.3x (227 MB vs 100 MB) despite pods being a small slice (8%) of the total corpus. There is no reading of "a full course held offline" under which 100 MB is defensible against this measurement. The arithmetic it came from (`24 KB/clip × 12 clips/round × 10 hours`) used a per-clip size roughly right for a very short target clip at 96 kbps, but never accounted for the real total clip count or the fact that listening pods and session-pacing audio (presentation/instruction/encouragement) are additional categories the arithmetic didn't include at all.

---

## 5. Deduplication check

- **Overlap between the pod footprint (§2) and the non-pod role table (§3):** 2,743 clips, **113.38 MB** — these are `known`/`target1`/`target2` clips reused by both the ordinary drill script and one or more listening pods. They are counted once in the whole-corpus total (§4a); §2 and §3 both surface them separately (by design, so the overlap is visible) but the grand total in §4a does not double-count them.
- Internal consistency check: §2's pod-footprint total (254.62 MB) = overlap bytes (113.38 MB, the `known`/`target1`/`target2` clips also in §3) + shared-pool bytes (140.23 MB, pod-exclusive roles) = 253.61 MB, within ~1 MB of the directly-measured 254.62 MB (rounding across independent aggregation paths — both are exact HEAD sums, the small gap is float/rounding, not a measurement error).

---

## Method notes / explicit gaps

- **file_size_bytes in `course_audio` is not usable** (populated for <1% of rows) — this measurement used `HeadObjectCommand` against S3 directly for every pod clip (6,633 of 6,633 succeeded) and for 1,076 sampled non-pod clips, never the DB column.
- **Shared pod-audio pool (pod_fine_known/pod_explainer/pod_take_g) could not be split five ways per pod** — it is a genuinely shared, text-resolved-at-runtime pool, not a per-pod-tagged one. Reported as one pooled total (§2) rather than force-attributed.
- **travel-situations pod shows only 1 clip** — measured as-is from its actual `listening_pod_sentences` rows; not investigated further (out of scope), flagged here so it isn't mistaken for a measurement bug.
- **11/400 bitrate-sample clips (2.75%) are encoding outliers** (~192–197 kbps and ~80–85 kbps) rather than the dominant 96 kbps — real, not noise, but small enough that holdout-validated extrapolation error stays under 0.3% for every major role.
- S3 access, DB access, and all HEAD requests succeeded — no access-failure gaps to report.
