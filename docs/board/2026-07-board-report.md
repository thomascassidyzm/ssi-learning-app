# SSi board report — mid-June to 14 July 2026

The month's story is simple: the schools platform went from "works in a demo" to "survives contact with real users", the commercial model got settled, and we now have a live, sendable demo programme for the India partnership. Roughly 725 commits landed across the two codebases in 30 days — the learning app took about 500 of them, most in service of the schools tier. We also taught Chinese through Irish in Ireland, live, which is the community-language model doing exactly what it's for.

## Progress

### Schools platform — the big story

The whole schools "region tier" is now built and hardened. The shape: a group leader (a council, a trust, a partner like IME) gets one link. Clicking it makes them the owner of their group. From there they mint one-link invites for schools; a school admin clicks, verifies their email once, and lands on a working dashboard — no forms, no second sign-in, no setup wizard standing in the way. Schools a leader creates show honestly as "awaiting admin" until someone claims them. Teachers press play and teach the whole class from one screen.

Then we did the unglamorous part. A live soak on 13 July surfaced real breakage, so we ran a systematic audit across five bug classes over every schools and admin surface, then fixed it in three waves — around 30 fixes in 48 hours. The one that mattered most was security-grade: an SSi admin viewing one school's dashboard could carry that school's context into their own view and write against the wrong tenant's data. Found, fixed, and the whole class of related navigation and scope leaks closed with it. We also eliminated every "false Saved" — nine places where a failed write told the user it had succeeded now surface the failure honestly. And we built an automated end-to-end robot test that walks the full leader → group → school journey against the staging site, including confirming that a forged request cannot mint invites into someone else's region.

Separately, all course-content APIs now enforce entitlements server-side (promoted to production 7 July) — paywall decisions no longer live only in the browser.

### Commercial model — settled

After a month of working the options, the model is decided and documented:

- **The unit is the teacher, not the school.** Price-per-teacher, pay-as-you-go subscription through Paddle (who handle VAT/GST worldwide, so we build no tax logic). Monthly or annual, cancel anytime, no contracts, no true-up.
- **Students are always paid** at the existing £5/month school rate — students carry the streaming cost, which is exactly why teacher pricing can stay a simple flat fee.
- **Groups aggregate payers, they are never a pricing tier.** A council can pay for its schools' teachers on one subscription, or a school pays for itself. Who pays is a fact in Paddle's ledger, not in our schema.
- **One paying teacher seat unlocks every language** for that teacher's class — French Monday, Chinese Wednesday, same class. Our marginal cost is bandwidth; ten languages cost the same to serve as one, so we stopped pretending otherwise. This also deleted a pile of per-course entitlement machinery we now don't need.
- **Trial: 30 days, single language**, clock starts when the school picks its course; minority-language schools keep the 365-day free year. Expiry means read-only, never lockout.
- **Regional price bands** so India and Wales aren't priced with the same number.

### Partnerships

**India (IME).** Their due-diligence questionnaire — seven sections covering architecture, devices, offline, data handling, third parties and the course pipeline — was answered in full with evidence, 9 July. On top of that we built a complete seeded demo: an "IME Demo Programme" group with three Indian schools (two live with teachers, classes, 80 students and 164 hours of practice history on the English-for-Hindi-speakers course; one deliberately sitting in the "awaiting admin" state so they can see what an invited-but-unclaimed school looks like). The pitch is five clicks, and it ends by handing over a real one-shot invite link that makes their regional officer the actual owner of everything they just saw. Ready to send.

**Ireland.** We travelled to Ireland and taught Chinese through Irish — a live demonstration that the platform works with a minority language as the *medium* of instruction, not just the target. The app got an Irish-language interface this month, and the system carries Gaelscoileanna demo data for the schools dashboards. [TOM: add colour — who, where, numbers in the room, reception, and any follow-up commitments.]

**Wales.** The Gwynedd pilot is the named first real cohort for the schools tier — the hardening above was done with them in mind, and the 365-day Welsh school offer stands.

### Listening pods — immersive dialogue, shipped and dogfooded

This was a massive amount of work this month and it shaped the player experience more than any single feature: real multi-speaker dialogue scenes, generated per course, delivered two ways — woven into the main learning flow as a staged fusion ladder (individual sound atoms fusing into whole natural clauses), and as a standalone "Dialogues" listening mode for free replay. Both now run on one shared composition engine after the two implementations had drifted apart — fixing that unification also caught a real bug where 65% of split dialogue turns were silently skipping the fusion step. Pods are downloadable for full offline use, and this month's broader offline push (full-course downloads, safe caching so a plane-mode learner doesn't hit a stuck spinner, a fix for a real on-device stutter Tom had flagged) covers them too.

