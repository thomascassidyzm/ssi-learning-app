# Group commercial model — settled shape

*Settled 2026-07-14, superseding the 2026-07-14 think-piece it replaces. Owner ruling in
conversation; numbers still open.*

## 0. The shape

**The unit is the teacher, not the school.** Price `y(band)` per teacher, PAYG subscription
via **Paddle** (merchant of record — Paddle handles VAT/GST for regional pricing, so we
don't build tax logic). Monthly or annual, no contract, cancel anytime, hop-on/hop-off.
Teachers start whenever they start; each seat is its own Paddle subscription with its own
billing anchor. **No proration, no true-up** — the model makes them unnecessary, because
there's nothing to reconcile: a seat's subscription starts when the teacher starts and bills
on its own cycle from then on.

~~**Students are always paid, no trial**, at the existing school-linked £5 price. Students
carry the marginal infra cost (audio streaming) — which is exactly why teacher pricing can
be a simple flat platform fee: the cost driver and the revenue line are the same object.~~
**SUPERSEDED 2026-07-15 (final student-entitlement ruling, below).** Schools never pay for
students — school revenue is teacher seats only. The £5 is the independent personal
all-courses door; a class-affiliated student's course access is derived free from their
school's live coverage, for as long as that coverage lasts. See "Student entitlement — FINAL
model" below.

**Groups aggregate payers; they are never a pricing tier.** A group paying is one Paddle
subscription with an adjustable quantity covering its schools' teachers; a school can
equally pay for itself. *Who pays* is a fact in Paddle's ledger, not a fact in the domain
schema. Sub-groups (path-tree nesting or flexible-grouping tags) stay organisational lenses
— never billing objects, exactly as the earlier think-piece's §3 argued.

**No commercial caps.** Subscription count is the truth; school creation stays uncapped
commercially (abuse guards, if ever needed, are a separate concern). This supersedes the
school-cap-as-purchase idea below — a cap needed inventing when the unit was the school; it
has nothing to enforce when the unit is the teacher and Paddle already meters seats.

**Trial:** 30 days, single language, clock starts at **course-pick**, with a ~7-day browse
window at redemption before commit (the resolution of the earlier think-piece's decision
#1). 365-day no-lock stays for minority-language schools. Expiry → **read-only**
(dashboards stay visible, play stops) — never lockout.

~~**Trial clock is per teacher seat, not per school (owner ruling, 2026-07-15 morning).** The
30-day clock attaches to the individual teacher, starting at *that teacher's* first course
pick — consistent with "the unit is the teacher, not the school" above. One school can
therefore have several teachers on independent, staggered trial clocks; this is intended
behaviour (bottom-up adoption — a school doesn't need a single synchronised start). Serial-
trial abuse via fake teacher rotation (spinning up throwaway teacher accounts to keep
re-triggering fresh 30-day clocks) is accepted as self-limiting pre-Paddle: the teacher
roster is visible to the school admin and staff are finite, so the abuse doesn't scale
quietly. No guard is built for it by policy — revisit only if real abuse shows up
post-Paddle, not preemptively.~~

**SUPERSEDED 2026-07-15 (owner ruling): trial clock is SCHOOL-LEVEL, one clock per school —
not per teacher seat.** `schools.platform_status`/`platform_expires_at` is the one trial/paid
clock a school carries; every teacher and class at that school shares it. This is consistent
with (and was already the FACTUAL implementation, not just the eventual target) the
class-coverage cascade landed the same day (`api/_utils/classCoverage.ts`,
"Implementation (landed 2026-07-15)" below) and the coverage gate on the schools
rollup/analytics endpoints (`api/_utils/schoolCoverageGate.ts`) — both key off the school row,
never a per-teacher-seat row. The per-teacher-seat clock idea above was a same-day morning
ruling superseded by this one before any per-seat trial column was ever built; no migration
or backfill is needed. A `teachers` row's own `platform_status` (the separate private-tutor
product, §"Implementation" below) is unrelated and keeps its own independent clock.

**Regional bands:** price band set once per school/group by an SSi human at creation time;
Paddle carries the per-region price lists. Three bands as the object model; band values are
open numbers.

**Domain schema impact is minimal:** paid/trial state per teacher seat, plus the trial
columns that already exist on `schools` (`platform_status`, `trial_course_code`,
`platform_expires_at`). Enforcement stays at the choke points that already exist:
course-pick for the trial lock, the player paywall at Orange belt for Big-10, and a
teacher-seat active check.

## Student entitlement — FINAL model (owner ruling, 2026-07-15, afternoon)

*Supersedes BOTH the "Students are always paid" line above and the morning's "derived, never
personal" ruling below — the latter is kept as historical record in a collapsed section, not
current design.*

**(1) Schools never pay for students.** Student accounts are owned by the student/parents.
The personal ~£5/month account (all languages) is the *only* paid student product — there is
no school-linked student charge. **Consequence:** school revenue is teacher seats only;
per-student school billing is deleted from the model (the worked-example numbers change
accordingly, once `y` lands).

**(2) During the school trial, class-affiliated students are effectively premium.** No
student-level clock, no student-level state — a class-affiliated student's access is the
simplest possible derivation: full/all-languages access, live-computed from the affiliated
school's trial status at check time.

**(3) On trial expiry, students drop to the normal free tier — nothing confiscated, no
lockout.** Free courses keep working forever, on free or paid accounts alike (e.g. Irish; the
universal Yellow-belt preview on every course). A class running a premium course simply
reverts that student to the same preview-through-Yellow experience any non-subscriber gets —
this is the *ordinary* free-tier shape, not a special "read-only" mode, and it is never
confused with the *school's own* dashboard read-only-at-expiry behaviour (§0 above, which is
about the teacher/admin's own access to their tools, not about a student's course access).

**(4) Live affiliation gates VISIBILITY, not just machinery.** The school pays (teacher seats)
for the dashboard/insights machinery *and* for the right to look at student data through it.
Dashboards/insights may read student data only while the school's affiliation is live (in
trial or paid). On expiry the affiliation goes dormant: the school can no longer view student
data (the client already blocks this — `SchoolsContainer`'s `showExpired` replaces the entire
dashboard, so no student-data view renders while lapsed); the students themselves keep their
accounts, courses and progress completely untouched. Renewal re-lights visibility instantly —
nothing to re-provision.

