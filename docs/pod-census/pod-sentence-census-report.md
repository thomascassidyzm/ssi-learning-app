# Pod-sentence census — 2026-08-24

Read-only census of `listening_pod_sentences` across every live `pod-1` row, run against the live DB (sanity check: `courses` returned 149 rows, confirming the service key had full access, not the undercounting public key). Raw data: `docs/pod-census/pod-sentence-census.json` (also mirrored to scratch).

## Headline numbers

- **Bucket B (the reported bug — sentence text silently dropped on screen): 0 rows**, across all 22 live pod-1 courses that the boundary regex can split. The text-loss bug is **not currently present** in live data.
- **Bucket D (stale-slice — dangling clip ids, falls back to whole-turn safely): 0 rows.** All 6,109 distinct split clip ids referenced by live rows exist in `course_audio`.
- **Bucket F (known-side per-sentence audio cleared): 1,709 rows.** Of these, **1,296 show direct evidence of being cleared by today's event** (the retired-2026-08-24 copy of the same row still has a populated `sentence_known_audio_ids`, the live one doesn't); 356 never had a known-side split (pre-existing, not today's event); 57 have no matching retired copy to compare against.
- **Bucket E (target-side per-sentence audio cleared, text-safe via whole-turn fallback): 121 rows.** Of these, **56 show evidence of being cleared today**; 64 were never split; 1 has no retired match.
- **The clearing event was wider than the suspect window.** The brief flagged 11:00–11:30Z; the rows with retired-copy evidence of clearing actually span **11:12Z to 12:49Z** (501 rows updated in the 11:xx hour, 795 in the 12:xx hour) — nearly 1h37m, not 30 minutes.
- **Bucket C (clips outnumber text-sentences — possible mis-split/duplicate text): 18 rows**, all in `ara_eg_for_eng` (8) and `ara_for_eng` (10).

## Excluded from B/C classification (script can't split their text)

`hin_for_eng`, `jpn_for_eng`, `kor_for_eng`, `zho_for_eng` — the Latin-punctuation boundary regex (`(?<=[.!?…])\s+`) cannot split Devanagari/Japanese/Korean/Chinese text (no-space or non-Latin sentence punctuation), exactly as the app's own `splitRowUnits` doc warns. These courses' clips≥2 rows (48/97/86/74 respectively) are counted separately as `EXCLUDED_SCRIPT`, not folded into B or C — counting them would have produced false positives/negatives. No text-loss (B) claim is made for these four courses one way or the other; a real answer would need per-clip `course_audio` text comparison (the `textById` path the app itself uses), which this census did not attempt.

## Per-course table (live pod-1)

| course | total | A healthy | B TEXT-LOSS | C clips>text | D stale-slice | E target-cleared | F known-cleared | excluded (script) | retired rows (blast radius) |
|---|---|---|---|---|---|---|---|---|---|
| ara_eg_for_eng | 231 | 89 | 0 | 8 | 0 | 2 | 89 | 0 | 373 |
| ara_for_eng | 231 | 89 | 0 | 10 | 0 | 1 | 92 | 0 | 373 |
| deu_at_for_eng | 231 | 86 | 0 | 0 | 0 | 14 | 86 | 0 | 231 |
| deu_for_eng | 231 | 92 | 0 | 0 | 0 | 8 | 92 | 0 | 373 |
| eus_for_eng | 231 | 100 | 0 | 0 | 0 | 0 | 84 | 0 | 373 |
| fra_ca_for_eng | 231 | 100 | 0 | 0 | 0 | 0 | 94 | 0 | 232 |
| fra_for_eng | 231 | 96 | 0 | 0 | 0 | 4 | 96 | 0 | 373 |
| gle_for_eng | 231 | 99 | 0 | 0 | 0 | 1 | 92 | 0 | 142 |
| hin_for_eng | 231 | 0 | 0 | 0 | 0 | 0 | 47 | 48 | 142 |
| hrv_for_eng | 231 | 53 | 0 | 0 | 0 | 78 | 37 | 0 | 553 |
| isl_for_eng | 231 | 100 | 0 | 0 | 0 | 0 | 93 | 0 | 142 |
| ita_for_eng | 231 | 99 | 0 | 0 | 0 | 1 | 25 | 0 | 373 |
| jpn_for_eng | 231 | 0 | 0 | 0 | 0 | 0 | 55 | 97 | 373 |
| kor_for_eng | 231 | 0 | 0 | 0 | 0 | 0 | 43 | 86 | 373 |
| nld_for_eng | 231 | 96 | 0 | 0 | 0 | 4 | 92 | 0 | 142 |
| por_br_for_eng | 231 | 98 | 0 | 0 | 0 | 2 | 93 | 0 | 373 |
| por_for_eng | 231 | 98 | 0 | 0 | 0 | 2 | 94 | 0 | 373 |
| ron_for_eng | 231 | 100 | 0 | 0 | 0 | 0 | 90 | 0 | 373 |
| spa_for_eng | 231 | 98 | 0 | 0 | 0 | 2 | 67 | 0 | 373 |
| spa_mx_for_eng | 231 | 100 | 0 | 0 | 0 | 0 | 94 | 0 | 373 |
| swe_for_eng | 231 | 98 | 0 | 0 | 0 | 2 | 92 | 0 | 373 |
| zho_for_eng | 231 | 0 | 0 | 0 | 0 | 0 | 62 | 74 | 373 |

Note on `hrv_for_eng`: it stands out with E=78 (by far the highest) and F=37 (lowest among splittable courses), and 553 retired rows (3 generations — `pod-0-retired-2026-08-22`, `pod-1-retired-2026-08-22`, `pod-1-retired-2026-08-24` — one more retirement cycle than any other course). Worth a closer look separately; not otherwise explained by this census.

Note on `deu_at_for_eng`: only course whose retired copy is a `pod-0` generation, not `pod-1` — so its F=86 rows could not be cross-checked against a same-generation retired snapshot (all 86 fall into "no retired copy found" or "never split", not "likely cleared"; see JSON for the exact split).

## Bucket B — TEXT-LOSS (the reported bug): empty

No rows to list. Checked specifically: `ita_for_eng:pod-1` Scene 1 (the reported case) — all 4 rows in that scene are currently either single-sentence, or have a clip count matching their sentence count exactly (2 sentences/2 clips, 3 sentences/3 clips). The bug is not reproducible against current live data by this text-vs-clip-count test.

## Bucket D — STALE-SLICE: empty

No rows to list. All 6,109 distinct clip ids referenced across live rows' `sentence_audio_ids`/`sentence_known_audio_ids` exist in `course_audio`.

## Buckets E and F — full row-level lists

Too large to inline here (121 + 1,709 = 1,830 rows). Full detail — course, row id, `pod_id`, `updated_at`, target/known text, clip counts, retired-copy match count, and the per-row evidence verdict (`likely CLEARED` / `never split` / `no retired copy found`) — is in `docs/pod-census/pod-sentence-census.json` under `bucketLists.E` and `bucketLists.F`.

Evidence-verdict breakdown:

| bucket | likely CLEARED today | never split (pre-existing) | no retired copy to compare |
|---|---|---|---|
| E (target-side) | 56 | 64 | 1 |
| F (known-side) | 1,296 | 356 | 57 |

## Explicit gaps

- **CJK/Devanagari text-loss (B) not determinable** for hin/jpn/kor/zho — see exclusion note above. If a text-loss check is needed for these, it must compare each split clip's stored `course_audio.text` (the `textById` path) rather than a punctuation-regex sentence count.
- **`ara_sy_for_eng`** has no `pod-1` yet (only `pod-0` and a `pod-1-staged-2026-08-23`) — excluded from this census as it isn't live.
- **`deu_at_for_eng`** retired-copy cross-check is weaker than other courses (generation mismatch, see note above) — the 86 F-bucket rows there are not confidently attributable to today's event or not.
- Course-code inference used `pod_id.split(':')[0]` (no dedicated `course_code` column on this table) — verified correct against the `fra_for_eng` live/retired pair (231/231 rows, identical `scene_number`/`sentence_number`/`global_order`) but not spot-checked for every course.
