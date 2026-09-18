# Player advancing on its own — the two forum reports of 2026-09-13/14 (job #644)

Traced from the learner's experience backwards, on 2026-09-14, against the live database, the
live telemetry and the code on `dev`. Learners are not identified: the two telemetry threads below
are named by the first eight characters of a learner id, as evidence of the pattern, not as identity.

## The root cause, in one paragraph a forum reply could be written from

The player was deciding what the learner had heard from what its own timers were doing, and on a
phone that is often wrong. When something outside the app paused the audio — the car's bluetooth
dropping, a headset button, another app taking the sound — the engine only made a note of it and
left every timer running, so ten seconds later its stall watchdog decided the paused clip had
failed, skipped it, and started the next one on the phone's own speaker, or into silence if the
ring switch was on. While the sound stayed lost every clip "failed" in turn, and the cursor walked
forward one clip every ten seconds with nothing to hear. That is the app that "determinedly keeps on
playing" and the "enormous progress that I have not made". The same skip-on-failure path had no
floor, so any run of clips that would not play was walked through at machine speed. Separately, the
app was reading "no new item in this round" as "this must be infinite play": a round whose item has
no audio yet looks exactly like that, and Basque has sixteen such items between seeds 85 and 99, so
two seeds past one of them the learner got the red infinite-play bar, a frozen belt, an infinite-play
back button and a fast-forward that would not go — with the cursor still saying seed 87. And the
seed-sentence reviews that come just before a listening lap were built without clip lengths, so the
gap for saying the sentence collapsed to its one-second safety floor. The fixes: an outside pause is
now a pause and nothing resumes without a tap; a fourth unheard clip in a row stops the player with
a tap-to-retry message instead of racing on; every round now carries which loop it belongs to
instead of being guessed from its shape; and the seed reviews carry their clip lengths, with a
sensible gap assumed whenever a length is missing.

## Each symptom, and what it turned out to be

| Reported | Finding | Fix |
|---|---|---|
| Neil: pause then it skips ahead; 3% of the belt in ten minutes; "my brain can't keep up" | An outside pause (headset, lock screen, route loss, another app) was recorded but not acted on; the stall watchdog and the pause trim timer kept advancing; the foreground recovery timer un-paused. A dead or unreachable run of clips advanced at machine speed. | Outside pause halts in place and lands paused. Fourth consecutive unheard clip stops the player loudly. |
| Neil: back button only goes one section back | Once a round is taken for infinite play, back is "one revival round" and the header chevron is the only exit. Rounds were taken for infinite play by shape. | Rounds carry `revival: true/false` from the producer; shape is the fallback only for old caches. |
| mintonman (1): about one second to respond, usually before a listening lap | Seed-sentence reviews (`_seedrep`) are built from `course_seeds`, which has no clip durations; the gap formula collapsed to `min_pause_ms` = 1000. Measured in the reporter's telemetry: 16 seed reviews at 1.6–1.8 s, most within 30 s of a `pod_lap_start`. | Bundle route looks up seed clip durations from `course_audio`; `computePauseDuration` assumes a 2.5 s sentence when both durations are missing. |
| mintonman (2): moves on a second into the mic stage | Every instance in the telemetry carries a `tap_skip` event 150–200 ms earlier (bursts of 7–14 taps at ~180 ms spacing on 09-08 13:38 and 15:04). The client registered taps. Not reproduced as a spontaneous advance. | No change. Reported as evidence. |
| mintonman (3): a lone Basque phrase, no "just listen" intro, then a normal exercise | The drained seed sandwich (target → known → target → target, single-audio sub-cycles) that a seed-phase review emits at offset ≥144. By design; it has no framing clip. | No change. Flagged for a product call: a one-line frame would stop it reading as a glitch. |
| mintonman (4): red infinite-play bar after a seed or two | `isInfPlayActive` was true whenever the current round had no intro/debut/build cycle. Basque LEGOs with no audio at seeds 85, 87, 88, 90, 91, 93, 99 produce review-only main-loop rounds. | `isMainLoopRound` reads the producer's stamp first. |
| mintonman (5): stuck around seed 87, would not fast-forward | Same cause as (4): a round mistaken for infinite play routes forward/back through the infinite-play handlers. | Same fix. |
| mintonman (6): car off, bluetooth gone, app keeps playing; phantom progress | The outside-pause path above. iOS pauses the element on route loss; the engine now stays paused. | Outside pause halts in place; no auto-resume; `audio_interrupted` telemetry added. |

## Evidence

**Basque, blue belt (learner `c7455b18`, `eus_for_eng`, mobile, seeds to 95, active to 2026-09-13).**
Mic gap measured as (target1 `audio_play` − known `audio_play` − known clip duration): 436 ordinary
cycles at 8–36 s; every gap under 1.6 s is an intro cycle (no gap by design) except the seed-sentence
reviews, all of which sit at 1.57–1.76 s, and most of which are followed by a listening lap within
30 s. Two bursts of `tap_skip` at ~180 ms spacing (09-08 13:38:54–13:39:00, 14 cycles; 15:04:42–49,
10 cycles). No `audio_failed` in seven days.