**(5) Consequence acknowledged:** school revenue = teacher seats only. Per-student school
billing does not exist in this model.

### Implementation (landed 2026-07-15)

Derivation: `GET /api/entitlement/user` now computes a **class-coverage cascade** alongside
the existing `entitlement_grants` → `get_cascade_courses` cascade —
`api/_utils/classCoverage.ts`'s `resolveClassCourseCoverage`. For the calling student: find
every class they're tagged into (`user_tags`, `tag_type='class'`, `role_in_context='student'`),
resolve each class's `school_id` → `schools.platform_status`/`platform_expires_at`, and for
every school whose coverage is live (`active`, or `trial` with an unexpired/absent
`platform_expires_at` — the same `isPlatformActive` gate `api/school/subscription.ts` already
used, now shared via `api/_utils/platformStatus.ts`), grant that class's `course_code`. The
result is pushed into the same `entitlements` array `checkCourseAccess` already consumes
(`access_type: 'courses'`) — **zero client-side changes**, because the existing
subscription/entitlement/preview cascade in `packages/core/src/pricing/access.ts` already knows
how to honour a course-scoped grant. No new student state, no new migration:
`schools.platform_status`/`platform_expires_at` already existed (region-tier work) and is the
only representation of school trial/paid state a class can currently be affiliated to (the
per-teacher-seat clock from §0 is a `teachers` row keyed to the *separate* private-tutor
product, not a per-classroom-teacher entity — so class coverage derives from the school, not a
teacher seat, until a per-seat model is actually built for classroom teachers).

On lapse, the class-coverage grant simply stops being added on the next check (no cache to
invalidate, nothing to revoke) — the student falls through to the existing free/community and
universal-Yellow-belt-preview rules, per (3) above.

