# The delivery-side intelligence surface

*Design frame for the surface that replaces SSi internal admin in the learning app. Commissioned by Tom, written 2026-09-10 from a read of the live code and the live database. Popty is the creation side; this is the delivery side. Nothing here is built yet.*

*Every fact below was checked against code on the `dev` branch or a read-only query on the live database on 2026-09-10. Where I could not see something, section 5 says so.*

---

## What this document is for

Tom's verdict on the current internal admin is settled and this document does not reopen it: not fast enough, not logical enough, not clear how to do the things we want, changed a lot, probably five ways to do the same thing. The replacement earns its place by answering questions, not by being tidier. So the frame is built around ten questions that Tom, Kai or Aran would say out loud, a short list of what is deliberately left out, a grammar precise enough that agents can build to it without a designer in the room, one first slice, the gaps, and one fork Tom can answer in a word.

First, the fossil record, because the ten questions come from it.

### The fossil record: what exists today and why

There are eighteen admin views and a redirect graveyard. Read as archaeology rather than mess, each one was the right answer to a real need on the day it was built. The needs are what matter.

**Ways to see how learners are doing.** I count seven, each built at a different moment:

1. **Platform Analytics** with five tabs, Overview, Growth, Engagement, Retention, Friction, on its own bar-chart components and the `analytics_*` database functions. It is no longer in the admin navigation at all. It survives as a URL only.
2. **Stats**, eight Insight Engine boards: Lifecycle, Rate compare, Course Scoreboard, Content Friction, Difficulty turns, Voice and pause, Coverage, Health strip. This is the Insight Engine driven by hand.
3. **Insights**, the nightly Discovery feed, where Claude reads the week's telemetry and writes findings. Its last run in the live database is dated 2026-08-31. It runs from a launchd job on a Mac, not from the estate, and it has been silent for ten days with nothing on the page shouting about it except a banner rule that only fires after two missed runs.
4. **Board**, the living board report. Three registered metrics, real learners active in thirty days, minutes in thirty days, schools total, plus an authored monthly report and a freeze-and-share link. Not in the navigation.
5. **Node insights**, the rate-compare engine scoped to an organisation, school or class. This one is good and is shared with the org dashboard.
6. **Courses**, tiles with enrolment and practice stats per course. Not in the navigation.
7. **Needs attention**, subscribers with no practice in seven days or a period ending soon. Not in the navigation.

Add **Activity**, a live timeline, also not in the navigation, and **Users**, a searchable list with hero stats, and **User detail**, a 2,100-line page carrying profile, role editing, sign-in rescue, entitlements, trial testing, course positions and six diagnostic telemetry sections.

**The navigation shows four of these.** Structure, Users, Stats, Insights are flat tabs. Invites and Methodology sit in a More menu. Analytics, Attention, Activity, Courses, Board and Release notes are reachable only if you already know the URL. That is the mechanism behind "not clear how to do the things we want": the surface has more answers than doors.

**The redirect graveyard** in the router is the clearest record of the consolidation that already happened on the organisation side. Access, Demos, Demo organisations, Demo schools, Entitlements, Try links, Setup and Schools all now redirect to Structure. The old class tools page and the individual learner progress page redirect to node home and user detail. Every one of those redirects marks a place where a founder ruling collapsed a separate design into one recursive page. That consolidation is finished for the organisation tree and has not started for intelligence. This document is that second consolidation.

**What the org dashboard has that the admin pages lack** is not a colour. It is that one page grammar, ruled 2026-07-19, holds at every level: a map rail that says where you are, an identity header, a stats row that always counts everyone below this point, a children list where lenses are filters rather than pages, and verbs across the top. Rows are links. The URL carries the state. Drilling swaps content in place with no repaint. Every number has an Updated stamp. Plain words only. Empty states are teaching buttons. The admin pages each invent their own version of these, which is why they feel disjointed even though they share a stylesheet.

