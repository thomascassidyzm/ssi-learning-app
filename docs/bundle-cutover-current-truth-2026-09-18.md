# The bundle cutover — what the code actually says, 2026-09-18

*A read-only audit. No code was changed. Every claim below is tied to a file, a
commit or a query; anything that could not be read from here is named as a gap.*

**One line first.** The cutover is further along than its status document says —
step 6 shipped on 29 August, 83 minutes after that document was last written, and
nobody went back to it. What is genuinely unfinished is step 7, and the cost of
leaving it unfinished is that **two script paths are live at once**, which is the
thing that bit twice this week.

---

## 1. The phase table as it really is today

The status document is `docs/bundle-cutover-status.md`, last written in commit
`709f0dd1e` at **18:44 UTC on 2026-08-29**. Step 6 landed in `461d81af1` at
**20:07 UTC the same evening** — with its verification harness at 20:28
(`cf51e2842`), a performance repair at 20:51 (`37327b510`) and a further fix at
22:25 (`522bcfe56`). The document was simply overtaken by the evening's own work
and never revised. That is the whole explanation for the gap between doc and code;
there was no change of plan behind it.

| # | Step | Status doc says | **What the code says today** | Evidence |
|---|---|---|---|---|
| 1 | Generator promoted to `@ssi/core`, `GENERATOR_VERSION`, re-export shims | DONE | **DONE** | `eec98f09`; `packages/core/src/script/generateScript.ts` |
| 2 | Bundle enriched — `scriptShape`, seed text+audio, `?head=1` probe | DONE | **DONE** | `eec98f09`; `api/courses/[code]/bundle.ts` (1,034 lines) |
| 3 | Generator parity — shape injection, seed-phase reviews ≥144, golden master | DONE | **DONE**, and since superseded by something better: the two selection algorithms were merged into one shared module rather than policed by a diff | `95bd4a1e`; then `522bcfe56` → `packages/core/src/script/phraseSelection.ts` |
| 4 | Client bundle store `useCourseBundle` | DONE | **DONE** | `53b4a00d`; `packages/player-vue/src/composables/useCourseBundle.ts` |
| 5 | Bootstrap cut over (retires the JIT endpoints for flagged courses) | DONE, 15 courses | **DONE**, still exactly 15 courses, unchanged since 29 Aug | `53b4a00d`, `9d27521e`; `useInstantPlayback.ts:189-230` |
| 5b | `gloss_segments` in the bundle; INF PLAY cut over | DONE | **DONE** | `e1dd52bb`, `464ba654` |
| 6 | **Cut the full walk over** | **"not started"** | **DONE for the 15 flagged courses — and it has been since 29 August.** `fullScriptFromBundle()` at `LearningPlayer.vue:601` builds the whole course from the bundle already in memory and returns `null` on anything at all going wrong, so the walk stays as the fallback | `461d81af1`, `37327b510`; `providers/bundleFullScript.ts`; `docs/bundle-cutover-step6-verified-2026-08-29.md` |
| 7 | Repoint stragglers, delete the walk, `REVOKE` anon on content tables | "not started" | **NOT DONE — correctly reported.** See below | |

**Step 6, stated plainly.** On any of the 15 flagged courses the browser no longer
walks the database to build the session: it builds the whole course from the one
bundle it already downloaded. Measured at the time on `spa_for_eng`, cold, signed
in: **7,938 ms to a pressable play button before, 5,121 ms after, and 124 Supabase
queries down to 74** (`docs/bundle-cutover-step6-verified-2026-08-29.md` §0).

**Step 7, stated plainly — nothing has been done.** Three separate things are all
still true today:

- `providers/generateLearningScript.ts` still exists and is still 2,133 lines. It
  is not dead code: it is the live path for every course outside the 15, the
  fallback for all 15, and the generator behind `CourseExplorer.vue` (via
  `composables/useFullCourseScript.ts`) and `composables/useEagerScriptPreload.ts`.
- The three JIT endpoints are all still deployed and still reachable —
  `api/courses/[code]/cycles.ts` (1,114 lines), `infplay-cycles.ts` (449),
  `round-map.ts` (178) — and `views/EmbedDemoView.vue:149` still calls `/cycles`
  directly.
- **The anon `SELECT` grant on the content tables is untouched.** `supabase/schema.sql`
  still carries `CREATE POLICY "Anon can read course_legos" … TO anon USING (true)`
  (line 19934), the same for `course_practice_phrases` (19941) and `course_seeds`
  (20104). That is the whole paid content of every course readable from a browser
  with the public key, and it stays that way until the walk is gone. It is the
  single largest prize in finishing this, and it is entirely unclaimed.

**One correction to the status doc's own framing.** It closes by saying
`BUNDLE_BOOTSTRAP_ALL = true` is "a one-line change gated on the soak, not on
missing work." The one-line part is true. The "not on missing work" part is now
doubtful: two real divergences between the paths were found and fixed *this week*
(`997faff61`, `190104618`), three weeks after that sentence was written — which
says the evidence-only flag list was doing more work than "soak" implies.

---

## 2. Which courses are on which path, in production right now

*Census by #227·H against the live database, 2026-09-18. Standalone copy, with every query
text in full: https://watson-1.tail4968cb.ts.net/d/785d3b98*


- **Live** = what the app's own catalogue read selects: `courses.new_app_status IN ('live','beta')`
  (`packages/player-vue/src/App.vue:668`, and the stamp query at `:696`). That is the filter the
  learner-facing course list actually uses — **not** `status`, **not** `visibility`. All four
  status-ish columns are reported per course below so you can see them disagree.
- **Path** = `isBundleBootstrapEnabled()` in `packages/player-vue/src/composables/useInstantPlayback.ts:230`.
  `BUNDLE_BOOTSTRAP_ALL = false`; `BUNDLE_BOOTSTRAP_COURSES` is a literal Set of 15 codes (re-read
  from the tree today, unchanged from the 15 in the brief). Everything else is on the walk.
- **Play volume** = rows in `player_events` with `event_type = 'audio_play'`. Chosen because it is
  the documented play log (CLAUDE.md: `audio_plays` was dropped 2026-05-19, `player_events.audio_play`
  is the source of truth), and because in a 24h sample it is 86% of all player events
  (1,651 of 2,000: audio_play 1,651, adaptation_plan 263, audio_failed 83, audio_interrupted 2,
  adaptation_persistence_error 1). One `audio_play` row ≈ one clip played, so it is a work-done
  measure, not a learner-count measure — read it alongside the distinct-learner columns.
- **7d** = `occurred_at >= 2026-09-11`. **30d** = `occurred_at >= 2026-08-19`.

**Columns that exist on `courses`** (`GET /rest/v1/courses?select=*&limit=1`): `course_code,
display_name, known_lang, target_lang, voice_config, course_type, status, creator_email, created_at,
updated_at, seed_count, translation_analysis, new_app_status, legacy_app_status, new_app_beta_started_at,
legacy_app_beta_started_at, export_ready, quality_rules, content_version, visibility, pricing_tier,
is_community, released_at, featured_order, learner_display_name, variant_label, needs_gender_prep,
gender_prep_check_notes, gender_prep_checked_at, version, content_stamp, audio_stamp,
record_full_max_seed, voice_pool_key, dialect, known_dialect`.
Value spread across all 150 rows: `status` draft 70 / beta 58 / released 22 · `new_app_status`
not_available 66 / beta 59 / live 20 / draft 5 · `legacy_app_status` not_available 144 / draft 4 /
beta 2 · `visibility` public 79 / hidden 63 / beta 7 / private 1 · `pricing_tier` premium 107 /
free 43 · `is_community` false ×150 · `course_type` official 149 / template 1 · `export_ready`
false ×150.

---

### 1. The live catalogue

150 rows in `courses`; **79 are live to learners** (`new_app_status IN ('live','beta')`).
**15 of those 79 are on the bundle. 64 are on the walk.** All 15 bundle codes exist and are live —
none is stranded, none is missing from the table.

Sorted by 30-day play volume, descending.

```
GET /rest/v1/courses?select=course_code,display_name,learner_display_name,known_lang,target_lang,\
    course_type,status,new_app_status,legacy_app_status,visibility,pricing_tier,is_community,\
    released_at,export_ready,seed_count&order=course_code
```

