# Adoption numbers — what learners actually turn on

Measured live against production Supabase on **19 August 2026**. Read-only; nothing was written.
Scripts that produced every figure are in this directory (`00`–`05`, run in order from the repo root).

Sanity gate passed: `courses` counted **146** rows (expected ~145), so the service-role key was in
force and no count here is anon-scoped.

Identity verified before use, not assumed: on a 3,000-row sample, `player_events.learner_id` and
`player_events.user_id` both match `learners.id` 2,520/2,520 and `learners.user_id` 0/2,520 — and
the two columns are identical on all 540,423 rows that carry both. `sessions.learner_id` matches
`learners.id` 17,277/17,277. So every join below keys on `learners.id`.

---

## 1. The active-learner population

**Definition used: 36 learners.** A learner row that is
not demo (`is_demo = false`), not a class placeholder (`is_class_entity = false`), not SSi staff
(`is_internal = false` and `platform_role` not `ssi_admin`/`tester`), with at least one session that
recorded play, **≥ 2 hours** of accumulated `sessions.duration_seconds`, and a session started within
the **last 90 days** (from 21 May 2026).

| Cut | Learners |
|---|---:|
| `learners` rows, all | 1,116 |
| — excluded: `is_demo` | 723 |
| — excluded: `is_class_entity` | 75 |
| — excluded: `is_internal` | 19 |
| — excluded: staff `platform_role` (`ssi_admin`, `tester`) | 17 |
| Real, non-staff learner rows | 327 |
| …who ever played a session at all | 137 |
| …active in 90 days, any play at all | 123 |
| **…active in 90 days with ≥ 2h play (the population used here)** | **36** |
| …same but ≥ 30 min instead of 2h | 50 |
| …same but staff included | 44 |

Play time inside the population: min 2.6 h, p25 4.9 h, **median 12.9 h**, p75 35.9 h, max 717.9 h.

**Demo exclusion is clean and it matters enormously.** `is_demo` is the generator's own flag, and the
demo cohort dominates several telemetry tables — of the 271 learners with any `learner_lego_metrics`
row, **269 are demo**; of the 272 with any `cycle_prosody` event, **269 are demo**. Any figure taken
without that exclusion is a measurement of the demo generator, not of learners.

**One honest wobble in the population.** Two of the 36 carry `platform_role = 'popty_user'` — SSi
content-team accounts using the player for real, which you could argue either way. Script `05`
recomputes every event-derived figure with them removed: the population goes 36 → 34 and **no single
figure moves by more than two learners**, so nothing below turns on that call.

The 36 are named accounts with plausible learner behaviour (top five by play: 718 h, 169 h, 130 h,
121 h, 69 h). The 718-hour account is an outlier and probably a heavy internal user who is not
flagged as one; it changes no percentage here, since every figure below is a learner count.

---

## 2. `player_events` event-type census

704,047 rows scanned, all-time, **43 distinct event types**. "All learners" and "90d learners" are
distinct-learner counts **including demo** — that gap is itself the story on several rows. The last
two columns are restricted to the 36 active learners (their events are all within 90 days, so the
90-day and all-time active columns are identical and only one is shown).

