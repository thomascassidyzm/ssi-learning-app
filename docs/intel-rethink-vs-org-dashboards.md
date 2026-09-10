# What the intelligence rethink changes for the org dashboards

*Read-only cross-read, 2026-09-10, against `origin/dev` at `6e44c7227` and the unmerged branch
`origin/cs/47-build-intel-surface-first-slice`. No code was written, no design was made, nothing was
changed. Every claim about a schools surface below names the file it was read from.*

Answering one question Tom asked out loud:

> "ok before we do all this, is it worth seeing if the rethink on the admin ssi's intelligence
> surface leads to anything that the orgs dashboards will then do differently?"

---

## The position, first

**Build now — with one thing pulled forward and two things held.**

The two lines of work are **very nearly independent, and the intelligence rethink says so itself.**
Section 2 of the design document — the "what is deliberately not in it" list, which its author calls
"as load-bearing as the ten questions" — puts every single schools surface out of scope by name:

- "Structure, the org tree page, and the node home with its verbs. **Stay exactly as they are.**"
- "**Teacher and school tooling.** Class detail, teacher dashboard, school setup, seats and upgrade.
  Customer-facing, not internal."
- "**The Handbook.** It documents the org dashboard's capabilities for leaders and stays with that
  surface."

That is not a hedge in a document nobody acted on. The first slice is **already built** — branch
`cs/47-build-intel-surface-first-slice`, eight commits, 47 files — and I checked what it touches on
the schools side. The answer is **nothing**. It adds `/intel/*` under its own container, redirects
`/admin/analytics` only, and deletes four hand-rolled chart components whose only consumers are the
five analytics tabs deleted with them. `/schools/analytics` is untouched — it mounts
`TeacherInsightsView`, not `AdminAnalytics` (`router/index.ts:294-304`). **A schools-side reader
loses nothing at all when the Analytics page dies.**

So the honest answer to "is it worth waiting" is **no, not for the schools surfaces as a whole**.
But three specific things came out of the cross-read that do change what I would build first:

1. **PULL FORWARD: the freshness stamp for walks — and make it cover a second anchor namespace
   while you are in there.** §3.6 of the design says the intelligence surface "reuses the mechanism"
   of the Handbook comment. The built slice **does not**: it has **zero** HANDBOOK comments and
   invented a parallel `data-intel="…"` attribute alongside the existing `data-walk="…"`
   (`intel/QuestionPage.vue`, `PopulationChip.vue`, `ScopeRail.vue`, `UpdatedStamp.vue` — 16
   `data-intel` occurrences, 0 `data-walk`, 0 `HANDBOOK` across all 15 new intel files). This is the
   one real dependency in the pack, it is small, and it bites *now* rather than later. Watson's
   recommendation to do the freshness stamp first is **strengthened**, not weakened.

2. **HOLD: clips for the nine bare surfaces — but only the four I name below, and only for a
   fortnight.** Three of the nine bare surfaces (dashboard, students, analytics) are almost entirely
   readings, and #121·G is right that readings do not want clips. The four that carry residue —
   settings, setup, upgrade, teachers — are unaffected by the rethink and can be clipped whenever.
   Nothing in the rethink changes what any of the nine *contains*.

3. **HOLD, genuinely: the colour half of the visual grammar.** This is the one place where building
   now would mean building twice, and it is not a small collision. §3.3 declares the 2026-05 schools
   system canonical and says four tones map one-to-one onto the Insight Engine's — and **in the live
   code they do not, in either direction.** Details in list C below. A visual grammar for schools
   authored this week against `--schools-success` / `--schools-gold` would be authored against the
   wrong four values, because the pills and the charts on the schools surfaces both already read
   `--tone-*` from the *legacy Frostwell* token file. Settle which four values are the four tones
   before anyone writes a grammar that names them. That is one ruling, not a project.

Weighed on better × simpler × cheaper: building the Handbook freshness stamp now is **better** (it
is the only gate that exists for prose and the only one missing for clips), **simpler** (it reuses
`fingerprintCapability`, which already runs over the anchor), and **cheaper** (doing it once for
both anchor namespaces costs less than doing it for `data-walk` now and `data-intel` in three weeks
when somebody notices the intel pages have no freshness gate at all). Holding the colour ruling is
cheaper for the same reason in reverse: one sentence from Tom now, or a grammar rewritten later.