**Three colour vocabularies are live on one screen.** The player's Mist tokens, warm putty canvas, ink `#2C2622`, brand red `#c23a3a`, DM Sans. The 2026-05 schools system by Aran, putty backdrop `#e8e5dd`, white cards, ink `#0F1212`, brand red `#DB1E17`, gold `#FEC902`, Arsenal display with Open Sans body. And the older Frostwell tokens, glass surfaces, tonal RGB triplets, a mono kicker in Spline Sans Mono. The admin container loads the schools stylesheets but tops them with a dark bar with a gold indicator, uses Frostwell stone cards on some pages and schools cards on others, and draws charts two ways, hand-rolled bar charts on Analytics and ECharts on the Insight boards. Tom's read that the org dashboard "matches the app better" is right for a checkable reason: the org node home uses one vocabulary, the schools system, and its canvas is within two hex digits of the player's. The admin pages use all three.

---

## 1. The ten questions

These are the questions the surface exists to answer, in the order a person would ask them on a Monday. Everything in the surface is a page that answers one of these. The ten territories Tom named do not map one to one: content gets two questions because stopping and stumbling need different actions, devices and territories share one because they are asked together, and marketing and learner communication get no question of their own because they are answered by others and there is no signal yet that would earn them one. That defence is spelled out under each.

**1. How many real people practised this week, and is that more or less than last week?**
The pulse. It is first because every other number is meaningless until the population is right. The live database holds 1,441 learner rows, of which 533 are real people once demo, internal, class-entity and staff rows are removed. 153 of them practised in the last thirty days. 87 have ever reached a position in a course. Every page in the surface inherits this filter and shows it. This question is also the whole of marketing today: the only signals we have about where people come from are their country, their first course and whether they arrived through an organisation link, and those belong here.

**2. Who is about to leave, and who has already gone quiet?**
Behaviour patterns that inform what we do. Today this is split across Needs attention, the Lifecycle board, Retention tabs and the Discovery feed. One page: people who were regular and have stopped, subscribers with no practice, trials ending, ranked by how much we would lose. This is also learner communication today: it produces the list of who to write to and why. It does not send anything, see section 2.

**3. Where is each course losing people?**
The first content question. Where along a course do real learners stop for good. The live friction function answers this at bands of twenty seeds from `course_enrollments`. The honest resolution today is coarse, see the note after question 4.

**4. Which bits of a course make people stumble, skip or retry?**
The second content question, and the one Tom means by weak points found through telemetry. A learner who skips a LEGO, retries audio, or pauses hard at one phrase and then carries on is telling us about the content, not about themselves. The raw events exist: `audio_play` carries a lego id, and `lego_skip`, `phase_skip`, `tap_skip`, `audio_retry`, `audio_failed` and `cycle_prosody` are all live in production telemetry. Nothing aggregates them per LEGO today.

*Honest note on 3 and 4.* Today's telemetry cannot identify weak points in course content at the resolution Tom wants. The friction map works in twenty-seed bands, not LEGOs. Per-LEGO signal exists in raw events but has no aggregate. And the population is thin: 87 real people with a course position spread across 53 courses, largest single-course cohort under twenty, so a per-LEGO number for most courses would be one or two people. This is a project, not a page: a per-LEGO aggregate over the existing events, with a k-floor that shows a course as "too few learners to say" rather than a fake heatmap. That is consistent with Tom's standing ruling that analytics are real or absent. The first slice in section 4 builds exactly this, because it is the highest-value thing telemetry can be made to say.

**5. Which courses are worth our attention, and which are people actually finishing?**
Course improvements at course grain. The Course Scoreboard and Courses tiles both try to answer this. One page, one ranking, with reach, stickiness and completion, and a link from any course into questions 3 and 4 scoped to it.

**6. What is this one person's story, and what has gone wrong for them?**
Problems with individual user accounts. Today this is the 2,100-line user detail page, and it is genuinely the most complete thing in the admin. The question keeps everything on it that answers a support call: identity and support id, sign-in rescue, effective access with the precedence spelled out, positions per course, recent events, device and country, and the verbs that fix things. It loses nothing; it gains the same shape as every other page.

**7. Is the app working right now, and did my last fix land?**
The Health strip's question, and Tom's own words in the board blurb. Audio failure rate by build version, by device type, by day, with the current deployed build named. Environment is stamped on every event server-side so production, staging and dev never mix.

**8. Where in the world are people using us, and on what?**
Devices and territories, one question because they are always asked together. Country is stamped on every event from the edge and is populated: in the last thirty days of production, Britain leads by a distance, then Germany, Belgium, the United States, the Netherlands, Australia, Korea, Spain, Sri Lanka, Switzerland and India. Finland and Japan are machines and are excluded by rule. Device type is stamped as phone, tablet or desktop. Whether a session was in the browser or in the native shell is computed by the server but the column that would store it is not applied in the live database, so the code silently drops it on every insert. Until that column lands, "in the app or on the web" cannot be answered. That is a one-migration project and it should ride the first slice.