| event_type | all events | all learners | 90d events | 90d learners | active-pop events | active-pop learners |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `audio_play` | 575131 | 302 | 562266 | 299 | 320071 | 33 |
| `phase_skip` | 25433 | 212 | 25291 | 205 | 3602 | 19 |
| `tap_pause` | 22147 | 169 | 20216 | 164 | 7695 | 36 |
| `tap_play` | 19068 | 136 | 17549 | 131 | 6142 | 34 |
| `lego_skip` | 9571 | 54 | 9571 | 54 | 1197 | 25 |
| `round_complete` | 8782 | 104 | 8132 | 99 | 4249 | 34 |
| `tap_skip` | 7996 | 185 | 7098 | 159 | 1746 | 25 |
| `cold_start` | 7654 | 189 | 7654 | 189 | 2015 | 34 |
| `cycle_prosody` | 4806 | 272 | 4417 | 270 | 437 | 1 |
| `audio_retry` | 4525 | 36 | 4525 | 36 | 697 | 21 |
| `adaptation_plan` | 3209 | 58 | 3209 | 58 | 1676 | 22 |
| `pod_lap_end` | 3202 | 54 | 2746 | 52 | 1865 | 29 |
| `pod_lap_start` | 3188 | 54 | 2715 | 52 | 1786 | 29 |
| `listening_tick` | 2328 | 10 | 2328 | 10 | 384 | 4 |
| `audio_failed` | 2061 | 37 | 2061 | 37 | 327 | 18 |
| `commentary_start` | 1158 | 49 | 1146 | 49 | 673 | 30 |
| `commentary_end` | 1158 | 49 | 1147 | 49 | 679 | 30 |
| `belt_skip` | 900 | 57 | 900 | 57 | 195 | 22 |
| `session_complete` | 785 | 170 | 544 | 168 | 1 | 1 |
| `turbo_toggle` | 237 | 19 | 237 | 19 | 60 | 8 |
| `learning_mode_selection` | 180 | 23 | 180 | 23 | 11 | 5 |
| `intro_audio_missing` | 159 | 9 | 159 | 9 | 10 | 4 |
| `learning_mode_toggle` | 132 | 24 | 132 | 24 | 24 | 11 |
| `script_revalidated` | 79 | 28 | 79 | 28 | 37 | 17 |
| `l1_cluster_start` | 32 | 2 | 0 | 0 | 0 | 0 |
| `admin_group_deleted` | 28 | 0 | 28 | 0 | 0 | 0 |
| `admin_demo_node_activity_refreshed` | 23 | 0 | 23 | 0 | 0 | 0 |
| `admin_signin_link_minted` | 15 | 9 | 15 | 9 | 0 | 0 |
| `admin_demo_school_expired` | 9 | 0 | 9 | 0 | 0 | 0 |
| `instant_playback_entitlement_fallback` | 8 | 2 | 8 | 2 | 1 | 1 |
| `admin_demo_school_created` | 7 | 0 | 7 | 0 | 0 | 0 |
| `admin_demo_school_activity_refreshed` | 7 | 0 | 7 | 0 | 0 | 0 |
| `admin_school_deleted` | 6 | 0 | 6 | 0 | 0 | 0 |
| `test_event` | 5 | 1 | 5 | 1 | 0 | 0 |
| `admin_demo_node_minted` | 3 | 0 | 3 | 0 | 0 | 0 |
| `admin_entitlement_code_minted` | 3 | 0 | 3 | 0 | 0 | 0 |
| `sentinel_synthetic_probe` | 3 | 0 | 3 | 0 | 0 | 0 |
| `tap_listening_download` | 2 | 2 | 0 | 0 | 0 | 0 |
| `listening_pack_start` | 2 | 2 | 0 | 0 | 0 | 0 |
| `listening_pack_progress` | 2 | 2 | 0 | 0 | 0 | 0 |
| `deploy_check` | 1 | 0 | 1 | 0 | 0 | 0 |
| `prod_deploy_check` | 1 | 0 | 1 | 0 | 0 | 0 |
| `adaptation_persistence_error` | 1 | 1 | 1 | 1 | 0 | 0 |

### What the census says at a glance

- **The player itself is well instrumented.** Play, pause, skip, round completion, cold start, pod
  laps, meta-commentary, audio failures and retries all land.
- **Three toggles emit an event**: `turbo_toggle`, `learning_mode_selection` / `learning_mode_toggle`,
  and the listening-pack trio. Everything else a learner can switch on emits nothing.
- **`cycle_prosody` at 272 learners is a demo artefact** — 269 of those are demo learners, 1 is active.
- **`session_complete` looks healthy at 170 learners all-time but reaches exactly 1 active learner.**
  Same cause: it is overwhelmingly demo-generated. It is not a usable completion metric for real
  learners as it stands.
- **`listening_pack_start`, `listening_pack_progress`, `tap_listening_download` have 2 events each,
  all older than 90 days, none from an active learner.** The offline-download flow is instrumented
  and effectively unused.
- **Nine event types are ops/admin, not learner behaviour** (`admin_*`, `deploy_check`,
  `prod_deploy_check`, `sentinel_synthetic_probe`, `test_event`) — worth knowing before anyone counts
  rows in this table as engagement.
- **`listening_pack_end` and `listening_pack_skip` exist in the client code but have never been
  written once.**

---

## 3. Per-feature adoption among the 36 active learners

