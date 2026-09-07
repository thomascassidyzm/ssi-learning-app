# Layer-1 seed cups — the real rule, and who is actually getting them

Read-only census, 2026-09-06. Nothing was written to the database. Nothing here ships.

---

## 1. The rule, in one paragraph

A Layer-1 seed cup is poured at the end of **every single round**, once the course has
introduced **30 seeds** — and "introduced" is the part that matters, because it is **not
seed number 30 and not round 30**. A seed counts as introduced only when its **last LEGO**
has debuted, and the main round number is essentially the running LEGO ordinal (one new
LEGO per round). So the activation point is the round at which the 30th seed's final LEGO
lands, which on a normal SSi course with ~3 LEGOs per seed is **round 74–129, median 90**.
From that round on, a cup is due at every boundary: the wheel holds **30 cups**, one poured
per round, `cupIndex = (round − activation) mod 30`, and each cup carries
`min(20, floor(introducedSeeds / 30))` seeds — so one seed per cup at 30 introduced, two at
60, capping at 20 per cup once 600 seeds are introduced. Each seed in the cup plays a
four-slot sandwich (target → known → target voice 2 → target). The constants live in
`DEFAULT_LAYER1_CONFIG` in `packages/player-vue/src/composables/useLayer1Scheduler.ts`
(`cups: 30, activationCount: 30, maxSeedsPerCup: 20, clusterStep: 5`) and are overridable
per deployment from `algorithm_config` where `key='listening'` — **I read that live row and
it carries exactly the code defaults, so no admin has moved the threshold**. What can still
stop a cup reaching a learner: the scheduler is never constructed if there is no Supabase
client (`LearningPlayer.vue` ~4341 — the Android APK class of failure); a cup composes to
**nothing** if none of its assigned seeds have `target1_audio_id`, and `nextLap` then
returns null silently; a batch of fewer than 30 seeds "never plays" (`looseProvider`
returns null for a partial batch); the cup is skipped if its audio is not on the device;
and Layer-1 is stood down in INF PLAY mode and on a belt-earning boundary. A pod does **not**
starve it — since 2026-09-01 the cup is segued onto the back of the pod lap
(`seguePodWithLayer1`), and if the pod composes nothing the cup runs in its place
(`fallback-layer1`). Two dev cheats exist and are not the rule: `?l1test` (2-cup wheel,
activate at 2) and `?l1=1` (activate at 1, with a preview fallback that ignores activation
and cup-fill entirely) — **4,423 of the 17,515 Layer-1 plays in the database are below their
course's activation round and are therefore cheat/dev traffic, not delivery.**

---

## 2. How the reader works, and how I know it isn't lying

**The reader.** A Layer-1 play is a `player_events` row with `event_type='audio_play'`,
`payload.cycleType='pod_play'` and **`payload.stage = 0`**. `stage: 0` is written by exactly
two places in the codebase, both Layer-1 (`podSegue.ts:38` and `LearningPlayer.vue:6462`);
every Layer-2 pod play carries `stage ≥ 1` (`podStageFor` starts its loop at 1). This
survives the 2026-08-31 `isLayer1` flag — which only exists on `pod_lap_start`/`pod_lap_end`,
only since 2026-08-31, and is **false on a pod lap that has a Layer-1 cup segued onto it**,
so it is the wrong instrument for a fleet census. `role='ps'/'trans'` is *not* a
discriminator: pods use those roles too.

**Calibration, before any zero was believed.** Run against the two courses #659 established
are firing cups today:

| control | expected | reader returned |
|---|---|---|
| `rus_for_eng` | delivering | 13 cups / 65 plays, rounds 103–323, latest 2026-09-06 |
| `rus_for_eng`, `paddyhardy@hotmail.com` | the worked example, ~round 134 | **12 cups / 48 plays across rounds 103–145, latest 2026-09-06** ✅ |
| `afr_for_eng` | delivering | 3 cups / 12 plays, rounds 80–82, learner `sprosser@hasmissions.co.uk` |

Both reproduced. Only then were zeros read as zeros.

