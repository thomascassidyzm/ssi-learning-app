# Telemetry census, 2026-09-12: six questions from live player_events, inventory, and a proposed algebra

Job #318·F, read-only. Every number below was produced by a SELECT in `scripts/telemetry-census-2026-09-12.sql` on this branch, run through the pooler against the live Supabase project at about 03:45 to 04:10 UTC on 2026-09-12. No row was written. Each query was run on a 7-day window first, then 30 days, then all-time where the question asked for it.

## The finding in one paragraph

The diary can answer all six questions today, but two of them only through a derivation the event does not carry and one only through a proxy. Lapse, session length, courses per learner and the Blue-belt round question are computable from timestamps plus `round_complete.seedId`. Easy v Fast is attributable, but only because Easy leaks a once-per-page-load event that Fast does not, plus a stored preference and a code default; no per-play row carries mode. Listening Mode is measured by a 30-second heartbeat with no per-clip events, so it can be sized but not inspected. The real production population is small: 140 real learners have ever produced a production event, 92 in the last 30 days, and only 7 have ever completed a Blue-belt round. Any engine built on this will be answering questions about tens of people, and the algebra has to say so on every card.

## Defaults taken without asking, one line each

- Session rule: consecutive events by one learner closer than 300 s are one session, block capped at 3 h, exactly `api/_utils/inAppTime.ts`. Sensitivity at 120 s and 600 s shown for Q1 and Q3.
- Q1 and Q2 sessionise per learner and course; Q3 per learner across courses.
- Headline numbers are `env = 'production'`. All-time figures also include `env IS NULL`, which is every row before tagging began on 2026-06-18, and that means all-time may hold a little pre-tagging staging traffic.
- Learner key is `coalesce(learner_id, user_id)`; `user_id` holds `learners.id`, verified with zero disagreements in 30 days and 8,881 of 8,881 user_id-only rows resolving to a learner.
- Belt is derived from `round_complete.payload.seedId` with the CLAUDE.md thresholds. The event stores no belt.
- Real-practice floor tested two ways, see Q1.
- This week is Monday 2026-09-07 00:00 UTC to the run time.

## Population, as resolved live

| Population step | Count |
|---|---|
| learners rows | 1,458 |
| excluded by test_learner_ids() | 1,018 |
| excluded by staff platform_role | 26 |
| excluded as class entities | 184 |
| real learners | 433 |
| real learners with any production event | 199 |
| after dropping JP and FI rows | 140 |
| active last 30 days | 92 |
| active last 7 days | 62 |

Two things worth knowing. Fifty-nine real learners have every one of their production events stamped JP or FI, so the machine-country rule removes whole people, not just rows. And 143,751 production rows carry no learner key at all, guests mostly, led by audio_play, cycle_prosody and cold_start. They are outside every number here.

Rows by env: production 568,437 of which 162,759 in the last 30 days; env NULL 202,812 from 2026-04-20 to 2026-08-26; staging 67,201 of which 13,776 in 30 days; dev 19,717.

## Part A, the six questions

### Q1. Average lapse between sessions per course

Lapse is next session start minus previous session end, same learner, same course. Median matters; the mean is pulled by people who come back after weeks.

Last 30 days, production, cutoff 300 s, courses with two or more learners, top rows:

| course | learners | sessions | lapses | mean h | median h | p90 h |
|---|---|---|---|---|---|---|
| cym_s_for_eng | 41 | 149 | 108 | 27.5 | 9.5 | 72.8 |
| zho_for_eng | 22 | 27 | 5 | 74.4 | 23.8 | 182.9 |
| cym_n_for_eng | 6 | 76 | 70 | 18.7 | 4.5 | 22.7 |
| ell_for_eng | 6 | 31 | 25 | 39.6 | 6.7 | 109.5 |
| hrv_for_eng | 5 | 64 | 59 | 13.1 | 2.9 | 33.7 |
| nld_for_eng | 5 | 46 | 41 | 25.4 | 20.3 | 70.1 |
| fra_for_eng | 4 | 80 | 76 | 20.9 | 8.1 | 48.0 |
| swe_for_eng | 3 | 90 | 87 | 15.4 | 6.8 | 50.4 |
| eus_for_eng | 3 | 70 | 67 | 19.5 | 4.0 | 43.1 |