| course_code | title | known→target | new_app_status | visibility | pricing_tier | seeds | path | plays 7d | plays 30d | sessions 30d | learners 30d |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `eus_for_eng` | Basque for English Speakers | eng→eus | beta | public | free | 300 | **BUNDLE** | 24549 | 41548 | 54 | 7 |
| `cym_s_for_eng` | South Welsh for English Speakers | eng→cym | live | public | premium | 300 | **BUNDLE** | 17241 | 22241 | 246 | 142 |
| `cym_n_for_eng` | North Welsh for English Speakers | eng→cym | live | public | premium | 300 | **walk** | 4715 | 18364 | 136 | 15 |
| `fra_for_eng` | French for English Speakers | eng→fra | beta | public | premium | 668 | **BUNDLE** | 4806 | 18274 | 67 | 9 |
| `pol_for_eng` | Polish for English Speakers | eng→pol | beta | public | free | 300 | **BUNDLE** | 3851 | 13917 | 81 | 2 |
| `swe_for_eng` | Swedish for English Speakers | eng→swe | beta | public | free | 300 | **walk** | 3185 | 13034 | 34 | 3 |
| `nld_for_eng` | Dutch for English Speakers | eng→nld | beta | beta | free | 300 | **BUNDLE** | 2115 | 9118 | 44 | 5 |
| `ell_for_eng` | Greek for English Speakers | eng→ell | beta | public | free | 300 | **walk** | 4182 | 8987 | 43 | 7 |
| `hrv_for_eng` | Croatian for English Speakers | eng→hrv | live | public | free | 300 | **walk** | 3689 | 7325 | 41 | 8 |
| `por_br_for_eng` | Brazilian Portuguese for English Speakers | eng→por | beta | public | premium | 668 | **walk** | 3751 | 6701 | 33 | 1 |
| `ita_for_eng` | Italian for English Speakers | eng→ita | live | public | premium | 668 | **walk** | 681 | 6527 | 45 | 4 |
| `kor_for_eng` | Korean for English Speakers | eng→kor | live | public | premium | 668 | **walk** | 2448 | 5132 | 15 | 1 |
| `rus_for_eng` | Russian for English Speakers | eng→rus | beta | public | free | None | **walk** | 2048 | 4404 | 21 | 3 |
| `zho_for_eng` | Chinese for English Speakers | eng→zho | live | public | premium | 668 | **BUNDLE** | 175 | 3986 | 161 | 9 |
| `spa_for_eng` | Spanish for English Speakers | eng→spa | live | public | premium | 668 | **BUNDLE** | 755 | 3786 | 194 | 9 |
| `cat_for_eng` | Catalan for English Speakers | eng→cat | beta | public | free | 300 | **walk** | 559 | 3641 | 22 | 2 |
| `isl_for_eng` | Icelandic for English Speakers | eng→isl | beta | public | free | 300 | **walk** | 563 | 3115 | 14 | 4 |
| `ukr_for_eng` | Ukrainian for English Speakers | eng→ukr | beta | public | free | 300 | **walk** | 501 | 2873 | 13 | 3 |
| `deu_for_eng` | German for English Speakers | eng→deu | beta | beta | premium | 668 | **walk** | 265 | 1972 | 13 | 3 |
| `ron_for_eng` | Romanian for English Speakers | eng→ron | beta | public | free | 300 | **walk** | 0 | 1828 | 15 | 4 |
| `jpn_for_eng` | Japanese for English Speakers | eng→jpn | live | public | premium | 668 | **BUNDLE** | 416 | 1440 | 16 | 8 |
| `afr_for_eng` | Afrikaans for English Speakers | eng→afr | beta | public | free | 668 | **walk** | 439 | 1273 | 40 | 7 |
| `gle_for_eng` | Irish for English Speakers | eng→gle | beta | beta | free | 300 | **BUNDLE** | 143 | 993 | 14 | 5 |
| `srp_for_eng` | Serbian for English Speakers | eng→srp | beta | public | free | None | **walk** | 784 | 784 | 2 | 1 |
| `tha_for_eng` | Thai for English Speakers | eng→tha | beta | public | free | 300 | **BUNDLE** | 610 | 614 | 4 | 2 |
| `lav_for_eng` | Latvian for English Speakers | eng→lav | beta | public | free | 300 | **walk** | 284 | 545 | 3 | 1 |
| `ara_lb_for_eng` | Lebanese Arabic for English Speakers | eng→ara | beta | public | premium | 668 | **walk** | 0 | 528 | 8 | 1 |
| `tur_for_eng` | Turkish for English Speakers | eng→tur | beta | public | free | 300 | **BUNDLE** | 0 | 527 | 4 | 2 |
| `ces_for_eng` | Czech for English Speakers | eng→ces | beta | public | free | None | **walk** | 11 | 479 | 4 | 2 |
| `hye_for_eng` | Armenian for English Speakers | eng→hye | beta | public | free | 300 | **walk** | 54 | 475 | 7 | 4 |
| `hin_for_eng` | Hindi for English Speakers | eng→hin | beta | public | free | 300 | **BUNDLE** | 0 | 438 | 4 | 3 |
| `bul_for_eng` | Bulgarian for English Speakers | eng→bul | beta | public | free | 300 | **walk** | 0 | 403 | 1 | 1 |
| `lit_for_eng` | Lithuanian for English Speakers | eng→lit | beta | public | free | 300 | **walk** | 319 | 319 | 1 | 1 |
| `deu_at_for_eng` | Austrian German for English Speakers | eng→deu | beta | beta | premium | 668 | **walk** | 67 | 251 | 15 | 4 |
| `eng_for_hin` | English for Hindi Speakers | hin→eng | live | public | premium | 668 | **walk** | 0 | 237 | 8 | 0 |
| `spa_mx_for_eng` | Mexican Spanish for English Speakers | eng→spa | beta | public | premium | 668 | **walk** | 0 | 171 | 65 | 2 |
| `eng_for_kan` | English for Kannada Speakers | kan→eng | live | public | premium | 668 | **walk** | 0 | 123 | 5 | 0 |
| `eng_for_mar` | English for Marathi Speakers | mar→eng | live | public | premium | 668 | **walk** | 14 | 118 | 5 | 3 |
| `hun_for_eng` | Hungarian for English Speakers | eng→hun | beta | public | free | None | **BUNDLE** | 0 | 97 | 43 | 1 |
| `ben_for_eng` | Bengali for English Speakers | eng→ben | live | public | free | None | **walk** | 22 | 44 | 3 | 2 |
| `dan_for_eng` | Danish for English Speakers | eng→dan | beta | public | free | 300 | **walk** | 26 | 26 | 2 | 1 |
| `est_for_eng` | Estonian for English Speakers | eng→est | beta | public | free | 300 | **walk** | 0 | 21 | 1 | 0 |
| `glg_for_eng` | Galician for English Speakers | eng→glg | live | public | free | None | **walk** | 0 | 21 | 3 | 0 |
| `eng_for_ben` | English for Bengali Speakers | ben→eng | live | public | premium | 668 | **walk** | 0 | 13 | 1 | 0 |
| `eng_for_tel` | English for Telugu Speakers | tel→eng | live | public | premium | 668 | **walk** | 0 | 13 | 1 | 0 |
| `eng_for_urd` | English for Urdu Speakers | urd→eng | live | public | premium | 668 | **walk** | 0 | 13 | 1 | 0 |
| `eng_for_guj` | English for Gujarati Speakers | guj→eng | live | public | premium | 668 | **walk** | 0 | 12 | 1 | 0 |
| `eng_for_pan` | English for Punjabi Speakers | pan→eng | live | public | premium | 668 | **walk** | 0 | 12 | 2 | 1 |
| `eng_for_tam` | English for Tamil Speakers | tam→eng | live | public | premium | 668 | **walk** | 0 | 12 | 1 | 0 |
| `heb_for_eng` | Hebrew for English Speakers | eng→heb | beta | public | free | 300 | **BUNDLE** | 0 | 11 | 1 | 1 |
| `fra_for_jpn` | フランス語 — 日本語話者向け | jpn→fra | beta | public | premium | 300 | **walk** | 10 | 10 | 1 | 1 |
| `nor_for_eng` | Norwegian for English Speakers | eng→nor | beta | public | free | 300 | **walk** | 9 | 10 | 2 | 2 |
| `spa_for_jpn` | スペイン語（スペイン） — 日本語話者向け | jpn→spa | beta | public | premium | 300 | **walk** | 9 | 9 | 1 | 1 |
| `swa_for_eng` | Swahili for English Speakers | eng→swa | beta | public | free | 300 | **walk** | 4 | 8 | 2 | 1 |
| `ara_for_eng` | Modern Standard Arabic for English Speakers | eng→ara | beta | beta | premium | 668 | **walk** | 0 | 6 | 3 | 0 |
| `ara_eg_for_eng` | Egyptian Arabic for English Speakers | eng→ara | beta | public | premium | 668 | **walk** | 3 | 3 | 1 | 0 |
| `eng_for_jpn` | 英語 — 日本語話者向け | jpn→eng | beta | beta | premium | 300 | **walk** | 3 | 3 | 1 | 1 |
| `spa_for_zho` | 西班牙语（西班牙） — 面向中文使用者 | zho→spa | beta | public | premium | 300 | **walk** | 0 | 3 | 1 | 1 |
| `eng_for_deu` | Englisch für Deutschsprachige | deu→eng | beta | public | premium | 300 | **walk** | 2 | 2 | 1 | 1 |
| `cat_for_spa` | Catalán para hispanohablantes | spa→cat | beta | public | free | 300 | **walk** | 0 | 0 | 0 | 0 |
| `deu_for_jpn` | ドイツ語 — 日本語話者向け | jpn→deu | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `deu_for_zho` | 德语 — 面向中文使用者 | zho→deu | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_ara` | الإنجليزية للناطقين بالعربية | ara→eng | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_fra` | Anglais pour francophones | fra→eng | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_ita` | Inglese per italofoni | ita→eng | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_kor` | 한국어 사용자를 위한 영어 | kor→eng | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_por` | Inglês para lusófonos | por→eng | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_sin` | English for Sinhala Speakers | sin→eng | beta | public | premium | 668 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_spa` | Inglés para hispanohablantes | spa→eng | beta | public | premium | 668 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_zho` | 英语 — 面向中文使用者 | zho→eng | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `eus_for_spa` | Euskera para hispanohablantes | spa→eus | beta | public | free | 300 | **walk** | 0 | 0 | 0 | 0 |
| `fas_for_eng` | Persian for English Speakers | eng→fas | beta | public | free | 300 | **walk** | 0 | 0 | 0 | 0 |
| `fra_for_zho` | 法语 — 面向中文使用者 | zho→fra | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `ita_for_jpn` | イタリア語 — 日本語話者向け | jpn→ita | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `ita_for_zho` | 意大利语 — 面向中文使用者 | zho→ita | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `nep_for_eng` | Nepali for English Speakers | eng→nep | beta | public | free | 300 | **walk** | 0 | 0 | 0 | 0 |
| `por_for_eng` | Portuguese for English Speakers | eng→por | live | public | premium | 668 | **walk** | 0 | 0 | 0 | 0 |
| `zho_for_gle` | Chinese for Irish Speakers | gle→zho | beta | beta | premium | 5 | **BUNDLE** | 0 | 0 | 0 | 0 |
| `zho_for_jpn` | 中国語 — 日本語話者向け | jpn→zho | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |

`seed_count` of `None` is a genuine NULL in the table, not a read failure
(`rus_for_eng`, `srp_for_eng`, `ces_for_eng`, `hun_for_eng`, `ben_for_eng`, `glg_for_eng` and
others carry no seed count).

**The 71 courses NOT live** (`new_app_status` is `not_available`, `draft`, or NULL) are excluded
above. One of them has recent play: `zho_for_tam`, 78 plays in 30d, 0 in 7d — someone testing a
course that is not in the catalogue. Every other non-live course is at zero over 30 days.

---

### 2. Weekly play volume

```
# per course, per window — 150 × 2 HEAD-style counts, no rows downloaded
HEAD /rest/v1/player_events?select=id&event_type=eq.audio_play&course_code=eq.<CODE>\
     &occurred_at=gte.2026-09-11        # and gte.2026-08-19 for the 30d figure
Headers: Prefer: count=exact, Range: 0-0   → count read off the Content-Range response header

# distinct sessions / learners — rows pulled only for courses with a non-zero count
GET /rest/v1/player_events?select=session_id,user_id,learner_id&event_type=eq.audio_play\
    &course_code=eq.<CODE>&occurred_at=gte.<DATE>&limit=60000
```

Estate totals: **83,308 plays in 7 days, 206,918 in 30 days** across all courses.
A whole-table cross-check run first returned 83,299 for the 7d window against the 83,308 summed
per-course a few minutes later — the 9-row difference is live traffic arriving between the two
reads, not a discrepancy.

`learner_id` and `user_id` returned identical distinct counts on every course in both windows, so
one learner column is reported. Rows with a NULL learner are guests — that is why `pol_for_eng` shows
16 sessions and 0 learners in 7d, and `eng_for_hin` / `eng_for_kan` show sessions with no learner at all.

#### Walk courses by volume — who is still on the walk

