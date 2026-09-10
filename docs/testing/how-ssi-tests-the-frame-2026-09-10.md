# How SSi tests — the frame

*2026-09-10. Written against the code on `origin/dev` @ `40b217ad8`, the live DB, and job #997·F's retest of Dulmini's six findings. Nothing here has been built. The near answer is decided; one thing needs your word.*

---

## The one word

**Do we seed premium test logins for Dulmini?** Yes. Three named accounts, decided below, and the smallest one lands this week.

**The word I need from you is on the frame, not the accounts.** The frame says: **the standing check is a person, not a suite.** One human pass per promotion to staging, asked for in a fixed shape, on named accounts, plus four already-written probes promoted from throwaway to standing. No new test suite. No new tests.

**Question: do we adopt "one human pass per promotion" as the rule, so that nothing goes staging → main without a Colombo pass on the fixed sheet?**  My recommendation is **yes**, because every one of the six findings that a machine could not have caught was a thing a person sees in ten minutes, and the promotion train already has a weekly cadence to hang it on.

Answer **yes** or **no**. Everything else below is already decided.

---

## Part 1 — Dulmini this week (decided)

### What is actually blocking her
Two things, and neither is the app code she is testing.
- Her sign-in code never arrives. #997·F traced the path: minting is fine, it is **delivery**, and Sri Lankan filtering is a live hypothesis nobody can prove from here. The Resend webhook now stamps delivery times, so from the next build on that becomes one query rather than a forensic session.
- She was a **guest** for the whole pass, because of the first blocker. That single fact changed what finding 2a even was: a guest's record is localStorage, and `Maybe later` overwrites it. A signed-in learner's Yellow Belt survives in the DB twice over.

So a test login is not a nicety. Without one, her findings about progress are findings about the guest path, and the premium half of the app is unreachable.

### The three accounts
All on Tom's Gmail with plus-addressing, so nobody can mistake them for a learner, any mail they trigger lands with Tom, and the `thomas.cassidy+` pattern is already in the canonical analytics exclusion.

| Account | Role | Premium | Seeded position | What it is for |
|---|---|---|---|---|
| `thomas.cassidy+colombo-fresh@gmail.com` | plain learner | no | none | The brand-new-user pass. Reset to blank before every pass. |
| `thomas.cassidy+colombo-wall@gmail.com` | plain learner | no | end of Yellow Belt, parked at the wall | The subscription wall, `Maybe later`, belt-complete moments. This is the one that reproduces her finding 2. |
| `thomas.cassidy+colombo-premium@gmail.com` | `platform_role = tester` | yes, by role | end of Yellow Belt | Everything past the wall. Also switches on the in-app feedback widget, see Part 2. |

Three, not five. A fixture set nobody can name is a fixture set nobody maintains, and these three cover every state she reached or was stopped at.

### How she signs in with no working email
**Password.** The app already has password sign-in (`SignInModal.vue`, `signInWithPassword`) and a server path that sets one. The seed script creates each account with `email_confirm: true` and a password, and the password goes to Imdad over WhatsApp with the sheet. No code email is ever needed. This also sidesteps the admin sign-in link's known redirect problem on non-production origins.

One trap the code showed me: `api/auth/claim-account.ts` rotates the password and kills every session on any account that still looks unclaimed. The seed must therefore create these as fully confirmed accounts with no pending shell claim, or the first sign-in destroys the password we just handed out. That is a seed-script detail, not a design fork.

### Where premium comes from
`platform_role = tester`. It is the cheapest layer and it is already wired end to end: the server gate (`checkCourseAccess`) gives full content, the offline lease treats it as privileged, and the client's `offlineRenews` agrees. Not an entitlement row, not a fake subscription. **Consequence to know:** a tester-role account is not a paying subscriber. The Paddle purchase flow itself cannot be tested with a role. That needs a sandbox card on staging, which is the only environment Paddle notifies, and is a separate ask, named in the gaps.

### Reset between passes
- **She resets herself:** Settings → reset progress is already a server endpoint (`api/account/reset-progress`) scoped to her own account and course. That is the between-pass reset for `fresh` and `premium`.
- **Re-seeding a position** (putting `wall` back at the end of Yellow after she has moved it) is a service-key script, one command, one flag: `node tools/test-accounts/seed.mjs --account wall --state yellow-complete`. It deletes and re-inserts the enrolment row rather than updating it, because the `ratchet_highest_completed_round` trigger refuses to lower a ceiling. A proposed fixture definition is committed alongside this document at `packages/player-vue/e2e/fixtures/test-accounts.mjs`. Nothing runs it yet.