All-time, production plus untagged, cutoff 300 s, top rows by learners:

| course | learners | sessions | lapses | mean h | median h | p90 h |
|---|---|---|---|---|---|---|
| cym_s_for_eng | 51 | 217 | 166 | 66.1 | 9.5 | 115.4 |
| zho_for_eng | 43 | 63 | 20 | 206.5 | 48.0 | 470.1 |
| afr_for_eng | 27 | 207 | 180 | 46.3 | 8.5 | 64.6 |
| ell_for_eng | 13 | 314 | 301 | 38.0 | 8.0 | 77.8 |
| cym_n_for_eng | 12 | 226 | 214 | 23.0 | 3.5 | 23.6 |
| hrv_for_eng | 11 | 257 | 246 | 27.1 | 6.4 | 32.4 |
| fra_for_eng | 11 | 229 | 218 | 24.7 | 5.9 | 52.0 |
| isl_for_eng | 10 | 217 | 207 | 40.1 | 11.4 | 72.0 |
| swe_for_eng | 8 | 341 | 333 | 17.3 | 5.3 | 28.2 |

Cutoff sensitivity, all-time median lapse in hours:

| course | 120 s | 300 s | 600 s |
|---|---|---|---|
| cym_s_for_eng | 3.9 | 9.5 | 15.8 |
| zho_for_eng | 24.9 | 48.0 | 48.0 |
| afr_for_eng | 2.9 | 8.5 | 9.9 |
| ell_for_eng | 2.2 | 8.0 | 12.4 |

What the number says: the median lapse moves by a factor of four between a 2-minute and a 10-minute cutoff, because a large share of "lapses" are same-sitting breaks of a few minutes. Lapse as Tom means it, the gap before you come back, is better read as lapses longer than 3 hours: median 27.7 h on cym_s, 16.5 h on afr, 22.6 h on ell, 112 h on zho, all-time.

Chinese with a real-practice floor, all-time:

| floor | learners | lapses | median h | median return over 3 h |
|---|---|---|---|---|
| none | 43 | 20 | 48.0 | 112.4 |
| A: two sessions or ten minutes | 9 | 20 | 48.0 | 112.4 |
| B: ten minutes total | 0 | 0 | | |

Floor A as worded cannot move a lapse figure, because a lapse already needs two sessions. Floor B is the one that bites, and on Chinese it removes everybody: not one of the 43 real learners has ten minutes of sessionised time on zho_for_eng. Tom's suspicion is confirmed and stronger than stated. Chinese is not a polluted course with a real core, it is tyre-kicking all the way down. Floor B on cym_s keeps 13 of 51 learners and drops the median lapse from 9.5 h to 5.1 h.

### Q2. Average lapse after completing a round in Blue Belt

Belt derived from seedId, Blue = S0080 to S0149. Every round_complete row in the window has a parseable `Snnnn` seedId, 1,882 of 1,882 in 30 days, so the derivation covers the whole diary. No row carries a belt field.

| window | Blue rounds | learners | courses | rounds that ended a session | median pause to next event | median carried on after the round | returns | median return | mean return |
|---|---|---|---|---|---|---|---|---|---|
| 30 days | 145 | 3 | 6 | 0 | 0.0 s | 9.9 min | 123 | 1.9 h | 22.6 h |
| all-time | 372 | 7 | 9 | 0 | 0.0 s | 13.8 min | 350 | 1.1 h | 22.2 h |

What the number says: nobody stops at a Blue round boundary. The next event is the next cycle's audio_play, immediately, in all 372 cases; learners carry on for a median 14 more minutes and then come back a median 1.1 h later. The population is 7 people ever, 3 this month. Belt coverage of all round_complete rows all-time: White 1,254 rounds by 92 learners, Yellow 901 by 26, Orange 1,135 by 24, Green 792 by 14, Blue 372 by 7, Purple 435 by 5, Brown 172 by 5, Black none.

