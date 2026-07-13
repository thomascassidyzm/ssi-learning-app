# Region Tier: invite-only regional leaders with heritage permissions

*Design doc — 2026-07-13. No implementation in this branch. Grounded in a read of
`api/_utils/schoolScope.ts`, `api/onboarding/provision.ts`, `api/admin/create-school.ts`,
`api/admin/create-govt-admin.ts`, `api/invite/create.ts`, `api/code/redeem.ts`,
`api/code/validate.ts`, `api/groups/index.ts`, `api/groups/[id].ts`,
`RedeemCode.vue`, `DashboardView.vue`, `useSchoolContext.ts`, and `supabase/schema.sql`.*

## The one-paragraph version

Almost everything already exists. The `groups` tree is live with a trigger-maintained
materialized path (`compute_group_path`, `idx_groups_path`); `schoolScope.ts` already
resolves a govt admin's visible schools by path-prefix subtree; the dashboard already
renders the group rollup; `invite_codes.grants_group_id` already exists and the admin
tool already writes it; and **govt admins can already mint school\_admin codes** —
`api/invite/create.ts` line 95 permits it, and redeeming one already creates a school.
The whole feature is three missing wires: (1) govt\_admin redemption ignores
`grants_group_id`, (2) leader-minted school codes don't carry the leader's group, (3)
there's no "name your region" moment. Plus one policy layer we must not skip: the
data-visibility floor (§4).

---

## 1. The leader flow, end to end

### 1a. Tom creates the invite (existing surface, one change)

Tom, as ssi\_admin, uses the existing Schools Setup admin view → "Create group admin"
(`POST /api/admin/create-govt-admin`). Today that endpoint requires an **existing**
`group_id` and pre-creates a synthetic learner + `govt_admins` row keyed on a fake
`govt_<timestamp>` user\_id. Change it:

- **Stop creating the synthetic learner and govt\_admins row.** They're dead weight — on
  redemption a *second*, real `govt_admins` row is created under the real auth uid, and
  the synthetic one is never linked to anyone who can log in. The invite code IS the
  provisioning; redemption does the writes.
- **Make `group_id` optional.** Two modes:
  - *Group exists already* (Tom pre-built "Wales" in the admin tree): pass `group_id`,
    code gets `grants_group_id` as today.
  - *Leader will name their own region* (the new default): pass only
    `organization_name` + recipient details; code gets `grants_group_id = null` and the
    redemption path creates the group (§1c).

The response is what it is today: a one-shot code (`max_uses: 1`). Tom copies the link
`saysomethingin.app/redeem/ABC-DEF` into a WhatsApp/email himself — **no email infra
exists and none is needed; the whole schools system already runs on manually shared
links** (teacher join codes, class codes). Design for that: the redeem page must carry
all context so a cold click works.

### 1b. The leader clicks the link

`/redeem/:code` → `RedeemCode.vue`, exactly the existing pattern: validate → show
"Group Admin Invite — *Gwynedd Education Authority*" (from `metadata.organization_name`;
extend `api/code/validate.ts` to prefer `grants_group_id`→`groups.name`, falling back to
metadata, instead of the legacy `regions` lookup) → email OTP inline → redeem. No new
auth machinery; it's the same screen every teacher already lands on.

### 1c. Redemption (`api/code/redeem.ts`, the real fix)

The `govt_admin` branch currently inserts `govt_admins` with only
`region_code: inviteRow.grants_region`. New behaviour:

1. If `inviteRow.grants_group_id` is set → `govt_admins.group_id = grants_group_id`.
2. If null → **create the group here, atomically with the admin row**:
   `groups.insert({ name: metadata.organization_name || 'New region', type: 'region' })`
   (the `compute_group_path` trigger sets `path`), then insert `govt_admins` with the new
   `group_id`. Creating at redemption rather than via a leader-callable create-group
   endpoint means no new write endpoint, no orphan groups from abandoned first-runs, and
   the leader can never end up group-less.
3. Write `region_code` too during the consolidation window (§2), then stop.

Redirect to `/schools` as today.

### 1d. First run: "Name your region"

The leader lands on the schools dashboard, which already branches on `isGovtAdmin`
(`DashboardView.vue:431`) and shows the group rollup. Add a first-run state: if their
group's name is the placeholder (or a `metadata`-seeded name they may want to change),
show a single inline card at the top of the dashboard — "**Name your region** — this is
what schools will see when they join" — one text field, one button. Not a wizard, not a
modal wall; the dashboard is visible (empty) behind it.