**Server-side enforcement of (4), landed 2026-07-15** (`api/_utils/schoolCoverageGate.ts`):
live-affiliation visibility was enforced **client-side only** (`SchoolsContainer`'s
`showExpired`/`platformActive` gate blocks the whole dashboard, all student-data views
included, the instant a school's coverage lapses), but the schools rollup/analytics endpoints
behind `resolveVisibleScope` (`api/_utils/schoolScope.ts`) didn't themselves check
`platform_status` — a direct API call from an expired school's own admin/teacher session still
got student data. Closed by applying the same `isPlatformActive` predicate server-side in
every endpoint that resolves a caller's own school/class-anchored scope:
- `api/school/class-practice-7d.ts`, `api/school/daily-activity.ts` — filter the caller's
  classIds to schools with live coverage (`filterActiveScope`); 403 `coverage_expired` only
  when the caller's WHOLE resolved scope has lapsed (a teacher spanning >1 school only loses
  the expired school's classes, not their entire view).
- `api/school/rate-compare.ts` — 403 `coverage_expired` when the requested `entity_id`'s own
  school (`entity_level='class'` or `'school'`) has lapsed (`isEntityCoverageExpired`).

**Group-level rollups are deliberately exempt (owner ruling, PROPOSED — flagging since it's
the one contentious call in this pass):** an expired school does NOT drop out of its group's
aggregates. A group's rollup is the group leader's own-program view, already privacy-floored
(K_FLOOR) — losing one school's numbers mid-trial-lapse would make the group's own trend data
noisier for a fact the group leader has no lever over, whereas a school/class-scoped
drill-down is exactly the surface the expired school's own admin/teacher would otherwise use
to keep seeing their students. So `filterActiveScope` passes a govt_admin's scope through
unfiltered, and `rate-compare.ts`'s `entity_level='group'` is never gated (`ownSchoolId` is
null at that level). Revisit if this reads wrong once a real school lapses inside a live
group.

---

<details>
<summary>Superseded: "Student entitlement — derived, never personal" (owner ruling, 2026-07-15 morning) — kept for record</summary>

**Students have no personal trials, ever.** A student's content entitlement is three stacked
sources, none of which is a student-level clock or student-level state:

1. **Free courses** — everyone, always.
2. **Universal preview** — up to end of Yellow belt, on every course (matches the existing
   `PREMIUM_PREVIEW_MAX_SEED` wall in `checkCourseAccess`).
3. **The class course, in full** — DERIVED live from class membership, for exactly as long as
   the class's school has active coverage. **School coverage for a class = that class's
   teacher seat being in trial or paid** (the per-teacher-seat trial clock ruling recorded
   the same day, §0 above: `teachers.platform_status` / `platform_expires_at`, or
   `schools.platform_status` for the school-track). When coverage lapses, the student falls
   back to (1)+(2) with progress retained **read-only** — the no-lock principle already
   established for trial expiry, never a wipe.

The **personal paid account (~£5)** is unaffected and stays the independent all-courses door —
a student (or anyone) can subscribe directly regardless of any school relationship.

**Why school-level, not student-level:** the thing that's actually trialling is the school's
*machinery* — dashboards, insights, play-as-class — which only schools consume. A student
never sees or touches that machinery; their access should simply track "is my class's teacher
seat covered right now", recomputed on every check, never provisioned or burned as a
per-student event.

*(This "read-only" phrasing in point 3 is what the afternoon ruling's (3) tightened: a lapsed
class-course student isn't in a special locked/read-only mode, they're just back on the
ordinary free-tier preview — "read-only" stays reserved for the school's own dashboard-access
lapse.)*

#### Implementation status vs the ruling (2026-07-15 morning audit — gap logged, not built; closed by the afternoon implementation above)

Traced the full path: `LearningPlayer` → `useEntitlement.checkCourseAccess` →
`@ssi/core`'s `checkCourseAccess` (`packages/core/src/pricing/access.ts`) → inputs are
`platformRole`, personal `subscription` (Paddle), and `userEntitlements` (from
`GET /api/entitlement/user`, backed by `user_entitlements` — personal entitlement-code
redemptions — plus a `get_cascade_courses` DB cascade over `entitlement_grants` at
group/school/class level).

**The divergence is large — none of the ruling's three sources is actually wired this way today:**

- `checkCourseAccess` has **no input at all** for "is this student's class's school covered
  (teacher seat trial/paid)". The three inputs it does take (role, personal subscription,
  personal/cascaded entitlements) are all upstream of and unrelated to
  `schools.platform_status` / `teachers.platform_status`.