### Q3. Average session length in minutes this week

Per learner, production, real population, cutoff 300 s:

| week | learners | sessions | mean min | median min | p90 min | total min |
|---|---|---|---|---|---|---|
| this week from Mon 07 Sep | 55 | 225 | 11.3 | 2.2 | 30.6 | 2,539 |
| previous week 31 Aug to 06 Sep | 48 | 208 | 12.5 | 5.5 | 35.9 | 2,601 |

Sensitivity, this week: mean 9.0 / 11.3 / 14.0 min and median 2.1 / 2.2 / 3.6 min at 120 / 300 / 600 s; previous week mean 10.0 / 12.5 / 14.9, median 4.4 / 5.5 / 8.0.

What the number says: the typical sitting is a few minutes and the mean is carried by a tail of half-hour sessions; this week has more learners and more sessions than last but a shorter median, which is the Chepstow class accounts and their students showing up in short bursts.

### Q4. In-app minutes at Easy v Fast per course

No per-play row carries mode. `audio_play.playbackSpeed` is identical in both modes by design, pinned by `playback/easyFastSpeedParity.test.ts`, so speed cannot separate them; the two modes differ in which cycles are selected out and how many times a cycle sounds. The signals that exist, in the order the query uses them: `learning_mode_toggle {mode}` on a change; `learning_mode_selection {mode:'easy', selectedOut, rounds}` once per page load when the Easy selection pass first runs, and Fast never runs that pass so it never logs; the last-known signal carried forward across page loads; `learners.preferences.learning_mode`, set by the toggle; and the code default, which is Fast. Minutes are gaps of at most 300 s between consecutive events, attributed to the mode in force at the start of the gap.

Last 30 days, totals:

| mode | minutes | learners | from a diary signal | from stored preference | from the code default |
|---|---|---|---|---|---|
| easy | 978 | 73 | 950 | 28 | 0 |
| fast | 9,354 | 56 | 4,507 | 4,697 | 150 |

Per course, last 30 days, courses over 100 minutes:

| course | easy min | fast min |
|---|---|---|
| eus_for_eng | 1 | 1,747 |
| cym_n_for_eng | 8 | 1,416 |
| swe_for_eng | 5 | 1,145 |
| fra_for_eng | 7 | 1,043 |
| nld_for_eng | 5 | 939 |
| ita_for_eng | 35 | 536 |
| por_br_for_eng | 2 | 477 |
| hrv_for_eng | 4 | 435 |
| rus_for_eng | 48 | 354 |
| ell_for_eng | 261 | 92 |
| ukr_for_eng | 42 | 298 |
| cym_s_for_eng | 289 | 47 |
| isl_for_eng | 0 | 306 |
| spa_for_eng | 0 | 149 |
| ron_for_eng | 41 | 91 |
| pol_for_eng | 3 | 106 |

Of the 92 real learners active in 30 days, 27 toggled at least once, 67 have some diary mode signal, 13 have only a stored preference and 12 have neither and are attributed Fast by default. Stored preferences across all learners: easy 101, fast 41, unset 1,316.

What the number says: Fast carries about ninety percent of production minutes, and the exceptions are the school courses, cym_s and ell, where Easy dominates. Half the Fast minutes rest on a stored preference rather than an in-diary signal, and 150 minutes rest on nothing but the default.

GAP, the most important one in this census: mode is not on any per-event row. A learner in Fast who never toggles is indistinguishable in the diary from a learner who never reached playback. The fix is one field, `mode`, on audio_play or on round_complete.

### Q5. Listening exercises in main flow v in Listening Mode

How the two were told apart. Main flow is audio_play rows by `cycleType`: the pod layer is `pod_play`, `pod_intro`, `pod_outro`, roles ps, ps2x and trans, logged with podRound and stage; the older listening cycles are `listening`, `listen_intro`, `listen_outro`. Listening Mode is `ListeningOverlay.vue`, which logs no audio_play at all, only `listening_tick {view}` every 30 s while playing and foregrounded, so its minutes are ticks times 0.5. The two cannot collide because the overlay never writes an audio_play.