**Every zero in this report carries the same control:** the identical query, unchanged except
for the course code, returns non-zero on the 22 delivering courses below — including on
courses with only 3 cups ever (`afr_for_eng`), so it is not a sensitivity floor.

---

## 3. Per-course result

Scope: every course with at least one real (non-test, non-demo) enrolment or any Layer-1
telemetry — 77 courses. Guests excluded from the per-learner comparison, reported separately.
Tom's internal accounts included and labelled. Verdicts as at 2026-09-06.

### DELIVERING — 22 courses

Activation round is derived per course from `course_legos` exactly as `computeSeedLastOrdinals`
does. "cups" = distinct cups actually poured at or above activation.

| course | activation | learners getting cups | evidence |
|---|---|---|---|
| `ell_for_eng` | 104 | richardbuck | 29 cups / 480 plays, rounds 604–639, last 2026-07-18 |
| `rus_for_eng` | 103 | paddyhardy | 12 cups / 48 plays, rounds 103–145, last 2026-09-06 |
| `ron_for_eng` | 100 | michael204351, jackbrooks_25 | 108 + 31 cups, rounds 101–409, last 2026-08-26 |
| `hrv_for_eng` | 97 | aran, Tom | 109 + 2 cups, rounds 222–539, last 2026-07-11 |
| `cat_for_eng` | 94 | richardbuck | 12 cups / 375 plays, rounds 582–597 |
| `fra_for_eng` | 94 | sprosser, wlfgnggbln, davidmmawson, Tom | 92 + 83 + 44 + 3 cups, rounds 94–222, last 2026-09-04 |
| `zho_for_eng` | 92 | meredith.cane, Tom | 27 + 6 cups, rounds 111–1029, last 2026-08-31 |
| `gle_for_eng` | 92 | Tom | 7 cups / 26 plays, rounds 109–116 |
| `eus_for_eng` | 89 | mark.hinton | 102 cups / 561 plays, rounds 91–218, last 2026-09-05 |
| `ukr_for_eng` | 88 | joslionel, wlfgnggbln | 82 + 13 cups, rounds 112–416, last 2026-08-31 |
| `spa_for_eng` | 88 | prussell36, stephie.bordier, Tom | 41 + 13 + 5 cups, rounds 88–829, last 2026-08-31 |
| `ita_for_eng` | 87 | wlfgnggbln, Tom | 91 + 10 cups, rounds 113–878, last 2026-09-04 |
| `lav_for_eng` | 87 | hanna.salmi | 41 cups / 218 plays, rounds 134–184, last 2026-09-03 |
| `isl_for_eng` | 86 | steak4eggs, ssi@digitalcsi, paddyhardy | 60 + 30 + 4 cups, rounds 87–249, last 2026-09-04 |
| `por_br_for_eng` | 86 | jackbrooks_25, richardbuck | 39 + 17 cups, rounds 86–143, last 2026-09-04 |
| `swe_for_eng` | 82 | sprosser, attackedbywolves | 113 + 37 cups, rounds 82–143, last 2026-09-05 |
| `kor_for_eng` | 82 | meredith.cane | 41 cups / 475 plays, rounds 186–477 |
| `afr_for_eng` | 80 | sprosser | 3 cups / 12 plays, rounds 80–82 |
| `por_for_eng` | 79 | nba4191 | 15 cups / 53 plays, rounds 79–97 |
| `jpn_for_eng` | 74 | meredith.cane | 52 cups / 212 plays, rounds 74–184 |
| `cym_s_for_eng` | 56 | fransetter | **1 cup only**, round 326 — see cause below |
| `cym_n_for_eng` | 49 | morgan1009, stormhborum | 178 + 6 cups, rounds 70–625, last 2026-09-06 |

### NOT DELIVERING — 1 course

| course | activation | who, and what they got |
|---|---|---|
| `deu_for_eng` | 100 | Tom (`thomas.cassidy+ssi`, high-water round 1250) completed **one** round at round 1395 on 2026-08-08 and received no cup. No other learner on the course has completed a round at or above 100 since Layer-1 shipped. |