Saving calls a small extension to `PATCH /api/groups/:id`: today it's `verifyAdmin`
(ssi\_admin) only; allow **name-only** updates when the caller's `govt_admins.group_id`
equals the target id (server-derived, never from the client). `parent_id`/`type` stay
ssi\_admin-only — a leader must never re-parent themselves up the tree.

### 1e. "Add a school" — the leader's core surface

New section on the govt-admin dashboard (or the existing `/schools/all` view):
**Schools in your region**, with a primary "Invite a school" button. Clicking it:

1. Optional school-name field ("Ysgol y Garnedd" — purely for the link's label).
2. Calls the existing `POST /api/invite/create` with `code_type: 'school_admin'`. The
   permission check for this already exists (any `govt_admins` row may mint
   school\_admin codes). One change: **the server sets `grants_group_id` from the
   caller's own `govt_admins.group_id`** — ignore any client-supplied group. That single
   rule is what makes every leader-minted link group-bound and makes cross-region
   minting impossible.
3. The UI shows the link + a copy button, and keeps a list of minted links with state
   (pending / redeemed by *school name* on *date*), read from `invite_codes` +
   `schools.invite_code_id`. Leaders share the link however they like — that's already
   how the entire invite economy works here.

### 1f. A school admin redeems the link

Same `/redeem/:code` page: "School Admin Invite — *your school, part of Gwynedd
Education Authority*" (validate.ts resolves `grants_group_id`→group name). OTP, redeem.
The existing `school_admin` branch in `redeem.ts` already creates the school and its
teacher join code; two changes:

- `schools.insert({ ..., group_id: inviteRow.grants_group_id })` — **automatic group
  attachment, at birth, no adoption step.**
- Register the **admin** join code as well as the teacher one (the current branch only
  registers `teacher_join_code` — the same silent-failure class
  `ensureJoinCodesRegistered` in provision.ts fixes for the self-serve path; fold that
  helper in here).

Then route the new school admin into the existing course-picking onboarding
(`/schools1` continuation) rather than straight to `/schools`, so
`POST /api/onboarding/provision` runs. Provision finds the school by `admin_user_id`
(idempotent), and sets the platform trial columns — **group schools get exactly the
same 365-day (minority) / 30-day (Big Ten) clocks and £5 school-linked student price
as self-serve schools, with zero new billing code** (§5b). Today a school created via
invite redemption never gets its trial columns set at all; this closes that hole for
free.

### 1g. The rollup updates

Nothing to build. `resolveVisibleScope` → `schoolIdsForGovtAdmin` already does
`groups.path LIKE '{leader.path}%'` → `schools WHERE group_id IN (subtree)`. A school
attached in 1f is in the leader's next dashboard load, and so is every school added in
2027. That subtree query **is** the heritage permission — there is no grant table to
maintain, which is the whole point.

---

## 2. Consolidation: retire `region_code`, `group_id` wins

**Recommended path — do this, and start it in slice 1.** Two parallel region concepts
(legacy `region_code` strings on `schools`/`govt_admins`/`invite_codes.grants_region`
vs the `groups` tree) can silently disagree today: `schoolScope.ts` prefers group and
falls back to region, so a leader with both set sees the group subtree while a stale
region\_code sits there lying. Files that still touch region\_code: `schoolScope.ts`,
`create-govt-admin.ts`, `redeem.ts`, `validate.ts`, `useSchoolContext.ts`,
`useSchoolData.ts`, `useClassesData.ts`, `useStudentsData.ts`, `useAnalyticsData.ts`,
`SchoolsSetup.vue`, `SetupView.vue`, `SettingsView.vue` + tests. Plan, expand-contract
(one shared DB across dev/staging/prod — same discipline as the identity renames):

1. **Backfill** (gated script, canary method, `supabase/secfix-toolkit` runbook): for
   each distinct `region_code` on `schools`/`govt_admins` with no `group_id`, create one
   `groups` row (`type:'region'`, name from the `regions` table), set `group_id` on
   every matching row. Idempotent, logged, DRY\_RUN first.
2. **Dual-read stays** (it already exists everywhere that matters) but becomes
   dead-code-in-waiting: after backfill, zero rows resolve via the fallback. Assert that
   with a one-off audit query before step 3.
3. **Stop writing**: `redeem.ts` and `create-govt-admin.ts` drop their region\_code
   writes; `validate.ts` drops the `regions` lookups.
4. **Single-read**: delete the region\_code fallback branches in `schoolScope.ts` and
   the four schools composables; flip their tests.
5. **Drop columns later** — parked with the other gated migrations for the RLS-tighten
   window; not urgent once nothing reads them.

---

## 3. Permission model — heritage, stated precisely

**Rule: a role held on a group node grants READ over that node's entire subtree —
every school whose `group_id` is in the subtree, every class in those schools, at the
aggregation level §4 allows — including nodes and schools added after the role was
granted.** Mechanically this is already true: permission is evaluated at query time by
path-prefix, so "heritage" isn't a feature, it's the absence of per-school grants.

**Keep it two levels in product terms (group → school), even though the tree supports
depth.** Why: the product story a leader needs is "my region, my schools" — one noun
each. Depth multiplies every surface (rollups per level, drill-down per level, invite
semantics per level, the §4 consent story per level) for zero current demand; and
leaders creating sub-groups is exactly the surface that turns a read-only tier into an
org-chart product. The tree stays in the schema, so when a national deal genuinely
needs nation→region→school, ssi\_admin nests groups in the admin tool and
`resolveVisibleScope` already handles it — depth is an ssi\_admin capability, not a
leader capability.

A leader **CAN**:
- see the group rollup and per-school aggregate cards (existing `DashboardView`),
- drill into a school's dashboard read-only at the §4 floor,
- mint group-bound school-signup links (§1e) and see their redemption state,
- deactivate a *pending* (unredeemed) link they minted (`invite_codes.is_active=false`),
- rename their group (name only).

A leader **CANNOT**:
- create/edit/delete classes, or anything inside a school,
- mint teacher, student, or school\_admin\_join codes for a school (those belong to the
  school admin / class teacher — the existing checks in `api/invite/create.ts` already
  enforce this; don't loosen them),
- impersonate a school admin or act-as anyone,
- detach or delete a school, re-parent their group, or touch another group,
- see per-learner data without the school's consent toggle (§4),
- grant entitlements (comps stay ssi\_admin via `api/entitlement/grant.ts`).

Enforcement stays where it is: server-mediated, service-role endpoints with explicit
ownership checks (`resolveVisibleScope` for reads; the §1 write endpoints derive scope
from the caller's own `govt_admins` row). RLS on the six org tables stays off per the
standing doctrine — nothing here changes that calculus.

---

## 4. Data-visibility floor (GDPR / safeguarding)

A government officer seeing a named child's minute-by-minute learning activity is a
safeguarding and GDPR question, not a dashboard feature. **Recommended default:**

- **Leader sees school- and class-level aggregates only**: student counts, practice
  hours, sessions, cycle totals, belt distribution — everything `DashboardView`'s
  rollup cards already show. Class rows appear with counts, **no student names, no
  per-learner rows**.
- **Per-learner drill-down requires an explicit per-school consent toggle held by the
  school admin**: `schools.group_learner_visibility boolean NOT NULL DEFAULT false`,
  surfaced as one switch in the school's Settings view — "Allow your regional
  authority to view individual student progress." The school admin is the data
  controller for their pupils; this puts the decision exactly where the legal duty
  sits, and makes the sales conversation honest ("your schools opt in per school").
- Enforcement is server-side, one place: the rollup/report endpoints that call
  `resolveVisibleScope` check `role === 'govt_admin'` and drop per-learner payloads
  for schools where the flag is false (aggregates computed as now). The flag gates the
  *shape* of the response, not the scope resolution.

**Alternative (full drill-down by default), for completeness:** simplest to build (it's
what the code does today), and defensible where the government body is itself the data
controller for its schools (some national deployments will be). If a deal requires it,
flip the *default* for that group via an ssi\_admin-set group-level override — but ship
the consent-toggle model as the product default. Opt-in is the only default that's safe
in every jurisdiction we'll meet, and it costs one boolean.

---

## 5. The three open forks — options + recommendation, your call

### 5a. Pre-existing groupless schools joining a group

- **Option 1 — leader requests, school admin one-tap accepts. ← Recommended.** Leader
  searches by school join-code or the school admin's shared identifier (not a browsable
  school directory — leaders shouldn't enumerate schools they don't govern), sends an
  adoption request (`group_adoption_requests` row: group\_id, school\_id, status);
  school admin sees a banner "Gwynedd Education Authority wants to add your school to
  their region — Accept / Decline"; accept sets `schools.group_id` server-side. Consent
  is symmetric with §4 and nobody's data moves without the school saying yes.
- Option 2 — school admin enters a group code the leader shares. Same consent, slightly
  cheaper to build (reuses invite-code muscle), but a *joining* gesture reads wrong for
  an authority relationship, and codes leak.
- Option 3 — ssi\_admin attaches manually (exists today via the admin tools). Keep as
  the escape hatch regardless.

### 5b. Commercial terms for group schools

- **Option 1 — identical to self-serve at launch: 365-day minority / 30-day Big Ten
  platform clocks, £5 school-linked student price, no auto-entitlement. ← Recommended.**
  It's literally free (§1f routes group schools through the existing `provision.ts`),
  it keeps the trial-burn ledger honest, and it preserves the deliberate "no
  entitlement\_grant on self-serve" rule (provision.ts's own comment: free access via
  the hierarchy is reserved for deliberate comps).
- **Plus, same slice:** group-level term overrides settable by **ssi\_admin only**
  (columns on `groups`: e.g. `platform_trial_days_override`, `student_price_override`,
  or simply an ssi\_admin-issued group entitlement\_grant via the existing cascade) —
  so a signed government deal is **config, not code**: Tom sets it on the group, every
  current and future school in the subtree inherits it, heritage-style.
- Option 2 — bespoke terms per group at launch. Premature: no signed deal defines the
  shape yet, and every speculative knob is maintenance forever.

### 5c. Can a leader create schools directly (no school admin yet)?

- **Option 1 — invite-only at launch. ← Recommended.** Every school is born with a
  real, OTP-verified school admin who chose to sign up; the trial-burn ledger keys on
  that admin's email; nobody ever inherits a half-provisioned shell; and the leader
  surface stays read-plus-invite, consistent with §3. The link-with-state list (§1e)
  gives leaders the "I've onboarded 40 schools" feeling without owning the rows.
- Option 2 — leader pre-provisions schools (name + admin email), admin claims later.
  Adds a claimed/unclaimed state machine, an ownerless-school support class, and a
  trial-clock ambiguity (start at creation or claim?) — real costs, and only justified
  if a deal arrives as a spreadsheet of 200 schools. If that happens, build it then as
  a bulk *invite* generator (200 pre-labelled links, still claim-based) rather than
  pre-created school rows — which keeps Option 1's invariants.

---

## 6. Implementation slices (each ships alone)

**Slice 1 — wire `group_id` into govt\_admin redemption + start consolidation.**
`redeem.ts` govt\_admin branch (use `grants_group_id`, create-group-if-absent),
`validate.ts` group-name context, `create-govt-admin.ts` (drop synthetic rows, optional
group), region\_code backfill script + audit (§2 steps 1-3). No UI beyond existing
screens. *Size: one coding-worker session, including tests; the backfill canary run is
a second, careful, short session.*

**Slice 2 — self-serve region naming + group-bound school links.**
First-run name card + `PATCH /api/groups/:id` leader-rename rule; "Invite a school"
surface with link-state list; `invite/create` server-derived `grants_group_id`;
`redeem.ts` school\_admin branch sets `group_id` + registers both join codes; route
redeemed school admins through provision so clocks/price just work (§1f, §5b option 1).
*Size: two sessions — one server (endpoints + redemption + tests), one UI (dashboard
surfaces + RedeemCode copy).*

**Slice 3 — adoption flow + consent toggle.**
`group_adoption_requests` table + request/accept endpoints + the two banners (§5a);
`schools.group_learner_visibility` + Settings toggle + the aggregate-only filter in the
govt-admin report endpoints (§4); finish consolidation single-read (§2 step 4).
*Size: two sessions — the consent filter needs a deliberate pass over every govt-admin
data endpoint, and that's the one to be slow on.*

Every slice: `dev` branch, existing feedback loops (typecheck/test/lint), new tables
created with an explicit RLS posture (service-role-only, matching the org-table
doctrine), and no outward-facing action — nothing here emails, charges, or touches prod
learners until promotion.
