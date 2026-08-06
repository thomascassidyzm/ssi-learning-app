# Dead audio across the released estate — who is actually exposed

**6 August 2026.** Two questions: does the never-abort player fix really cover the A-22 failure, and how much of the estate is carrying dead audio in front of real learners.

Short version: **the player fix works, production has not got it yet, and mass audio regeneration is not worth buying.**

---

## 1. The headline

**Nobody is currently sitting in front of a hole.** 194 real learners have been active in the last 30 days, 68 in the last 7. 161 of those 194 are still inside the first 20 seeds of their course, and 89 of them are on the very first LEGO. The gaps in the content sit much deeper — the earliest one in any course carrying real learners is French at seed 15, and the next is Welsh at seed 40. Almost every learner would need months of progress to walk into one.

**And a hole no longer stops anything.** A LEGO with missing audio is already filtered out before it reaches the player, so it is quietly not taught rather than fatal. The A-22 case was different and worse: an audio id that was *present* but pointed at a file that no longer existed. That is the one that killed the session, and that is what the never-abort fix answers.

---

## 2. The player fix — verified, and one gap closed

I wrote six regression tests that reproduce the A-22 shape exactly: the audio request 404s, the media element reports the error code it reports in the field, on the prompt clip, on a target clip, on a whole cycle, and on a whole round.

**Five of the six passed on arrival.** The fix that went in this morning genuinely does convert the A-22 trigger into a logged skip. It was diagnosed from a different cause — Aran's German "with you", which was a client-side hang, not a missing file — so this needed proving rather than assuming. It is proven. The tests stay as a fence.

The sixth was the one worth writing. Browsers reject an undecodable file with a different error from the one they use for "the user hasn't tapped yet". The player keeps exactly one deliberate stop, for the tap case, because there the browser will play nothing at all until the learner touches the screen. If a missing file could ever be mistaken for a tap problem, A-22 would still stop sessions by another door. It cannot. That is now pinned by a test.

**The gap I found is the price of never stopping.** Skipping is instant. So a course with a dead block of audio does not stall — it races to a "session complete" screen in under a second with nothing audible. A stall was at least obvious to the learner; silence is not. The player must not stop, so I made the silence loud instead: the player now counts clips skipped back to back, resets the count the moment real audio plays, and at three in a row — one whole item, prompt and both voices — it says in the log that this is a course that should never have passed the release gate. Nothing about when the player stops has changed, because it does not stop.

That is your rule doing its job in both directions: the loud fail lives at the gate, the runtime keeps driving.

---

## 3. The estate — what the census actually found

I swept every audio reference in the content: 1,995,859 ids across LEGOs, practice phrases and seeds. **Every one of them resolves to a real audio row.** There are no dangling pointers left in the content the player reads.

Two honest caveats on that, because the number flatters:

- **Another A-22 job got there first.** A parallel remediation nulled dead pointers earlier today and is relinking them as I write. So this reads the estate *after* that clean-up, not independently of it. What I can say is that there is nothing left for a regeneration run to chase.
- **A nulled pointer is not a repaired one.** 16,200 LEGOs estate-wide are missing at least one of their three clips, so they are skipped rather than taught. The great bulk of those are in draft courses nobody is learning. Across the sixteen courses that actually carry active learners, the figure is about 51.

**The count of courses is not 132.** The courses table holds **143 rows — 16 released, 63 beta, 64 draft**. The 88 in this morning's chopped-clip census was an undercount: the public database key cannot see 55 of the draft courses, so anything counted with it is short. I could not find an inventory of exactly 132 anywhere, and I would rather say that plainly than pick a number that fits. Worth knowing that "released" as the database means it covers only 16 courses, while real learners are active on 53 — including many marked beta. If beta courses have live learners, the release gate needs to apply to them too.

---

## 4. Where the exposure actually is

Courses with real active learners, and the first gap in each:

| Course | Active 30d | First gap at seed | Learners upstream of it |
|---|---|---|---|
| zho_for_eng | 34 | 476 | 33 |
| cym_n_for_eng | 12 | 43 | 9 |
| cym_s_for_eng | 12 | 40 | 11 |
| ell_for_eng | 9 | none | — |
| ita_for_eng | 9 | none | — |
| afr_for_eng | 7 | none | — |
| hrv_for_eng | 7 | none | — |
| deu_for_eng | 7 | none | — |
| **fra_for_eng** | **7** | **15** | **4** |
| jpn_for_eng | 6 | 130 | 6 |
| isl_for_eng | 5 | none | — |
| rus_for_eng | 3 | 47 | 3 |
| spa_for_eng | 3 | 505 | 3 |

Seven of the sixteen busiest courses have no gap at all. **French is the only one with a gap a learner could plausibly reach soon**, at seed 15, with four learners currently below it. That is the single repair worth doing by hand, and it is a handful of clips.

Every one of these courses plays cleanly from seed 1, which is where most learners are.

---

## 5. What I would spend, and what I would not

**No mass regeneration.** The three-way test says so clearly. It would not be better — the content the player reads is already complete, and the deep gaps sit beyond where anyone has reached. It would not be simpler — it adds a large run to chase a problem the player already survives. And it would not be cheaper by any reading. The never-abort fix plus the relink job already in flight makes the estate safe enough that buying a regeneration run is spending money to fix something that is no longer breaking.

The cheap version that is worth doing: **French seed 15**, plus the ~51 incomplete LEGOs in the courses that carry live learners. That is hand-sized, not a run.

There is one thing worth knowing that is structural rather than per-course. The player's script cache has **no expiry** and deliberately plays from the cached copy first while it checks for a newer one. Meanwhile 96 of the 143 courses gained new audio in the last 30 days and 48 in the last 7. So a learner's device can hold audio ids from before a regeneration for an unbounded time. That is the shape A-22 came in, and it is the reason regeneration is a *cause* of this failure class rather than a cure for it. Root-causing the specific deletion belongs to the investigation already running, not to me.

---

## 6. Defaults I chose — overrule any of these in a word

- Counted a learner as live on any session, event or contribution activity in 30 days, and gave the 7-day figure alongside.
- Censused every course rather than only the 16 the database calls released, because real learners are active on beta courses too, and marked status throughout.
- Excluded demo, internal and class accounts — 921 of 1,078 — leaving 157 real learners, of whom 194 course-enrolments were active. The rule used flags on the account plus a staff and test email pattern.
- Where a gap in the player would have needed more than a bounded change, I wrote it up rather than shipping something speculative into a path the whole estate depends on.

**One genuine gap:** per-learner position rests on the enrolment record alone. The progress table that would corroborate it holds rows for demo accounts only — no real learner has a single row in it. Positions above are best-available, not cross-checked.

---

## 7. The two things that need you

**Promote the never-abort player fix from staging to production?** I checked the deployed code, not the branch: staging is carrying the fix, production is not. Production today still stops a session dead on a missing clip, which is the A-22 bug, live. The fix only changes what happens to a clip that has already failed — a healthy session cannot tell the difference. Staging has only soaked about ninety minutes, which is the one argument for waiting, and against it is that the bug is hurting real learners now. **My recommendation: promote.**

**Buy a mass audio regeneration run?** **My recommendation: no.** Fix French seed 15 and the few dozen incomplete LEGOs in the live courses by hand, and let the never-abort player carry the rest. Regeneration would cost real money and time to solve a problem the player now survives, and every regeneration run widens the stale-cache window that caused A-22 in the first place.