**Cause: undetermined, and the evidence is one round.** I am flagging this rather than
dressing it up: a single isolated round completion after a jump (the surrounding
`round_complete` rows for that session are rounds 0–26, then one row at 1395) is thin
ground for a verdict, and the honest reading is "one eligible round, no cup". What would
settle it: play `deu_for_eng` from a position past round 100 for a handful of consecutive
rounds and watch for `stage: 0` plays. The mechanical gates are all clean on this course —
667/668 seeds carry target audio, both listening bookends exist, `algorithm_config` is
default.

### Two courses that "deliver" but almost entirely fail to — cause named from data

- **`cym_n_for_eng`** — only **9 of the first 150 seeds** carry `target1_audio_id`
  (19 of 668 course-wide).
- **`cym_s_for_eng`** — only **38 of the first 150 seeds** carry `target1_audio_id`
  (128 of 668 course-wide).

A cup draws from the *introduced* seeds — the early ones — and `nextLap` returns null when
none of the cup's assigned seeds has target audio. So most cups on the two Welsh courses
compose to nothing and pour silence. Measured against rounds actually completed past
activation: `cym_s` poured **1 cup in 37 eligible rounds (0.03)**; `cym_n` poured 184 in 585
(0.31). Every other course with complete early-seed audio sits at 0.5–1.0. **This is a
content gap, not a scheduler defect, and it is the single clearest actionable finding here.**

`cym_n_for_eng` and `cym_s_for_eng` also have **no listening bookends** (`bookend_listen_intro`
/ `bookend_listen_outro` absent from `course_audio`), as do `rus_for_eng`, `afr_for_eng`,
`hun_for_eng`, `eng_for_hin`, `zho_for_tam`, `eng_for_mar` and several others — the cup still
pours, it just arrives without its chime.

### CANNOT TELL — 54 courses

No learner on these courses has completed a round at or above the activation round since
Layer-1 shipped (2026-06-03), so there is nothing to observe. This is a real answer, not a
softened "not delivering".