| course_code | title | known→target | new_app_status | visibility | pricing_tier | seeds | path | plays 7d | plays 30d | sessions 30d | learners 30d |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `cym_n_for_eng` | North Welsh for English Speakers | eng→cym | live | public | premium | 300 | **walk** | 4715 | 18364 | 136 | 15 |
| `swe_for_eng` | Swedish for English Speakers | eng→swe | beta | public | free | 300 | **walk** | 3185 | 13034 | 34 | 3 |
| `ell_for_eng` | Greek for English Speakers | eng→ell | beta | public | free | 300 | **walk** | 4182 | 8987 | 43 | 7 |
| `hrv_for_eng` | Croatian for English Speakers | eng→hrv | live | public | free | 300 | **walk** | 3689 | 7325 | 41 | 8 |
| `por_br_for_eng` | Brazilian Portuguese for English Speakers | eng→por | beta | public | premium | 668 | **walk** | 3751 | 6701 | 33 | 1 |
| `ita_for_eng` | Italian for English Speakers | eng→ita | live | public | premium | 668 | **walk** | 681 | 6527 | 45 | 4 |
| `kor_for_eng` | Korean for English Speakers | eng→kor | live | public | premium | 668 | **walk** | 2448 | 5132 | 15 | 1 |
| `rus_for_eng` | Russian for English Speakers | eng→rus | beta | public | free | None | **walk** | 2048 | 4404 | 21 | 3 |
| `cat_for_eng` | Catalan for English Speakers | eng→cat | beta | public | free | 300 | **walk** | 559 | 3641 | 22 | 2 |
| `isl_for_eng` | Icelandic for English Speakers | eng→isl | beta | public | free | 300 | **walk** | 563 | 3115 | 14 | 4 |
| `ukr_for_eng` | Ukrainian for English Speakers | eng→ukr | beta | public | free | 300 | **walk** | 501 | 2873 | 13 | 3 |
| `deu_for_eng` | German for English Speakers | eng→deu | beta | beta | premium | 668 | **walk** | 265 | 1972 | 13 | 3 |
| `ron_for_eng` | Romanian for English Speakers | eng→ron | beta | public | free | 300 | **walk** | 0 | 1828 | 15 | 4 |
| `afr_for_eng` | Afrikaans for English Speakers | eng→afr | beta | public | free | 668 | **walk** | 439 | 1273 | 40 | 7 |
| `srp_for_eng` | Serbian for English Speakers | eng→srp | beta | public | free | None | **walk** | 784 | 784 | 2 | 1 |
| `lav_for_eng` | Latvian for English Speakers | eng→lav | beta | public | free | 300 | **walk** | 284 | 545 | 3 | 1 |
| `ara_lb_for_eng` | Lebanese Arabic for English Speakers | eng→ara | beta | public | premium | 668 | **walk** | 0 | 528 | 8 | 1 |
| `ces_for_eng` | Czech for English Speakers | eng→ces | beta | public | free | None | **walk** | 11 | 479 | 4 | 2 |
| `hye_for_eng` | Armenian for English Speakers | eng→hye | beta | public | free | 300 | **walk** | 54 | 475 | 7 | 4 |
| `bul_for_eng` | Bulgarian for English Speakers | eng→bul | beta | public | free | 300 | **walk** | 0 | 403 | 1 | 1 |
| `lit_for_eng` | Lithuanian for English Speakers | eng→lit | beta | public | free | 300 | **walk** | 319 | 319 | 1 | 1 |
| `deu_at_for_eng` | Austrian German for English Speakers | eng→deu | beta | beta | premium | 668 | **walk** | 67 | 251 | 15 | 4 |
| `eng_for_hin` | English for Hindi Speakers | hin→eng | live | public | premium | 668 | **walk** | 0 | 237 | 8 | 0 |
| `spa_mx_for_eng` | Mexican Spanish for English Speakers | eng→spa | beta | public | premium | 668 | **walk** | 0 | 171 | 65 | 2 |
| `eng_for_kan` | English for Kannada Speakers | kan→eng | live | public | premium | 668 | **walk** | 0 | 123 | 5 | 0 |
| `eng_for_mar` | English for Marathi Speakers | mar→eng | live | public | premium | 668 | **walk** | 14 | 118 | 5 | 3 |
| `ben_for_eng` | Bengali for English Speakers | eng→ben | live | public | free | None | **walk** | 22 | 44 | 3 | 2 |
| `dan_for_eng` | Danish for English Speakers | eng→dan | beta | public | free | 300 | **walk** | 26 | 26 | 2 | 1 |
| `est_for_eng` | Estonian for English Speakers | eng→est | beta | public | free | 300 | **walk** | 0 | 21 | 1 | 0 |
| `glg_for_eng` | Galician for English Speakers | eng→glg | live | public | free | None | **walk** | 0 | 21 | 3 | 0 |
| `eng_for_ben` | English for Bengali Speakers | ben→eng | live | public | premium | 668 | **walk** | 0 | 13 | 1 | 0 |
| `eng_for_tel` | English for Telugu Speakers | tel→eng | live | public | premium | 668 | **walk** | 0 | 13 | 1 | 0 |
| `eng_for_urd` | English for Urdu Speakers | urd→eng | live | public | premium | 668 | **walk** | 0 | 13 | 1 | 0 |
| `eng_for_guj` | English for Gujarati Speakers | guj→eng | live | public | premium | 668 | **walk** | 0 | 12 | 1 | 0 |
| `eng_for_pan` | English for Punjabi Speakers | pan→eng | live | public | premium | 668 | **walk** | 0 | 12 | 2 | 1 |
| `eng_for_tam` | English for Tamil Speakers | tam→eng | live | public | premium | 668 | **walk** | 0 | 12 | 1 | 0 |
| `fra_for_jpn` | フランス語 — 日本語話者向け | jpn→fra | beta | public | premium | 300 | **walk** | 10 | 10 | 1 | 1 |
| `nor_for_eng` | Norwegian for English Speakers | eng→nor | beta | public | free | 300 | **walk** | 9 | 10 | 2 | 2 |
| `spa_for_jpn` | スペイン語（スペイン） — 日本語話者向け | jpn→spa | beta | public | premium | 300 | **walk** | 9 | 9 | 1 | 1 |
| `swa_for_eng` | Swahili for English Speakers | eng→swa | beta | public | free | 300 | **walk** | 4 | 8 | 2 | 1 |
| `ara_for_eng` | Modern Standard Arabic for English Speakers | eng→ara | beta | beta | premium | 668 | **walk** | 0 | 6 | 3 | 0 |
| `ara_eg_for_eng` | Egyptian Arabic for English Speakers | eng→ara | beta | public | premium | 668 | **walk** | 3 | 3 | 1 | 0 |
| `eng_for_jpn` | 英語 — 日本語話者向け | jpn→eng | beta | beta | premium | 300 | **walk** | 3 | 3 | 1 | 1 |
| `spa_for_zho` | 西班牙语（西班牙） — 面向中文使用者 | zho→spa | beta | public | premium | 300 | **walk** | 0 | 3 | 1 | 1 |
| `eng_for_deu` | Englisch für Deutschsprachige | deu→eng | beta | public | premium | 300 | **walk** | 2 | 2 | 1 | 1 |
| `cat_for_spa` | Catalán para hispanohablantes | spa→cat | beta | public | free | 300 | **walk** | 0 | 0 | 0 | 0 |
| `deu_for_jpn` | ドイツ語 — 日本語話者向け | jpn→deu | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `deu_for_zho` | 德语 — 面向中文使用者 | zho→deu | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_ara` | الإنجليزية للناطقين بالعربية | ara→eng | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_fra` | Anglais pour francophones | fra→eng | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_ita` | Inglese per italofoni | ita→eng | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_kor` | 한국어 사용자를 위한 영어 | kor→eng | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_por` | Inglês para lusófonos | por→eng | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_sin` | English for Sinhala Speakers | sin→eng | beta | public | premium | 668 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_spa` | Inglés para hispanohablantes | spa→eng | beta | public | premium | 668 | **walk** | 0 | 0 | 0 | 0 |
| `eng_for_zho` | 英语 — 面向中文使用者 | zho→eng | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `eus_for_spa` | Euskera para hispanohablantes | spa→eus | beta | public | free | 300 | **walk** | 0 | 0 | 0 | 0 |
| `fas_for_eng` | Persian for English Speakers | eng→fas | beta | public | free | 300 | **walk** | 0 | 0 | 0 | 0 |
| `fra_for_zho` | 法语 — 面向中文使用者 | zho→fra | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `ita_for_jpn` | イタリア語 — 日本語話者向け | jpn→ita | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `ita_for_zho` | 意大利语 — 面向中文使用者 | zho→ita | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |
| `nep_for_eng` | Nepali for English Speakers | eng→nep | beta | public | free | 300 | **walk** | 0 | 0 | 0 | 0 |
| `por_for_eng` | Portuguese for English Speakers | eng→por | live | public | premium | 668 | **walk** | 0 | 0 | 0 | 0 |
| `zho_for_jpn` | 中国語 — 日本語話者向け | jpn→zho | beta | public | premium | 300 | **walk** | 0 | 0 | 0 | 0 |

**Carrying real learners (the walk courses that matter).** `cym_n_for_eng` is the biggest single
problem: 18,364 plays / 136 sessions / 15 learners in 30 days, a live premium course and the
sibling of `cym_s_for_eng` which is already on the bundle. Then `swe_for_eng` (13,034 / 34 / 3),
`ell_for_eng` (8,987 / 43 / 7), `hrv_for_eng` (7,325 / 41 / 8), `por_br_for_eng` (6,701 / 33 / 1),
`ita_for_eng` (6,527 / 45 / 4), `kor_for_eng` (5,132 / 15 / 1), `rus_for_eng` (4,404 / 21 / 3),
`cat_for_eng` (3,641 / 22 / 2), `isl_for_eng` (3,115 / 14 / 4), `ukr_for_eng` (2,873 / 13 / 3).
Those eleven are 80,103 of the 89,850 plays on live walk courses in 30 days — **89.2%** of all walk play.

**Thin but alive** (30d play between 100 and 2,000): `deu_for_eng` 1,972 · `ron_for_eng` 1,828 ·
`afr_for_eng` 1,273 · `srp_for_eng` 784 · `lav_for_eng` 545 · `ara_lb_for_eng` 528 ·
`ces_for_eng` 479 · `hye_for_eng` 475 · `bul_for_eng` 403 · `lit_for_eng` 319 ·
`deu_at_for_eng` 251 · `eng_for_hin` 237 · `spa_mx_for_eng` 171 · `eng_for_kan` 123 ·
`eng_for_mar` 118.

**Dead** (0 plays in 30 days) — 19 live walk courses:
`cat_for_spa`, `deu_for_jpn`, `deu_for_zho`, `eng_for_ara`, `eng_for_fra`, `eng_for_ita`, `eng_for_kor`, `eng_for_por`, `eng_for_sin`, `eng_for_spa`, `eng_for_zho`, `eus_for_spa`, `fas_for_eng`, `fra_for_zho`, `ita_for_jpn`, `ita_for_zho`, `nep_for_eng`, `por_for_eng`, `zho_for_jpn`.

**Caveat you should carry into any decision made off this table.** The distinct-learner counts are
tiny — 7 learners behind 41,548 plays on `eus_for_eng`, 3 behind 13,034 on `swe_for_eng`, 1 behind
5,132 on `kor_for_eng`. This is not a mass-market usage distribution; most of this volume is a
handful of accounts, very plausibly internal testing and course QA rather than paying learners.
`cym_s_for_eng` (142 learners / 246 sessions) is the one course whose shape looks like a real
learner population. I have not cross-referenced learners against tester accounts — that is beyond
this census and is an explicit gap.

#### Bundle courses by volume

| course_code | title | known→target | new_app_status | visibility | pricing_tier | seeds | path | plays 7d | plays 30d | sessions 30d | learners 30d |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `eus_for_eng` | Basque for English Speakers | eng→eus | beta | public | free | 300 | **BUNDLE** | 24549 | 41548 | 54 | 7 |
| `cym_s_for_eng` | South Welsh for English Speakers | eng→cym | live | public | premium | 300 | **BUNDLE** | 17241 | 22241 | 246 | 142 |
| `fra_for_eng` | French for English Speakers | eng→fra | beta | public | premium | 668 | **BUNDLE** | 4806 | 18274 | 67 | 9 |
| `pol_for_eng` | Polish for English Speakers | eng→pol | beta | public | free | 300 | **BUNDLE** | 3851 | 13917 | 81 | 2 |
| `nld_for_eng` | Dutch for English Speakers | eng→nld | beta | beta | free | 300 | **BUNDLE** | 2115 | 9118 | 44 | 5 |
| `zho_for_eng` | Chinese for English Speakers | eng→zho | live | public | premium | 668 | **BUNDLE** | 175 | 3986 | 161 | 9 |
| `spa_for_eng` | Spanish for English Speakers | eng→spa | live | public | premium | 668 | **BUNDLE** | 755 | 3786 | 194 | 9 |
| `jpn_for_eng` | Japanese for English Speakers | eng→jpn | live | public | premium | 668 | **BUNDLE** | 416 | 1440 | 16 | 8 |
| `gle_for_eng` | Irish for English Speakers | eng→gle | beta | beta | free | 300 | **BUNDLE** | 143 | 993 | 14 | 5 |
| `tha_for_eng` | Thai for English Speakers | eng→tha | beta | public | free | 300 | **BUNDLE** | 610 | 614 | 4 | 2 |
| `tur_for_eng` | Turkish for English Speakers | eng→tur | beta | public | free | 300 | **BUNDLE** | 0 | 527 | 4 | 2 |
| `hin_for_eng` | Hindi for English Speakers | eng→hin | beta | public | free | 300 | **BUNDLE** | 0 | 438 | 4 | 3 |
| `hun_for_eng` | Hungarian for English Speakers | eng→hun | beta | public | free | None | **BUNDLE** | 0 | 97 | 43 | 1 |
| `heb_for_eng` | Hebrew for English Speakers | eng→heb | beta | public | free | 300 | **BUNDLE** | 0 | 11 | 1 | 1 |
| `zho_for_gle` | Chinese for Irish Speakers | gle→zho | beta | beta | premium | 5 | **BUNDLE** | 0 | 0 | 0 | 0 |

---

### 3. The named stragglers

| code | live? | `new_app_status` | path | plays 7d | plays 30d | learners 30d |
|---|---|---|---|---|---|---|
| `cat_for_eng` | **yes** | beta | **walk** | 559 | 3641 | 2 |
| `ell_for_eng` | **yes** | beta | **walk** | 4182 | 8987 | 7 |
| `hrv_for_eng` | **yes** | live | **walk** | 3689 | 7325 | 8 |
| `fin_for_eng` | no | not_available | **walk** | 0 | 0 | 0 |
| `cym_n_for_eng` | **yes** | live | **walk** | 4715 | 18364 | 15 |
| `ita_for_eng` | **yes** | live | **walk** | 681 | 6527 | 4 |
| `deu_for_eng` | **yes** | beta | **walk** | 265 | 1972 | 3 |
| `por_for_eng` | **yes** | live | **walk** | 0 | 0 | 0 |

Every one of them is on the **walk**. Seven of the eight are live; `fin_for_eng` is not.

**`cym_n_for_eng` is the headline straggler**: live, premium, 18,364 plays and 15 learners in 30
days, second-highest walk volume in the estate — and its southern twin is already bundled.
**`ell_for_eng`, `hrv_for_eng`, `ita_for_eng`, `cat_for_eng`** all carry real, current play.
**`deu_for_eng`** is live but `visibility='beta'` and thin (1,972/30d). **`por_for_eng`** is live,
public, premium, 668 seeds — and has **zero plays in both windows**; nobody is on it.

#### `fin_for_eng` — the "no audio at all" claim, checked

The code comment at `useInstantPlayback.ts:206` says fin_for_eng "has 1,394 rounds and no rendered
audio at all". **That is very nearly true but not literally true**, and the exact shape matters more
than the slogan:

```
HEAD /rest/v1/course_audio?select=id&course_code=eq.fin_for_eng   → 357
HEAD /rest/v1/course_audio?select=id&course_code=eq.fin_for_eng&role=eq.target2 → 0
GET  /rest/v1/course_audio?select=role,origin,s3_key,created_at,lego_id&course_code=eq.fin_for_eng&limit=400
```

**357 rows, not zero.** By role: `known` 238, `instruction` 48, `target1` 44, `encouragement` 26,
`welcome` 1. By origin: tts 238, human 119. Every row has an `s3_key`. But **`target2` is exactly
zero**, and `target1` is 44 clips against a 668-seed course — so no 4-phase cycle can be completed
and the practical claim holds: the course cannot play. The 119 human rows are course-wide chrome
(instruction / encouragement / welcome), not content.

It is also **moot for the cutover**: `fin_for_eng` is `status='draft'`, `new_app_status='not_available'`
— it is not in the learner catalogue at all, and has 0 plays in both windows. Excluding it from the
bundle list is right; the reason written in the comment should say "no target2 audio and 44 target1
clips" rather than "no rendered audio at all".

#### Reverse `eng_for_XXX` courses

19 exist in `courses`; all 19 are live (`new_app_status` live or beta); **all 19 are on the walk**;
all 19 are premium.

| code | title | `new_app_status` | plays 7d | plays 30d | learners 30d |
|---|---|---|---|---|---|
| `eng_for_ara` | الإنجليزية للناطقين بالعربية | beta | 0 | 0 | 0 |
| `eng_for_ben` | English for Bengali Speakers | live | 0 | 13 | 0 |
| `eng_for_deu` | Englisch für Deutschsprachige | beta | 2 | 2 | 1 |
| `eng_for_fra` | Anglais pour francophones | beta | 0 | 0 | 0 |
| `eng_for_guj` | English for Gujarati Speakers | live | 0 | 12 | 0 |
| `eng_for_hin` | English for Hindi Speakers | live | 0 | 237 | 0 |
| `eng_for_ita` | Inglese per italofoni | beta | 0 | 0 | 0 |
| `eng_for_jpn` | 英語 — 日本語話者向け | beta | 3 | 3 | 1 |
| `eng_for_kan` | English for Kannada Speakers | live | 0 | 123 | 0 |
| `eng_for_kor` | 한국어 사용자를 위한 영어 | beta | 0 | 0 | 0 |
| `eng_for_mar` | English for Marathi Speakers | live | 14 | 118 | 3 |
| `eng_for_pan` | English for Punjabi Speakers | live | 0 | 12 | 1 |
| `eng_for_por` | Inglês para lusófonos | beta | 0 | 0 | 0 |
| `eng_for_sin` | English for Sinhala Speakers | beta | 0 | 0 | 0 |
| `eng_for_spa` | Inglés para hispanohablantes | beta | 0 | 0 | 0 |
| `eng_for_tam` | English for Tamil Speakers | live | 0 | 12 | 0 |
| `eng_for_tel` | English for Telugu Speakers | live | 0 | 13 | 0 |
| `eng_for_urd` | English for Urdu Speakers | live | 0 | 13 | 0 |
| `eng_for_zho` | 英语 — 面向中文使用者 | beta | 0 | 0 | 0 |

Combined: **19 plays in 7 days, 558 in 30 days** — under 0.25% of estate play. The Indic reverse
courses (`eng_for_hin` 237, `eng_for_kan` 123, `eng_for_mar` 118) carry all of it, and `eng_for_hin`
and `eng_for_kan` register **zero distinct learners** — guest sessions only. As a block the reverse
courses are commercially significant and operationally dead; migrating them is cheap and urgent for
nobody.

---

### 4. Honest summary

**Two-thirds of real play is already on the bundle, and the remaining third is concentrated in about
a dozen courses.** Over the last 7 days, 54,661 of 83,308 `audio_play` rows (65.6%) came from the
15 bundle courses and 28,647 (34.4%) from walk courses; over 30 days the split is
116,990 / 206,918 bundle (56.5%) against 89,928 walk (43.5%) — of which 89,850 is on live walk
courses and 78 on `zho_for_tam`, which is not in the catalogue at all. The 7-day figure flatters the
bundle because `eus_for_eng` alone contributed 24,549 plays this week; the 30-day 56/44 split is the
steadier number to plan against. The walk's third is not spread thin across 64 courses — eleven
courses (`cym_n_for_eng`, `swe_for_eng`, `ell_for_eng`, `hrv_for_eng`, `por_br_for_eng`,
`ita_for_eng`, `kor_for_eng`, `rus_for_eng`, `cat_for_eng`, `isl_for_eng`, `ukr_for_eng`) carry 89.2%
of it (80,103 of 89,850), 19 live walk courses have not been played once in 30 days, and the whole
19-course `eng_for_XXX` reverse block amounts to 558 plays in 30 days. So finishing the cutover is a
short list, not a long tail: bundle those eleven and the walk is carrying a rounding error. The one
honest qualification on all of it is that the learner counts are tiny — 7 accounts behind Basque's
41,548 plays, 1 behind Korean's 5,132 — so most of this volume is a small number of heavy sessions
rather than a learner base, and only `cym_s_for_eng` (142 learners) looks like a real population.

#### Explicit gaps

- **Tester vs real learner not separated.** I did not join `player_events.learner_id` against
  `learners` or any tester tagging, so "learners 30d" counts accounts, not paying customers. The
  read of this census changes materially if most of those accounts are internal.
- **Volume is clips played, not time.** `audio_play` row counts are a proxy for session length; I
  did not sum durations.
- **The 60,000-row PostgREST ceiling** applies to the distinct-count reads. No course exceeded it in
  either window (largest: `eus_for_eng` 41,548 in 30d), so no count is truncated — but a future
  re-run on a busier month would need paging.
- **`visibility`, `status` and `new_app_status` disagree across the table.** I used `new_app_status`
  because the app's own catalogue query does. I did not establish which column anybody intends to be
  authoritative, and that is a question for Tom rather than a fact I could read.


---

## 3. The parity gate — is Tom's two-part bar enforced?

**Short answer: the test exists, it is good, and nothing runs it.** Audit by #229·H;
standalone copy https://watson-1.tail4968cb.ts.net/d/ef74dbfc. I re-verified the two
load-bearing claims myself, independently, because they are severe:

> **Correction, after cross-family cold-verify (#230·H, GPT-6 Astra, folded 2026-09-18).**
> Two claims in this section are wrong as written and the appendix at the foot of this document
> carries the full re-check. In short: the `parity-fullscript` DRIFT is **not** a urn violation on
> the walk — it is the known seed-sandwich divergence; and the urn half of the parity test asserts
> its properties on a **restatement** of `drawReviewPhrases`, not on the function itself. The
> central finding — that no gate runs any of it — stands, and its history turns out to be worse
> than reported.

- **No gate reaches `packages/core`.** `vitest.api.config.ts` includes `api/**` and
  `scripts/**`; `packages/player-vue/vitest.config.ts` includes `src/**` rooted at
  player-vue; `packages/core` has no vitest config at all and its `"test"` script is bare
  `vitest` (watch mode, no `run`). `test:premerge` = `test:invariants && test:changed`, and
  neither leg touches core. The nightly (`ops/ci/ci-checks.sh:174`) runs
  `--filter @ssi/core build` — `tsup`, which compiles core and runs none of its tests.
  **39 test files in `packages/core` are run by no gate in the estate.**
- **The committed "final" step-6 parity record was already red.**
  `docs/bundle-cutover-parity/parity-fullscript-final-2026-08-29.json` contains
  **6 occurrences of `DRIFT` and 0 of `IDENTICAL`** — it records drift on all six courses
  it ran. #229·H reproduced `gle_for_eng`'s figure exactly (`windowRoundDiffs=21`) on
  today's production tree.
### 1. Does the test exist?

**Yes for both parts, in one file:** `packages/core/src/script/selectionParity.test.ts` (509 lines,
landed in `522bcfe56` "fix(script): one selection algorithm, called by both producers"). It is the
only executable assertion of either part anywhere in the repo. Everything else named below is a
hand-run harness, not a test.

#### `packages/core/src/script/selectionParity.test.ts` — asserts BOTH parts

What it asserts, by block:

| Lines | Assertion | Which part |
|---|---|---|
| 208-227 | For every one of the 15 cut-over courses, for every fixture LEGO: the shared selector's BUILD list and CONSOLIDATE list are `toEqual` an **independent transcription of the walk** (`walkDebutSelection`, lines 104-150) — same phrases, **same order**. | **Part 1** |
| 230-243 | Anti-vacuity: at least one real LEGO must order differently by DB position than by syllable, so the above cannot pass by coincidence. | Part 1 |
| 266-280 | Every drawn review phrase is a member of that LEGO's own capped USE pool, on real fixture pools, all 15 courses. | **Part 2 membership** |
| 282-290 | Over the full Fibonacci offset ladder (17 reviews), every sliding window of length `poolLength` contains `poolLength` distinct indices, for pools 1..24 — i.e. **no repeat before exhaustion**. | **Part 2 non-repeat** |
| 292-307 | Wraparound is exactly `+1 mod poolLength` per draw, and the first `poolLength` draws cover the pool exactly once — **correct refill**. | **Part 2 refill** |
| 309-322 | A suppressed draw still consumes its turn (`['a', null, 'c']`), so rotation stays in step with the walk. | Part 2 |
| 324-334 | `reviewCursorStart` is position-independent — the closed form the paged bundle path needs. | Part 2 |
| 369-480 | **End-to-end**: builds a real `CourseBundle` per fixture course and runs the production `generateScript`, asserting round 1's emitted BUILD and USE cycle texts equal the walk's debut selection **in order**, plus every later round's BUILD half. This is what stops `generateScript` quietly reverting to DB-position order. | **Part 1, on the live producer** |
| 482-508 | An unplayable phrase never consumes a BUILD slot, with its own anti-vacuity guard. | — |

**What it does NOT assert — three real holes:**

1. **Part 2 is asserted on the helpers, never on `generateScript`'s output.** The urn block calls
   `reviewCursorStart` / `drawReviewPhrases` (`phraseSelection.ts`) directly. Nothing asserts the
   emitted `spaced_rep` cycles of a generated script obey non-repeat or refill. Part 1 has that
   end-to-end block (369-480); Part 2 does not. `generateScript.ts:442` and `:553` do call
   `drawReviewPhrases`, so the wiring is there today — but a future edit that stopped calling it,
   or called it with a wrong cursor, would keep all 40 tests green.
2. **The walk side is a frozen transcription, not the code.** `walkDebutSelection` is hand-copied
   from `providers/generateLearningScript.ts` (deliberately — the file header explains the
   non-circularity reason). `generateLearningScript.ts` imports nothing from `phraseSelection.ts`
   except `countTargetSyllables` (line 17). So if the **walk** drifts, this test still passes. The
   walk is not dead code: `LearningPlayer.vue:601-657` falls back to it on any bundle failure, and
   `?fullscript=walk` forces it.
3. **The fixture is a 2026-08-29 snapshot with no liveness or completeness guard.** Nothing compares
   the fixture's 15 course codes against `BUNDLE_BOOTSTRAP_COURSES` in `useInstantPlayback.ts:189-238`
   — only `expect(COURSE_CODES).toHaveLength(15)` (line 210). Cut over a 16th course and no test
   fails. Change a course's phrases in Supabase and the gate keeps grading 2026-08-29 data.

#### `packages/core/src/script/phraseSelection.ts` — the subject, not a test
The shared selector: `orderLegoPools`, `capPhrasesByLength`, `selectDebutPhrases`,
`reviewCursorStart`, `drawReviewPhrases`. Called by `generateScript.ts` at lines 205, 309, 442, 553.
It has no test of its own besides `selectionParity.test.ts`.

#### `tools/bundle-cutover/parity-cycles.mjs` — cycle-level diff, asserts NEITHER part as a property
Diffs `@ssi/core generateScript` (default) or `providers/bundleToBackendCycles` (`--wire`) against
the **live** legacy `/api/courses/:code/cycles` on the deployed dev alias, page by page. It proves
**the two producers agree on the cycles the player would keep** — a mutual agreement test. It never
states what first-delivery order should be, and never checks the urn: if both producers repeated the
same review phrase every round, every case would still read IDENTICAL. Its own verdicts are
`IDENTICAL` / `SUPERSET_SEED_PHASE_ONLY` / `NO_AUDIO` / `DRIFT`.

#### `tools/bundle-cutover/parity-infplay.mjs` — asserts urn MEMBERSHIP only, in infinite play
Checks four things per case: the spaced-rep LEGO schedule matches exactly, round-size ranges overlap,
**pool legality** (every emitted cycle's known/target pair is a real USE phrase of the LEGO it is
filed under — `illegalDraws`), and main-loop-count agreement. So it covers **half of Part 2
(membership)** and explicitly declines non-repeat: "cycle-for-cycle equality is not a property either
producer has". It says nothing about Part 1.

#### `tools/bundle-cutover/parity-fullscript.mjs` — whole-script diff, asserts neither part
Runs both real producers — the walk against live anon Supabase, the bundle path against a fetched
`/api/courses/:code/bundle` — and diffs the player `Round[]` by LEGO-id sequence, cycle types,
texts and audio ids. Again mutual agreement, not a property. Four documented exemptions
(listening/pod cycles, round numbering, the inf-play tail, premium preview truncation).

#### `tools/bundle-cutover/capture-selection-fixture.mjs` — the fixture writer
Snapshots the first 20 LEGOs of each of 15 hardcoded courses into
`packages/core/src/script/__fixtures__/selection-pools.json`. Needs
`SUPABASE_URL` / `SUPABASE_SERVICE_KEY`. Its own header states the intent plainly: *"The parity guard
has to run on every commit, offline, in CI."* Section 3 is about whether that intent was delivered.

#### `docs/bundle-cutover-parity/*.json` — dated evidence, not a gate
Nine committed result files, all `generatedAt` 2026-08-29. Evidence of one afternoon, re-read in
section 5.

---

### 2. Does it cover every cut-over course?

| Thing | Courses | Positions per course | Committed fixture or live network? |
|---|---|---|---|
| `selectionParity.test.ts` | **15/15** — fixture keys are exactly the 15 in `useInstantPlayback.ts` | LEGOs **1-20 only** (14 courses × 20, `zho_for_gle` × 15; 295 LEGOs, 1,952 phrases total) | **Committed fixture**, `__fixtures__/selection-pools.json`, 327 KB, captured `2026-08-29T22:14:47Z`. No network, no DB, runs offline in 0.5s |
| `parity-cycles.mjs` (committed run `parity-gen.json` / `parity-wire.json`) | 16 (the 15 + `fin_for_eng`, which came back NO_AUDIO ×3 and proves nothing) | 3 start fractions (0, 0.25, 0.6) × 6 rounds = 48 cases | **Live** deployed dev alias, read-only, no credentials |
| `parity-infplay.mjs` (`parity-infplay.json`) | 16, same list | 3 from-rounds (1, 7, 95) × 15 rounds | **Live** dev alias; `PARITY_TOKEN` required for premium |
| `parity-fullscript.mjs` (`parity-fullscript-final-2026-08-29.json`) | **6 of 15** — hun, gle, nld, tur, spa, cym_s | whole script; spa and cym_s `previewOnly=true`, so proven only to seed 19 | **Live** anon Supabase **and** the dev alias |

So: the only artefact that covers all fifteen courses **without a network call** is
`selectionParity.test.ts`, and its reach is the first 20 rounds of each course. Everything past round
20 — the whole spaced-rep tail, the seed-phase tier, infinite play — is covered only by harnesses
that need the deployed dev alias, which by Tom's own test is not a gate.

---

### 3. Does it run in CI or premerge?

**No. Nothing runs it. Flatly: not premerge, not the nightly, not any npm script.**

- `package.json` `test:premerge` = `test:invariants && test:changed`.
  `test:invariants` is a named list of `api/**` files plus `pnpm --filter player-vue test:invariants`
  (a named list of `packages/player-vue/src/**` files). `test:changed` is
  `vitest -c vitest.api.config.ts --changed` plus `pnpm --filter player-vue test:changed`.
  **Neither leg touches `packages/core`.**
- `vitest.api.config.ts` `include` is `['api/**/*.test.ts', 'scripts/**/*.test.ts']`.
  `packages/player-vue/vitest.config.ts` `include` is `['src/**/*.test.ts']` rooted at player-vue.
  **No config includes `packages/core/src/**`.** `packages/core` has no vitest config at all.