**9. Who is paying us, through which door, and who has stopped?**
Income receipts. Section 3 below settles what can honestly be shown. Short version: this database sees one of at least four doors, and stores no amounts.

**10. Which organisations and schools are alive, which trials are about to end, and which have gone dark?**
Problems with orgs and schools. The org tree already exists as the Structure page and as the node home. This question is a lens over it, not a new tree: every node with its trial or paid state, expiry, seats, learners active this week, and the Ways-in ledger's health. The verbs stay on the node home, which is where they already live.

---

## 2. What is deliberately not in it

Everything that does not serve one of the ten is out. This list is as load-bearing as the ten, because it is what stops the replacement becoming the sixth way. For each, what serves it instead.

- **Structure, the org tree page, and the node home with its verbs.** Stay exactly as they are. They are the customer-facing organisation dashboard and the reference for this design. Question 10 links into them; it does not duplicate them.
- **Invites, Ways-in ledger, minting links, demo orgs.** Stay on the node as verbs, per the 2026-07-18 ruling that the invites page dies. The audit list stays as a utility door, not a question.
- **Release notes curation.** A content-editing chore, not intelligence. Keep the page, hang it off a Tools door in the top bar, not off the question navigation.
- **Methodology papers and the public methodology index.** Prose. They belong on the public methodology routes, which already exist.
- **Pod stage auditioner.** A creation-side tool. It belongs in Popty.
- **The Handbook.** It documents the org dashboard's capabilities for leaders and stays with that surface. The description-next-to-the-thing mechanism behind it is reused, see section 3.
- **View-as.** A support verb, not a question. It stays in the top bar, one door, read-only, as rebuilt.
- **Freeze-and-share board snapshots.** No external consumer exists today beyond Tom. If a funder or board needs a frozen page, a question page gets a share verb. No separate Board page.
- **Sending anything to learners.** This surface identifies who to write to and why. Resend sends. Marketing tooling, campaign attribution and messaging live outside until there is a signal to show.
- **A and B testing, algorithm config editing, feature flags.** No consumer of these inside intelligence yet. Out until one exists.
- **Repairing a learner's position.** Never. Tom's ruling of 2026-08-31 stands: a cursor at the course end is a legitimate state and cannot be used to infer damage.
- **Anything Popty already does.** Course text quality, ZUT compliance, audio provenance, translation QA. The delivery side reports where learners stumble; the creation side decides what to change.
- **Teacher and school tooling.** Class detail, teacher dashboard, school setup, seats and upgrade. Customer-facing, not internal.
- **A dark mode or a theme switcher.** Mist is the single forced theme.

The **Discovery feed** is not on either list because it changes shape rather than dying: Claude's nightly findings stop being a page and become cards at the top of the question they concern. The engine stays; the destination goes.

---

## 3. The grammar

This is the part where "buildable by agents from the written frame alone" is won or lost. Every rule below is stated so an agent can check it, and where a rule cannot be checked I have not written it. The word Tom used for what he wants is re-expressed throughout as consistent placement, one way to do each thing, the same shape meaning the same thing everywhere, and a stated number of taps to a named answer.

### 3.1 The layout grammar: one page, ten times

Every question is one page and every page has the same five parts in the same order, top to bottom, produced by one layout component that no page may add to or reorder:

1. **Where you are.** A rail on the left at desktop width, the first block at phone width. It says what scope you are looking at: everyone, one course, one organisation node, or one person. It is the existing map rail generalised by one level: its root is "Everyone" and its three branches are Courses, Organisations and People. Under Organisations it is the existing org rail unchanged. Changing scope re-asks the same question for the new scope and swaps content in place.
2. **The answer.** One sentence in plain words and one number, with the freshness stamp and the population chip directly beneath. The sentence is the question answered, for example "412 real people practised this week, 38 more than last week." If the data cannot support a sentence, the sentence says so: "Too few learners in this course to say."
3. **The evidence.** Exactly one widget from the Insight Engine library, chosen per question and fixed. No page shows two charts side by side. The library has thirteen widgets; the surface uses no others and adds none without registering them there.
4. **The rows.** A list of the things behind the number: people, courses, LEGOs, nodes. Rows are links, one rule, no exceptions. Lenses over the rows are filter chips, never separate pages, and the active lens is in the URL.
5. **The verbs.** Actions the answer implies, across the top of the main column, most common first, scoped to what you are looking at. A verb that writes anything confirms first and names what it will change. Pages that have no verbs render the bar empty rather than omitting it.

