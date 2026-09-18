# One push to main: today's train plus the schools door — the case (job #195)

2026-09-18. For Tom, deciding whether to promote `staging` to `main` once. Answer with a word.

## 1. What the train carries

Everything below is on `staging` now. The first block was already there and verified this morning. The second block landed this afternoon.

**Already on staging this morning, verified by the jobs that built it**

- Teachers: My Classes is the teacher's home, one class page for everything, and the class Overview leads with the course journey brain rather than a progress bar. Insights offers All time and opens on it.
- Leaders: the school and group pages lead with all-time totals, with this week as the sentence beneath. Funder numbers on their own page. Dozens of new Handbook walks.
- Privacy: no pupil name reaches any Insights page.
- Learners: the player never advances on its own again. A second email links and recovers an account. A seed review reaches the learner whole instead of one clip in four. The course-updated notice sits where it should.
- Messages: admin-to-learner messages with a one-tap action, replies to bug reports inside the app.
- Billing: an expired personal subscription no longer hides live family cover. A Paddle refund revokes the grant it paid for.
- This morning's three fixes: Insights minutes are no longer understated when a diary read fails, class-account lessons are counted from the diary only, and verifying a second email never deletes an account that holds grants or a subscription.

**Landed this afternoon: the schools door, with your three rulings**

- A head sets a school up with no code to type. They land in the dashboard straight away. The six digits still go out, and a strip at the top takes them whenever they arrive.
- The password form is the first thing they see, so next time they sign in with a password from any device.
- Resend cools for a minute and says the old code stops working. A superseded code is named as superseded, not called invalid.
- Ruling 1: an unproven school can build but not enrol. Until the head confirms a mailbox from the strip, or an admin vouches, no pupil code and no class link works. The pupil reads one line saying the school's email needs confirming. The teacher's class page says the same, instead of offering a link that will not work.
- Ruling 2: proof never ends sessions. Confirming the email signs nobody out, and nothing built before confirming is lost.
- Ruling 3: if the account is signed in on a second device at the moment of proof, the confirming device sees one line: keep it, or sign it out. Keep is the default. Nearly everyone never sees the line.

## 2. What was verified, and how

**The three rulings, each by a test that failed before the change and passed after.** I ran the new tests against the routes as they were before the change and saw them fail, then against the changed routes and saw them pass.

- Ruling 1: a pupil code on a held school is refused by all four routes a code passes through, before a use is claimed, and lets through once proven. Three route tests failed on the old code and passed on the new. The predicate itself has twelve cases, including failing closed when the founder cannot be read.
- Ruling 2: confirming the primary address retires the door's marker and calls no sign-out. Failed before, passed after.
- Ruling 3: exactly one session answers zero and shows nothing. More than one answers the count. A count that cannot be read answers zero. Four tests, all red before and green after. In the browser: the line appears only above zero, Keep makes no call, and Sign it out is the one tap that does.

**The gates.** The pre-merge gate on dev was green: repository invariants, every API test that imports a changed file, every player test that imports a changed file. Player and API typechecks are clean. The Handbook gate is green with the two new capabilities described and the changed sentence re-pinned.

**Live on staging, as a probe head.** Run against the deployed staging build at bundle `index-DfM8t8cg.js`, staging head `f1fe2af9a`, as a probe head on a fresh throwaway domain. Seventeen checks, all passed. The probe's school, class, code, learner and auth user were deleted at the end and the deletion confirmed.

- The door: typed the address, tapped once, landed on the school page with no code screen. The banner was there. The founder was stamped unproven.
- Ruling 1, held: the class link answered unavailable with the confirming-first line. The code lookup answered not valid with the same line and gave no class name away. The teacher's class page showed the hold line and no link.
- Ruling 2: typed the six digits into the banner. The banner said sorted for good. The door's marker was retired. The browser's session was still live afterwards, counted alongside the second one.
- Ruling 3: with a second session minted beforehand, the banner showed the one line naming another device. Keep hid it. The session count afterwards was still two, so Keep ended nothing.
- Ruling 1, open: the same class link answered 200, the same code answered valid with the class name, and the class page offered the link.

Two things the first live run found and this build fixes, both now proven live: the proof's own code check was leaving a phantom session behind, which would have shown the second-device line to a teacher with one device; and after confirming, a reload of a class page kept the hold line until the session refreshed. The count is now exact and the session is refreshed at proof.

**Not verified.** The admin vouch card was proven by its route tests and rendered in unit tests, not exercised live on staging: that needs an admin viewing a held school, and the probe was a head. The second-device line was exercised with a session minted out of band, not a real second phone. Increment 1 itself was walked live by job #188 this morning before the revert and is unchanged here beyond the rulings on top.

## 3. What changes for Sarah McAuley's stuck Hwb teachers

Today they are told: go to saysomethingin.app/schools1, pick your language, type the same school email, tap Send my code once, wait for the newest email, type that code only, do not tap Resend.

If this lands, the same teachers do this instead:

- Type the school email and tap **Set up my school** once. They are in the dashboard immediately. No code to wait for. A teacher whose earlier attempt left an unconfirmed account gets that account, not a refusal.
- Set a password there and then. It is the first thing on screen. From then on they sign in with it from any device, and Hwb's mail never enters it again.
- Build the school: classes, teachers, everything.
- When the six-digit email finally arrives, type it into the strip at the top. That confirms the school and its class links go live for pupils. If Hwb never delivers it, tap **Use a different address** in the strip and confirm from a personal address, or ask Sarah or SSi to vouch for the school from its admin page.
- Until one of those happens, pupils cannot join. A pupil who tries reads that the school's email needs confirming first. That is deliberate: it is what makes a stolen school an empty room.

A teacher who already has a confirmed account is told welcome back and signs in with their password, or with a code if they never set one. Resend waits a minute and says the earlier code stops working.

## 4. The rollback

- App: revert the promote merge on `main` and push. One command, and the site rebuilds in a few minutes. Or use Vercel's instant rollback to the previous production deployment, which takes about a minute and needs no commit.
- Database: the one change is an additive function only the server can call. Nothing in production depends on it, so it needs no undoing for the old code to run.
- Data: no learner, teacher or school row is changed by landing this. The two probe accounts used to prove it on staging were deleted.
- Increment 1 alone: it is one merge on staging. Reverting that merge on main takes the door back to the code-first version and leaves the rest of the train in place.