- The nightly, `~/command-surface/ops/ci/ci-checks.sh` lines 174-184, runs exactly:
  `@ssi/core build`, `player-vue lint`, `player-vue typecheck`, `typecheck:api`,
  `player-vue test`, `test:api`, `test:release-train`.
  **`@ssi/core build` is `tsup` — it compiles core and runs none of core's 40 test files.**
- `packages/core/package.json` `"test": "vitest"` — watch mode, no `run`. Reachable only via
  `pnpm -r test` (root `test`), which no gate invokes.
- `grep -rn "bundle-cutover"` over `*.json`/`*.mjs`/`*.ts`/`*.yml`/`*.sh`: **`tools/bundle-cutover/*.mjs`
  is referenced by no npm script anywhere** — only by its own file headers and by prose comments in
  `bundleToBackendCycles.ts`, `bundleFullScript.ts` and their tests.

A human must remember to run a `.mjs` by hand, against a live deployment, with credentials for the
full-script leg — and must also remember to run a vitest file that no script names.

**Cheapest possible repair, for the parent room's consideration:** the test costs 0.5 s and needs no
network. Adding `packages/core/src/script/selectionParity.test.ts` to a config the premerge list
already runs, or adding `pnpm --filter @ssi/core test -- --run` to `ci-checks.sh`'s learning-app leg,
converts a hand-run file into the gate Tom asked for. No new test is needed for Part 1; Part 2 would
still need its end-to-end assertion (hole 1 above).

