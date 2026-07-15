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

**Trial clock is per teacher seat, not per school (owner ruling, 2026-07-15).** The 30-day
clock attaches to the individual teacher, starting at *that teacher's* first course pick —
consistent with "the unit is the teacher, not the school" above. One school can therefore
have several teachers on independent, staggered trial clocks; this is intended behaviour
(bottom-up adoption — a school doesn't need a single synchronised start). Serial-trial abuse
via fake teacher rotation (spinning up throwaway teacher accounts to keep re-triggering
fresh 30-day clocks) is accepted as self-limiting pre-Paddle: the teacher roster is visible
to the school admin and staff are finite, so the abuse doesn't scale quietly. No guard is
built for it by policy — revisit only if real abuse shows up post-Paddle, not preemptively.

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

**Scoped out — follow-up, not built this pass:** server-side enforcement of (4) at the API
layer. Today, live-affiliation visibility is enforced **client-side** (`SchoolsContainer`'s
`showExpired`/`platformActive` gate already blocks the whole dashboard, all student-data views
included, the instant a school's coverage lapses) but the schools rollup/analytics endpoints
behind `resolveVisibleScope` (`api/_utils/schoolScope.ts`) do not themselves check
`platform_status` — they'd still serve student data to a direct API call from an expired
school's own admin/teacher session. This is a genuine separate build (touches every rollup
endpoint, needs its own fail-open care) rather than a one-line addition riding along with the
entitlement work above — logged here rather than half-built.

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