#47·G being already built rather than merely commissioned makes the fuse **shorter than the brief
assumed** — but it also makes the answer easier, because there is a diff to read instead of an
intention to guess at.

---

## A. Signals the schools surfaces should now show, and do not

Each names the question it comes from, the school-side view it lands on, and what it would say.

**A1. Which schools and classes have gone dark — question 10, on the node home's Below-this tree
(`components/admin/belowTree.ts`, `NodeBelowTree.vue`).**
`BelowClass` carries exactly `{ id, name, teachers, studentCount }`. There is no last-practised, no
health, no activity of any kind on a child row. The stats row above it says "3/11 classes practising
this week" (`NodeHomeView.vue:400`) — a ratio with **no way to find out which eight**. Everywhere
else in this product a row is a link and a row carries its own state; here the aggregate is the only
signal. A leader with eleven schools has to open each one to find the dead ones. Question 10 is
exactly this reading, and the data is one join away from a payload that already exists.

**A2. Which trials are about to end — question 10, on the same tree rows.**
This one is nearly free, and that is what makes it worth naming. The node-home endpoint **already
attaches `commercial` to every child row** — `platformStatus`, `platformExpiresAt`, `trialCourseCode`,
`createdAt` (`api/groups/[id]/home.ts:349`, `api/_utils/groupRollups.ts` `CommercialInfo`). The only
thing the UI does with it is pick the caption word: `n.hasSchool || n.commercial ? 'School' :
'Group'` (`NodeChildrenList.vue:98`). The node's **own** badge got the honest "No end date —
inactive" reading on 2026-09-09 (`NodeHomeView.vue:330`) after unstamped trials were found silently
conferring nothing — but the child rows never got it, so the fault that ruling closed is still
invisible one level up. A leader looking at a programme of eleven schools cannot see which of them
are dead. **The data is in the payload and is being thrown away.**