Checkable rules that follow:

- One route per question, ten routes, and the URL of every old admin page redirects into the question it served with its scope preserved. A test asserts that no admin route other than the ten, the Tools door and the redirects renders.
- From the landing page, every one of the ten answers is one tap. From any answer to a named person, course or node is at most two taps. A test walks the ten and counts.
- Each registered metric renders on exactly one question page. Two pages showing the same number is the fossil we are burying; a test over the registry enforces it.
- The rail, the Updated stamp and the population chip appear on every page, the same component in the same slot. A page without them fails a template test.
- Scope, lens, window and course live in the URL and reproduce the exact view when pasted. This is already the rule on node insights and is extended to all ten.
- Drilling within the surface never repaints the whole page. The rail stays mounted, scroll holds, values blank while the new scope loads and the old scope's numbers are never shown against the new name. This is the 2026-07-30 stability ruling and it applies verbatim.

### 3.2 The visual grammar: five shapes, each with one meaning

The surface uses five shapes. Each means one thing wherever it appears. An agent adding a sixth shape has to add it here first.

| Shape | Looks like | Means | Never used for |
|---|---|---|---|
| **Card** | White, 12px radius, 1px border at 10 percent ink, on the putty canvas | A section of one page | Nesting inside another card |
| **Stone** | A card holding one mono number and one word beneath it | A single count or rate for the current scope | Two numbers, a chart, a sentence |
| **Row** | Full-width, name left, values right, hover reveals the arrow, the whole row is the link | One thing you can open | Anything that is not a destination |
| **Chip** | Small pill, outlined when off, filled when on | A filter or lens state | A status |
| **Pill** | Small filled pill with a dot, in one of four tones | A status: good, watch, alarm, quiet | A filter |

Belts keep their belt colours as dots and strips; they are content, not status.

### 3.3 The colour system and how it relates to the app and the org dashboard

The surface uses the 2026-05 schools system as its one vocabulary and retires the other two from anything internal. This is what makes it match the app: the schools backdrop `#e8e5dd` sits two hex digits from the player's Mist canvas `#e8e3dd`, and both put white cards on warm putty. The relationship to state in words: the intelligence surface is the app's own management colour, not a third family.

- **Canvas** is the schools page backdrop. **Surfaces** are white cards. **Ink** is `#0F1212` for primary, `#555555` secondary, `#6b6b6b` muted. These are the existing `--schools-*` tokens and no new hex values are introduced.
- **Brand red `#DB1E17`** does exactly three jobs: the mono kicker above a heading, the primary verb, and the alarm tone. It is never a background and never decoration. This is the Schindler's List restraint from the player carried across.
- **Four tones only carry meaning.** Good is the schools success green, watch is the schools gold, alarm is brand red, quiet is the muted grey. They map one to one onto the Insight Engine's `neutral`, `good`, `warn`, `alarm` tones so a chart and a pill never disagree. A test greps components for hex literals and fails on any.
- **The dark admin top bar dies.** It is the single largest source of "disjointed": a black bar with a gold indicator above a putty and white page that shares nothing with it. The replacement bar is the schools top bar, white on putty, red active indicator, with the surface's own name and the ten questions in it.
- **Charts** are ECharts through the existing Frostwell theme registration, which already resolves its palette from the live tokens. The hand-rolled bar charts in the admin charts folder are deleted with the Analytics page. One charting path, not two.

### 3.4 Type

Three text roles and one number style, all already defined in the schools stylesheet:

- **Kicker**: mono, 11px, letter-spaced, uppercase, brand red. Names the section or the question group.
- **Display**: Arsenal, for the page's answer sentence and the identity name. One per page.
- **Body**: Open Sans, 14px, 1.45 line height. Everything else.
- **Numbers**: tabular mono figures wherever a number is a value, so columns align and stones match.