---

### 4. Verdict

**PARTIALLY ENFORCED — the test for both parts exists and passes, but NOTHING RUNS IT**: no premerge
leg, no vitest config and no nightly check reaches `packages/core`, so today Tom's bar is enforced
only by whoever remembers to type the command, and the cycle-level harnesses from 2026-08-29 are
hand-run against a live deployment and assert neither part as a property.

---

### 5. What I actually ran

All commands from `/home/tomcassidy/.cs-worktrees/ssi-learning-app/229-cutover-parity-gate` at
`d73662013`. `packages/core/dist` built first with the shared checkout's `tsup` (core has no
`node_modules` in a fresh worktree).

**(a) The test — PASS.**
```
$ node_modules/.bin/vitest run --root packages/core --maxWorkers=2 src/script/selectionParity.test.ts
 ✓ src/script/selectionParity.test.ts (40 tests) 99ms
 Test Files  1 passed (1)
      Tests  40 passed (40)
   Duration  529ms
```

**(b) `parity-cycles.mjs`, generator mode — exit 0, no drift.** Live dev alias, no credentials.
```
$ node tools/bundle-cutover/parity-cycles.mjs --courses=gle_for_eng,nld_for_eng
gle_for_eng from=S0001L01 old=44 new=44 IDENTICAL onlyOld=0 onlyNew=0
gle_for_eng from=S0068L01 old=134 new=137 SUPERSET_SEED_PHASE_ONLY onlyOld=0 onlyNew=3
gle_for_eng from=S0157L01 old=112 new=130 SUPERSET_SEED_PHASE_ONLY onlyOld=0 onlyNew=18
nld_for_eng from=S0001L01 old=42 new=42 IDENTICAL
nld_for_eng from=S0052L01 old=133 new=133 IDENTICAL
nld_for_eng from=S0146L01 old=136 new=136 IDENTICAL
mode=generator: 4 identical, 2 superset (seed-phase only), 0 no-audio, 0 drift/error   [EXIT=0]
```

**(c) `parity-cycles.mjs --wire` — exit 0, no drift, but only after I fixed my own confound.**
My first `--wire` run reported **DRIFT on all three gle cases**. That was an artefact, and it is
worth recording as a finding about the harness: `--wire` imports
`providers/bundleToBackendCycles.ts`, which resolves `@ssi/core` through
`packages/player-vue/node_modules` — which in a fresh worktree does not exist, so I had symlinked it
to the shared checkout's, silently pointing the harness at the **shared checkout's** core
(`ebddb73fb`, dirty, `dist` built 2026-09-10) instead of the worktree's. The harness has no version
or provenance guard and reported the mismatch as product drift. After repointing `@ssi/core` at the
worktree's freshly built core:
```
$ node --experimental-strip-types tools/bundle-cutover/parity-cycles.mjs --wire --courses=gle_for_eng,nld_for_eng
mode=wire: 4 identical, 2 superset (seed-phase only), 0 no-audio, 0 drift/error        [EXIT=0]
```

**(d) `parity-infplay.mjs` — exit 0, every extra attributed, zero illegal draws.**
```
$ node --experimental-strip-types tools/bundle-cutover/parity-infplay.mjs --courses=gle_for_eng --rounds=1,7
gle_for_eng from=1 rounds=15 SCHEDULE_SUPERSET_EXPLAINED scheduleDiffs=0 supersetRounds=15
  illegalDraws=0 extras={"seedPhase":60,...} roundLen old=[4,16] new=[9,19]
gle_for_eng from=7 rounds=15 SCHEDULE_SUPERSET_EXPLAINED scheduleDiffs=0 supersetRounds=15
  illegalDraws=0 extras={"seedPhase":60,...} roundLen old=[4,13] new=[9,17]
0 schedule-identical, 2 superset (every extra attributed), 0 drift/error               [EXIT=0]
```

**(e) `parity-fullscript.mjs` — exit 1, DRIFT — and the committed "final" record was already red.**
Run with the shared checkout's anon Supabase credentials copied into the worktree.
```
$ node tools/bundle-cutover/parity-fullscript.mjs --courses=gle_for_eng
gle_for_eng previewOnly=false verdict=DRIFT oldMain=772 newMain=772 legoSeqIdentical=true
  onlyOld=0 onlyNew=0 windowRoundDiffs=21 runtimeOnlyStripped=0 tail(old=30,new=30,comparable=true)
0 identical, 1 drift/error                                                             [EXIT=1]
```
`docs/bundle-cutover-parity/parity-fullscript-final-2026-08-29.json` — the file named "final" —
records `verdict=DRIFT` on **all six** courses it ran, with `gle_for_eng windowRoundDiffCount=21`.
My run today reproduces that number exactly. So step 6's committed evidence has never been a green
run, and the step-6 harness is red on today's production tree.

The diffs are `spaced_rep` composition, not debut order (`legoSequence.identical=true` on every
course). In the gle window at `S0106L05` the **walk** side emits the same review phrase three to four
times in one round, several with missing audio-id slots
(`spaced_rep|it's interesting when you understand enough words|…||f94c95ed…|` ×3), where the bundle
side emits distinct phrases with complete audio triples. On its face that is the bundle path being
right and the walk repeating inside a round — which is a **Part 2 urn violation on the walk side** —
but I did not confirm it, because the walk here runs against live anon Supabase and its own log says
it skipped 730 phrases for missing audio ids, so a local-environment cause cannot be ruled out from
inside this audit. **Named as an explicit gap, and the single most worthwhile thing to chase next.**

#### Explicit gaps
- **Whether the fullscript DRIFT is a real defect or an environment artefact — not determined.** It
  needs a run with the same credentials the 2026-08-29 run used, and a look at whether the walk's
  review draw can legitimately repeat within a round. It reproduces the committed number exactly,
  which argues the behaviour is old and stable, not new.
- **`parity-cycles` / `parity-infplay` run on 2 of 15 courses and `parity-fullscript` on 1.** I
  bounded them deliberately: each case is a live network walk, and the coverage question (section 2)
  is answered by the committed 2026-08-29 results, not by re-running all 15 today.
- **`PARITY_TOKEN` was never set**, so `parity-infplay` was exercised on a free course only; the
  premium courses' inf-play leg is unrun by me.
- **No test was written and no code was changed** — this was a read-only audit by instruction.

---

## 4. Where the two live paths disagree today

*Behavioural diff by #228·H; standalone copy https://watson-1.tail4968cb.ts.net/d/204a518d.
I independently re-verified the two most severe claims: `grep -rn "graduat" packages/core/src`
returns **zero** hits, and the `seedSandwich` flag appears in the walk's adapter
(`toSimpleRounds.ts:408`) and nowhere in `packages/core`.*

### The two paths

| | PATH A — "the walk" | PATH C — "the bundle" |
|---|---|---|
| Generator | `packages/player-vue/src/providers/generateLearningScript.ts` (2,133 lines) | `packages/core/src/script/generateScript.ts` (920 lines) |
| Fed by | ~9 Supabase queries from the BROWSER on the anon key (`generateLearningScript.ts:550`) | `api/courses/[code]/bundle.ts` (1,034 lines), server-side |
| Adapter to `SimplePlayer` | `providers/toSimpleRounds.ts` | `providers/bundleToBackendCycles.ts` → `providers/backendCyclesToRounds.ts` |
| Client entry points | `generateSimpleScript()` at `LearningPlayer.vue:702`; `CourseExplorer.vue:467` | step 5 `useInstantPlayback.ts`; step 6 `bundleFullScript.ts` via `fullScriptFromBundle()` at `LearningPlayer.vue:601` |
| Who gets it | every course NOT on the 15-course allow-list, every fallback on the 15, `?fullscript=walk`, `?bundle=0`, and Course Explorer always | the 15 courses in `BUNDLE_BOOTSTRAP_COURSES` (`useInstantPlayback.ts:210-228`), gate at `:230` |

**Step 5 and step 6 are the same code below `generateScript`.** `bundleFullScript.ts:194-215` calls
`generateScript` → `toBackendCycle` → `backendCyclesToRounds`, which is exactly what the step-5
instant path calls. So there is no step5/step6 divergence to report anywhere in this document: every
bundle-side finding applies to both consumers. That is by design and it is stated at
`bundleFullScript.ts:18-25`.

---

### The divergence table

#### (a) SEED REVIEWS — the spaced-rep tier at offsets ≥ 144

| The behaviour | Which path has it | Which is right | What the learner on the wrong path gets |
|---|---|---|---|
| **A drained review plays the whole original sentence as four listening slots — target, English, target, target — with no mic gap, each slot holding its words on screen for 1.6 s.** | **WALK ONLY.** Built by `emitSeedSandwich`, `generateLearningScript.ts:1362-1400`; flags and linger applied in `toSimpleRounds.ts:376`, `:408`, `:426` (`SEED_SANDWICH_LINGER_MS = 1600` at `:27`). | **WALK.** This IS the design (Tom + Aran, 2026-07-14), and it is the speaking-side twin of the Layer-1 cup sandwich. | On the bundle the same review is an **ordinary three-clip production exercise with a real mic gap**: `buildSeedReviewCycle`, `generateScript.ts:750-790`, ids ending `_seedrep`. The learner is asked to produce, cold, a whole sentence they last met 144 rounds ago. |
| **The four slots are exempt from the consecutive-duplicate pass and from the A-64 cap, so all four survive contiguously.** | **WALK ONLY** (nothing to exempt on the bundle). `isSeedSandwichItem` at `generateLearningScript.ts:401`, used at `:1993`; `cyclePromptIdentity` special-case at `capConsecutiveRepeats.ts:217`. | WALK. | n/a — the bundle's seed review is one cycle, so no cap interacts with it. |
| **State today.** The walk was BROKEN until 2026-09-18 — slots 2, 3 and 4 were dropped as duplicates, so every drained review course-wide arrived as one lone target clip with English on screen and never spoken (311 plays / 9 learners / 0 English clips over 30 days). It is **fixed now**, proven by `providers/seedSandwichSurvives.test.ts` and live on staging. | Fix + evidence: `997faff61` and `docs/only-the-basque-is-spoken-2026-09-18.md`. | — | The bundle was never broken in that sense and was never right either: it has **never built the sandwich at all**. |
| **A seed review needs only `target1` audio to fire; the English slot is dropped, never silenced, when the seed has no known clip (3 slots instead of 4).** | WALK: `generateLearningScript.ts:1638` (`seed && seed.target1_audio_id`) and the role list at `:1380-1382`. | WALK — "plays what it has", Tom 2026-08-06. | BUNDLE requires **known + target1 + target2** (`generateScript.ts:756-758`) and otherwise falls back to an ordinary use-phrase review. On a course with incomplete seed audio the bundle learner **never sees a seed review at all** where the walk learner gets one. |
| **The four slots carry `singleAudio: true`, which makes `isTeachingCycle()` true, which exempts them from every Easy-mode selection filter.** | WALK: `toSimpleRounds.ts:407`; `modeCycleSelection.ts:102-103`, `:131`. | WALK. | The bundle's seed review is a plain `spaced_rep` cycle with no `singleAudio`, so **Easy's course-wide phrase-LENGTH cap applies to it** (`modeCycleSelection.ts:205-207`). A full seed sentence is by construction among the longest phrases in the course, so on Easy a bundle seed review is a prime candidate to be filtered out of the round entirely, subject only to `PRACTICE_FLOORS`. (The known-side syllable filter does not bite: `reviewSyllableFilterMaxRound` is 100 and an offset-144 review is past round 145 — `useAlgorithmConfig.ts:535`.) |
| **A seed that has "graduated" drops out of USE-phrase spaced rep but stays eligible for seed-phase review.** | **WALK ONLY.** `graduatedSeeds` at `generateLearningScript.ts:1183`, filled at `:1740-1747` (a seed graduates `listeningConfig.offset` = 90 rounds after its last LEGO — `:171-180`), enforced at `:1614` and `:1813`. | **WALK.** This is the retirement rule — "nothing truly retires; whole-sentence production continues at growing cadence". | **`grep -rn graduat packages/core/src` returns nothing.** On the bundle **no seed ever graduates**: every LEGO keeps drawing ordinary use-phrase reviews at every Fibonacci offset forever, alongside the seed reviews. The bundle learner's late-course rounds are fuller of short old phrases than the design says they should be. This is the largest silent divergence in this document. |

#### (b) LEGO IDs PER CYCLE — is `190104618` fully landed?