**A3. Where this class is stumbling in the course — question 4, on `NodeInsightsView.vue` (a class
or school scope) or `insight/TeacherInsightsView.vue` (a teacher's own class).**
The org side has *no* content-friction reading at any scope. `NodeRateEngine` answers "is this class
moving faster or slower than the average", and `VadPanel` answers "what is the microphone giving
us" — neither says anything about the course material. The `contentFriction` metric exists in the
Insight Engine registry (`insight/registry.ts:67`) but is only rendered on the admin boards at
`/admin/stats`. Question 4's new per-LEGO aggregate (`api/intel/weak-points.ts`, built on cs/47) is
the first thing in the estate that says "these bits of this course make people stumble". A teacher
would obviously want it for their own class. **The mechanism to make it node-scoped and
permission-checked already exists and has a precedent**: `api/_utils/vadVisibility.ts`, written for
exactly this, under Tom's 2026-08-20 ruling quoted in `NodeInsightsView.vue:126` — "the VAD data
should follow the same hierarchy of visibility that all data follows — students < teachers < school
leaders < group leaders". `weak-points.ts` is `verifyAdmin`-gated and course-scoped only.

**A4. The population chip, or rather its schools-shaped equivalent — question 1's §3.5 grammar, on
`NodeInsightsView.vue` and `views/schools/DashboardView.vue`.**
Both carry an `UpdatedStamp`; neither carries anything saying **who is behind the number**. The
schools side already knows how to be honest about this in its own idiom — `DashboardView.vue:388`
computes a `staffPracticeNote` reading "incl. 4m staff practice" precisely so a trial school's
headline is "never silently inflated" — and `VadPanel` states its denominator by rule ("a learner
with no microphone data is absent from these figures rather than counted as a zero",
`NodeInsightsView.vue:257`). What is missing is that discipline being **structural** rather than
per-surface. See B2 for the important bound on this.

**A5. [DATA DOES NOT EXIST] App versus browser — question 8.** The design says the `app_shell`
column is absent live and the code silently drops the value on every insert. Branch cs/47 carries
the migration (`20260904_player_events_app_shell.sql`) plus a canary. Until it is applied, no
surface — org or admin — can answer it. Named as data-that-does-not-exist rather than a query away.

---

## B. What the schools surfaces show today that the rethink makes obsolete or misleading

**B1. Nothing on any schools surface is deleted, obsoleted or broken by the rethink.** I looked for
this specifically and it is not there. `AdminAnalytics.vue` and its five tabs die, and the four
hand-rolled chart components die with them — `grep` for `admin/charts` across `packages/player-vue/src`
returns **five import sites, all five inside the deleted tabs**, plus two files that only mention the
folder in a comment (`insight/widgets/Flow.vue:11`, `Stat.vue:11`). No schools view imports any of
them. `/schools/analytics` mounts `TeacherInsightsView`, which is untouched.

**B2. The population rule does NOT transfer to the customer-facing surfaces, and applying it there
would be a defect.** This is the one place where I think the design's §3.5 rule, read literally
across both surfaces, is wrong rather than incomplete — and I want to be precise about why.
`realLearnerPopulation.ts` excludes staff platform roles because for *SSi's* pulse a staff account
practising is not a customer. But the schools surfaces answer a different question: a head teacher
asking "how much has my school practised" absolutely means to include the teacher who practised.
`DashboardView.vue` already gets this right — it counts staff minutes into the headline and then
*names* the staff share underneath. Transplanting "exclude staff" onto a school dashboard would show
Chepstow "0h" on a school where Lucy has genuinely practised. **The rule that transfers is "say who
is in the number", not "take these people out of it."**

There is a second, related bound. The node-home stats row is a **membership** count, not an analytics
population: `learnerCount` is built from `user_tags` rows in `api/_utils/groupRollups.ts`, which
contains zero references to `is_demo`, `is_internal`, `is_class_entity`, `platform_role` or
`test_learner_ids`. Class entities are excluded incidentally (they carry a `class-learner:<id>`
user_id and no tag — `api/_utils/classLearnerEntity.ts:38`), demo nodes are deliberately included and
badged "Demo". Those are legitimately different counts. **The collision is that both surfaces will
print the word "Learners" over two different numbers**, and Tom will one day put them side by side.
Arguable rather than clear; I lean towards saying it out loud in the copy rather than unifying the
maths.

**B3. [EXPLICIT GAP] I could not tell whether the Bench's "global" bar is contaminated.** The
three-bar bench on `DashboardView.vue` and the class card on `NodeHomeView.vue:1055` draw
class / school / **global-average-for-the-course**. The global figure comes from
`demographic_cycle_averages` (`api/groups/[id]/home.ts:402`), a live database view with **no
migration in this repo** — I searched `supabase/migrations/` and found no definition, only a
reference in a 2026-06 security handoff. So I cannot say from code whether it excludes demo rows,
staff rows or the Japan/Finland machine traffic that the intelligence resolver is about to start
excluding by rule. If it does not, then a Welsh teacher's "global average" bar is already wrong and
would be *provably* wrong the day the SSi side starts publishing a differently-filtered number. **A
read-only query against that view's definition settles it in one minute and I did not have the DB
access to run it.** Named as a gap, not guessed at.

---

## C. Concepts that should be shared rather than invented twice

*This is the practical payload. For each: already shared, shared in name only, or about to be
duplicated.*

**C1. The Handbook comment mechanism — ABOUT TO BE DUPLICATED. This is the strongest link in the
pack and the only hard dependency I found.**
§3.6 says the intelligence surface "reuses the mechanism, not the page: every one of the ten question
pages and every verb carries the same style of comment, and the compiled result is a 'What this page
counts' panel". What shipped on cs/47 is a **second anchor namespace**: `data-intel="question-page"`,
`data-intel="answer"`, `data-intel="evidence"`, `data-intel="rows"`, `data-intel="verb-bar"`,
`data-intel="population-chip"`, `data-intel="updated-stamp"` — and not one HANDBOOK comment
anywhere. Meanwhile `tools/walkthrough/compile.mjs` and `fingerprintCapability` know only about
`data-walk`. So today the estate has one described-and-fingerprinted anchor system and one
undescribed one, and nothing connects them.

This bears directly on Watson's freshness-stamp recommendation in the way that matters: the stamp
work is `fingerprintCapability` over an anchor's tag, label and same-file handler. If the same pass
is written to take the attribute name as a parameter, it covers `data-walk` **and** `data-intel`, and
the intelligence surface is born with the freshness gate the walks currently lack. If it is not, the
intel surface will grow ten question pages with no description gate at all and somebody will build
the same thing again. **Better × simpler × cheaper says do it once, and do it now, before #47·G's
second slice lands more `data-intel` anchors.**

**C2. The four tones — SHARED IN NAME ONLY, and the names point at three different sets of values.**
This is the item I would put in front of Tom before anyone writes a visual grammar. Read from the
code:

| tone | Insight Engine chart (`insight/theme.ts`) | schools status pill (`schools-design.css:190-213`) | what §3.3 says to use |
|---|---|---|---|
| good | `--tone-green` → `rgb(74,222,128)` | fill `--tone-green` @16%, text `--tone-green-ink` `#15803D` | "the schools success green" = `--schools-success` `#1F8A5B` |
| watch | `--tone-gold` → `rgb(212,168,83)` | fill `--tone-gold`, text `--tone-gold-ink` `#A16207` | "the schools gold" = `--schools-gold` `#FEC902` |
| alarm | `--tone-red` → `rgb(217,69,69)` | `--tone-red` | "brand red" = `--schools-red` `#DB1E17` |
| quiet | `--ink-secondary` `#4A4440` | `--schools-fg-3` `#6b6b6b` | "the muted grey" |

The `--tone-*` triplets are defined in **`schools-tokens.css`** — the *legacy Frostwell* file the
aesthetic contract (`/d/a56bdcd6`) correctly calls vestigial, whose own header says it is removed
once every view is migrated. It cannot be removed: the live `.status-pill` rules consume it, and so
does the live chart theme. So the chart and the pill **do** share a family — which is better than
§3.3 implies — but **neither of them uses any of the four values §3.3 names**, and §3.3's promise
that "a chart and a pill never disagree" is a requirement to be built, not a description of today.

Three further collisions in the same channel, all read from code:
- **A fifth pill tone with no counterpart.** `.status-pill` has `tone-blue`; the engine's `Tone` type
  is `neutral | good | warn | alarm` and its `neutral` renders grey. There is no blue in the tone
  set and no home for the pill's blue.
- **A sixth tone that exists only as a fallback.** `NodeHomeView.vue:1337` styles `.tone-amber` — the
  Demo and Trial badges — from `var(--tone-amber, 194 132 58)`, and **`--tone-amber` is defined
  nowhere in `packages/player-vue/src/styles/`.** Every Demo and every Trial badge in the product is
  currently painted by an inline literal.
- **A fourth status vocabulary.** `HealthDot` uses `--schools-health-excellent/good/needs-attention/
  inactive` = `#1F8A5B / #3768c4 / #c66a1c / #999999`. Note that health's **good is blue** while
  tone's **good is green**, on pages that show both.

That is four colour vocabularies for status on one surface, which is precisely Tom's "pig's
breakfast" diagnosis, verified in schools rather than asserted about it. **The ruling that unblocks
the visual grammar is one line: which four values are the four tones.** Everything else follows,
including whether `schools-tokens.css` can finally die.

**C3. The population resolver — ABOUT TO BE DUPLICATED, but only partly, and that is correct.**
`api/_utils/realLearnerPopulation.ts` (on cs/47) is a good piece of work and its header is explicit
about why it calls `test_learner_ids()` rather than forking it. But `api/intel/pulse.ts` opens with
the reason it does **not** reuse the existing analytics functions: "analytics_overview excludes only
`is_demo` and `is_internal`: it does not know about staff platform roles, class entities, or the
machine countries". So there are now **two** population rules in the estate that both claim to count
real people, and a third — the org rollup's membership count — that means something else again. Per
B2 I think the schools surfaces should keep their own rule; what should be shared is the *statement*
of the rule on the page, not the rule.

**C4. The k-floor and the honest empty state — ALREADY SHARED, and the org side is the source.**
`spec.ts:61` defines `Sovereignty.kFloor`, `api/groups/[id]/rate-compare.ts:416` computes
`effectiveFloor` with a documented demo-world exception, and returns a first-class `insufficientData`
response with a reason. `api/intel/weak-points.ts` on cs/47 sets `K_FLOOR = 5` and says in its own
comment that it uses that value because it is "the Insight Engine's own default floor (spec.ts,
Sovereignty.kFloor) and this uses the same value so a chart and a page cannot disagree". **This is
what sharing looks like when it works**, and it is the strongest argument for the design's own §6
recommendation to share the shell.