### Analytics: the half that is NOT already solved
The brief suspected the tester exclusion might be one endpoint doing it and others not. It is exactly that.
- `api/me/standing.ts` excludes `platform_role in (tester, ssi_admin)` inline.
- The **canonical** exclusion, `test_learner_ids()` in the DB, feeding board metrics and the `daily_contributions` write-time trigger, tests `is_demo`, `is_internal`, the `thomas.cassidy+` address pattern and `is_test` schools. **It does not know the tester role exists.**
- Nothing in the code ever sets `is_internal = true`. It was set by a one-off backfill migration and by hand.
- Live today, read-only: all 5 tester rows and all 13 ssi_admin rows carry `is_internal = true`, and zero tester rows leak. **But the mechanism is not what keeps it that way.** The next person who redeems a tester code gets the role and stays `is_internal = false`, and counts as a real learner in every board number and every daily contribution.

**Decision taken:** the seed script sets `is_internal = true` explicitly on all three accounts, and `api/code/redeem.ts` should set `is_internal = true` whenever it assigns `platform_role = tester`. One line, code-only, revertable, no DB migration, no canary. That closes the gap at the mechanism rather than relying on a backfill someone remembers.

### Security blast radius
- The tester role is privileged content access only. It cannot mint codes, cannot reach `/admin`, cannot see other learners.
- Passwords over WhatsApp are the same trust level as the invite links and staff access codes the estate already hands out on WhatsApp and paper, by explicit ruling. If a password leaks, the exposure is three internal accounts with fake progress on staging and production content that is already free to the first 19 seeds.
- Rotate the three passwords when a tester rotates. One command.
- **Real-account guard:** the denylist in `real-account-guard.mjs` stays exactly as it is. The fixture file exports the three addresses by name so a probe signs in by reference (`FIXTURES.wall.email`), and the guard's "no default, ever" rule is untouched. Seeded accounts are the clean way to honour "never touch learner progress": a probe or a tester writing progress on a row that exists to be written on is not machine entry on a human.

---

## Part 2 — The frame

### What testing on this estate actually is today
Read from the code, not the docs:
- **163 files** in `packages/player-vue/e2e/`. 71 of them mint a real session; 10 use the real-account guard; 144 take a `BASE_URL`; 27 hard-code staging and 17 hard-code production; **4** carry a three-way verdict. Almost every one was written by one worker to prove one thing once. Nobody runs them again.
- **4** Playwright specs, run by nobody on a schedule.
- **One** honest standing harness, the six journeys, with a network axis and a README that refuses to fake sound.
- **The deploy sentinel** on production: version reached, telemetry volume, endpoint probes, and a real headless play-through with a `healthy / broken / inconclusive` verdict, where only `broken` alerts. This is the estate's best existing example of the verdict asymmetry Tom ruled on.
- **Nightly CI** at 02:00 on watson-1, reporting not blocking, and this week's commit `40b217ad8` is the evidence of what that means: three reds in a row, three different causes, none a regression. A merge lands between two nightlies and is told about it in the morning.
- **An in-app tester feedback widget** already exists, gated on exactly the role we are about to give Dulmini. It stamps route, device, build version and a screenshot, and writes to `tester_feedback`. **Nothing reads that table.** No API, no admin view, no digest line.

So the honest description is: SSi has plenty of machinery for proving one thing once, one good harness for measuring wait times, a production watchdog, and no standing practice at all for the thing Dulmini did, which is *look at the app as a stranger would*.

### The organising idea: test where a defect reaches a human
Not a pyramid. Three rings, each with a different owner, and the rule is that a check lives in the cheapest ring that can actually see the defect.

**Ring 1 — the machine can see it.** Anything a headless browser against the deployed URL can assert without taste. Owner: watson-1. Already covered: deploy live, endpoints, playback starts on production. Not covered and cheap: the same play-through against **staging** after a promotion, with a signed-in fixture account. Of Dulmini's six, this ring could have caught two: the duplicate Update button (a DOM assertion) and Install App inside the WebView (the staleness-line probe's trick, page served under the shell's user agent, then assert the button is absent). Both are ten-line additions to probes that already exist.