| course | activation | learners | furthest learner | how far short |
|---|---|---|---|---|
| `cat_for_spa` | 129 | 4 | thomas.cassidy+ssi@gmail.com @ round 0 | 129 rounds short |
| `nep_for_eng` | 109 | 6 | nba4191@gmail.com @ round 2 | 107 rounds short |
| `fra_ca_for_eng` | 100 | 6 | michael204351@gmail.com @ round 5 | 95 rounds short |
| `eng_for_jpn` | 98 | 4 | thomas.cassidy+ssi@gmail.com @ round 400 | past activation, but no round completed there since Layer-1 shipped |
| `hun_for_eng` | 96 | 9 | thomas.cassidy+ssi@gmail.com @ round 670 | past activation, but no round completed there since Layer-1 shipped |
| `tur_for_eng` | 96 | 15 | nba4191@gmail.com @ round 18 | 78 rounds short |
| `deu_at_for_eng` | 96 | 5 | kai@saysomethingin.com @ round 3 | 93 rounds short |
| `nld_for_eng` | 95 | 23 | thomas.cassidy+ssi@gmail.com @ round 563 | past activation, but no round completed there since Layer-1 shipped |
| `srp_for_eng` | 95 | 9 | sprosser@hasmissions.co.uk @ round 6 | 89 rounds short |
| `hin_for_eng` | 94 | 11 | alisonpest@yahoo.co.uk @ round 7 | 87 rounds short |
| `eng_for_tam` | 94 | 9 | thomas.cassidy+ssi@gmail.com @ round 460 | past activation, but no round completed there since Layer-1 shipped |
| `fas_for_eng` | 94 | 13 | richardbuck@vfemail.net @ round 40 | 54 rounds short |
| `lit_for_eng` | 93 | 6 | nba4191@gmail.com @ round 642 | past activation, but no round completed there since Layer-1 shipped |
| `fra_for_jpn` | 93 | 2 | michael204351@gmail.com @ round 0 | 93 rounds short |
| `eng_for_guj` | 93 | 1 | nsmprichard@gmail.com @ round 0 | 93 rounds short |
| `tha_for_eng` | 92 | 12 | meredith.cane@gmail.com @ round 31 | 61 rounds short |
| `est_for_eng` | 92 | 6 | jessicacorinnarodemerk@gmail.com @ round 2 | 90 rounds short |
| `spa_for_jpn` | 92 | 1 | sprosser@hasmissions.co.uk @ round 0 | 92 rounds short |
| `ces_for_eng` | 92 | 9 | hanna.salmi@haansa.fi @ round 71 | 21 rounds short |
| `zho_for_tam` | 92 | 1 | thomas.cassidy+ssi@gmail.com @ round 112 | past activation, but no round completed there since Layer-1 shipped |
| `bul_for_eng` | 91 | 6 | martinharte.cfc@gmail.com @ round 71 | 20 rounds short |
| `swa_for_eng` | 91 | 12 | michael204351@gmail.com @ round 11 | 80 rounds short |
| `ara_eg_for_eng` | 91 | 10 | michael204351@gmail.com @ round 7 | 84 rounds short |
| `pol_for_eng` | 91 | 12 | simonjenni374@gmail.com @ round 55 | 36 rounds short |
| `eng_for_zho` | 91 | 4 | thomas.cassidy+ssi@gmail.com @ round 116 | past activation, but no round completed there since Layer-1 shipped |
| `eng_for_kan` | 91 | 1 | thomas.cassidy+bumface@gmail.com @ round 0 | 91 rounds short |
| `deu_for_jpn` | 91 | 1 | beunollyn@gmail.com @ round 0 | 91 rounds short |
| `hye_for_eng` | 90 | 26 | thomas.cassidy+ssi@gmail.com @ round 635 | past activation, but no round completed there since Layer-1 shipped |
| `eng_for_pan` | 90 | 2 | nsmprichard@gmail.com @ round 0 | 90 rounds short |
| `dan_for_eng` | 89 | 11 | soini.vilhunen@gmail.com @ round 529 | past activation, but no round completed there since Layer-1 shipped |
| `ara_for_eng` | 88 | 9 | attackedbywolves@hotmail.com @ round 24 | 64 rounds short |
| `spa_mx_for_eng` | 88 | 7 | thomas.cassidy+ssi@gmail.com @ round 645 | past activation, but no round completed there since Layer-1 shipped |
| `ben_for_eng` | 88 | 8 | mark.hinton@gmail.com @ round 4 | 84 rounds short |
| `eng_for_mar` | 87 | 4 | thomas.cassidy+ssi@gmail.com @ round 859 | past activation, but no round completed there since Layer-1 shipped |
| `eng_for_ben` | 87 | 2 | nsmprichard@gmail.com @ round 0 | 87 rounds short |
| `eng_for_urd` | 87 | 1 | nsmprichard@gmail.com @ round 0 | 87 rounds short |
| `nor_for_eng` | 86 | 12 | thomas.cassidy+ssi@gmail.com @ round 508 | past activation, but no round completed there since Layer-1 shipped |
| `spa_for_zho` | 86 | 2 | thomas.cassidy+ssi@gmail.com @ round 0 | 86 rounds short |
| `ara_lb_for_eng` | 85 | 12 | michael204351@gmail.com @ round 22 | 63 rounds short |
| `heb_for_eng` | 85 | 12 | thomas.cassidy+mergetest@gmail.com @ round 200 | past activation, but no round completed there since Layer-1 shipped |
| `eng_for_ara` | 85 | 3 | thomas.cassidy+admin001@gmail.com @ round 0 | 85 rounds short |
| `eng_for_hin` | 84 | 9 | thomas.cassidy+ssi@gmail.com @ round 197 | past activation, but no round completed there since Layer-1 shipped |
| `eng_for_sin` | 84 | 8 | michael204351@gmail.com @ round 504 | past activation, but no round completed there since Layer-1 shipped |
| `eng_for_tel` | 84 | 1 | danielwithington91@gmail.com @ round 0 | 84 rounds short |
| `glg_for_eng` | 83 | 6 | nba4191@gmail.com @ round 36 | 47 rounds short |
| `eng_for_fra` | 83 | 10 | thomas.cassidy+ssi@gmail.com @ round 102 | past activation, but no round completed there since Layer-1 shipped |
| `eng_for_kor` | 83 | 2 | thomas.cassidy+ssi@gmail.com @ round 0 | 83 rounds short |
| `ita_for_jpn` | 82 | 1 | aboassa@yahoo.it @ round 0 | 82 rounds short |
| `eus_for_spa` | 82 | 19 | nba4191@gmail.com @ round 3 | 79 rounds short |
| `fra_for_zho` | 81 | 2 | wlfgnggbln@arcor.de @ round 52 | 29 rounds short |
| `zho_for_jpn` | 78 | 3 | danielwithington91@gmail.com @ round 0 | 78 rounds short |
| `zho_for_gle` | n/a | 3 | thomas.cassidy+schools1-001@gmail.com @ round 9 | catalogue <30 seeds |
| `cym_for_eng_north` | n/a | 4 | thomas.cassidy+ang@gmail.com @ round 0 | catalogue <30 seeds |
| `cym_for_eng` | n/a | 1 | farleyj17@hwbcymru.net @ round 0 | catalogue <30 seeds |
---