- The existing `entitlement_grants` → `get_cascade_courses` cascade (`api/entitlement/user.ts`,
  `supabase/schema.sql`) *is* a per-class/school/group grant mechanism, but it's **manually
  admin-provisioned** (`api/entitlement/grant.ts`, an ssi_admin-only write) with its own
  `is_active`/`expires_at` — entirely decoupled from the teacher-seat trial/paid clocks. In
  practice: a student in a school whose teacher is mid-trial gets **no full-course access at
  all** today unless an admin has separately hand-run a grant for that class/school/group.
  This is the actual live-test symptom's sibling bug — the ticket surfaced the *landing* half;
  this is the *entitlement* half, and it's currently unimplemented, not just misconfigured.
- The `user_entitlements` personal-code path (`api/code/redeem.ts`'s `redeemEntitlementCode`)
  remains fully capable of granting a student a personal entitlement — nothing currently
  blocks an entitlement code from being handed to or redeemed by a student account. The ruling
  says this should never happen for students; today it's merely a convention, not enforced.

**Scoped follow-up (not built this pass — flagged per BSC: this is a real design+build, not a
one-line fix riding along with the landing bug):** derive course access for a class-tagged
student directly from `classes.school_id/teacher_user_id` → `teachers.platform_status`/
`schools.platform_status`, either as a new input into `checkCourseAccess` or a server-computed
addition to the `GET /api/entitlement/user` cascade (replacing or supplementing
`get_cascade_courses`), with read-only-not-wipe on lapse. Until that lands, the honest state is:
class-course access for students is inconsistent with the ruling — it's either wide open (no
gate at all if the class's course previews-only-through-Yellow like every premium course
already does for anyone) or requires an admin's manual `entitlement_grants` row, never the
"just works because the teacher's seat is covered" experience the ruling describes.

</details>

## Play-as-class permission model (owner ruling, 2026-07-16)

**Play-as-class is a school-STAFF capability, not a teacher-only one.** Any staff
member of a class's school — teachers AND school admins — may play any class in
their school as-class. Cover/substitute and shared-class situations are normal;
multiple teachers per class are already supported (the `class_teachers`
membership relationship, lead + co-taught, scoped in `useClassesData.fetchClasses`
via `myTaughtClassIds`).