Last 30 days, production, real population:

| bucket | rows | learners | minutes |
|---|---|---|---|
| Listening Mode, ticks | 120 | 5 | 60 |
| main flow, listening pods | 20,558 | 23 | 739 |
| main flow, listening cycles | 0 | 0 | 0 |
| main flow, speaking cycles | 85,191 | 68 | 8,320 |

Per course, pods v Listening Mode, courses with any: eus 167 min pods; fra 135; cym_n 99 pods and 1 Listening Mode; swe 99; ita 75 and 3; ukr 46 and 44; nld 42; por_br 22; hrv 21; isl 12; ell 2 and 10; hin 0 and 3; afr 0 and 1. The `listening` cycle type has 1,227 audio_play rows all-time and none in the last 30 days.

What the number says: Listening Mode is used by five people for an hour a month in total; the listening pods in main flow carry twelve times that. Only one learner, on ukr, uses both in comparable amounts.

GAPS: Listening Mode logs no per-clip event, so nothing inside it can be inspected, only its duration to the nearest 30 s; the tick is gated on foreground and playing, so backgrounded listening is invisible; the only navigation signal is `view` with values pods, seeds and phrases, so "free to navigate around" cannot be measured beyond which tab was open.

### Q6. People on multiple courses

| basis | window | 1 course | 2 | 3 | 4 or more | share on 2 or more |
|---|---|---|---|---|---|---|
| production events | all-time | 72 | 43 | 17 | 24 | 84 of 156, 54% |
| production events | 30 days | 51 | 28 | 7 | 6 | 41 of 92, 45% |
| course_enrollments rows | all-time | 115 | 44 | 18 | 34 | 96 of 211, 45% |
| course_enrollments rows created in window | 30 days | 80 | 22 | 7 | 1 | 30 of 110 |

Reconciliation all-time: 79 learners are multi-course on both bases; 5 are multi-course by events only; 17 by enrolments only, of whom 13 have no production event at all. The events basis counts 156 learners and the enrolments basis 211, the difference being enrolled people who never produced a production event or only produced untagged or staging ones. The 30-day enrolments row is enrolments created in the window, not learners active in it, so it is not comparable to the events row and is shown only because the brief asked for both.

Top course pairs all-time: cym_s + zho 13 learners, cym_n + zho 6, afr + cym_n 5, afr + fra 5, afr + isl 5, deu + zho 5. In 30 days cym_s + zho is 11 of the 28 two-course learners. The Chinese default-loading period shows up here as a phantom second course on Welsh learners.

## Part B, what is actually present

Production, real population, last 30 days. Payload keys listed are those on at least 5% of a 300-row random sample; a percentage means the key is on that share of the sample, no percentage means all of it.