The quality arc is the sharper story. Pod audio is generated as long "whole-turn" takes and sliced into individual sentence clips by detecting the pauses between them — and the first generation of that audio used bare commas as the only cue, leaving seams too tight to trust. Tom's fix: explicit pause markers plus a three-tier gate-and-retry render pipeline. Italian proved it: all 163 dialogue groups re-rendered and sliced clean, zero phonology failures (no English-accented reads slipping through). That recipe is now proven and cheap to repeat — re-rendering the ~18 remaining courses still on the older, tighter-seamed audio is costed at roughly $2 of TTS spend, queued behind a go decision (see Problems).

The heart of the month, though, was dogfooding. Co-founder Aran used the Croatian course's listening pods an hour a day for 75 days, and his feedback directly shaped the pod design. [ARAN/TOM: add a sentence on what changed as a result — e.g. the specific feedback that most altered the design.] In Tom's words: we got to a really good place.

### Analytics that are real

Teachers, school admins and group leaders now see real comparative progress data, not seeded demo numbers: rate-of-progress for a class against the school average, a school against its group, a group against its region or the global cohort — normalised per course, with a privacy floor (no comparison shown unless at least five entities are in the pool) and an honest "not enough data yet" state instead of a fabricated one. The standing rule is now written down: customer-visible analytics are real or absent, never fake.

### Platform and content production

Learner-side robustness got a solid month: full offline mode (download ahead, listening material included, fast bulk downloads), a "never-wedge" app update lifecycle so a broken update can't strand a learner, and a simpler, truthful position model so "where am I in the course" is one answer everywhere.

On the production side (the Popty dashboard, ~215 commits): we ran an estate-wide audio census across all 74 live and beta courses, so gaps are now a known, costed list rather than a suspicion (more on the finding under Problems, below). New audio tooling ships with a phonology gate — every AI-rendered clip is transcription-checked so English-accented renders get caught and re-rolled automatically before a learner ever hears them (the Italian pass completed 163/163 groups, zero phonology failures). A "clone once, copy everywhere" pass stops us paying to re-render identical known-language audio across courses. And an edit-cascade now lets us fix a translation and safely rebuild just what depends on it — content maintenance at scale instead of course-by-course surgery.

## Problems

- **The soak surfaced real breakage.** 13 July's live soak found genuine faults across five bug classes on every schools and admin surface — including a security-grade tenant-isolation leak (an SSi admin's view could carry into and write against the wrong school's data). All ~30 issues are fixed and the classes closed off, but the haul is itself evidence the platform was more fragile pre-soak than the demo-stage testing had shown. The standing lesson: staging soaks earn their keep, and the next tier shouldn't go to production without one.
- **Five live courses are quietly thin on audio.** Korean, Japanese, Portuguese, Chinese and Spanish are silently missing 36–59% of their practice-phrase audio deep in the course (early lessons are ~99% complete, so new learners are unaffected, but advanced learners hit thin rounds). The fix is cheap — roughly **$60 of text-to-speech spend** for the entire estate's known audio defects — so the blocker is pipeline hours and a go decision, not money.
- **~18 courses are still on the older, comma-era listening-pod audio.** Not broken for learners today, but below the quality bar the Italian pass proved out (163/163 groups, zero phonology failures). Same shape as the audio finding above: the fix is proven and costed at **~$2 of TTS spend** — the blocker is a go decision, not money.
- **Pricing bands are still unset.** The commercial model is settled in shape, but without actual per-band numbers the Paddle per-seat subscription build can't start — this is currently the gate on schools-tier revenue.
- **The region tier hasn't been promoted to production yet.** It's live and hardened on dev/staging, but needs the normal staging soak before it's in front of Gwynedd and IME.

## Plans

1. **Prices, then Paddle.** Set the per-band teacher price; build the per-seat subscription flow. This is the gate on revenue from the schools tier.
2. **Promote the region tier to production.** It's on dev/staging now; it rides the normal staging soak to production ahead of Gwynedd and IME onboarding.
3. **Send the IME link** and support their regional officer's first real group.
4. **Greenlight the audio passes.** ~$60 clears the known deep-course phrase gaps across five live courses; ~$2 re-renders the remaining 18 courses on old comma-era listening-pod audio to the Italian-proven standard. Both awaiting the go decision.
5. Known product gaps queued behind real use: class-wide skip/revisit for teachers, and the college question (16+ students with their own accounts and £5 subscriptions — possibly a revenue-share angle worth thinking through).

## The numbers that matter

- **£42k/month subscribers + £30k/month government contract — the ~£30k subscriber target is already exceeded.** On top of that, the settled model prices the schools path as a further growth mechanism: every teaching seat is £15/month (band-adjusted), every school student £5/month — so a single 10-teacher, 300-student school is worth ~£1,650/month, and the group mechanism is how we sign ten of them with one link.
- **74 live/beta courses**, now with a full audio census and the tooling to maintain them at fleet scale rather than one at a time.
