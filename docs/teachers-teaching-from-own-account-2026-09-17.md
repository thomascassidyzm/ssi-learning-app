# Teachers who taught a class from their own account

Read-only, 2026-09-17. Live DB, `player_events` joined to `classes` / `class_teachers`.
No writes of any kind were made. Nothing here has been sent to anybody.

## The signal

A teacher's own-account `player_events` sharing a browser `session_id` with the class
learner of a class that teacher teaches — the signal job #74 proved from the raw events
for 9b/KW LJ at St Alban's. It catches the specimen, so the query is sound.

One confound had to be removed first, and it matters: when a teacher plays **as the class**,
the app writes the same event twice, once against the class learner and once against the
teacher's own learner, at the identical millisecond. Counting those as own-account play
inflates the list with every teacher who has ever done the right thing. Every own-account
event that has a twin class-learner row at the same timestamp, same event type and same
role is therefore discarded, and only the genuinely solo events remain.

Excluded as non-real: `St. Mary's Academy, Kochi` (`is_demo = true`), `ZZ Test — Chepstow
scenario` (Tom's own test school), and `dulminih+testt@alliontechnologies.com` (no school,
a build test). Excluded on the evidence: **Mrs Ruttley**, Ysgol Gyfun Tredegar — her
own-account play on 11 September was *Afrikaans*, one phrase, two minutes, immediately
before she opened the class properly and taught it on the class account for ten minutes.
That is a teacher looking at a different course, not teaching a class from the wrong
account. She was also one of the five in the 2026-09-15 copy sweep and has already had an
inbox notice on this subject; a second note would read as nagging.

## The list — two teachers

Neither of them was in `tools/copy-teacher-play-sweep-applied-log.json`. Nothing of theirs
was copied on 2026-09-15, so neither has heard from us about this before. Both appear in
`docs/teacher-play-sweep-ambiguous-2026-09-14.md`, left alone because copying would have
been a guess — that is a different criterion from this one, and it is a cross-check, not
the answer.

### 1. leejames — St Alban's RC High School, Pontypool

- **user_id** `be35b6de-96d5-4900-b6b8-e6c4ab8360d9`, own learner `e40decc7-2bc7-4723-a264-c8cc98067580`
- **Course** cym_s_for_eng — Welsh southern for English speakers
- **Classes** teaches 9 at the school: 7A LJ, 7G LJ, 7L LJ, 8a/AB LJ, 9a/AB LJ, 9b/KW LJ, 10a1 LJ, 10b3, 11b1 LJ
- **9 qualifying sittings**, 8 to 14 September, **about 122 minutes** of active teaching on his own account
- **Session ids** `0125c130-33ca-411d-8c9b-967446223716`, `a8e8d70b-0d60-4da7-958b-1cfe120d037f`, `bd9f7c8a…`, `daad4752…`, `5757e0dc-2850-4152-a1cc-ed14dea3c101`

| Date | Time | Phrases heard | Chunks covered |
|---|---|---|---|
| Tue 8 Sep | 13:08–13:18 | 27 | S0001L01 → S0002L02 |
| Wed 9 Sep | 08:55–09:05 | 28 | S0002L02 → S0004L01 |
| Thu 10 Sep | 10:06–10:19 | 28 | S0001L01 → S0003L01 |
| Thu 10 Sep | 10:52–11:10 | 29 | S0001L01 → S0003L01 |
| Thu 10 Sep | 13:29–13:39 | 27 | S0001L01 → S0003L01 |
| Fri 11 Sep | 10:52–11:11 | 26 | S0001L01 → S0004L01 |
| Fri 11 Sep | 11:41–12:01 | 27 | S0003L01 → S0004L01 |
| Mon 14 Sep | 08:28–08:43 | 30 | S0001L01 → S0003L01 |
| Mon 14 Sep | 13:25–13:43 | 28 | S0001L01 → S0004L01 |

Read that table as a timetable. Nine sittings, every one of them fifteen minutes long,
every one starting again at the first chunk of the course, in the middle of a school day.
That is not somebody learning Welsh in their own time — that is the same first lesson given
to a different class, period after period, on the teacher's own login. Three of the nine
sittings are directly proved by the shared-session signal against 9b/KW LJ, 7G LJ and
11b1 LJ; the other six are the same pattern on days when no class account was opened at
all, and they are the same teacher on the same course in the same fifteen-minute shape.

### 2. hughesr310 — Ysgol Gyfun Tredegar

- **user_id** `1e94f8ac-b9c3-4094-8c22-605cb433a5f0`, own learner `9fd8dcef-278d-4df5-ab0d-f42139e04e9c`
- **Course** cym_s_for_eng
- **Classes** Blwyddyn 8 Set 2, Blwyddyn 10 6 — and in the qualifying session the browser also opened Blwyddyn 8 4, Blwyddyn 10 Set 3, Blwyddyn 9 1 and Athrawon Teachers
- **1 qualifying sitting**, Monday 14 September 09:16–09:33, **about 18 minutes**, 41 phrases heard, S0001L01 → S0004L01
- **Session id** `1abdbe1e-611e-4d75-b717-d7ebc1b8ddbe`

The proof is the shape of the day in that one browser session. Blwyddyn 8 4 is taught on
the class account from 07:57. Then at 09:16 the next lesson runs for seventeen minutes on
hughesr310's own login. Then at 09:53 Blwyddyn 10 6 goes back onto its class account, and
Blwyddyn 10 Set 3 and Blwyddyn 9 1 after it. One teacher, one device, one morning, four
lessons, and the second one landed on the wrong account.

## Second tier

There isn't one. The weaker criterion — own-account teaching-shaped play in lesson hours
in a session that never touched a class account — returns two days, 10 and 11 September,
and both of them are leejames, who is already in the primary list. No other teacher on the
platform shows the pattern at any strength.

## Gaps, stated plainly

- Which class each of leejames's six unattributed sittings belongs to cannot be recovered
  from the events. He opened no class account on those days, so there is nothing to join
  to. Naming a class in a note to him would be a guess.
- "Minutes" is active time — the sum of gaps between his own events, each gap capped at
  sixty seconds so an app left open overnight cannot inflate it. It is a fair floor, not
  an exact figure.
- `class_sessions.teacher_user_id` is known-dirty and was not used for identity anywhere
  in this work; every teacher-to-class link here comes from the `class_teachers` view.