| event_type | rows | learners | payload keys |
|---|---|---|---|
| audio_play | 105,749 | 68 | cacheHit, cycleType, learnerId, legoId, playbackSpeed, role, seedId, url, cycleId 78%, elapsedMs 22%, podRound 22%, reason 22%, playIndex 21%, sentenceIdx 21%, stage 21% |
| phase_skip | 3,615 | 20 | cycleId, cycleType, direction, elapsed_in_phase_ms, fromPhase, learnerId, legoId, pauseDuration, roundNumber, slot, toPhase |
| tap_pause | 1,905 | 82 | during, learnerId, legoId, roundIndex, roundNumber |
| tap_play | 1,434 | 66 | firstPlay, learnerId, legoId, roundIndex, roundNumber |
| round_complete | 1,364 | 52 | learnerId, legoId, roundIndex, seedId |
| adaptation_plan | 1,348 | 52 | applied, difficultyStates, learnerId, legoId, plan, roundLegoCentrality, roundNumber |
| tap_skip | 832 | 16 | during, learnerId, legoId, roundIndex, cycleIndex 98%, cycleType 98%, direction 98%, roundNumber 98%, skipInProgress 86% |
| cold_start | 801 | 89 | animFloorMs, guest, isFreshLoad, learnerId, mainExecMs, mountedMs, mountToReadyMs, returnUser, scriptPath, totalMs, userAgent, warmAudioMs |
| pod_lap_start | 756 | 23 | learnerId, omitIntro, plays, podRound, isLayer1 42% |
| pod_lap_end | 754 | 23 | abortReason, cancelled, elapsedMs, learnerId, playsCompleted, playsExpected, podRound, skippedByUser, stoppedByUser, isLayer1 40% |
| lego_skip | 646 | 27 | direction, fromLegoId, learnerId, roundNumber, slot |
| cycle_prosody | 471 | 4 | audioId, averageEnergyDb, cycleId, cycleType, durationDeltaMs, envelope, extractorVersion, learnerDurationMs, learnerId, legoId, peakEnergyDb, playbackSpeed, responseLatencyMs, seedId, speechEndMs, speechStartMs, startedDuringPrompt, stillSpeakingAtVoice1, promptEndMs 63%, voice1StartMs 63% |
| cursor_move | 415 | 17 | fromLegoId, fromRoundIndex, kind, learnerId, moved, toLegoId, toRoundIndex, reason 93% |
| bundle_boot_path | 373 | 46 | budgetMs, detail, learnerId, outcome, reason, stage, waitedMs, actor_user_id 16% |
| learning_mode_selection | 201 | 62 | learnerId, mode, rounds, selectedOut, actor_user_id 11% |
| commentary_start | 155 | 18 | learnerId, textPreview, type |
| commentary_end | 153 | 18 | learnerId, reason, type |
| listening_tick | 120 | 5 | view |
| bundle_tier_heal | 105 | 33 | bundle_course_code, detail, learnerId, outcome, resolved_tier, stored_tier, stored_with_auth, tookMs |
| belt_skip | 92 | 19 | direction, fromBelt, learnerId, roundNumber, targetSeed, toBelt, actor_user_id 7% |
| learning_mode_toggle | 67 | 27 | learnerId, mode |
| script_revalidated | 50 | 20 | courseCode, fromStamp, learnerId, ms, rounds, toStamp |
| infplay_enter | 6 | 2 | cachedOnly, cursorLegoId, infRoundIndex, isGuest, learnerId, mode, online, trigger |
| infplay_exit | 4 | 1 | cursorLegoId, dwellMs, enteredAtCursorLegoId, infRoundsElapsed, learnerId, online, reason, trigger |
| audio_failed | 2 | 2 | learnerId, reason, attempt 50%, cycleId 50%, cycleType 50%, errorCode 50%, lastError 50%, legoId 50%, role 50% |
| audio_retry | 2 | 2 | attempt, cycleId, cycleType, learnerId, legoId, reason, role, errorCode 50%, lastError 50% |

Twenty-six event types in the window against the 43 the August census saw all-time; session_complete, turbo_toggle and settings_changed are absent from production in the last 30 days.

Dimensions:

| dimension | status | field or rule |
|---|---|---|
| mode, Easy or Fast | DERIVABLE, weakly | learning_mode_toggle and Easy-only learning_mode_selection, carried forward; learners.preferences.learning_mode; default Fast. Not on any per-play row |
| speed | STORED | audio_play.payload.playbackSpeed, per play; but it does not encode mode |
| belt | DERIVABLE | seedId thresholds on round_complete and audio_play; belt_skip carries fromBelt and toBelt as the only stored belt |
| round | STORED | roundIndex on round_complete, tap_play, tap_pause, tap_skip; roundNumber elsewhere; podRound on pod events |
| seed | STORED | seedId on audio_play, round_complete, cycle_prosody |
| lego | STORED | legoId on most player events |
| session boundary | DERIVABLE | 300 s idle gap on occurred_at; session_id is a page-load uuid that never closes. Confirmed as #316 found |
| flush trigger | ABSENT | no column, no payload key. Confirmed as #316 found |
| device_type | STORED | mobile 89,420 rows, desktop 31,989, tablet 11 |
| app shell, web or webview | STORED since 2026-09-10 | app_shell column: web 10,660 rows, webview 2; NULL before that date |
| user agent | STORED on cold_start only | cold_start.payload.userAgent, once per page load; no column on the row |
| env | STORED since 2026-06-18 | production, staging, dev; NULL on 202,812 older rows |
| country | STORED | ip_country: GB 79,034, DE 15,857, BE 9,281, NL 7,565, AU 6,343 in the window; region and nation of the learner ABSENT |
| client_version | STORED | commit sha; eight builds in the window, top 572d716 |
| class-mode actor | STORED, partial | payload.actor_user_id on 674 of 121,420 rows; the class entity is the learner_id itself |