| The behaviour | Which path has it | Which is right | What the learner on the wrong path gets |
|---|---|---|---|
| **Every cycle names all the LEGOs it contains, so the brain can record which chunks fired together.** | **BOTH, as of `190104618`.** Core spreads `decomposition` in `baseCycle` (`generateScript.ts:887`) from both phrase builders (`:737`, `:822`); `bundleToBackendCycles.ts:95` forwards it; `backendCyclesToRounds.ts:324-327` derives `componentLegoIds`. **Step 6 shares that exact chain** (`bundleFullScript.ts:203-215`), so the fix reaches BOTH consumers. Nothing is half-fixed. | — | Fixed. Before it, every bundle-course learner wrote zero rows to `learner_lego_pairings` since the cutover. |
| **A phrase with NO authored `decomposition` still gets component LEGO ids, derived by greedy longest-match segmentation of the target text — with CJK character-level sliding-window support and a synthetic `_SYN####` id for anything unmatched.** | **WALK ONLY.** `decomposePhrase` at `generateLearningScript.ts:1229-1305`; CJK branch at `:1233-1259`; synthetic minting at `:1218-1227`. | **WALK** under the ruling — but see the caveat in the next row, which is why I flag this one for Tom rather than calling it settled. | On the bundle a phrase with no authored `decomposition` column yields **one lego id**, hence **no pairs** and **no multi-tile rendering**, exactly the shape `190104618` fixed for phrases that DO carry the column. `zho_for_eng`, `jpn_for_eng` and `zho_for_gle` are on the allow-list and are precisely the courses the CJK branch exists for. **GAP: I did not measure how many rows on the fifteen courses have a null `decomposition`.** That number decides whether this is a footnote or a second job #158. |
| **Synthetic `_SYN####` ids are written to `learner_lego_pairings` as though they were LEGOs.** | **WALK ONLY.** `expandFiredLegoIds` (`buildLegoPairs.ts:55-64`) and `buildPairs` (`:19-43`) apply no filter; `LearningPlayer.vue:2800` passes them straight in; `learner_lego_pairings.lego_a/lego_b` are plain `text` with no foreign key (`supabase/schema.sql:11588-11589`). The renderer knows they are filler (`ensureTileCoverage.ts:127`) — the telemetry does not. | **Neither.** This is the one place where "the walk is right by definition" produces a wrong answer: it is a walk-side defect, not a method. Flagging rather than deciding. | Walk learners have junk rows in their pairing table; bundle learners do not. |
| **Component TARGET text in native script on a romanised course.** | WALK: real native strings, from `componentsByLegoNative` / `legoIdToTextNative` (`generateLearningScript.ts:1203-1208`). | WALK. | BUNDLE **fakes it**: `backendCyclesToRounds.ts:362-366` and `:377-379` set `componentsNative` and `componentLegoTextsNative` to the *same roman arrays*, with the comment "backend doesn't emit a separate componentsNative today". Live on `hin`, `tha`, `heb`, `zho`, `jpn`, `zho_for_gle`. A learner who toggles to native script sees roman tiles under a native sentence. |

#### (c) THE CUPS / LISTENING INTERLUDE, and the ≥144 tier — my reading is below the table

