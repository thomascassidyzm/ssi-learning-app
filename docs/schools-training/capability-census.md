# Schools capability census

Read-only census of every distinct action or read a non-learner persona (govt_admin/leader,
school_admin, teacher, tutor) can perform in the schools/org dashboard, grounded in **live code
only** (`packages/player-vue/src`, `dev` branch, read 2026-09-07). Docs carry no authority per
CLAUDE.md — every row below is sourced from a file and line, not from a doc.

Personas as the code actually gates them (not as marketing names them):
- **govt_admin** — a "leader" in product copy; scoped to a group/region subtree. Lands on `/org/:id`
  (THE VIEW) if `group_id` is set, else the legacy `/schools` dashboard (no-group rows only).
- **school_admin** — scoped to one school. Lands on `/org/:schoolId` (their own school's node home)
  or the legacy `/schools` dashboard for no-school/legacy rows.
- **teacher** — scoped to their own classes. Always the legacy `/schools` + `/schools/classes/:id`.
- **tutor** — a freelancer, `/tutors/dashboard`. Its own player-only lane; no schools/org data.
- **ssi_admin** — platform staff. Reads any school/class/group via `/admin/schools/:id/*` read-views
  (`isAdminView=true` everywhere below) with every write control hidden, or acts platform-wide under
  `/admin/*`. Listed separately at the end — out of the four target personas but load-bearing for
  "admin-only" capabilities a school never sees.

Two live UI generations coexist for the same data: the **legacy flat dashboard**
(`views/schools/*.vue`, routes under `/schools`) and **THE VIEW** (`views/admin/NodeHomeView.vue` +
`components/admin/NodeActionBar.vue`, routes under `/org/:id`), which is where the `router/index.ts`
comments say group-scoped govt_admins and school-scoped school_admins are actively being redirected
(2026-07-29/30 nav-unification rulings). A teacher only ever sees the legacy dashboard. Both are
covered below.

---

## A. Getting people in

| # | Capability | Personas | Where | R/W | Destructive |
|---|---|---|---|---|---|
| A1 | Invite a teacher (join-link banner) | school_admin | `/schools/teachers` `TeachersView.vue:295` (`+ Invite teacher` → reveals the standing link below; no mint) | R (link is standing) | No |
| A2 | Copy the teacher join link / show join code | school_admin, teacher (view only for teacher) | `/schools/teachers` `TeachersView.vue:471-495`, InviteLinkField | R | No |
| A3 | Create a rescue sign-in ("access code") for a locked-out teacher | school_admin | `/schools/teachers` `TeachersView.vue:404-413` `data-walk="teacher-signin-link"`, `useTeachersData.createStaffSigninLink` | W (mints a one-use, 2-day code) | No |
| A4 | Remove a teacher from the school | school_admin | `/schools/teachers` `TeachersView.vue:417-424`, `useTeachersData.removeTeacher` (refuses on an Admin-tagged row) | W | **Yes** |
| A5 | Bulk-import teachers via CSV | school_admin | `/schools/teachers` `TeachersView.vue:292-294,120-124` — **stub**, shows a "coming soon" hint, no endpoint wired | — | No |
| A6 | Invite students (redirect) | teacher/school_admin | `/schools/students` `StudentsView.vue:154-156` — routes to `/schools/classes` (no dedicated per-school invite; invites are per-class) | R (nav only) | No |
| A7 | Copy a class's student join link / show join code | teacher, school_admin | `/schools/classes/:id` `ClassDetail.vue:970-994` `data-walk="class-join-link"`/`"class-join-code"` | R | No |
| A8 | Share a class's join link from the class list | teacher, school_admin | `/schools/classes` `TeacherDashboard.vue:314-322`, copy-to-clipboard of `/with/:code` | R | No |
| A9 | Remove a student from a class | teacher, school_admin | `/schools/classes/:id` `ClassDetail.vue:349-360` — direct `user_tags` soft-delete (`removed_at`) | W | **Yes** |
| A10 | Set your own password (rescue path off email codes) | any staff persona | Global banner `SchoolsPasswordPrompt.vue` (legacy) / `YourAccount.vue` `data-walk="account-password"` (THE VIEW) | W | No |
| A11 | Invite a person (any role) into a node | govt_admin (member), ssi_admin | THE VIEW, `NodeActionBar.vue:582,606-629` `data-walk="verb-invite-person"`/`"invite-form-role"`/`"invite-form-submit"` — role dropdown (leader/school_admin/teacher/student depending on node) | W (mints a personal invite) | No |
| A12 | Invite students into a specific class (class-mode bar) | teacher/school_admin (member) | THE VIEW class page, `NodeActionBar.vue:580` `data-walk="verb-invite-student"` — collapses the bar to one verb | W | No |
| A13 | Get a shareable (non-personal) join link for a node | govt_admin, school_admin (member), ssi_admin | THE VIEW, `NodeActionBar.vue:583,629` `data-walk="verb-shareable-link"` | W (mints a standing link) | No |
| A14 | Ways-in ledger: copy / re-mint / revoke / resend an invite | govt_admin, school_admin, ssi_admin | THE VIEW node home, `WaysInLedger.vue:180-236` `data-walk="ways-in-ledger/ways-in-copy/ways-in-remint/ways-in-revoke/ways-in-resend"` | W (remint/revoke); R (copy) | Revoke is **yes** |
| A15 | Platform invites desk (org/direct/demo, one primitive) | ssi_admin only | `/admin/invites` `AdminInvites.vue` → `InviteCreateCard.vue`, `OrgInviteForm.vue`, `UnifiedInviteList.vue` `data-walk="invites-mode-strip/invites-org-who/invites-org-submit/invites-active-toggle"` | W | Deactivate = **yes**-ish (reversible) |

## B. Running classes

| # | Capability | Personas | Where | R/W | Destructive |
|---|---|---|---|---|---|
| B1 | Create a class | teacher, school_admin | `/schools` (Dashboard `+Create class`), `/schools/classes` (`TeacherDashboard.vue:236-242,362-364`), `CreateClassModal.vue` | W | No |
| B2 | Rename a class | teacher (any co-teacher), school_admin | `/schools/classes/:id` `ClassDetail.vue:365-374`, `useClassesData.renameClass` → `api/school/rename-class` | W | No |
| B3 | Delete a class | lead teacher / school_admin (server-enforced ownership) | `/schools/classes/:id` `ClassDetail.vue:379-407`, `ConfirmDeleteModal.vue`, impact preview via `fetchClassDeleteImpact` | W | **Yes** (typed-confirm gated if real activity) |
| B4 | Add a class to a node (THE VIEW) | govt_admin, school_admin (member), ssi_admin | THE VIEW, `NodeActionBar.vue:592,660-671` `data-walk="verb-add-class"`/`"add-class-name"`/`"add-class-submit"` | W | No |
| B5 | Play as class (launch a live session) | teacher, school_admin (server permission-gated) | Dashboard row, My Classes row, Class Detail hero — `usePlayAsClass.launchClassSession`, `ClassDetail.vue:711` `data-walk="class-play"` | W (starts a session; not destructive) | No |
| B6 | View class roster (belt, LEGOs, practice, health, last active) | teacher, school_admin, govt_admin (drill-down), ssi_admin | `/schools/classes/:id` `ClassDetail.vue:842-916` | R | No |
| B7 | Search / filter the roster | teacher, school_admin | `ClassDetail.vue:846-852` | R | No |
| B8 | See who teaches a class | teacher, school_admin, govt_admin | `ClassDetail.vue:727-839` `data-walk="class-teachers"` | R | No |
| B9 | Add another teacher to a class | lead teacher / any co-teacher-with-manage-rights, school_admin, govt_admin | `ClassDetail.vue:789-816` `data-walk="class-teacher-add"`/`"class-teacher-picker"`, `useClassesData.addClassTeacher` | W | No |
| B10 | Remove a teacher from a class (or "leave" if it's you) | as above, or the teacher themself | `ClassDetail.vue:750-768`, `removeClassTeacher` | W | **Yes**-ish (they keep their account) |
| B11 | Hand over the class lead | as B9 | `ClassDetail.vue:750-759` `data-walk="class-teacher-make-lead"`, `addClassTeacher(…,{lead:true})` | W | No |
| B12 | Assign a teacher to other classes (from their row, on Teachers or Class Detail) | school_admin, govt_admin, lead teacher (Class Detail only) | `TeachersView.vue:390-398` `data-walk="teacher-assign-classes"`; `ClassDetail.vue:740-749` `data-walk="class-teacher-other-classes"`; both open `AssignClassesModal.vue` `data-walk="assign-classes-modal/-list/-save"` | W | Removing = **yes**-ish |
| B13 | Mint a class-scoped co-teacher (supply teacher) link | lead teacher, school_admin, govt_admin | `ClassDetail.vue:606-629,818-836` `data-walk="class-coteacher-link"`, `createCoTeacherLink` | W | No |
| B14 | Filter / sort classes (course, health, students, hours, journey) | teacher, school_admin | `/schools/classes` `TeacherDashboard.vue:409-438` | R | No |
| B15 | Export classes to CSV | teacher, school_admin | `TeacherDashboard.vue:324-345` | R | No |
| B16 | View class benchmark (cycles/practice-min vs school vs global) | teacher, school_admin, govt_admin | `Bench.vue` on Dashboard/ClassDetail, `getClassReport` | R | No |

## C. Courses and access

| # | Capability | Personas | Where | R/W | Destructive |
|---|---|---|---|---|---|
| C1 | 4-step onboarding wizard: name school → share staff links → choose courses → create classes | school_admin | `/schools/setup` `SetupView.vue` (no nav tab; reached from first-run banner or Settings→Quick links) | W (each step persists) | No |
| C2 | Choose which of the school's courses are used for classes (local filter) | school_admin | `SetupView.vue:159-198` (step 3) — does **not** grant access | W (local pref only) | No |
| C3 | Set/read a node's course entitlement (trial vs paid, trial course) | ssi_admin only (`!member`) | THE VIEW `NodeActionBar.vue:594` "Courses" → `NodeEntitlementControl.vue:231-271` | W | No |
| C4 | Subscribe the school to the platform (seats, monthly/annual) | school_admin | `/schools/upgrade` `UpgradeView.vue:233-249,677-749` | W (payment) | No |
| C5 | Subscribe an org/group (seats) | govt_admin | `/org/upgrade` `UpgradeView.vue:299-363,600-651` | W (payment) | No |
| C6 | Subscribe a tutor | tutor | `/tutors/dashboard/upgrade` `UpgradeView.vue:404-467,771-807` | W (payment) | No |
| C7 | Open the billing portal (invoices, card, cancel) | school_admin | `SettingsView.vue:144-168` / `SchoolBillingPanel.vue:38-46`, `UpgradeView.vue:452-465` | W (external Paddle portal) | Cancel = **yes** (external) |

## D. Reading the numbers

| # | Capability | Personas | Where | R/W | Destructive |
|---|---|---|---|---|---|
| D1 | Dashboard headline stats (students/teachers/classes/hours) | teacher, school_admin, govt_admin | `/schools` `DashboardView.vue` (role-branched template) | R | No |
| D2 | Students list: search, filter by class/belt/health, view a student | teacher, school_admin | `/schools/students` `StudentsView.vue` | R | No |
| D3 | Export students to CSV | teacher, school_admin | `StudentsView.vue:132-145` | R | No |
| D4 | View a student's own progress (belt, journey, sparkline, per-course table) as admin read-view | ssi_admin (`isAdminView`) | `/admin/users/:learnerId/progress` → `StudentProgressView.vue` | R | No |
| D5 | Class analytics (Rate-compare, teacher-scoped) | teacher | `/schools/analytics` → `TeacherInsightsView.vue` (embedded) | R | No |
| D6 | Insight Engine — node-scoped Rate-compare (measure/window/compare pickers) | govt_admin, school_admin, ssi_admin | `/org/:id/insights` `NodeInsightsView.vue`, `NodeRateEngine.vue` `data-walk="insights-measure/-window/-compare"` | R | No |
| D7 | Drill from a school's own students page into a per-learner analytics view | teacher, school_admin | `StudentsView.vue:120-130` (`router.push` to `/schools/analytics?scope=learner&learner=…`) | R | No |
| D8 | All-schools programme view (govt admin): stats, sort, search | govt_admin | `/schools/all` `SchoolsView.vue` | R | No |
| D9 | Export schools list to CSV | govt_admin | `SchoolsView.vue:165-185` | R | No |
| D10 | Govt-admin drill-down into one school's classes/stats | govt_admin | `DashboardView.vue:749-940` (viewingSchool branch) | R | No |

## E. Money and settings

| # | Capability | Personas | Where | R/W | Destructive |
|---|---|---|---|---|---|
| E1 | Edit school profile (name, city, region, contact email, about) | school_admin | `/schools/settings` (Profile tab) `SettingsView.vue:384-419` | W | No |
| E2 | Confirm/rename the school's display name (first-run card) | school_admin | Dashboard first-run card `DashboardView.vue:581-602`; also THE VIEW `NodeHomeView.vue:274-787` | W | No |
| E3 | Rename a group / confirm group name (first-run card) | govt_admin | Dashboard `DashboardView.vue:764-785`, `useGovtAdminActions.renameGroup` | W | No |
| E4 | Localisation settings (language, timezone, week start, show-flags) | school_admin | `SettingsView.vue` (Localisation tab) — persists to `localStorage` only, not server | W (local only) | No |
| E5 | Data & privacy toggles (analytics sharing, messaging, real names, retention) | school_admin | `SettingsView.vue:473-509` — **visual placeholders, no DB column** | — | No |
| E6 | Download all school data (.csv) | school_admin | `SettingsView.vue:319-347,495-497` | R | No |
| E7 | Delete the school | school_admin (self-serve, ownership-enforced server-side) | `SettingsView.vue:186-235,500-509`, `ConfirmDeleteModal.vue` | W | **Yes** (typed-confirm gated) |
| E8 | Create a school directly (group-attached, both join codes minted at birth) | govt_admin | Dashboard `DashboardView.vue:172-184,793-847`; also `/schools/all` `SchoolsView.vue:139-157`; THE VIEW admin-only `NodeActionBar.vue:588` (`!member` — leader's own path is the separate `/api/govt/create-school` lane, not this button) | W | No |
| E9 | Add a group (sub-region) under a node | govt_admin (member), ssi_admin | THE VIEW `NodeActionBar.vue:587,638-651` | W | No |
| E10 | Rename a node (group/school) via Structure verb bar | ssi_admin only (`!member`) | `NodeActionBar.vue:595,687-696` | W | No |
| E11 | Delete a node (group/school) via Structure verb bar | ssi_admin only (`!member`) | `NodeActionBar.vue:599,538-564`, `ConfirmDeleteModal.vue` | W | **Yes** |
| E12 | Mint / refresh a demo org | ssi_admin only (`!member`) | `NodeActionBar.vue:593,596,408-521` | W | No |
| E13 | Install the app (PWA) prompt | govt_admin (and general staff) | THE VIEW `YourAccount.vue:147` `data-walk="account-install"` | R (triggers browser install) | No |

## F. Admin-only (ssi_admin platform surface — outside the four target personas, listed for completeness since `/admin/schools/:id` read-views are how ssi_admin sees any school)

| # | Capability | Where | R/W |
|---|---|---|---|
| F1 | Read-view any school/class/group dashboard as admin (no impersonation) | `/admin/schools/:id`, `/admin/groups/:id`, `/admin/classes/:id`, `/admin/users/:learnerId/progress` — every write control above hides under `isAdminView` | R |
| F2 | Structure — the org tree (groups/schools/staff/entitlements at the node) | `/admin/structure` `AdminStructure.vue` | R/W |
| F3 | Platform analytics, users, attention, activity, courses | `/admin/analytics`, `/admin/users`, `/admin/attention`, `/admin/activity`, `/admin/courses` | R |
| F4 | Release notes curation | `/admin/release-notes` | W |
| F5 | Methodology papers/demos | `/admin/methodology` | R |
| F6 | Insight Engine discovery feed / stats boards / board report | `/admin/insights`, `/admin/stats`, `/admin/board` | R |

---

## UNCOVERED — ranked by how likely a school admin needs it in their first term

None of the 12 non-learner walks (see below) target the routes `teachers`, `students`, `classes`
(My Classes list), `settings`, `setup`, `schools-list`/`all`, `upgrade`, or the flat `dashboard` —
every walk's `place.route` is one of `node-home`, `node-insights`, `class-detail`, or `admin-invites`
(ssi_admin-only). That means the entire **legacy flat dashboard capability surface** (sections A1-A9,
B1-B3/B14-B16, C1-C2/C4, D1-D5/D8-D10, E1-E8) has **zero walk coverage** — the walks only teach THE
VIEW (`/org/:id`) and the Class Detail page. Ranked:

1. **Create your first class** (B1) — the very first productive action after signup; no walk.
2. **Set up your school** (C1, the 4-step wizard at `/schools/setup`) — the whole onboarding flow
   has no walk despite being the literal first-run path.
3. **Invite a teacher / bulk-manage staff from Teachers page** (A1-A5) — the legacy `TeachersView`
   has its own "Assign to a class" and "Access code" entry points (`teacher-assign-classes`,
   `teacher-signin-link` anchors exist in code) that no walk anchors — only the *Class Detail* side
   of the same feature (B12) is walked.
4. **Rename or delete a class** (B2, B3) — genuinely destructive/irreversible actions with no walk.
5. **Copy a class join link / invite students** (A7-A8) — partially covered indirectly by
   `run-class-session`, but the Students page's own "+ Invite students" redirect (A6) is unwalked.
6. **Edit school profile / delete the school** (E1, E7) — the Danger Zone has no walk despite being
   irreversible.
7. **Subscribe / manage seats** (C4-C7, all of UpgradeView) — no walk touches billing at all.
8. **Read the Students page filters and per-student drill-in** (D2, D7) — no walk.
9. **All-schools programme view for govt admin** (D8-D10, E3, E8-E9 on the legacy dashboard) — no
   walk; THE VIEW's node-home walks (`invite-first-person`, `ways-in`) partially substitute but
   never touch the school-creation or group-rename flows.
10. **Localisation / data-privacy settings** (E4-E5) — lowest priority; E5 is admittedly non-functional
    placeholders (no DB column), so not urgent to teach.

## COVERED capabilities (walk id in brackets)

- Hand a class over to another teacher — B11 [`hand-over-the-lead`]
- Invite a teacher who isn't here yet (co-teacher link) — B13, A7 [`invite-a-supply-teacher`]
- Bring your first person / teacher in (THE VIEW) — A11 [`invite-first-person`, `invite-first-teacher`]
- Move a teacher to another class (from Class Detail) — B12 [`move-a-teacher-between-classes`]
- Reading your insights — D6 [`reading-insights`]
- Run your first class session — A7, B5 [`run-class-session`]
- Set or change your password (THE VIEW) — A10 [`set-your-password`]
- Share a class with a colleague — B9 [`share-a-class`]
- Ways in — who can get in — A14 [`ways-in`]
- Install the app — E13 [`install-the-app`]
- The invites desk (ssi_admin platform) — A15 [`invites-desk`]

## Learner-persona walks (out of scope for this census, listed for completeness)

`choose-something-else-to-learn`, `go-back-over-something`, `reading-the-course-list`,
`save-your-progress`, `what-your-numbers-mean`, `where-you-are-in-this-course` — all target `library`
(`BrowseScreen.vue`/`CourseBrowser.vue`), the learner's own course-browsing screen, not the schools
dashboard.

## Drift — walks that reference something not found in current code

None found. Every anchor referenced by the 18 walk JSON files (`class-teachers`,
`class-teacher-make-lead`, `class-coteacher-link`, `class-join-link`, `class-join-code`,
`verb-invite-person`, `invite-form-role`, `invite-form-submit`, `ways-in-ledger`, `invites-mode-strip`,
`invites-org-who`, `invites-org-submit`, `invites-active-toggle`, `class-teacher-other-classes`,
`assign-classes-list`, `assign-classes-save`, `insights-measure`, `insights-window`,
`insights-compare`, `insights-overview`, `library-*`, `belt-browser-list`, `account-card`,
`account-install`, `account-password`, `ways-in-copy`, `ways-in-remint`, `ways-in-revoke`,
`verb-shareable-link`, `class-play`, `class-teacher-add`, `class-teacher-picker`) resolves to a live
`data-walk="…"` attribute in the current tree. No stale walk references were found.

---

## Sources read

`packages/player-vue/src/router/index.ts`; `views/schools/{DashboardView,TeachersView,StudentsView,
TeacherDashboard,ClassDetail,SettingsView,SetupView,SchoolsView,StudentProgressView,UpgradeView,
SchoolBillingPanel,classDetailPanels}.{vue,ts}`; `components/schools/{AssignClassesModal,
ClassCreatedModal,ConfirmDeleteModal,CreateClassModal,NodeEntitlementControl,
SchoolsPasswordPrompt}.vue`; `views/admin/{NodeHomeView,NodeInsightsView}.vue`;
`components/admin/{NodeActionBar,NodeBelowTree,NodeChildrenList,WaysInLedger,YourAccount}.vue`;
`insight/NodeRateEngine.vue`; `tools/walkthrough/walks/*.json` (all 18).