**Group leaders (`govt_admin`) are excluded by default.** Their product is
visibility into their group's schools, not classroom delivery — the group-leader
rollup views (`DashboardView`'s govt_admin template) never show a play button,
by design. A group leader covering a class in practice gets added as school
staff (teacher or school_admin) for that school, rather than being granted
play-as-class through the govt_admin role itself.

**Implementation:** `useSchoolContext().isSchoolStaff` = `isTeacher ||
isSchoolAdmin` (mutually exclusive with `isGovtAdmin`/`isStudent`/unaffiliated
by construction, since `educational_role` is a single value). `usePlayAsClass()`
combines this with the separate `isAdminView` flag (the ssi_admin **read-only**
god-view under `/admin/schools/:id` etc. — a different axis entirely, unrelated
to group leaders) into `canPlayAsClass`, which gates both the button's
visibility and the handler itself in `ClassDetail.vue`, `DashboardView.vue`, and
`TeacherDashboard.vue`. Permission matrix verified in
`usePlayAsClass.test.ts`: allowed for teacher / school_admin; excluded for
govt_admin, student, unaffiliated (no role), and the ssi_admin god-view.

**Gap found and closed 2026-07-16:** before this pass, `ClassDetail.vue`'s Play
as class button was gated only on `!isAdminView` (the ssi_admin god-view flag),
with no role check at all — a govt_admin drilling into a class via the normal
`/schools/classes/:id` route (not the `/admin/...` god-view) could see and click
it, contradicting this ruling. `DashboardView`'s own class-list templates
already correctly excluded a play button from the govt_admin's rollup view, but
that protection didn't extend to what you reach by clicking through to a
class's detail page.

**Attribution model (shipped 2026-07-16 — owner ruling: class as first-class
learner):** the attribution gap above is closed. A CLASS now has its own
learner identity — a `learners` row (`is_class_entity = true`, synthetic
`user_id = 'class-learner:<classId>'`, never signed in) linked from
`classes.class_learner_id`, enrolled in its own course via `course_enrollments`
exactly like a human learner. Play-as-class plays AS THAT ENTITY: while
`props.classContext` is active, `LearningPlayer.vue`'s `learnerId` resolves to
the class's own learner id, and every progress write that entity model implies
follows it — the live cursor (`setLivePosition`/`updateCurrentCycle`), the
position ratchet/ceiling (`setEnrollmentCursor`/`setMode`/`bumpInfplayRound` —
no longer skipped), practice minutes (`updateEnrollmentActivity`), and
per-lego spaced-repetition state (`lego_progress` via
`getLegoProgressById`/`saveLegoProgress`/`updateLegoProgress`). The class
genuinely progresses through the course between lessons now — a substitute
teacher resumes exactly where the last lesson left off, on the CLASS's own
ceiling, not the covering teacher's.

The staff member's own personal account gets nothing from a class-mode
session — no cursor, no ratchet, no lego_progress. `class_sessions` keeps
attributing session start/end to `teacher_user_id` (the staff auth uid)
exactly as before; `player_events` telemetry now attributes to the class's
learner id (via a cookie flip on class-mode enter/exit) with the driving
staff member's auth uid additionally logged as `actor_user_id` in every
event's payload, so "which teacher was at the keyboard" is never lost even
though the telemetry itself belongs to the class.

**Why this needed server mediation, not just a learnerId swap:**
`course_enrollments`/`lego_progress` have RLS enabled, own-row only
(`current_learner_id()` = the CALLER's own learner row) — a staff member's
auth uid never resolves to the class's learner id, so a direct browser write
targeting the class's row is rejected by RLS, by design. Per standing RLS
doctrine, the fix is a server-mediated endpoint with its own authz check
(`/api/school/class-progress`, gated on `resolveVisibleScope` + teacher/
school_admin role), never a "clever" hierarchy-aware write policy. The one
read-side RLS change made is narrow and additive: `can_view_learner_data()`
gained one OR clause so a class's own teacher/school_admin can read the
class's course_enrollments row for belt/progress display — write
authorization is completely unaffected (writes were never RLS-granted; they
route through the endpoint above).

**Known residual scope (not built in this pass, flagged deliberately):**
- `sessions`/`SessionStore` (checkpointSession/endSession, the legacy
  items_practiced tracking) and RPC-based counters
  (`bump_speaking_opportunities`, spike_events, response_metrics,
  learner_lego_pairings/points, pod-activation state) still write directly
  via the raw Supabase client keyed on `learnerId` — in class mode these
  silently no-op under RLS (all already warn-and-continue on write failure,
  never throw). None of these currently have a consumer that reads a CLASS's
  own row, so the gap is inert today, but it would need the same
  server-mediated treatment if a future feature reads the class's own session
  history, speaking-opportunities count, or spike/response telemetry.
- **daily_contributions (community minutes rollup) — open question, not
  decided:** class entities were added to `test_learner_ids()` (the one
  canonical "exclude from real-learner counting" set already used everywhere)
  so they don't inflate admin Users-page/board headcounts. A side effect:
  this ALSO excludes a class's own practice minutes from the
  `daily_contributions` community rollup, since that trigger reads
  `test_learner_ids()` too. Whether a class's practice SHOULD count toward
  the public community-minutes number is a genuine open call — left excluded
  by default (the cautious direction) rather than silently decided either way.

## Open numbers (for the owner)

- `y` — price per teacher, per band.
- Band list (3 bands assumed; names/values open).
- Annual-vs-monthly discount, if any.

## Superseded explorations (deleted from the design — kept for record)

- **x-per-school flat pricing.** Replaced once the unit moved from school to teacher —
  per-school flat pricing was solving for the wrong denominator once Paddle can meter seats
  directly.
- **School caps as purchased capacity.** A cap only needs inventing when schools are the
  billed unit; with per-teacher PAYG subscriptions, Paddle's subscription count already is
  the cap, so no `school_cap` column is needed.
- **Invoicing / true-up machinery.** PAYG per-seat billing with no proration removes the
  reconciliation problem the true-up logic existed to solve.
- **Payer objects (`group_contracts`, contract columns on `groups`).** Rejected — "who pays"
  is Paddle's ledger, not a domain-schema fact; inventing a payer object here would be a
  second source of commercial truth next to Paddle.

*Build order, when the numbers land: Paddle per-seat subscription integration, trial
re-keying to course-pick, read-only-at-expiry enforcement.*
