# Bundle cutover — live course census

Read-only census, 2026-09-18. Every number below is tied to the query that produced it.
Code tree: `cs/227-cutover-course-census` off `origin/dev` at `d73662013` — and `origin/dev`,
`origin/staging`, `origin/main` are all at that same commit (`git ls-remote origin dev staging main`),
so the path split described here is the split running in production.

**Definitions used**

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

## 1. The live catalogue

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

## 2. Weekly play volume

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

### Walk courses by volume — who is still on the walk

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

### Bundle courses by volume

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

## 3. The named stragglers

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

### `fin_for_eng` — the "no audio at all" claim, checked

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

### Reverse `eng_for_XXX` courses

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

## 4. Honest summary

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

### Explicit gaps

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