| Feature | Active learners | % of 36 | Basis |
| --- | ---: | ---: | --- |
| Personalised pacing / VAD — mic consent granted (metrics proxy) | 1 | 3% | learner_lego_metrics rows exist; LearningPlayer.vue only calls recordCycle when VAD produced a latency, so any row proves consent |
| Personalised pacing / VAD — prosody captured | 1 | 3% | player_events event_type='cycle_prosody' |
| Adaptation plan actually computed for them | 22 | 61% | player_events event_type='adaptation_plan' |
| Listening mode / pronunciation mode — mode chosen or toggled | 11 | 31% | player_events 'learning_mode_selection' ∪ 'learning_mode_toggle' |
| Listening mode — actually played (ticks) | 4 | 11% | player_events 'listening_tick' |
| Learning mode persisted on the learner row | 11 | 31% | learners.preferences.learning_mode present |
| Turbo mode — toggled | 8 | 22% | player_events 'turbo_toggle' |
| Turbo mode — enabled on the learner row | 0 | 0% | learners.preferences.turbo_mode_enabled === true |
| Playback speed changed away from 1x | 28 | 78% | audio_play payload->>playbackSpeed != 1 |
| Offline download — listening pack started | 0 | 0% | player_events 'listening_pack_start' ∪ 'tap_listening_download' |
| Offline download — lease taken | 5 | 14% | offline_leases rows |
| Two or more courses — by sessions | 31 | 86% | sessions grouped by course_id |
| Two or more courses — by enrolments | 31 | 86% | course_enrollments grouped by course_id |
| Redeem / entitlement code redeemed | 11 | 31% | user_entitlements.redeemed_at |
| Arrived via an invite code | 0 | 0% | learners.invite_code_id not null |
| Pod used (lap started) | 29 | 81% | player_events 'pod_lap_start' |
| Meta-commentary heard | 30 | 83% | player_events 'commentary_start' |
| Encouragements setting present on row | 36 | 100% | learners.preferences.encouragements_enabled (written for everyone — a default, not a choice) |
| Session-length setting present on row | 36 | 100% | learners.preferences.session_duration_minutes (same caveat) |
| Last-course-code remembered on row | 35 | 97% | learners.preferences.last_course_code |
| Learner-facing insights surface opened | 0 | 0% | NO SIGNAL — /me is deliberately unlinked from every nav (router/index.ts:475) and emits no event |
| Script view toggled on | 0 | 0% | NO SIGNAL — localStorage 'ssi-show-view-script' only, never written to the DB |
| PWA installed | 0 | 0% | NO SIGNAL — localStorage 'ssi-install-dismissed' only; /install is a static guide with no event |
| Walkthrough / How This Works opened | 0 | 0% | NO SIGNAL — HowThisWorks.vue lives under components/admin and /methodology is admin-facing; no learner route, no event |
### The five findings that matter

1. **Personalised pacing / VAD is at 1 of 36 (3%).** Using the `vadUptake` method — `recordCycle` in
   `LearningPlayer.vue:1982` only fires when VAD produced a real latency, so *any*
   `learner_lego_metrics` row is proof the learner granted the mic. Across the whole database only
   **2 non-demo learners ever** have such a row, and only **3 non-demo learners ever** have a
   `cycle_prosody` event. This is the starkest number in the job.
2. **Adaptation still reaches 61% of them without a microphone.** `adaptation_plan` fires for 22 of
   36, because it is gated on `adaptationV2Config.enabled`, not on mic consent
   (`LearningPlayer.vue:5044`) — it runs off behavioural evidence. So the *pacing engine* is broadly
   live; only its *mic-fed* input is unused.
3. **Turbo mode: 8 of 36 toggled it, and nobody anywhere has it left on.** 237 `turbo_toggle` events
   across 19 learners all-time, yet `learners.preferences.turbo_mode_enabled` is `false` for all 25
   rows that carry the key — zero `true` in the entire table. People try it and turn it off.
4. **Playback speed is the most-adopted optional control: 28 of 36 (78%).** 263,445 `audio_play`
   events carry `playbackSpeed ≠ 1`. It is measurable only by accident, because the speed rides along
   in the audio-play payload rather than being logged as a choice.
5. **Course-hopping is near-universal: 31 of 36 (86%) have played 2+ courses**, and the distribution
   has a long tail — 13 of the 36 have played 8 or more (one has played 18). Whatever else these
   learners do, they browse.

Offline downloads split by which signal you trust: **5 of 36 hold an `offline_leases` row (14%)** —
14 leases exist in total, 5 of them trials — but **0 of 36 ever emitted a listening-pack event**. The
lease is the entitlement, not proof a download completed, so the honest reading is "a handful started,
none is observed finishing".

Redeem codes: **11 of 36 (31%)** have a `user_entitlements.redeemed_at` (85 redemptions exist in
total). `learners.invite_code_id` is set on 61 rows database-wide but **0** of the active 36 — invite
codes belong to the schools/teacher onboarding path, not to these learners.

The three `learners.preferences` keys written for everyone — `volume`, `encouragements_enabled`,
`session_duration_minutes` (all 1,116 rows) — are **defaults, not choices**, and must not be read as
adoption. `learning_mode` (29 rows, values `easy`/`fast`) and `turbo_mode_enabled` (25 rows) are the
only two preference keys that record a real learner decision.

---

## 4. The measurement gaps — what cannot be measured, and why

This section is a deliverable, not a caveat. Most learner toggles in this app live in `localStorage`
on the device and are never written to the database, so "ever enabled / still enabled" is genuinely
not measurable. The complete set of device-local keys found in `packages/player-vue/src`:

`ssi-adaptation-consent`, `ssi-mode-listening`, `ssi-mode-pronunciation`, `ssi-listening-mode`,
`ssi-listening-gloss`, `ssi-listening-audit`, `learner_speed`, `ssi-show-view-script`,
`ssi-install-dismissed`, `ssi-org-install-dismissed:*`, `ssi-offline-mode-*`, `ssi-last-course`,
`ssi-has-played`, `ssi-welcome-heard`, `ssi-brand-welcome-seen`, `ssi-locale`, `ssi-language`,
`ssi-timezone`, `ssi-show-fragile-warning`, `ssi-show-fire-path`, plus the dev/QA keys
(`ssi-enable-qa-mode`, `ssi-show-debug-overlay`, `ssi-verbose-logging`, `ssi-dev-*`).

| Feature | Why it cannot be measured | Cheapest change that would fix it |
|---|---|---|
| Mic / pacing consent state | `ssi-adaptation-consent` is device-local; the only DB trace is a *consequence* (a metrics row), so a learner who consented but never produced a usable latency is invisible, and one who revoked consent still looks consented forever | Emit one `settings_changed` event carrying `{ setting: 'adaptation_consent', value }` from `handleAdaptationConsent` in `LearningPlayer.vue` — the same one event covers every other toggle below |
| Script view (seeing the text) | `ssi-show-view-script` only; no event, no column. `script_revalidated` is a cache event and says nothing about the learner looking at text | The same `settings_changed` event, emitted where `ssi-show-view-script` is written |
| Pronunciation mode | `ssi-mode-pronunciation` only. `learning_mode_selection` covers `easy`/`fast`, not this | The same `settings_changed` event |
| Listening mode "on" (as opposed to played) | `ssi-mode-listening` / `ssi-listening-mode` only; `listening_tick` proves play, not enablement | The same `settings_changed` event |
| Playback speed as a *decision* | Measurable only as a side effect of `audio_play` payload; we cannot see when a learner changed it, to what, or whether they changed it back | The same `settings_changed` event where `learner_speed` is written |
| PWA install | Nothing records an install. `ssi-install-dismissed` records only a *dismissal*, device-locally; `/install` is a static guide with no event | Emit one `pwa_installed` event from the `appinstalled` window listener, and one `display_mode: 'standalone'` field on the existing `cold_start` payload — the second is close to free and retroactively answers "how many play from an installed app" |
| Walkthrough / How This Works / methodology explainer | Not a learner surface at all: `HowThisWorks.vue` sits under `components/admin/`, and `/methodology` is admin-facing. There is nothing for a learner to open, so 0% is structural rather than behavioural | Nothing to instrument until a learner-facing route exists; instrument it at the same time it is wired in |
| Learner-facing insights | `/me` exists but is **deliberately unlinked from every nav** (`router/index.ts:475` says so explicitly), so no learner can reach it. 0% is by construction | Same: instrument on the commit that links it |
| Offline download *completion* | `offline_leases` proves an entitlement was taken, not that bytes landed; `listening_pack_end` is coded but has never fired once | Confirm why `listening_pack_end`/`listening_pack_skip` never fire — the event exists, so this is a wiring bug, not a missing signal |
| Session completion, for real learners | `session_complete` reaches 1 active learner while showing 170 all-time, because the count is demo-dominated | Not a signal gap — a reporting trap. Any query on this table must exclude `is_demo` learners |
| Notifications | No opt-in surface found in the learner app; PWA push is documented as out of scope | Nothing to measure |
| Theme | Correctly a no-op: `useTheme.ts` pins `mist`, there is no switcher | Nothing to measure |

**One change buys almost all of it.** A single `settings_changed` event — `{ setting, value }` in the
payload, emitted from wherever a toggle is persisted — would make mic consent, script view,
pronunciation mode, listening mode and playback speed measurable at once, with no new table, no
migration and no schema decision. That is the one cheapest change, and it is one event type, not ten.

---

## 5. Scripts

| Script | What it does |
|---|---|
| `_db.mjs` | Service-role REST helper; keyset pagination only, never `offset` |
| `00-sanity.mjs` | The `courses ≈ 145` gate — aborts if an anon key leaked in |
| `01-pull-events.mjs` | All 704,047 `player_events` rows by keyset on `id` → `_cache-events.jsonl` |
| `02-pull-support.mjs` | `learners`, `sessions`, `course_enrollments`, `learner_lego_metrics`, `entitlement_grants`, `invite_codes` |
| `03-census.mjs` | The active population and the event-type census |
| `04-features.mjs` | Per-feature adoption, plus the live `offline_leases` / `user_entitlements` / playback-speed reads |
| `05-sensitivity.mjs` | Re-runs every event figure with the two `popty_user` accounts removed |

Cache and output files (`_cache-*`, `_out-*`, `_md-*`) are regenerable and are not committed.