**Ring 2 — the machine can only see the trail.** Email delivery. The Resend webhook now records accepted, delivered, delayed, bounced with Resend's own timestamps. A once-a-day query, "sign-in codes not delivered within ten minutes in the last 24 hours, by recipient domain", turns her finding 1 from a mystery into a line in the morning digest. This is a query, not a test.

**Ring 3 — a person has to look.** Finding 2b, the belt celebration that never fires because `beltJustEarned` is assigned nowhere, is dead code a human notices in one sitting and a machine would need to be told to expect. Finding 3, pause semantics, is taste, and it is Tom's. Finding 2a needed someone to actually tap `Maybe later` and be surprised. **This ring is not the fallback for what we have not automated yet. It is the primary ring for this product,** because the product is a feeling in the ear and a surprise on the screen, and the machine rings exist to keep the person's time for exactly those.

### The differential is the finding
Tom designed the shape for Dulmini and it generalises to everything. **Ask the tester for the difference, not the symptom.** Same account, same steps, on the web app and then inside the Android shell. Where they match, it is ours and it is in the web app. Where they diverge, it is the wrapper, and the wrapper only has five places it can differ: links returning into the app, purchase, audio autoplay, keyboard, and whether storage survives backgrounding. That halves the diagnosis before anyone opens a repo, and it works for any pair: two belts, two accounts, two networks, the account before and after a promotion. The sheet in Part 3 is built on it.

### What WhatsApp screenshots are bad at
Not unprofessional. Cheap, zero adoption cost, and they just produced six real findings. What they lose:
1. **Which build.** Nobody knew until a worker found the APK name.
2. **Which account and which state.** She was a guest, and that changed a finding's category.
3. **The differential.** Web or wrapper was unknowable.
4. **What she expected.** Finding 3 turned out to be a question, and finding 4 was not a bug.
5. **A place to land.** They arrive as one lump that a worker has to split into six.

The feedback widget already fixes 1, 2 and 5 automatically, for anyone with the tester role, and it costs nothing to switch on because it is already on. The sheet fixes 3 and 4 by asking.