British English, no parentheses anywhere, plain words: school, group, course, learner, people. Never node, entitlement, cohort, telemetry or metric in anything a user reads.

### 3.5 Population and freshness are part of the grammar, not a footnote

The two errors that have already burned analysis in this repo are counting machines and counting demo rows. The grammar makes them impossible to make silently:

- Every server endpoint the surface reads from applies one shared population resolver: exclude `is_demo`, `is_internal`, `is_class_entity`, staff platform roles, and events from the two known machine countries and headless user agents. The resolver has one test and every endpoint imports it. No page filters on its own.
- The population chip reads, for example, "533 real people. Demo, staff and test traffic excluded." It is on every page. If a page is deliberately looking at demo or staff data, the chip says so in the alarm tone.
- Every number carries an Updated stamp from the moment its fetch completed, never from render time, on the model the node home already uses. A number with no stamp fails the template test.
- Where the population under a number is smaller than the k-floor, the number is replaced by "too few to say" and the widget is replaced by the empty-state card. Empty with honesty beats seeded, Tom's ruling of 2026-07-14.

### 3.6 The description lives next to the thing

The org dashboard's Handbook compiles from comments placed directly above the element that is the capability, fingerprinted so a changed capability with an unchanged sentence fails a check. The intelligence surface reuses the mechanism, not the page: every one of the ten question pages and every verb carries the same style of comment, and the compiled result is a "What this page counts" panel reachable from the Updated stamp. Agents building a page write the sentence in the same edit as the code. That is the documentation grammar and no other is invented.

### 3.7 Tom's word, re-expressed

Tom asked for everything to be much easier to use, in a single word this document does not print because it cannot be built to or checked. Here is what it has been replaced by: one way to do each thing, tested by the one-route-per-question rule and the one-metric-one-page rule; the same shape meaning the same thing everywhere, tested by the five-shape table and the hex-literal grep; consistent placement, tested by the five-part layout component; and a stated number of taps, one to any answer, two to any named thing, walked by a test.

---

## 4. The first buildable slice

**Build the shell and two questions: the pulse and the weak points.** Specifically:

1. **The shell.** The schools top bar carrying the ten questions grouped as Learners, Content, Business. The question-page layout component with its five fixed slots. The generalised rail with Everyone, Courses, Organisations and People. The shared population resolver on the server. The population chip and Updated stamp. The redirects from every old admin route into a question. The template tests and the tap-count test.
2. **Question 1, the pulse.** Real people who practised this week against last week, by course and by country, with the rows being courses. Data already exists in the `analytics_overview` and `analytics_growth` functions, which are live in the database. The code comments that call several of these functions unapplied are stale; all sixteen are present.
3. **Question 4, the weak points.** A new server aggregate over `player_events` per course per LEGO: plays, skips, retries, failures, and the share of learners who reached the LEGO and stopped within it, k-floored. The evidence widget is the ranked bar. Rows are LEGOs showing both languages' text, since position is a LEGO, never a seed number, and a row opens the LEGO's phrase list read-only. Scoped by course through the rail.
4. **One migration**, the `app_shell` column on `player_events`, so question 8 can separate app from browser from the day it is built.

Why this slice and not another. It settles the shape rather than shipping a page: the shell forces every grammar rule to be real code with a test, and two questions at two scopes prove the rail generalises. It exercises the population filter, the k-floor and the honest empty state, which are the three ways the surface could lie. It reuses the Insight Engine library rather than bypassing it, which honours the standing direction that the engine is the spine. It kills ways rather than adding one: on landing, the Analytics page, the Stats friction and scoreboard boards, the Courses tiles and the Board pulse all redirect into these two questions. And question 4 is the single highest-value thing telemetry can be made to say that it does not say today.

What it proves. If Tom, Kai and Aran can open the surface on a phone, read the week's pulse in one tap, open a course in one more, and see which LEGOs its learners stumble on with a straight answer about whether there are enough learners to trust it, the frame holds and the remaining eight questions are fill-in. If they cannot, the frame is wrong and only two pages have been spent finding out.

What it does not do. It does not build revenue, devices, health, orgs, the person page or the leaver list. Those follow, one question at a time, each a page against a shell that already exists.

### The revenue answer, settled

Tom said income may be harder to aggregate but RevenueCat should enable it. I checked, and it does not, not today and not for most of the income.