**CORRECTION (13:10Z).** Learner `81987d60` is Tom's own account (display name "Tom"), not a
forum learner. The thread below is therefore Tom testing at the authored end of Welsh North, and
Neil remains unidentified: no Welsh learner other than a Colombo-hours tester was at seed 400+ in
the last four days, and the brown-belt reading below fits Neil's description only if "black belt"
is shorthand for the course end.

**Welsh North, brown belt (learner `81987d60`, `cym_n_for_eng`, cursor at `S0305L05`, the course's
final authored LEGO).** Thirteen `infplay_enter` events with trigger `round_cross` in 24 hours, each
landing on a random revival seed (S0297, S0290, S0126, S0186, S0051, S0167, S0073, S0237, S0018,
S0238, S0145, S0122) and each within a second of a `cold_start`. `infplay_exit` reason `session_end`
after 5–166 s. On 09-14 10:35 the learner was at S0001L01 pausing and re-pausing before being
dropped back into infinite play at S0122. No learner on any Welsh course was at seed 400+ in the
last four days other than a Colombo-hours tester who belt-skipped there on 09-12.

**Welsh South, black belt (learner `c430906f`, `cym_s_for_eng`).** 1,484 round-forward skips in 17
hours, 607 of them in one ten-minute window at 04:20Z on 09-12, from seed 8 to seed 221. Every one
carries a `lego_skip` event, i.e. the round-forward control fired. Consistent with a tester racing to
black belt, not with the reports.

## Content findings (not code — for the content pipeline)

- **Basque `eus_for_eng`: 178 new LEGOs and 1,958 practice phrases have no audio ids at all** (24%
  and 28% of the course). By seed, LEGOs without audio: 6(2) 22(3) 37(4) 38(3) 39(2) 43(2) 50(3)
  55(1) 85(3) 87(1) 88(1) 90(5) 91(2) 93(1) 99(3) 116(4) 117(3) 119(2) 121(4) 127(2) 129(2) 133(2)
  143(3) 144(2) 146(3) 148(2) 152(3) 157(3) 159(2) 168(3) 169(2) 170(2) 171(1) 178(2) 182(3) 183(2)
  184(3) 190(2) 192(2) 193(2) 194(1) 202(2) 203(3) 204(4) 205(3) 208(2) 224(1) 229(2) 234(3) 235(2)
  237(3) 238(2) 243(3) 246(2) 248(3) 249(2) 252(2) 254(2) 258(2) 260(1) 262(4) 268(4) 269(3) 270(2)
  281(4) 286(3) 290(1) 293(2) 294(3) 297(2) 298(2) 300(2). Only 93 of the LEGOs and 424 of the
  phrases have all three clips present in `course_audio` by text match — a re-link would recover
  those; the rest have no audio recorded. The player now survives them without pretending to be in
  infinite play; it cannot teach them.
- **Authored extent versus advertised length.** `cym_n_for_eng` has LEGOs to seed 305 of 668,
  `cym_s_for_eng` to 334, `eus_for_eng` to 300. Black belt starts at seed 400 and is unreachable on
  all three. A learner at the authored end is taken into infinite play from every cold start,
  which the Welsh North thread above shows.
- **Clip durations in `course_audio` are sound** for all three courses: no null, no sub-100 ms clip
  on any role, medians 2.7–3.5 s. The sub-5 ms pod-1 blips reported for the Welsh splicer work are
  not in these tables. The player now counts a real `ended` under 50 ms as unheard anyway.
- **Seed-phase reviews** are the only production cycles built without durations; the bundle route
  now supplies them.

## What was verified and how

- Engine: ten new or deliberately flipped tests fail on the pre-fix `SimplePlayer`/`PlayerConductor`
  and pass on the fix (`audioInterruption.test.ts`, `SimplePlayer.test.ts`, `PlayerConductor.test.ts`,
  `computePauseDuration.test.ts`, `revivalMarker.test.ts`). The playback, providers and i18n
  directories (71 files) pass; `@ssi/core` (39 files) passes; the bundle route's own test passes.
- Not reproduced on a device: bluetooth route loss and the headset pause button cannot be driven
  headless. The engine-level behaviour on the element's `pause` event is what the tests pin.
- Not reproduced headless as a spontaneous mid-mic-stage advance: every instance in telemetry has
  a tap 150–200 ms before it.

## Third report — Lithuanian, tester nba4191, `tester_feedback` row 90683123