**C5. The five shapes — NOT YET SHARED, and mostly compatible.** Card, Stone, Row, Chip, Pill map
onto `.schools-card`, `.stat-card`, the below-tree row, `.filter-bar` chips and `.status-pill` with
no violence. The one place I would flag as arguable: §3.3 says brand red "is never a background", but
`.btn-play`, `.verb-btn`, `.setup-banner-cta` and `.org-trial-cta` all use `--schools-red` as a
button background on the very surface §3.3 declares canonical. **I lean towards reading §3.3 as
"never a page or card background"** — the primary verb is one of its own three permitted jobs — and
towards saying so in the rule rather than leaving a grammar that forbids the schools primary button.
Reported as arguable per the brief's default.

**C6. The Insight Engine — SHARED FAR LESS THAN THE PREMISE ASSUMES, and this correction matters.**
My brief called it "already shared between the admin and org sides", and that is true of the folder
and of `theme.ts`, but not of the thing the intelligence surface is told to draw from. Read from the
routes and the imports:
- The **thirteen-widget dispatcher** (`InsightWidget.vue`) and the **metric registry**
  (`registry.ts` — `courseValue`, `contentFriction`, retention, health) render only on `/admin/stats`
  and `/admin/insights`. No schools route mounts a registry metric.
- What the org and school surfaces actually render is **`NodeRateEngine`**, whose data type
  `RateComparisonData` is documented in `spec.ts:189` as explicitly **"NOT part of the WidgetData
  union and NOT a registry kind"** — a hand-composed board widget — plus `VadPanel`.