### Where the 163 probes go
Not a pathology and not an asset. **Sediment.** Most of it stays where it is: a probe that proved one thing once is a record of that proof and costs nothing on disk. The rule for what changes:
- **Promote four to standing** by giving them a fixture account and a verdict. The staging play-through (a copy of the sentinel's, pointed at staging), journey j1, the shell-furniture check derived from the staleness-line probe, and the OTP proof. They run once after each promotion to staging, from the same ci-run that already exists, and report the way the sentinel does: `healthy / broken / inconclusive`, where only `broken` is red and `inconclusive` is never "done".
- **One rule for every new probe:** a `BASE_URL`, a fixture account by reference, a three-way verdict, and nothing else. Anything that hard-codes an origin or a human's address is not a probe, it is a note.
- **Nothing is deleted, nothing is added.** Tom said three days ago that the suites are already overkill, and he is right. This frame removes zero and adds zero tests. It re-aims four.

### Who holds the phone
Agents on watson-1 cannot drive an Android emulator. No `/dev/kvm`, no `vmx` or `svm`. That is a fact of the terrain, and the brief's commission line saying otherwise is wrong. So the phone axis has exactly three holders:
- **watson-1** holds the WebView *shape*: page origin `https://localhost`, shell user agent, served assets. Good enough for "does web furniture leak into the shell" and nothing more.
- **Tom's own machine** holds the emulator, and always has.
- **Colombo and Cardiff** hold real handsets, real networks, real filtering, real ears. This is the only place autoplay, keyboard, backgrounding and delivery to a Sri Lankan inbox can be tested at all.

Design consequence: anything that needs a real device is a Ring 3 ask, written for a phone, and it is never "we'll reproduce it here".

### Distribution: still a named gap, verified today
`git log` on dev shows the shell became a WebView onto the deployment on 2026-09-08 and job #7 is flipping its default origin back to staging, but **there is still no route anywhere on the estate that serves an APK**: not on popty, not on the command surface, and the publish-doc file path accepts images and PDFs only. A frame that says "cut a fresh build and hand it to the tester" does not run until one exists. The WebView change makes this hurt less than it did: the APK is now a window, so Dulmini's *current* install shows the *current* staging the moment #7 lands, and she needs a new APK only when the shell itself changes. That is the right shape, and it turns distribution from a per-promotion blocker into a per-shell-change one.

### The verdict asymmetry, built in
Every status this practice produces fails toward "still open".
- A probe that cannot drive the UI says `inconclusive`, never `healthy`.
- A tester sheet row with no answer is `not checked`, never `pass`.
- A finding is closed by a person saying "done" after looking at the deployed thing, never by a worker's report of a commit. #997·F's report did this correctly: it said "nothing has been fixed" about six findings whose fixes it could see in the code, because the code is not the deployment.

---

## Part 3 — What to ask a tester for

Plain English, WhatsApp-sized, one sheet, sent with the three passwords. Watson writes the actual message; this is its shape.

**Before you start.** Tell us which of the three logins you are using, and whether you are on the web link or the Android app. Tap the little feedback button in the app for anything odd; it knows the build and the screen, so you do not have to.

**The pass** (same steps, web first, then the app):
1. Sign in as `fresh`. Play until the first belt changes. What did you see when it changed? Screenshot.
2. Sign in as `wall`. Play one round. You should hit a subscription screen. Tap `Maybe later`. Where are you now, and what does the belt say?
3. Sign in as `premium`. Play past the wall. Pause mid-phrase and press play. Then pause during Aran talking and press play. Say what you expected each time, then what happened.
4. Open Settings. Screenshot the whole page. Tell us anything on it that makes no sense on the device you are holding.
5. Put the app in the background for five minutes, come back. Where are you?
6. Turn off wifi mid-round. What happens, and does it recover when wifi returns?

**Then the one question that matters most:** for each step, did the web and the app do the same thing? Only tell us the differences.

Six steps, two runs, under an hour. The steps are exactly her six findings, turned into standing asks. Anything a future promotion breaks in these will be found by the next pass.

---

## What would have caught Dulmini's six

| # | Finding | Ring | Would this frame have caught it |
|---|---|---|---|
| 1 | Code email never arrives | 2 | Delivery-lag query in the digest, from the next build. Sri Lankan filtering still needs a real inbox: Ring 3. |
| 2a | `Maybe later` drops a guest to the start | 3 | Step 2 on `wall`, signed in, which is the case that matters. |
| 2b | Belt completion never celebrated | 3 | Step 1: "what did you see when it changed". |
| 3 | Pause and resume semantics | Tom | Step 3 asks for expectation, which surfaces it as a question, not a bug. |
| 4 | Library and Settings placement | none | Not a defect. Step 4 lets it be raised without being a finding. |
| 5 | Duplicate Update button | 1 | DOM assertion in the promoted staging walk. |
| 6 | Install App inside the native app | 1 | Shell-furniture probe under the shell user agent. |

Two by machine, one by a query, three by a person on a fixed sheet. That ratio is the argument for the frame.

---

## Gaps, stated plainly
- I cannot read live Vercel env, so I cannot say whether Dulmini's mail went via Resend or fell back to Supabase's template. #997·F had the same gap.
- I have not seen her video. Its audio-quality half is in no written finding.
- Paddle purchase testing needs a sandbox card on staging. Not designed here; one line in Watson's ask to Tom when it is wanted.
- The admin sign-in link's behaviour on the staging origin is unverified. The password route makes it unnecessary for these accounts.
- Whether `verified_emails` gets populated for a seeded plus-address account is unverified, which is why `is_internal` is set explicitly rather than relied on from the address pattern.

## Decisions taken in this document, for the record
1. Three fixture accounts, named above, plain-learner for `fresh` and `wall`, tester role for `premium`, all `is_internal = true`.
2. Sign-in by password, handed over on WhatsApp, rotated when testers rotate.
3. Premium by role, not by entitlement row or fake subscription.
4. `redeem.ts` sets `is_internal = true` alongside the tester role. Code-only.
5. Four existing probes promoted to a post-promotion staging walk, three-way verdicts. Zero new tests.
6. The tester sheet is six steps, web then app, differences only.
7. Distribution is a per-shell-change concern now, not per-promotion, and still has no route.

**The one word is on adopting "one human pass per promotion" as the rule. Recommendation: yes.**