| The behaviour | Which path has it | Which is right | What the learner on the wrong path gets |
|---|---|---|---|
| **The cups listening interlude** — a 30-cup wheel, one cup poured at the end of every round, each seed in the cup played as a four-slot target/known/target/target sandwich on the belt ramp. | **NEITHER SCRIPT PATH.** It is a runtime scheduler: `composables/useLayer1Scheduler.ts` (spec in its header, `:1-62`), mounted in `LearningPlayer.vue:4860` on nothing but the presence of `supabase`, fired from the round-boundary handler at `:6663-6668` and `:6961-6966`. It does its own Supabase reads via `listeningMetaCache`. | n/a — **no divergence.** Both paths get it identically. | — |
| **Layer-2 pod laps.** | **NEITHER.** `composables/usePodLapScheduler.ts`, mounted at `LearningPlayer.vue:4774`, same conditions. | n/a — no divergence. | — |
| **Layer-1 main-flow emission** (`listening`, `listen_intro`, `listen_outro` script items). | **REMOVED from the walk on 2026-05-19** (`generateLearningScript.ts:153-155`, `:1736-1739`). Never existed on the bundle. | n/a. | — |
| **Pod emission from the script** (`emitPodLap`, `l2FiresAt`, `STAGE_PLAYLIST`, `podActivationRound`). | Dead code retained on the WALK for hot-fix rollback: defined at `generateLearningScript.ts:802-811`, `:754`, and **never called** — the main loop says so at `:1749-1754`, and `LearningPlayer.vue:684-687` explicitly declines to merge anything into it. | n/a. | — |
| **Cost of the dead listening machinery.** The walk STILL runs three Supabase queries per script generation that nothing consumes: listen-bookend audio (`:573-579`), pod sentences (`:589-604`), and a whole-course LEGO catalogue (`:612-620`, still a bare `.limit(10000)`). Only the third feeds anything real — the graduation ordinals. | WALK. | Bundle is cheaper here and loses nothing. Not a method divergence; a tidy-up. | — |
| **Pod-0 is gone; only `pod-1` is ever served.** | Enforced in ONE place, path-agnostic: `composables/servedPod.ts:21-30` (Tom's ruling 2026-09-13, `a4c55e430`). The walk reads it at `generateLearningScript.ts:590`; the bundle route queries `.in('slug', ['pod-1','method-pod'])` directly at `api/courses/[code]/bundle.ts:591`. | No divergence in what is served. | — |

#### (d) LISTENING CONFIG generally

| The behaviour | Which path has it | Which is right | What the learner on the wrong path gets |
|---|---|---|---|
| **`DEFAULT_LISTENING_CONFIG` = `{ enabled: true, offset: 90, podActivationRound: 6 }`.** Of its three fields only `offset` still does anything, and what it does is **seed graduation**, not listening. | WALK: `generateLearningScript.ts:171-180`. **The bundle has no listening config at all** — the only occurrence of the word in `packages/core/src/script/` is a comment at `generateScript.ts:219`. | **WALK**, for the same reason as the graduation row in (a): this knob is now the retirement rule wearing a listening name. | See (a): no graduation on the bundle. |
| **Layer-1 cup knobs** (`cups: 30`, `activationCount: 30`, `maxSeedsPerCup: 20`, `clusterStep: 5`) are admin-tunable from `algorithm_config['listening']` and merged at runtime. | Path-agnostic: `useLayer1Scheduler.ts:274-280`, wired at `LearningPlayer.vue:4835-4845`. | No divergence. | — |
| **The bundle DOES ship pod sentences and listen bookends** (`api/courses/[code]/bundle.ts:591`, `:612`, `:923`, `:936`) — `generateScript` ignores them entirely. They are there for the offline snapshot, not for the script. | — | No divergence. | — |

#### (e) SCRIPT-SHAPE OVERLAYS AND MODE

| The behaviour | Which path has it | Which is right | What the learner on the wrong path gets |
|---|---|---|---|
| **Easy/Fast no longer reshape the script at all.** Both generators are built MODE-NEUTRAL: the walk is called with every Easy lever off (`MODE_NEUTRAL_WALK_OPTIONS`, `repeat: 1`, `LearningPlayer.vue:721-735`), the bundle with `MODE_NEUTRAL_REPEATS` (`:624`, defined `:764`). Selection, filtering and repetition are decided live per step by `playback/modeCycleSelection.ts` and the `getCycleRepeatCount` override. Tom's architecture call, 2026-08-09. | BOTH, identically. | **No divergence in the lever itself** — and this is the good news of this audit. `easyUseWordCap`, `easyRepeatCycles`, `easyReviewSyllableFilter` test the shared runtime rule; `easyRepeatInstantPath.test.ts` and `a64RoundAdapters.test.ts` exist precisely to pin the bundle adapters to the same behaviour; `modeToggleMidSession.test.ts` pins the reshape. | — |
| **The mode consequences still differ, because the CYCLES differ.** `modeCycleSelection` decides from `cycle.type` and `cycle.singleAudio`, both of which the two generators set differently. | — | — | Concretely: the seed-review row in (a), where the walk's sandwich is exempt and the bundle's plain review is not. |
| **The global `algorithm_config.script_shape` row** (spacedRepOffsets, maxBuildPhrases, useConsolidationCount, maxSpacedRepPhrases, n1PhraseCount). | WALK reads it LIVE on every generation: `scriptShapeForMode(learningMode.value)` at `LearningPlayer.vue:719`, resolved at `useAlgorithmConfig.ts:1150`. BUNDLE gets it BAKED at API time: `api/courses/[code]/bundle.ts:709-713`, resolved at `generateScript.ts:119-125`. `bundleFullScript` passes no `shape` override (`bundleFullScript.ts:196-201`), so the baked value always wins. | Defensible as built, not a bug: the route serves a `scriptShapeVersion` on a HEAD probe (`bundle.ts:461-480`) so a client can invalidate its cached bundle. | An admin shape change reaches walk learners on their next script build and bundle learners only when their cached bundle is re-validated (`Cache-Control: private, max-age=300, s-maxage=86400` at `bundle.ts:1023-1026`). **GAP: I did not verify that the client actually runs the version HEAD probe before reusing a cached bundle** — I read the route, not the caller. |
| **The PER-MODE `scriptShape` overlay** (`ModeConfig.scriptShape`). | WALK only, via `scriptShapeForMode`. The bundle has no mechanism to receive it. | Currently moot and DOCUMENTED as a trap at `LearningPlayer.vue:707-718`: both shipped modes carry `{}`, so the walk is genuinely mode-neutral today. **Setting a non-empty overlay would split the two paths silently** — and would re-break the mid-session toggle on the walk. | Nothing today. A future admin edit to `easy_mode.scriptShape` would change round sizes for non-bundle learners only. |
| **Turbo** was retired in `d5548fdc`; only `easy` and `fast` remain. | Both. | No divergence. | — |

#### (f) EVERYTHING ELSE — both directions

| The behaviour | Which path has it | Which is right | What the learner on the wrong path gets |
|---|---|---|---|
| **The A-64 cap** — no prompt repeats more than twice consecutively. | **BOTH.** One rule in `playback/capConsecutiveRepeats.ts`, applied at the walk generator (`generateLearningScript.ts:2075`), in `toSimpleRounds.ts:20`, AND in `backendCyclesToRounds.ts:56` — which both bundle consumers go through. Pinned by `a64RoundAdapters.test.ts` for exactly this reason. | No divergence. | — |
| **Bare-LEGO build guard** — a build row whose text IS its own LEGO must not replay after the debut. | **BOTH.** Walk: `generateLearningScript.ts:1495-1500`. Core: `generateScript.ts:289-300` and `isBareLego` at `:313`, honoured in the shared selector at `phraseSelection.ts:360`. | No divergence. | — |
| **Debut phrase selection** — shortest-first by target syllables, per-LEGO urn for reviews. | **BOTH, by construction**: the walk's algorithm was extracted into `packages/core/src/script/phraseSelection.ts` and the bundle calls it. `selectionParity.test.ts` asserts debut selection **byte-identical** against real baskets from all fifteen courses, using an independent restatement of the walk. | No divergence — the strongest guarantee in the cutover. | **What it deliberately does NOT cover** (`selectionParity.test.ts:23-28`): review draws are asserted structurally only, on Tom's own 2026-08-29 ruling. It also covers nothing about seed reviews, graduation, intros, listening or mode. Every finding in this document lives in that uncovered space. |
| **Romanised courses: which text is measured for length and syllables.** | BUNDLE counts `targetTextNative ?? targetText` — the NATIVE one; the WALK counts `target_text` — also the native one, since `targetText` on the walk is `target_text_roman || target_text`. The core file flags this explicitly at `generateScript.ts:162-172`. | Stated as reconciled in code. | **GAP: I read the reconciliation note and the two call sites but did not run the two selectors over a real romanised basket to prove they agree.** `selectionParity.test.ts` runs against real fixtures from all fifteen courses including `hin`/`tha`/`heb`/`zho`/`jpn`, which is strong indirect evidence they do. |
| **Revised-audio refs** (`<uuid>.vN`) — a re-recorded clip must not be served from the old cached blob. | **BOTH.** Walk: `providers/revisedAudioRefs.ts`, applied at `generateLearningScript.ts:712-716`. Bundle: `api/courses/[code]/bundle.ts:671`, `:695-703`, `:923`, `:945`. | No divergence in mechanism. | **GAP:** the bundle's stamp is frozen at bundle-build time behind an `s-maxage=86400` CDN cache, invalidated by `courses.content_version`. **I could not verify from this repo whether Popty bumps `content_version` when a clip is revised.** If it does not, a bundle learner can hear a stale clip for up to a day after a re-record where a walk learner hears the new one immediately. That is a one-query question for the Popty repo. |
| **Intro audio: when does a LEGO get an intro cycle at all?** | WALK requires **prompt (presentation, or known as fallback) AND target1**; target2 optional, the phase is skipped gracefully. `generateLearningScript.ts:1423`, `:1441`, `:1449`. BUNDLE requires **target1 AND target2**; the prompt is optional and may resolve to an empty url. `generateScript.ts:631-640`. | **WALK** — its rule is stated as the deliberate per-item audio invariant, and it is the one that never emits a silent prompt. | Two opposite failures. A LEGO with presentation + target1 but no target2: **walk plays the intro, bundle emits none** — the learner never hears the chunk introduced. A LEGO with target1 + target2 but no presentation and no known clip: **walk skips it, bundle emits an intro whose prompt is silence**. |
| **Missing-audio telemetry when an intro falls back to the known clip.** | BOTH: `reportIntroAudioMissing` at `toSimpleRounds.ts:343-352` and `backendCyclesToRounds.ts:295-303`. | No divergence. | — |
| **A LEGO with no playable audio must not shift every later round number.** | BOTH, and both count rounds audio-aware. Walk: `mainLoopRoundCount` at `generateLearningScript.ts:2120-2124`. Bundle: `bundleFullScript.ts:145-151` and `:103-112`, which numbers the revival tail from the last round NUMBER rather than the count for exactly this reason. | No divergence. | — |
| **The revival/INF-PLAY stamp on every Round.** | BOTH: `toSimpleRounds`, `backendCyclesToRounds`, `infPlayCyclesToRounds`, pinned by `revivalMarker.test.ts`. | No divergence. | — |
| **Cycle ids name the phrase they play**, so the class brain parses one shape from both producers. | BOTH, deliberately converged (`cycleIdNamesPhrase.test.ts`, job #128). `api/_utils/classBrain.ts:288` reads `/_seed_?rep/` to catch the walk's `_seed_rep_` and the bundle's `_seedrep`. | No divergence. | — |
| **The 10,000-row phrase cap.** Both paths page `course_practice_phrases` in 1,000-row pages after an exact count: walk `fetchAllPracticePhrases` (`generateLearningScript.ts:336-371`), bundle `fetchAllBundlePhrases` (`api/courses/[code]/bundle.ts:392-420`), and the bundle's comment says it mirrors the walk's. | No divergence — **both are fixed.** | The **one remaining bare `.limit(10000)`** is the walk's listening LEGO-catalogue query at `generateLearningScript.ts:619`. It feeds graduation ordinals only, and no course is near 10,000 LEGOs, so it is a latent bug, not a live one. | — |
| **Phrase roles admitted to the pools.** BUNDLE takes `['build','use','practice','eternal_eligible']` (`bundle.ts:373`). | **GAP: I did not establish the walk's role filter precisely enough to assert they match.** The walk folds `practice` into build or use at `generateLearningScript.ts:989-1000`, which is the same intent, but I did not read its query's role list. Worth ten minutes before anyone relies on parity here. | — | — |
| **The walk does NOT fetch `decomposition` or `display_tiling` across the course** (`PRACTICE_PHRASE_COLUMNS`, `generateLearningScript.ts:321-322`) — it deliberately relies on `/cycles` to supply authored tiling per round, and derives the rest by text segmentation. The bundle fetches both (`bundle.ts:382`). | Split. | This is the inverse of the (b) finding: the **bundle** carries the authored tiling the walk's own script items lack. | Not a learner-visible loss on the walk, because `/cycles` fills it in at play time — but it means the walk's cached script and the bundle's rounds are not the same object even where they agree. |
| **`pauseConfig` passed into `generateScript` is inert on the client.** Core computes `pauseDuration` (`generateScript.ts:783-787`), `toBackendCycle` drops it (`bundleToBackendCycles.ts:82-105` carries no pause), and `backendCyclesToRounds.ts:343-350` recomputes it with `DEFAULT_FAST`. | Bundle only. | Harmless today — `DEFAULT_FAST` is what the walk uses too (`toSimpleRounds.ts:415`). Worth knowing before anyone tries to tune the mic gap through the bundle. | — |
| **Cycle type vocabulary.** Walk emits 11 types; core emits 3 (`intro`, `debut`, `review`). `bundleToBackendCycles.ts:69` maps `review` → `spaced_rep`, and build/use come through the phrase builder. | Reconciled at the adapter. | No divergence downstream — but it means `reviewItemKind` has **no bundle-side equivalent**, which is the mechanism behind the Easy-filter row in (a). | — |

---

### My reading of (c), with the evidence

**The question.** Tom's ruling of 2026-09-18 (`ssi-cups-listening-interlude-not-late-revisit`) says "the
sandwich" means the CUPS LISTENING INTERLUDE — after seed 30, 3 seeds between rounds, its phrases
dropping out of spaced repetition — and that "the late-revisit sandwich is OLD CODE". Does that mean
the ≥144 seed-phase tier should be DELETED?

**My reading: they are two different features that coexist, and the ruling is about a NAME collision,
not a deletion order. But one clause of the ruling has already come true in a way that makes me
genuinely unsure, so I am not going to pretend this is settled.**

The evidence for "two features":

1. **The code says so, in the file, in the same breath.** `generateLearningScript.ts:126-130`:
   "Distinct from L1 listening (the 30-cup model): cups are passive INPUT (hearing whole sentences
   you've stopped producing); a seed-phase spaced-rep review is active PRODUCTION (recalling the
   whole sentence from a known cue). Complementary channels, not redundant — so a graduated seed
   (dropped from use-phrase review) stays eligible for seed-phase production review." That is an
   explicit, dated statement that the two are designed to coexist, and the code enforces it: the
   graduation filter at `:1614` and `:1813` reads `!reviewItemIsSeed(offset)`, i.e. graduation
   removes a seed from use-phrase review and *deliberately leaves the ≥144 tier alone*.
2. **They live in different layers.** Cups are a runtime scheduler with no script involvement at all
   (`useLayer1Scheduler.ts`, mounted at `LearningPlayer.vue:4860`). The ≥144 tier is a script
   construct in both generators. Deleting one does not touch the other.
3. **"Phrases drop out of spaced repetition" is ALREADY IMPLEMENTED, and it is the graduation rule** —
   `listeningConfig.offset: 90` at `generateLearningScript.ts:177-179`, applied at `:1740-1747`. A
   seed graduates 90 rounds after its last LEGO, i.e. one round after the last Fibonacci use-phrase
   review (89) has fired. The comment at `:174-177` spells that arithmetic out. So the clause in
   Tom's ruling that sounds like new work is a description of existing walk behaviour.

The evidence that makes me uneasy, which I think is the real finding:

4. **The two "sandwiches" were deliberately built to be the same thing on two channels.** The walk's
   seed-sandwich docstring (`generateLearningScript.ts:1364-1366`) says it "mirrors the Layer-1
   listening cups sandwich", and `useLayer1Scheduler.ts:40-42` says the trailing 2× rep was cut
   "matching the SPEAKING-mode drained-seed review". Same four slots, same t→k→t→t order, same
   1× speed, designed within days of each other by the same people. If Tom now says only one of them
   is the sandwich, the honest question is not "delete the ≥144 tier" but **"is the ≥144 tier still
   supposed to be a listening sandwich, or should it go back to being a production review?"** — and
   the bundle path has quietly been answering "production review" for the entire cutover.
5. **Which means the two paths are currently a live A/B of exactly that product question,** with
   nobody choosing. That is what `997faff61`'s own doc says in its last paragraph, and I agree with
   it: "the drained sandwich that Tom and Aran designed only exists on the path that is being
   retired… Which of the two is the intent is a product call."

**What does not match, and I cannot resolve from code: "3 seeds between rounds".** The cup scheduler's
numbers are 30 cups, one poured per round, activation at 30 *introduced* seeds, and
`seedsPerCup = min(20, floor(introduced / 30))` (`useLayer1Scheduler.ts:20-24`, `:274-280`). So
"after seed 30" matches activation exactly. "3 seeds between rounds" matches **nothing** directly: a
cup is poured EVERY round, and seeds-per-cup only reaches 3 at 90 introduced seeds. I cannot tell
whether Tom means "3 seeds in each cup" (i.e. `maxSeedsPerCup`-ish, a knob that exists and is
admin-tunable), or "a cup every 3 rounds" (a cadence knob that **does not exist** — the wheel has no
interval; only Layer-2 pods have `roundInterval`). **Those are different builds and I am not going to
guess.** This is the one thing in my slice that needs a sentence from Tom before anyone writes code.

**So, concretely, what I would put in front of him:**
- The ≥144 tier is not dead code by any reading of the code; it is load-bearing and it is the ONLY
  thing `graduatedSeeds` still gates.
- The genuine unresolved question is whether a drained review should be **input (the walk's sandwich)
  or production (the bundle's three-clip cycle)**. Both ship today, to different learners, by accident.
- "3 seeds between rounds" does not map onto the cup wheel as built. Needs one clarifying sentence.

---

---

## 5. What changed in the plan since the design document

The design document (`archive/docs-retired-2026-08-24/bundle-cutover-design.md`,
461 lines) is the map of intent and is still broadly right. Seven things have moved
under it. Only the first was already recorded.

1. **Turbo is moot.** The design's step 3 asked for turbo tagging. Turbo was retired
   in `d5548fdc` ("two learning modes — easy and fast, turbo retired"); there is no
   `turboOmit` anywhere. Already noted in the status doc; repeated here because it
   is the only one that was.

2. **The parity problem was solved by deletion, not by a test.** The design proposed
   a golden-master diff between two selection implementations. On the evening of
   29 August that diff found a real disagreement — the walk sorted a LEGO's phrases
   shortest-first, the bundle generator sorted by database position, and the two
   filled 152 sampled rounds differently (`docs/bundle-cutover-step6-verified-2026-08-29.md`
   §2). It was written up as "open for Tom — one decision". It was then closed the
   same evening, the other way: `522bcfe56` put **one** selection algorithm in
   `packages/core/src/script/phraseSelection.ts` and made both producers call it.
   Tom's line on it — *"selection is pedagogy; bundling is plumbing"* — is quoted in
   that file's header. This is a better outcome than the design asked for, and it
   means the step6-verified document's §4 "open decision" is itself now stale.

3. **Bundle weight stopped being a gate — and the design's estimate was out by an
   order of magnitude.** Design risk 1 predicted "if > ~2 MB gz, split tiling into a
   lazily-fetched sidecar". Measured: `spa_for_eng` is 2.19 MB on the wire and
   **13.9 MB of JSON**. Tom ruled on 2026-08-29 that no split, no streaming and no
   lazy-load scheme is to be built: *"it is a one-time per-course cost after which
   everything runs off cache. Single fetch is the design."*

4. **The cold-start budget became the real story, and needed a concept the design
   did not have.** Design risk 5 called the first-visit-on-3G case "the regression
   to watch". It was worse than that: the bundle was losing the boot race on a
   *wired* link, because `CRITICAL_PATH_TIMEOUT_MS` (2,500 ms, sized for a ~20 KB
   round-map) was being used to bound a whole-course download. The answer was a new
   budget, `BUNDLE_BOOT_BUDGET_MS = 8000` in `config/networkGate.ts`, plus starting
   the download from `App.vue` at the earliest moment a course can be named, plus
   moving the IndexedDB write off the boot path.

5. **Removing work made boot slower before it made it faster.** Nothing in the
   design anticipated this. Step 6 as it first landed was a *regression* — 5,680 ms
   against the walk's 4,692 ms — because the walk's network waits handed the main
   thread back and an in-memory whole-course build did not, so ~700 ms of build
   landed inside the paint window. Two fixes: `bundleFullScriptSliced` (60-round
   chunks, yielding between them) and `afterNextPaint` on the ready handoff.

6. **Pods moved out from under the generator entirely.** Pod cadence became a
   runtime debt resolved by `usePodLapScheduler` (2026-09-05) — the generator's
   `podActivationRound` is now inert, retained only on a hot-fix rollback path
   (`LearningPlayer.vue:684-686`). And pod-0 was retired on 2026-09-13 (`a4c55e430`):
   the resolver serves pod-1 only. The design treated pod cadence as a generator
   handoff; it is now a player-side concern that the cutover does not touch.

7. **The bundle became security-load-bearing part-way through.** `a9b9071de`
   (2026-09-14) made the content gate resolve entitlements with the one resolver, so
   class and school coverage unlock the bundle. The design imagined entitlement
   becoming real *as a side effect* of the cutover; in practice entitlement work has
   overtaken the cutover and now depends on it, which raises the value of finishing
   rather than lowering it.

Two operational surfaces also appeared that the design had no reason to foresee: the
bundle's IndexedDB cache needed a version bump and a blocked-open fallback
(`7232bea9c`, `eb56d4040`, `9981a6a07`, 15 September) and the hashed bundles needed
immutable caching (`d19771d4b`, 17 September). Both are the cost of the bundle
becoming the thing every session depends on.

---

## 6. What finishing looks like

### First, a correction worth making out loud

The status doc's last open item says *"Nothing here has gone past dev (Tom,
2026-08-29: dev only)"*. That is no longer true. `git show origin/main:packages/player-vue/src/composables/useInstantPlayback.ts`
carries the 15-course list, and `git show origin/main:packages/player-vue/src/providers/bundleFullScript.ts`
exists. **Steps 5, 5b and 6 are on production today**, and today
`origin/dev`, `origin/staging` and `origin/main` are all the same commit
(`d73662013`). The soak happened; it just happened by shipping, on the ordinary
weekly train, without anyone marking the moment. Whatever else is unfinished, the
question "has this been proven in front of real learners" has been answered by
three weeks of them.

### The remaining steps

| # | Step | Gate | Risk | Size |
|---|---|---|---|---|
| **A** | **Widen the flag.** Either walk the remaining courses through the two harnesses and add them, or set `BUNDLE_BOOTSTRAP_ALL = true` and treat the evidence list as history | Both parity harnesses green per course — and see §3 on whether that gate is actually enforced | Medium. The named precedent is `fin_for_eng`: no rendered audio at all, so both paths emit nothing and parity passes *vacuously*. Any course with patchy audio needs the same scepticism | **1 line** (`useInstantPlayback.ts:189`), plus the evidence run |
| **B** | **Repoint the stragglers.** `composables/useFullCourseScript.ts` → `CourseExplorer.vue`; `composables/useEagerScriptPreload.ts` (imported by `App.vue:22`, provided at :988, no longer fired there); `views/EmbedDemoView.vue:149`'s direct `/cycles` call | Course Explorer renders the same script; the embed demo still plays | Low — all three are admin or demo surfaces, not the learner path | ~3 files, ~300 lines touched |
| **C** | **Move the shared bits out of the walk before deleting it.** `bundleFullScript.ts:45` imports `yieldToEventLoop` from `generateLearningScript`, and the `ScriptItem` type is imported by `toSimpleRounds`, `validateLearningScript`, `repeatPhraseCycles` and `speedRampSync` | Typecheck | Low, but it is why "delete the file" is not one commit | ~1 helper + 1 type into `@ssi/core` |
| **D** | **Delete.** `generateLearningScript.ts` (2,133) · `toSimpleRounds.ts` (500) · `validateLearningScript.ts` (473) · `backendCyclesToRounds.ts` (394) · `api/courses/[code]/cycles.ts` (1,114) · `infplay-cycles.ts` (449) · `round-map.ts` (178) · `useEagerScriptPreload.ts` (99) · `useFullCourseScript.ts` (194) — **≈5,530 lines**, plus most of `useInstantPlayback.ts` (1,651) and the script-blob half of `useScriptCache.ts` (962) | Nothing imports them; the player still plays | Low once A–C are done. This is the payoff, not the work | ≈5,500 lines deleted, ~2,600 more reduced |
| **E** | **`REVOKE` anon `SELECT` on the content tables** — `course_legos`, `course_practice_phrases`, `course_seeds` (`supabase/schema.sql:19934, 19941, 20104`) and the client-facing `course_audio` reads | The canary method is mandatory and is written down: apply in one transaction, replay the real app queries as the real roles, assert leak-closed **and** every legitimate path still alive, `COMMIT` only if green; then a full week on staging; then main only after 48 h with no violation logs (CLAUDE.md, RLS doctrine rules 2–4) | **Highest, and it is the one that cannot be flag-reverted.** It also cannot precede D: while any client still reads those tables directly, the revoke blacks out live learners | 1 migration, ~40 lines, carrying its own `GRANT`s and ending in `NOTIFY pgrst` |
| **F** | Drop the `get_course_cycles_window` RPC, created in the dashboard repo (`20260518_course_cycles_window_fn.sql`) | Nothing calls it | Low | 1 migration, other repo |

Steps A–D are ordinary work with a flag behind them. **E is the whole point** — it
is the only step that changes what a stranger with the public key can read — and it
is the only one with a real blast radius.

### The boot cost, honestly

The figure in question is step 6's whole-course build: roughly 700 ms of main-thread
work on a desktop profile, and "several times that" on a phone, measured at the time
(`docs/bundle-cutover-step6-verified-2026-08-29.md` §1, with a per-stage breakdown for
`tur_for_eng`). *[Gap: the "~700 ms – 5 s on a phone" range attributed to job #225
today could not be verified from here — I found no committed document or commit for
that job. The 700 ms end is verifiable in the file above; the 5 s end is not, from
this checkout.]*

**Finishing the cutover is net better than today, and orthogonal to that build.**
Three things are true at once and they are easy to run together:

- **Against the walk it replaces, the bundle path already wins** — 5,121 ms to a
  pressable button against 7,938 ms, and 74 queries against 124, on a cold signed-in
  `spa_for_eng`. So extending the flag to the remaining courses *reduces* their boot
  wait; it does not add the build cost, it swaps a bigger cost for a smaller one.
- **The build cost is paid once per course per device, not every session.**
  `setCachedScript` persists the built `Round[]` to IndexedDB on every producer
  (`LearningPlayer.vue:8033, 13553, 14351, 15793, 15930`), keyed by
  `SCRIPT_VERSION:courseCode` (`useScriptCache.ts:35, 68`). A returning learner on a
  warm cache pays neither the download nor the build. What that means practically is
  that the number to care about is the *first* open of a course, and only that.
- **Deleting the walk does not make the build any faster.** The build is on the
  bundle path, which already exists on the 15 busiest courses; step 7 removes the
  *other* path. So on the specific question — better, worse, or orthogonal — it is
  **better for every course still on the walk, and orthogonal for the 15**.

**What would actually attack the build cost**, if it turns out to matter, in the
order I would try them:

1. **Build only what the first play needs, then the rest after first audio.** All the
   machinery is already there and already used elsewhere: `generateScript` pages by
   (`fromLegoId`, `roundLimit`) — that is how `/cycles` has always driven it —
   `bundleFullScriptSliced` already chunks at 60 rounds, and `SimplePlayer.addRounds`
   / `appendRounds` exist precisely to extend a queue mid-session. Today step 6 builds
   the *whole* course on the boot path and then yields politely between chunks; it
   could build two rounds and get out of the way. This is the cheap one.
2. **Cache the built rounds against the bundle's artifact id rather than
   `SCRIPT_VERSION`.** The cache already exists; keying it to the artifact the server
   issued would make the build survive content bumps that do not change the script.
3. **Move the build off the main thread.** The walk already reaches for a
   `MessageChannel` (`generateLearningScript.ts:436`) and `generateScript` is a pure
   function with no Vue and no Supabase in it — it is genuinely worker-shaped. Most
   expensive of the three, and I would not do it before 1.

None of these are gated on finishing the cutover, and none of them block it. They are
the next question after it, not part of it.

### What this audit changes about "one line and a soak"

The status doc says flipping `BUNDLE_BOOTSTRAP_ALL` is "a one-line change gated on the soak, not on
missing work". **That is no longer a safe sentence**, and sections 3 and 4 are why. Three things have
to be true before the flag widens, and none of them is soak:

1. **Graduation has to exist on the bundle path.** `grep -rn "graduat" packages/core/src` returns
   nothing. On the walk, a seed retires from use-phrase spaced repetition 90 rounds after its last
   LEGO (`generateLearningScript.ts:177`, applied at `:1740-1747`); on the bundle **no seed ever
   retires**, so every LEGO keeps drawing reviews at every Fibonacci offset forever. That is the
   single biggest silent divergence found, it is live on 15 courses carrying 56% of all play, and
   under your ruling the walk is right by definition. It is a fix, not a decision.
2. **The parity test has to actually run.** It exists, it is good, it costs 0.5 s — and no gate in
   the estate reaches `packages/core`. Wiring it into `test:premerge` or the nightly is the cheapest
   repair in this whole audit.
3. **The two intro-playability gates have to agree.** The walk emits an intro on prompt+target1; the
   bundle requires target1+target2 and will play an intro whose prompt is silence. They fail in
   opposite directions, so neither is a subset of the other.

Everything else in §4 is either already converged (the A-64 cap, the bare-LEGO guard, debut
selection, cycle ids, the 10,000-row cap) or a footnote.

### The one thing only you can decide

**Should a drained seed review be INPUT or PRODUCTION?**

Today both ship, to different learners, by accident. On the walk, a review at offset ≥144 plays the
whole original sentence as four listening slots — target, English, target, target, no mic gap
(`emitSeedSandwich`, `generateLearningScript.ts:1362-1400`). On the bundle it is an ordinary
three-clip production exercise with a real gap, asking the learner to produce cold a sentence last
met 144 rounds ago (`buildSeedReviewCycle`, `generateScript.ts:750-790`). The bundle has never built
the sandwich at all.

Your 2026-09-18 ruling — that "the sandwich" is the cups listening interlude and "the late-revisit
sandwich is old code" — reads onto this in two incompatible ways, and the code argues against the
simpler one. The cups interlude is real, is implemented, and is **on neither script path**: it is a
runtime scheduler (`useLayer1Scheduler.ts`), identical for bundle and walk learners, and untouched by
the cutover. The ≥144 tier is a different mechanism in a different layer, and the walk's own comment
says so explicitly and dates it: *"cups are passive INPUT… a seed-phase spaced-rep review is active
PRODUCTION… complementary channels, not redundant"* (`generateLearningScript.ts:126-130`). It is also
the only thing `graduatedSeeds` still gates — deleting it strands the retirement rule. And a fix for
it landed **today** (`997faff61`), which is somebody treating it as live and wanted.

So: **is the ≥144 tier old code to delete, or a second channel to keep?** If delete, the cutover gets
simpler and the bundle's silence is accidentally correct. If keep, the bundle needs the sandwich built
before the flag widens, and that is real work rather than a flag flip. One sentence from you decides
which.

**And one clarification, if you have it to hand.** "3 seeds between rounds" does not map onto the cup
wheel as built: a cup is poured every round, and `seedsPerCup` only reaches 3 at 90 introduced seeds
(`useLayer1Scheduler.ts:20-24, 274-280`). Either you mean three seeds *in* each cup — a knob that
exists and is admin-tunable — or a cup every three rounds, a cadence knob that does not exist on the
L1 wheel at all. Those are different builds.

### Gaps, named

- The **"~700 ms – 5 s on a phone"** figure attributed to job #225 could not be verified from here: no
  committed document or commit for that job exists in this tree. The 700 ms end is verifiable
  (`docs/bundle-cutover-step6-verified-2026-08-29.md` §1); the 5 s end is not.
- ~~Whether the committed **`parity-fullscript-final` DRIFT** is a real urn defect on the walk.~~
  **CLOSED by cold-verify — see the appendix.** It is the seed-sandwich divergence of §4(a): the walk
  emits four single-audio cycles carrying the same sentence with one audio slot each
  (`emitSeedSandwich`, `generateLearningScript.ts:1371-1400`), the bundle emits one ordinary review
  cycle. Repeated text and empty audio slots are what that function is *for*. Not an urn defect.
  One residual: a cold-verify run also found an extra bundle-side USE cycle at `gle_for_eng`
  `S0001L04`, so the diffs are not exclusively seed-phase — unverified by this room.
- How many phrase rows on the 15 bundle courses have a **null `decomposition`** — decides whether the
  bundle's missing segmentation fallback is a footnote or a second job #158. Needs a live count.
- Whether the client runs the bundle's **`scriptShapeVersion` HEAD probe** before reusing a cached
  bundle; and whether Popty bumps `courses.content_version` on a re-record. The second is answerable
  only in the dashboard repo.
- The census's **learner counts are accounts, not paying customers** — no join against tester tagging
  was done, and the read of that table changes materially if most are internal.

---

*Read-only audit, 2026-09-18. No code was changed and no test suite was run beyond the named
parity harnesses. Tree: `d73662013`, which is `origin/dev`, `origin/staging` and `origin/main`
alike today. Worker slices: #227·H census, #228·H divergence, #229·H parity gate.*


---

## Appendix — cross-family cold-verify, folded 2026-09-18

`#229·H`'s report was cold-verified by GPT-6 Astra (`#230·H`), given the claim and the published
evidence only. It returned seven verifications, five refutations and one gap. Every refutation below
was re-checked against the code by this room before being accepted; all five are upheld, and one
finding Astra added is the most useful fact in the section.

**Upheld, and it changes the story: the gate was built and then deleted.** `522bcfe56` — the very
commit that created `selectionParity.test.ts` — also added a `Core tests` step running
`pnpm --filter @ssi/core test` to **both** GitHub workflows (`git show 522bcfe56 -- .github`). Those
workflows were deleted on 2026-09-04 by `8c2a88303`, *"chore(ci): delete the two dead GitHub Actions
workflows"*, as collateral of retiring Actions in favour of the command surface — and the nightly
`ci-checks.sh` never picked the core-test leg up. So this is not "nobody wired the gate". **The gate
was deliberately wired on the day the test was written, and silently dropped two months later by an
unrelated cleanup, and nothing noticed for a fortnight.** (Side note worth knowing before rewiring
it: `@ssi/core`'s `test` script is bare `vitest`, i.e. watch mode — fine under CI with no TTY, it
hangs locally. Any repair should use `vitest run`.)

**Upheld: the urn properties are asserted on a restatement, not on the function.**
`selectionParity.test.ts:252-264` defines a local `urnIndices` that re-implements
`drawReviewPhrases`'s cursor arithmetic line for line (compare `phraseSelection.ts:388-393`) rather
than calling it. The membership test *does* call the real function; non-repeat, wraparound and
coverage do not. This is the same class of hole as the frozen walk transcription, and #229·H did not
name it. Consequence in practice: with `N1_PHRASE_COUNT = 3` and seventeen offsets, the sequence is
at most 19 draws, so for pools of 20-24 the non-repeat and coverage assertions are **vacuous** — the
window loop runs zero times and the coverage test `continue`s. The wraparound test still covers them,
and `+1 mod poolLength` does imply non-repeat, so the property is not unproven — but it is proven
about a copy of the code, one step further from the thing that ships than the report implied.

**Upheld: the DRIFT is the seed sandwich, not a urn violation.** `emitSeedSandwich`
(`generateLearningScript.ts:1371-1400`) emits three or four cycles carrying the *same* known and
target text, each setting exactly one of `knownAudioId` / `target1Id`. "The same review phrase three
to four times in one round, several with missing audio-id slots" is a literal description of that
function working as designed — dated, and attributed to Tom and Aran, 2026-07-14. It also reconciles
the two worker slices: §4(a) found independently that the walk builds the sandwich and the bundle
never has, which is exactly what a whole-script diff would report as drift.

**Upheld: two harness descriptions were too generous.** `parity-fullscript.mjs:321-327` compares
cycle content only inside three ten-round windows; only the LEGO sequence is compared end to end.
And `parity-infplay.mjs:267` rejects a round-size mismatch only when `newMax < oldMin` — an entirely
larger new range passes, so "round-size ranges overlap" overstates what is checked.

**Claimed, not re-checked here:** that a live run also surfaces an extra bundle-side USE cycle at
`gle_for_eng` `S0001L04`, i.e. that the fullscript diffs are not exclusively seed-phase. Plausible
and consistent with the seed-sandwich explanation being incomplete; this room did not run it.

**Unchanged by any of this:** no gate in the estate reaches `packages/core` today (re-verified
independently against `package.json:15-17` and `ops/ci/ci-checks.sh:174-183`); the test passes, 40
tests in ~550 ms; fixture coverage is exactly the 15 cut-over courses at up to 20 LEGOs each, frozen
2026-08-29; and the three coverage holes §3 names all exist.