So: building the intelligence surface on the registry gives the schools side **nothing** for free,
and the one widget the schools side does render is deliberately outside the library the intelligence
surface is told to use. The built slice confirms the split — `views/intel/WeakPointsView.vue` imports
`InsightWidget` and builds a `ranked-bar` spec, joining the admin side of the line. If Tom wants A3
(weak points for a teacher's own class), that is where the second consumer would have to be built,
and it is a genuine piece of work rather than a wiring job.

**C7. The five-part page grammar — ALREADY SHARED IN SUBSTANCE, invented separately in code.**
`NodeInsightsView.vue` is already the five-part page: rail, identity header, `UpdatedStamp`, exactly
one widget, a verbs corner. `intel/QuestionPage.vue` is that same grammar written again as a layout
component with the slots enforced and a template test. The design's §6 "share or own" recommendation
— share — is right, and the built slice half-honours it: it uses `--schools-*` tokens throughout but
its own container and its own rail. Reported, not argued; that fork is already in front of Tom.

**C8. Walk anchors — NOT SHARED, and see C1.** `data-walk` appears in the intel slice zero times.

---

## D. What the rethink strengthens and breaks in the visual-semantics position

**STRENGTHENS — the readings/verbs split.** The rethink arrives at the same boundary from the other
side without citing it. §3.2's shape table says a Pill "means a status: good, watch, alarm, quiet"
and is "never used for a filter", and a Chip means a filter and never a status. That is #121·G's
"one fact one channel" written as a build rule by a different author on a different surface on the
same day. §3.2's line "Belts keep their belt colours as dots and strips; they are content, not
status" draws the content/status boundary in exactly the place #121·G was arguing about, and it
lands on #121·G's side.

**STRENGTHENS, hard — the second-artefacts reframe and "evidence over explanation".** §3.5's
population chip and Updated stamp are second artefacts by #121·G's own test — until you notice they
are *computed from the same fetch the number came from*. `UpdatedStamp` takes `fetchedAt` from the
moment the request resolved, "never from render time"; `PopulationChip` prints "the count the server
itself resolved — never a count the page worked out on its own". Those are evidence, not
description, and they cannot drift. That is #121·G's move, arrived at independently, and the design
makes it structural: "the chip and the stamp are this component's own, not each page's, which is
what makes 'every page shows them, in the same slot' true by construction instead of true by
everybody remembering" (`QuestionPage.vue`).

And the pattern is already shipped on the schools side, exactly as #121·G said. Verified:
`ClassDetail.vue:394-415` fetches `ClassDeleteImpact` from the server, `deleteImpactLines`
(`:747`) computes the student / teacher / session counts, and `require-typed-confirm` is bound to
`deleteImpact?.hasRealActivity` (`:1482`). The delete modal is a handler preview, not a description
of one.

**STRENGTHENS — the reading-grammar violation #121·G named is real.** `DashboardView.vue` renders
`<BeltDot belt="white" :size="28" ring />` on every class row of the compact table and again on every
class card in the detailed grid. Hard-coded, on both density branches. A measurement's clothes on a
decoration, confirmed in code.

**BREAKS, or at least bounds — "only about a dozen capabilities genuinely want a sentence."**
Two ways, in opposite directions, and they do not cancel.

*The 72 is a moving number, upward.* The design proposes the whole grammar be documented by the same
comment mechanism — "every one of the ten question pages **and every verb** carries the same style of
comment". `docs/intelligence-surface-verbs.md` names nine verbs. So the compiler's denominator is
about to grow by ten pages plus nine verbs plus the shell's own furniture, on the admin side. #107·G
counted 86 schools capabilities; nothing about the schools *number* changes, but the *compiler* the
freshness work targets is about to carry a second surface. That is an argument for doing the stamp
work once, generally — C1 again.

*And the residue is smaller than a dozen on the surfaces that matter.* Of #107·G's nine bare
surfaces, the rethink touches none. Three (dashboard, students, analytics) are, as #121·G says,
almost entirely readings. So the "dozen that want a sentence" sits on settings, setup, upgrade,
teachers and classes — the domain list, the access-code lifetime, the seats-over policy, the role
someone arrives as — **and every one of those is independent of the intelligence rethink.** Nothing
is gained by waiting for it before writing them.

**BEARS ON, but does not answer, the two taste calls.** They are Tom's and they are already in front
of him; I only report what the cross-read turned up.
- *Red for Delete.* The rethink independently grants brand red three jobs, one of which is "the
  primary verb" and one of which is "the alarm tone" — so on that surface red is already both a verb
  colour and a measurement-adjacent status colour, decided the same way #121·G asks about. Evidence
  for the fork, not a resolution of it.
- *The role channel.* Nothing in the rethink touches it. The intelligence surface's answer to
  permission is `verifyAdmin` on every endpoint and one role — "deliberately blunt and the right
  blunt" — so it never meets the problem. The role channel remains a schools-only question.

---

## Gaps, and defaults I took

- **The Bench's global average (B3) is a genuine blocked read**, not a soft one:
  `demographic_cycle_averages` has no definition anywhere in `supabase/migrations/`, and I had no
  live database access to read it. Whether the org dashboards' global bar already counts machines and
  demo rows is unanswered.
- **AdminStatsView and the eight Insight boards** I read by route and imports, not line by line. My
  claim that registry metrics are admin-only rests on the route table and on `grep` for
  `InsightWidget` consumers, both of which are unambiguous; the boards' internals are not the
  question here.
- **I did not read** `SetupView`, `SettingsView`, `UpgradeView` or `TeachersView` in full. My claims
  about them come from #107·G's coverage map and from #121·G, both of which read them. Where I say
  something is on those surfaces I have marked whose reading it is.
- **The published documents beat the brief in one place.** My brief said §3.3 states that four tones
  "map one to one onto the Insight Engine's neutral/good/warn/alarm tones so a chart and a pill never
  disagree" as if it holds. The document does say that; the code does not do it. I have reported the
  document's claim as a requirement rather than a description, and shown the values.
- **C5's brand-red-as-background** is reported as arguable with my lean stated, per the brief's
  taste-safe default.
- **No tests, no build, no dev server, no screenshots, no database queries** were run. Verification
  here was re-reading the cited file.

## One bug, named and left alone

`insight/theme.ts` disagrees with itself about green: `palette().green` falls back to `#3A9E60` while
`toneRgb('good')` falls back to `'74, 222, 128'` (`#4ADE80`). Both are fallbacks, so on a live page
under `.schools-surface` both resolve from `--tone-green` and agree; they diverge only where the
token is absent. Not touched.

---

*Written for job #124·G. Read-only. No code changed.*