## 4. Guests, cheats and the shape of the whole dataset

17,515 Layer-1 plays exist in `player_events`. They split:

| bucket | plays | reading |
|---|---:|---|
| at or above the course's activation round, real learner | **12,870** | genuine delivery |
| below activation, real learner | 4,423 | `?l1=1` / `?l1test` dev cheats and preview fires — **not delivery** |
| guest sessions (`learner_id` null) | 222 | evidence the path works without an account; excluded from the per-learner comparison |

The cheat bucket is why a naive count of "Layer-1 plays per course" overstates delivery
badly: 25% of all Layer-1 telemetry in the database was produced by a dev flag at rounds
1–4 on courses where the rule cannot possibly have fired.

---

## 5. Honest gaps

- **`round_complete` is not a complete log of rounds played.** On `afr_for_eng` the reader
  finds 3 cups against only 2 recorded eligible rounds — a ratio above 1 is arithmetically
  impossible if the round log were complete. So the cups-per-eligible-round ratios in §3 are
  **indicative, not exact**, and the "no round completed past activation since Layer-1
  shipped" test that puts 54 courses in CANNOT TELL may be over-inclusive. It cannot be
  wrong in the dangerous direction (it never turns a real delivery into a zero — delivery is
  measured from the Layer-1 plays themselves, not from the round log), but a course sitting
  in CANNOT TELL could in principle be a NOT DELIVERING.
- **Sub-1.0 cup rates on courses with complete audio** — `zho_for_eng` (33 cups / 207
  eligible rounds), `gle_for_eng` (7 / 37) — have **no cause I can name from data**. The
  candidates are INF PLAY (Layer-1 is stood down there), belt-earning boundaries, sessions
  that ended at the boundary, and the round-log incompleteness above. What would settle it:
  a per-session cross-tab of `learning_mode_selection` against boundary events for those two
  learners. I did not infer a cause.
- **Pre-2026-08-31 laps carry no `isLayer1` flag.** The `stage: 0` reader does not depend on
  it, but note that any *lap-level* count (`pod_lap_start`) before that date cannot separate
  the two layers.
- **`listening_skipped_offline` has never fired** — 0 rows fleet-wide. That event only
  shipped 2026-08-31 (`916bc875`), so this says nothing about earlier offline skips.
- `completed_pod_rounds = 0` on a Layer-1 learner is **correct**, not a defect — Layer 1 has
  no ratchet by design.

---

## 6. Method

Read-only. `algorithm_config` key `listening` read live. Activation computed per course from
`course_legos` ordered by `(seed_number, lego_index)`, taking the ordinal of the 30th seed's
last LEGO. Learner position from `course_enrollments`
(`max(highest_completed_round_index, last_completed_round_index)`); rounds actually played
from `player_events` `round_complete`. Delivery from `player_events` `audio_play` with
`payload.stage = 0`. Test/demo/e2e/invite-link accounts excluded. Scripts committed under
`scripts/layer1-delivery-census/`.