**What reaches this database.** Paddle only. The `subscriptions` table has seventeen rows, all provider Paddle: four active SSi Premium, one active SSi Family, twelve cancelled. The Paddle webhook writes subscription state and, on a paid transaction, a flat teacher commission in pence to a commissions table that currently has zero rows. **No transaction amount is stored anywhere.** There is no receipts, payments, invoices or transactions table. Organisation and school platform billing is written as a status, trial or paid, an expiry and a seat count on the group or school row, again with no amount.

**RevenueCat.** Zero data. The name appears in code only as a field name in an identity-merge audit whose migration is not applied in the live database, and in eight design documents for the India Android and iOS store route. Even when the store route ships, RevenueCat would see Google Play and App Store purchases only. It would never see Paddle, and it would never see the legacy rails below. "RevenueCat enables aggregation" is not true of today's income.

**The other doors.** The legacy native app is live on both stores with paying users. Its iOS build links Apple's in-app purchase framework. Staff conversations record subscriptions in Stripe and in Recurly. The legacy billing database is unreachable from this estate, and the 2026-09-06 cutover sizing could not count its paying users at all. So income today arrives through at least four doors, Paddle, Apple, Stripe and Recurly, and this database sees one of them, without amounts.

**What this decides.** Revenue is a project, not a page in the first slice. The honest first revenue page, when built, shows who is paying through the new app by plan and status, which organisations and schools are trial or paid with seats and expiry, and states in the alarm tone that amounts are not recorded and that legacy subscribers are not visible here. Making it a real income page needs two things in order: a receipts ledger fed by the Paddle webhook, which already receives the amount on every paid transaction and drops it, and an export from each legacy rail into the same ledger. RevenueCat joins that ledger as a third feed if and when store billing ships. The aggregation point is our own ledger, not any vendor.

---

## 5. What I could not see

Stated plainly so nobody builds on a gap I papered over.

- **No Paddle dashboard.** I read the webhook code and the live subscriptions table. I did not see Paddle's own transaction history, so I cannot say what revenue the five live subscriptions represent.
- **No RevenueCat account.** I did not check whether one exists. Everything above is what the code and database show, which is nothing.
- **The legacy app's billing.** Unreachable from this estate, as the September sizing also found. The claims about Apple, Stripe and Recurly rest on the linked framework in the iOS bundle and on staff Slack quoted in that sizing, not on a database I read.
- **No rendered pages.** I read the code of every admin view header and the node home in full, and the design tokens, but did not drive the surfaces in a browser. The "disjointed" diagnosis is from the stylesheets and components, not from screenshots.
- **Who uses which of the five ways.** Admin pages emit no usage telemetry, so I cannot say which of the seven learner-progress views Tom, Kai or Aran actually open. The fossil record is read from code and rulings, not from use.
- **The Insight widgets' internals and the schools views.** I read the registry, spec, theme, resolvers for friction and health, and the board list, not each widget's body. I did not read Class detail, Setup, Upgrade or Settings beyond their size and imports; they are out of scope.
- **The nightly Discovery job.** Its last row is 2026-08-31 and it runs from a Mac I cannot see. I do not know whether it is broken or paused.
- **The `app_shell` column.** Absent live, so the browser-versus-native split has never been recorded and the historical events cannot be back-filled.
- **Thin cohorts.** The per-LEGO weak-point view in the first slice will show "too few to say" for most of the 53 courses today. That is the truth, not a defect, but Tom should expect it.

---

## 6. One recommendation Tom can answer in a word

**Should the new surface share the org dashboard's shell, tokens and rail component outright, so the two are one visual family, or get its own shell?**

My recommendation: **share.** The org dashboard is the surface Tom judged best thought through and the one whose colour matches the app. Sharing its container, stylesheet and rail is better because the two management surfaces become one family the eye already knows, simpler because there is one shell and one token file to maintain instead of two, and cheaper because the rail, the stamp, the cards and the top bar already exist and are tested. The intelligence surface will not look like the org dashboard, because its content grammar is questions and answers rather than a tree of nodes and verbs; what it will share is the canvas, the shapes and the way around. If Tom wants a visibly distinct identity for internal tooling, the answer is "own" and the first slice grows by roughly a shell's worth of work.

One word: **share** or **own**.