## Part C, a proposed minimal algebra

Measure x grain x filter x comparator x window. Every result carries its population count and the session rule it used.

Measures: in_app_minutes, session_count, session_length, lapse and its return-only variant lapse_over_3h, return_within_N days, courses_per_learner, rounds_completed, plays, mode_minutes, listening_minutes by place, plus the two already on the intel pages, rate_of_progress from course_enrollments.highest_completed_seed over time and stick_rate as return_within_7 after first session.

Grains: event, session, round, learner, class, school, course, global. Class and school resolve through `learners.is_class_entity`, `user_tags` and `classes`, not through player_events.

Filters the data supports: mode with the weak derivation above, belt derived, course, env, country, device_type, app_shell from 2026-09-10, real-population, real-practice floor as minutes threshold. Not supported: region, nation, subscription tier on the event, flush trigger, user agent per event.

Comparators: entity v class, class v school, school v global this course, global all courses, entity v its own previous window. Above school the data supports nothing today: no learner, school or class carries a region or nation. A `region` on schools, or a country on learners rather than on each event, is the one field that would unlock class v regional and school v national.

Windows: today, 7, 30, all-time, and same window last period.

The six questions as expressions:

1. `median(lapse) by course, grain=session, filter real+production, window 30d | all-time, session_rule 300s` and the return-only variant `lapse > 3h`.
2. `median(next_session_start - session_end) by course, grain=round, filter belt=Blue derived from seedId, window all-time`, with the companion `median(session_end - round_complete)`.
3. `mean, median(session_length) grain=session, filter real+production, window this_week v last_week, session_rule 300s`.
4. `sum(in_app_minutes) by course x mode, grain=event-gap, mode from toggle | Easy-selection | preference | default`.
5. `sum(in_app_minutes) by course x place, place from cycleType in pods | listening | speaking, and listening_tick x 0.5 for Listening Mode`.
6. `count(learner) by n_distinct(course), grain=learner, basis events | enrolments, window 30d | all-time`, plus `count(learner) by course pair`.

The nightly insight-discovery digest against this algebra: event volume, audio failure rate by build, device and course, most-skipped legos and per-course enrolled and active are all expressible as `count(event) by filter` and `count(learner) by course x return_within_N`. What is not in the algebra and should not be is its population: the digest excludes only `educational_role = student` and applies neither the real-learner resolver nor the env or country rules, so its numbers and these will not agree until it reads the same population.

## Gaps, named

1. Mode is on no per-event row. Easy is inferable from a page-load side effect; Fast is silent. One `mode` field on audio_play or round_complete closes it.
2. Belt is on no row except belt_skip. Derived from seedId everywhere here; fine while thresholds are static, wrong the day they move without the event carrying the belt it played under.
3. Listening Mode has no per-clip events, a 30-second heartbeat gated on foreground, and a three-value view field.
4. Flush trigger and app-level session end are absent; sessions are the 300 s rule and nothing else.
5. Region and nation exist nowhere on a learner, school or class.
6. 202,812 rows before 2026-06-18 carry no env, so all-time figures cannot be cleanly production-only.
7. 59 real learners are invisible under the JP and FI rule because every production event they have is stamped with one of those countries. Worth one look at who they are.
8. The nightly digest and the intel pages use different populations from each other and from this census.