**The row.** Filed 2026-05-21 13:55Z from `staging.saysomethingin.app`, build `92a64c9`, desktop
Chrome on a Mac, route `/`: "Lithuanian course jumped from Orange belt to Brown belt … every belt
from White to Purple is fully complete and Brown is started … yesterday was working through the
Orange belt." It is four months old, not from this morning; it is the same false assumption in an
earlier body.

**The learner.** `de757444` (user `5884f9b6…`), enrolled in 33 courses. The `lit_for_eng` enrollment
today still reads `last_completed_lego_id = S0029L01`, `highest_completed_lego_id = S0300L02` (the
course's final LEGO), `infplay_round_index = 114`, mode `main`. The belt screen derives "White to
Purple complete, Brown started" from that ceiling. It was never repaired. Clip durations at the
Orange belt end are sound: seeds 20–39 have 535 known, 566 target1 and 537 target2 clips, none null,
minimum 0.9 s, medians 2.2–2.8 s; no LEGO in the course lacks audio ids and only 27 phrases do.

**When it jumped, to the second.** On 2026-05-20 the learner was in round 65 of the main loop
(`S0022L02`, Orange). At 12:52:13 the intro of `S0022L02` was sounding. At 12:52:16 the next known
clip played belonged to `S0040L01_intro` — the first LEGO of the Green belt — and from 12:52:17 to
12:52:22 the player walked through `S0020L01_inf_R526`, `S0134L01_inf_R525`, … `S0244L02_inf_R513`,
fourteen infinite-play rounds at ~200 ms each, then `S0300L01_intro`, `S0280L01_intro`,
`S0150L01_intro`, `S0080L01_intro`, `S0040L01_intro` — the first LEGO of every belt, descending —
and round again. Not one `tap_skip`, `tap_play` or `belt_skip` in that minute; the taps resume at
12:54:14 when the learner paused on `S0064L03` at round index 456 and navigated back by hand to seed
18. The next session (15:16) booted straight into an infinite-play round (`S0289L03` at index 0), so
the enrollment had already been written as "at the end" by then. No row-level provenance exists for
`course_enrollments` (`content_audit_log` covers content tables only), so the write itself is
bracketed, not timestamped: between 12:52:13 and 15:16:30 on 2026-05-20.

**What did it.** The build of that week loaded rounds through `PriorityRoundLoader` ("Priority 3:
First of NEXT belt"), which put the first round of every belt into the engine's queue ahead of the
rest of the current belt. `SimplePlayer.advanceRound` steps to `roundIndex + 1` in the array with
no check that the next round is the next round number — it still does not check today — so a
sparse queue is played as if it were contiguous: `S0022L02` → `S0040L01` → `S0080L01` … → the
revival tail. The 200 ms per round says every clip in that walk failed instantly on that desktop;
each round contributed only its intro's prompt before the engine stepped on. Reaching the revival
tail is infinite play by shape, and in that build `saveRoundProgress` ratcheted
`highest_completed_lego_id` to the course's final LEGO on nothing but the round's shape (no content
gate until commit `dd40e950c`, 2026-08-31: "a review-only round is not proof of infinite play").
`PriorityRoundLoader` was deleted on 2026-06-08 (`26a28944d`) with zero live callers.

**A twin four days later.** Learner `aa85be4f` (knightghost1), `hrv_for_eng`, desktop, 2026-05-24
15:06–15:08: after four completed rounds at seed 7 the queue ran `S0008L01` (Yellow start) →
`S0020L01` (Orange) → `S0040L01` (Green) → `S0080L01` (Blue) → `S0150L01` (Purple) → `S0280L02`,
`S0280L03` (Brown) → `S0090L01_inf` → `S0043L01_inf_R678`, each intro playing in full this time,
with `round_complete` at indexes 612, 660 and 661. Same loader, same walk, same ratchet; that
enrollment reads cursor `S0006L02`, ceiling at the course end, today.

**How many carry the mark.** 14 enrollments across 7 learners have `highest_completed_lego_id` at
the course's final LEGO with a cursor 50+ seeds behind. Eleven are explained by belt skips (Tom's own
test accounts on fra/ita/zho/gle/jpn/ell/nld, Meredith Cane on kor/zho, paddyhardy on isl,
soini.vilhunen on dan). Three have zero belt skips and are this defect: nba4191 `lit_for_eng`
(cursor S0029L01), knightghost1 `hrv_for_eng` (S0006L02), silverjfangio `hye_for_eng` (S0026L01,
predates the cycle-id telemetry so its date cannot be read). Repair would be one update per row,
setting the ceiling back to the cursor.

**What it adds to the diagnosis.** Same family as Basque: infinite play inferred from shape, and a
ceiling that only ratchets up. The May trigger (a sparse queue) is gone; the September trigger (a
main-loop round with no audio) is live; the residual in both is that the engine never checks that
the next round in its array is the next round in the course, and that `isMainLoopRound` reads
shape. Neither Lithuanian nor Croatian clip durations had anything to do with it.
