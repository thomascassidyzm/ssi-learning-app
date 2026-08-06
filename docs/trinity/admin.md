# Admin + /methodology — Trinity Compliance Audit

> **Date**: 2026-07-17
> **Scope**: All screens under `/admin` and `/methodology` (24+ routes, ~130+ sub-states) — the biggest area in the Phase 2 campaign.
> **Trinity**: App→User (output) | User→App (input) | App→App (processing)
> **Method**: `AdminAccess.vue` and `AdminUserDetail.vue`/`SchoolsSetup.vue` (highest sub-state density) prioritised per brief. Produced by 8 parallel workers, one per file group; numbering restarts per group (see group header). A consolidated, cross-group **Findings Ledger** with global severity ranking is at the bottom.
> **Enforcement architecture (read this first — it governs every finding below):** admin access is NOT enforced per-page. There is one global router guard (`router/index.ts:~683-690`, `beforeEach` on any `/admin/*` or `/methodology/*` path) that defers rather than denies when the role cache is unresolved ("don't know ≠ no", by design — avoids bouncing a about-to-resolve admin). Routes nested as *children* of `AdminContainer.vue` get a SECOND, reactive gate on top: `isCheckingAccess` blocks render until role resolution completes, and a live `watch(isDenied, …)` bounces to `/` the instant resolution says non-admin — including, in principle, a downgrade that resolves while the page is open. Routes that are **standalone** (siblings of `/admin`'s children array, not inside it) get ONLY the global deferring guard, with no reactive re-check. This split is the single biggest source of findings across every group below.

---

## Doctrine addendum — server is the enforcement; the gate is UX (2026-07-19)

> **Founder challenge:** "the useAdminGate 60-second role poll — are we sure we need that?" **Answer after a full server-side audit: no.** The poll is removed. Security lives on the server, per request; a browser timer is UX, not enforcement.

**Server-side enforcement audit (2026-07-19) — every endpoint that reads or writes org/admin data was checked for per-request role/scope verification. Result: 0 gaps.**

| Endpoint group | Server-side enforcement (per request) |
|---|---|
| `api/admin/*` (codes, invites, grant/revoke-entitlement, create-school/staff/govt-admin, update-school, update-user-role, users, view-as, set-trial, board-metrics/snapshot, attention, onboarding-messages, demo-*) | `verifyAdmin` helper, or an inline `learners.platform_role==='ssi_admin' \|\| educational_role==='god'` check → 403. `codes`/`invites` additionally enforce "you can only toggle codes you created" for non-ssi callers. |
| `api/school/*` (roster, class-progress, daily-activity, rate-compare, class-practice-7d, group-summary, delete-class, rename-class, portal, remove-staff, subscription, update-profile, update-seats) | `resolveVisibleScope(verifiedAuthUid)` (teacher/school_admin/govt scope from the caller's own identity), or `admin_user_id`/`user_tag` school resolution → 403. Client can never request arbitrary learners/schools. |
| `api/groups/[id]/home` + `tree`/`table` (the read-view data source) | `resolveGroupTreeCaller` + `callerCanSeeGroup` — ssi_admin sees the forest; a group leader only their own subtree. |
| `api/groups/[id]`, `[id]/invites`, `[id]/demo-mint`, `index`, `govt/*`, `invite/create`, `entitlement/*` | `verifyAdmin`, inline `govt_admins`-row check, or own-user scope + `codeGuard`. Privileged code types have `expires_at`/`max_uses` server-bounded. |
| `api/entitlement/user`, `offline-lease`, `me/*`, `teacher/{me,classes,commissions,portal,…}` | Own-user scope (caller's verified `user_id`) or `actAsGuard`. |
| `NONE` guard by design | `access/claim` (own-user), `board/snapshot/[code]` + `teacher/by-code` (public by share-code), `teacher/{paddle,wise}-webhook` (RSA/HMAC signature-verified). |

**The four admin read-views the gate was originally built to protect are now server-enforced, not UI-gated:**
- `/admin/schools/:id`, `/admin/groups/:id`, `/admin/classes/:id` → `NodeHomeView`/`AdminClassHome` → **`GET /api/groups/:id/home`** (`callerCanSeeGroup`). The stale claim in the old gate header — "these read RLS-off org tables directly, so the UI gate IS the enforcement" — was true when written but was superseded by THE VIEW migration; those reads go through the server now.
- `/admin/users/:learnerId/progress` → `AdminUserProgress` → `learners` under **own-row RLS + admin-bypass** (server-side per request).

**Consequence for the poll:** a de-platformed `ssi_admin`'s every request 403s (or returns empty via RLS) the instant it's made — no client state can change that. So `useAdminGate`'s 60s `refreshRole()` interval + `visibilitychange` re-check bought **no** security; they were the last idle network chatter on admin surfaces (~1 request/min). Removed. The gate now re-validates the role **on navigation only** (each route change re-runs `auth.refreshRole()`); a mid-session downgrade is caught on the admin's next navigation or reload, and in the idle gap between, the server already 403s everything. Pinned by `noDashboardPolling.test.ts` (now covers `useAdminGate.ts`) and `useAdminGate.test.ts`.

**Residual (tracked separately, NOT a gate/poll issue):** the `/schools` dashboard composables (`useClassesData`, `useSchoolContext`, `useStudentsData`, `useTeachersData`, `useAnalyticsData`, `useCourseAccess`, `useSchoolData`) and one admin invite picker (`OrgInviteForm.vue`) still **read** the schools org tables directly from the browser. **Correction (verified 2026-08-06): those tables are no longer RLS-off** — `pg_class.relrowsecurity` is true with real policies on all six (`classes`, `schools`, `groups`, `govt_admins`, `invite_codes`, `entitlement_grants`); CLAUDE.md's org-table RLS pass has landed. The repoint-to-server-endpoints workstream itself is unaffected by that — it's still worth doing to shrink the policy surface and keep hierarchy authz in endpoints per the RLS doctrine — but it is no longer closing an RLS-off gap; it's tightening an already-RLS'd surface. Every privileged **write/mint** those forms trigger already goes through a server-enforced endpoint; the residual is org-structure *reads*, unaffected by the admin gate.

---

## Group 1: Access Codes (`AdminAccess.vue`) — `/admin/access`, child of `AdminContainer`

> Note: despite the "impersonation / sign-in-as" description in the task brief, this file is actually **Access Codes management** (invite codes, direct-entitlement codes, a per-person magic-link grant, and an email allowlist) — there is no impersonation UI here (that's `GodModePanel.vue`). Audited as it actually exists.

### Page shell — header, banners, load

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→App | `onMounted` → `fetchAll()` + `fetchAllowlist()` (`AdminAccess.vue:662-665`) |
| 2 | App→App | Default `inviteCodeType` to `'school_admin'` for govt (non-ssi) admins (`:355-357`) |
| 3 | App→App | Parallel fetch: `/api/groups`, `/api/admin/codes`, `courses` (Supabase), `/api/entitlement/list` (`:363-379`) |
| 4 | App→User | "Loading codes…" while `isLoading && allRows.length === 0` (`:1259-1261`) |
| 5 | App→User | Header: kicker/title/subtitle, `{{ totalCount }}` / `{{ activeCount }}` (`:671-690`) |
| 6 | App→User | Success banner on `successMessage` (`:693-701`) |
| 7 | App→User | Error banner on `error` (`:702-711`) |
| 8 | App→App | `/api/groups` failure: swallowed, `console.warn` only, no `error` set (`:381-388`) |
| 9 | App→App | `/api/admin/codes` failure: throws → outer catch sets `error` (`:390-393,410-412`) |
| 10 | App→App | Courses-query failure: swallowed, `console.warn` only (`:397-402`) |
| 11 | App→App | `/api/entitlement/list` failure: throws → outer catch sets `error` (`:404-407,410-412`) |

### Create-code panel — mode toggle + Invite-to-org form

| # | Direction | Message |
|---|-----------|---------|
| 12 | App→User | 2-3 mode tabs: "Invite to org" / "Direct access" / "Grant free access" (`v-if="isSsiAdmin"`) (`:718-749`) |
| 13 | User→App | Click a mode tab → `mode` ref set (`:724,734,745`) |
| 14 | App→App | Switching to `'grant'` clears `grantMintedLink` (`:745`) |
| 15 | App→User | Active tab highlighted (`:722-743`) |
| 16 | App→User | Role select (options gated by `isSsiAdmin`); Group select (optional); Org-name input (required) (`:757-781`) |
| 17-19 | User→App / App→App | Fill fields, submit → `createInviteCode()`; client validation: org name required else abort (`:426-429`) |
| 20 | App→App | `POST /api/invite/create` — server: fresh JWT verify + per-`code_type` role check; `grants_group_id` for `school_admin` is **server-derived** from caller's own `govt_admins.group_id`, client value ignored; privileged types (`ssi_admin`/`god`/`tester`) have `expires_at`/`max_uses` forcibly bounded (`api/invite/create.ts:31-195`) |
| 21 | App→User | Success: shareable link shown, form cleared, refetch. Failure: `error` set from server or generic (`:453-470`) |

### Grant free access (magic link), `isSsiAdmin`-only

| # | Direction | Message |
|---|-----------|---------|
| 22-25 | User→App / App→App | Email/name/note/access/duration/course-picker form → `createGrantCode()`; client validates email regex + course selection + duration≥1 (`:168-179`) |
| 26 | App→App | `POST /api/entitlement/create`, `max_uses:1` hard-locked client-side; server `verifyAdmin` + rate limit (30/15min, fails open) + validation (`api/entitlement/create.ts:37-189`) |
| 27 | App→User | Success: `InviteLinkField` renders the link + copy button; failure: `error` set (`:217-238`) |
| 28 | App→App | Clipboard-write failure inside `InviteLinkField` is swallowed silently — no feedback, `copied` never flips (`InviteLinkField.vue:17-25`) |

### Direct-access form

| # | Direction | Message |
|---|-----------|---------|
| 29-31 | User→App / App→App | Label/access/duration/course form → `createDirectCode()`; client validates label + courses + duration (`:477-488`) |
| 32 | App→App | `POST /api/entitlement/create` — **`max_uses`/`expires_at` stored with no numeric bound**, since `grants_platform_role` is never sent here so `boundPrivilegedCodeLimits` never fires (`api/entitlement/create.ts:145-157`) |
| 33 | App→User | Success/failure: same pattern as invite mode (`:517-541`) |

### Shared fields + Allowlist

| # | Direction | Message |
|---|-----------|---------|
| 34 | App→User | Expires date / Max-uses number inputs (`v-if="mode !== 'grant'"`) (`:1005-1017`) |
| 35 | App→App | `formMaxUses`/`formExpiresAt` shared across Invite/Direct modes, **not reset on tab switch** — only cleared after a successful submit (`:87-88,464-465,532-533`) |
| 36 | App→App | Allowlist fetch on mount: `/api/access/list-grants`; failure `console.warn` only, **no App→User signal at all** (`:263-279,662-665`) |
| 37 | App→User | Emails textarea, live "N valid email(s)" count via regex-filtered computed (`:1065-1081`) |
| 38-40 | User→App / App→App | Submit `grantEmails()`; client validates ≥1 valid email; `getAuthToken()` null → specific re-auth message, abort (`:284-294`); `POST /api/access/grant-emails` |

---

## Group 2: Admin User Detail (`AdminUserDetail.vue`) — `/admin/users/:learnerId`, child of `AdminContainer` — PRIORITY (highest sub-state density)

### Loading / breadcrumb / profile

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→App | On mount/focus/tab-visibility-change: `refreshDetail()` → `fetchUserDetail(learnerId)` (L313-327) |
| 2 | App→User | "Loading user detail…" while `isLoading` (L461) |
| 3 | App→User | Error banner on fetch failure (L451-458) |
| 4 | App→App | 5 parallel queries (profile/enrollments/sessions/entitlements/subscription) — profile/enroll/sessions errors throw+set `error`; entitlement+subscription errors **swallowed** (`console.warn` only) |
| 5 | App→User | Breadcrumb "Users / {display_name}" (L427-435) |
| 6-7 | User→App | Click "Users" → back; click "Learner dashboard" icon → `/admin/users/:learnerId/progress` |
| 8-10 | App→User / App→App | Profile card (avatar/name/emails/joined/dual-identity ids); role badges; emails via `/api/admin/users?ids=` (failure swallowed) |

### Role editor

| # | Direction | Message |
|---|-----------|---------|
| 11-12 | User→App | Select platform role / educational role → `updateUserRole()` |
| 13 | App→App | `POST /api/admin/update-user-role` — server `verifyAdmin()` + role allowlists + **self-demotion block (403)** |
| 14-15 | App→User | Success: green "Saved" pill (2s); Failure: red "Failed" pill (3s) — **no reason shown** (Finding F1) |

### Sign-in link rescue

| # | Direction | Message |
|---|-----------|---------|
| 16-20 | User→App / App→App / App→User | "Create sign-in link" → `POST /api/admin/create-signin-link` (`verifyAdmin`-gated) — **validated by `AdminUserDetail.signinLink.test.ts`**: asserts POST body, renders link + caveat text ("single-use, expires ~1hr, whoever clicks becomes {name}"); failure surfaces via top error banner |

### Activity hero / Entitlements

| # | Direction | Message |
|---|-----------|---------|
| 21-23 | App→User / App→App | Lifetime/7d/Today/Streak tiles + 30-day sparkline, derived client-side from `sessions` |
| 24-25 | App→User | Entitlements header + "Effective access" resolved-truth banner (FULL/PARTIAL/DEFAULT) |
| 26-31 | User→App / App→App | Grant form (access type/duration/courses) → `POST /api/admin/grant-entitlement`, gated `verifyAdmin`+`platform_role==='ssi_admin'`; success collapses form + refetches |
| 32 | App→User | **Grant failure is silent** — `grantLoading` clears, form stays open, nothing shown; only `console.error`'d (Finding F2 — MISSING TWIN, the exact "silent failure" class the brief names) |
| 33-36 | App→User / User→App | Entitlements table or empty state; revoke → `confirm()` → `POST /api/admin/revoke-entitlement` (gated); failure surfaces via top banner |

### Trial testing / Course progress / Diagnostics

| # | Direction | Message |
|---|-----------|---------|
| 37-43 | App→User / User→App / App→App | Trial skip/restore controls → `POST /api/admin/set-trial` (`verifyAdmin`-gated); failure surfaces via top banner |
| 44-48 | App→User / User→App | Active/dormant course-progress grid, toggle dormant list, empty states |
| 49-57 | User→App / App→User | Diagnostics (collapsed by default): recent activity, player events (click-to-expand payload), event-type digest, audio-plays-by-cycle, L1 cluster-fire timeline, listening-state tables, adaptive-pause mastery summary |

### Router / auth-guard check (explicit per brief)

| # | Direction | Message |
|---|-----------|---------|
| 58 | App→App | `beforeEach`: stale cache saying `isInitialized=true` + admin=true from localStorage lets navigation through **immediately, unchecked against a fresh DB read** — the guard trusts the cache's "yes" as much as a resolved "yes" |
| 59 | App→App | `AdminContainer`'s `knowsAnswer` gate closes the **empty-cache** gap (shows spinner) but not the **stale-true-cache** gap in #58 |
| 60 | App→App | `useAuth.ts` real DB fetch eventually corrects the cache; `AdminContainer`'s `watch(isDenied, …)` then re-fires and redirects if corrected role is non-admin — so the stale-true window is real but bounded to "until the real fetch resolves," not indefinite |

**Findings (this screen):**
- **F1 — Class 4.** Role-update failure shows generic "Failed" pill with no reason (self-demotion 403 vs bad-value 400 vs network error all look identical). `AdminUserDetail.vue:541-544`.
- **F2 — Class 3 (MISSING TWIN, silent failure).** Grant-entitlement failure has **zero App→User signal** — the brief's paywall-tap/metrics-write bug class, live here. `AdminUserDetail.vue:372-392`.
- **F3 — Class 5 (ORPHAN).** "No player events recorded." empty-state div is dead code — its parent section is already `v-if="playerEvents.length > 0"`, so the inner empty branch can never render. `AdminUserDetail.vue:895,900-901,940-942`.
- **F4 — Class 2 (UNVALIDATED).** Course-codes grant field splits on comma with zero format validation against real course codes before POST. `AdminUserDetail.vue:673`.

---

## Group 3: Platform Org Management (`SchoolsSetup.vue`) — `/admin/setup`, child of `AdminContainer` — PRIORITY (highest sub-state density)

Distinct from the school-level `/schools/setup` (`SetupView.vue`, already audited 2026-04-11). This is the ssi_admin-only cross-org tool: Groups / Schools / Staff / Entitlements tabs.

### Mount + banners

| # | Direction | Message |
|---|-----------|---------|
| 1-2 | App→App | `onMounted` fires `fetchSchools/fetchGroups/fetchCourses/fetchGrants/fetchStaff` in parallel. `fetchSchools` queries `schools` **directly, client-side — no server-side role check on this read path**, relies entirely on whatever gate let the component mount |
| 3-7 | App→App | `fetchAdminClaimedSchoolIds` via `user_tags` (own-row RLS live, so non-admin silently gets empty rows not an error); `fetchGroups`/`fetchGrants` via server endpoints (`verifyAdmin`-gated); `fetchCourses` direct (content table, permissive by design) |
| 8-10 | App→User | Animated success/error banners; header metrics strip (school/group/staff counts) |
| 11-13 | User→App / App→App | Groups/Schools/Staff/Entitlements tab switch — client-side only, no re-fetch |

### Groups tab

| # | Direction | Message |
|---|-----------|---------|
| 14-24 | User→App / App→App / App→User | Invite-a-group-leader form (name*/email/group/org*) → `POST /api/admin/create-govt-admin` (`verifyAdmin`-gated); client validates name+org required (email format **not** checked); success → invite-link chip + copy-to-clipboard w/ checkmark |
| 25-32 | User→App / App→App | Create-empty-group `<details>` form → `POST /api/groups` (`verifyAdmin`-gated); name required client-side |
| 33-53 | App→User / User→App / App→App | Group tree (3 levels deep, search-filtered), inline rename (Enter/blur save, Escape discard) → `PATCH /api/groups/:id` (`verifyAdmin`); map-pin → navigate to group dashboard; delete → impact-fetch (`GET /api/groups/:id`) → typed-name confirm if real activity exists, else plain `confirm()` → `DELETE /api/groups/:id` (`verifyAdmin`); empty states for no-groups / no-search-matches |

### Schools tab

| # | Direction | Message |
|---|-----------|---------|
| 54-61 | User→App / App→App | Add-school form (name*, group) → `POST /api/admin/create-school` (`verifyAdmin`-gated, server compensates/deletes row if either invite-code insert fails) |
| 62-77 | App→User / User→App / App→App | Schools table (search-filtered) with status pill (Awaiting admin / Claimed via `admin_user_id` OR claimed-`user_tags`), entitlement badge, inline group `<select>` → `PATCH /api/admin/update-school` (`verifyAdmin`) — **note: on success, local `group_id` is mutated optimistically without echoing the server's confirmed row** (minor, no rollback needed since mutation is post-`await`); teacher/admin invite-link copy; map-pin → school dashboard; shield icon → `editSchoolEntitlements()`, which **races**: `activeTab='entitlements'` switches immediately while the grants fetch is still an unawaited `.then()`, so the course picker can render with zero pre-checked courses for a beat before chips populate |

---

## Group 4: Admin User Screens (`AdminUsers.vue`, `AdminUserProgress.vue`, `AdminAttention.vue`)

### AdminUsers.vue — `/admin/users`, child of `AdminContainer`

| # | Direction | Message |
|---|-----------|---------|
| 1-6 | App→User | Header (total/new-this-week), search input, course filter, tier chips w/ counts, sort chips |
| 7-22 | User→App / App→App | Live search filter on keystroke; Enter/Esc/clear-button handling; course/tier/sort filters, each resets to page 1 |
| 23-24 | App→App | `GET /api/admin/users?page=1&limit=10000` — server `verifyAdmin()` (401/403 on non-admin) |
| 25-27 | App→User | Loading / error banner — **error banner and populated table/empty-state are NOT mutually exclusive** (v-else scoping issue, see Finding below) |
| 28-36 | App→User / User→App | Users table, row-click/eye-icon → navigate to detail; empty states (contextual copy); pagination |

### AdminUserProgress.vue — `/admin/users/:learnerId/progress`, **STANDALONE, NOT nested under `AdminContainer`**

| # | Direction | Message |
|---|-----------|---------|
| 37-39 | App→App | Route-param watch fires `loadContext(id)`; guards only on "**some** learner logged in" — **no role/admin check** — then a direct (non-`verifyAdmin`-gated) Supabase query as the caller's own JWT |
| 40-46 | App→User / App→App | Loading/error states; **if the target learner row lookup returns no row, fails silently** (`if (!learner) return`) — `currentUser` stays null, nothing throws, downstream `StudentProgressView` renders an indistinguishable-from-real "empty learner" shell (name "Learner", "—" school, "No courses yet") |
| 47-50 | App→App / App→User | `provide('isAdminView', true)`; teardown on unmount (`ctx.clear()`); reachable only via AdminUserDetail's button (not orphaned); uses schools `TopNav` chrome, not `AdminTopBar` |

### AdminAttention.vue — `/admin/attention`, child of `AdminContainer`

| # | Direction | Message |
|---|-----------|---------|
| 51-56 | App→User / App→App | Header (subscriber/urgent/watch counts); `GET /api/admin/attention` (`verifyAdmin`-gated); server thresholds (7d inactive / 3d ending-soon / 30min low-use) |
| 57-59 | App→User | **Same v-else scoping bug as AdminUsers**: on fetch failure, success-shaped content ("No one needs attention… All 0 subscribers are active and healthy") renders **simultaneously with** the error banner — actively misleading, not just cosmetic |
| 60-62 | User→App / App→User | Row click → navigate to user detail; "+N healthy not shown" note |

### Resolved-session gate check (all three, cross-cutting — the single most important finding in this whole audit)

- `AdminUsers`/`AdminAttention`: correctly gated by `AdminContainer`'s reactive `isDenied` watch.
- `AdminUserProgress`: **standalone, no admin check of any kind** — only the deferring global guard.
- **Mid-session role downgrade, ALL screens including the correctly-wrapped ones**: `useUserRole`'s `platformRole`/`educationalRole` are set **once** at sign-in via `initialize()` — there is no realtime subscription or periodic re-poll of the DB. `canAccessAdmin` is a pure computed off that stale ref, so `AdminContainer`'s `watch(isDenied)` **never re-fires on a revoke that happens mid-session** — a de-platformed `ssi_admin` keeps full admin UI rendered until their next hard reload/sign-out, regardless of which screen they're on.

---

## Group 5: Courses / Platform Analytics / Activity / Class Detail

### AdminCourses.vue — `/admin/courses`, child of `AdminContainer`

| # | Direction | Message |
|---|-----------|---------|
| 1-11 | App→App / App→User | `fetchCourses` (courses/enrollments/RPC practice-minutes/sessions/seed_progress) — all query errors thrown into outer catch, `error` set; KPI stones; sort control (Enrolment/Active/Name); course tiles; empty state |

### AdminAnalytics.vue — `/admin/analytics`, child of `AdminContainer`

| # | Direction | Message |
|---|-----------|---------|
| 12-16 | App→User / User→App / App→App | Pure tab-switch shell (Overview/Growth/Engagement/Retention/Friction) — no local fetch, no local access check, inherits `AdminContainer`'s gate. Sub-tab components out of this audit's file scope. |

### AdminActivity.vue — `/admin/activity`, child of `AdminContainer`

| # | Direction | Message |
|---|-----------|---------|
| 17-28 | App→App / App→User | `fetchActivity` (sessions last-24h `.limit(100)` + batch learner names) on mount + 60s auto-refresh, cleaned up `onUnmounted`; KPI strip, live-now panel, hourly timeline, empty state |

### AdminClassDetail.vue — `/admin/classes/:id`, **STANDALONE, NOT nested under `AdminContainer`**

| # | Direction | Message |
|---|-----------|---------|
| 29-36 | App→App / App→User | Route-param watch → `loadContext` queries `classes` for `school_id`, then `useSchoolContext.loadFromSchoolId` unconditionally sets `currentUser` to `school_admin` scope for that school — **no `useUserRole`/`canAccessAdmin` check anywhere in this file**; loading/error states; `provide('isAdminView', true)`; teardown on unmount |

**Findings (this group):**
- **F1 — Class 2 (UNVALIDATED), the resolved-session bug class named in the brief.** `/admin/classes/:id` is registered as a standalone route (sibling of, not child under, `/admin`'s `AdminContainer`) — it gets only the global deferring guard, no reactive re-check, and its own `loadContext`/`loadFromSchoolId` do zero role verification, trusting whatever `realLearner` object is passed. A fresh-cache visitor (or a mid-session downgrade) sees "Loading class…" then the real roster/report render with no bounce. `router/index.ts:~523-527` (standalone registration) vs `~322` (`AdminContainer` parent); `AdminClassDetail.vue` (whole file); `useSchoolContext.ts:329-355`.
- **F2 — Class 3 (MISSING TWIN).** `loadFromSchoolId`'s school lookup discards `error` from `.single()` — a failed/denied lookup still "succeeds" with `undefined` fields, no throw, no signal. `useSchoolContext.ts:340-355`.
- **F3 — Class 4 (UNSPECIFIED CONTENT).** Real DB/RLS errors on the class lookup collapse to the same generic "Class not found" as a genuinely nonexistent id — no way for the operator to distinguish permission failure from absence. `AdminClassDetail.vue:40-45`.
- **F4 — Class 3 (MISSING TWIN).** Practice-minutes RPC failure is `console.warn`-only; every course tile silently shows "Practice: 0m" indistinguishable from a genuine zero. `useAdminCourses.ts:87-89`.
- **F5 — Class 4 (UNSPECIFIED CONTENT).** Activity's 24h session query silently caps at 100 rows — all derived stats (sessions/learners/minutes/top-course/hourly) under-report on a busy day with no "more exist" signal. `useAdminActivity.ts:97-102`.
- **F6 — Class 5 (ORPHAN).** Analytics sub-tabs have no URL/query-param representation — unlinkable, unbookmarkable, always resets to Overview on reload. `AdminAnalytics.vue:9-18,45`.

---

## Group 6: Demo Schools / Onboarding / Release Notes / Stats / Try Links

### AdminDemoSchools.vue — `/admin/demo-schools`, child of `AdminContainer`

| # | Direction | Message |
|---|-----------|---------|
| 1-36 | App→User / User→App / App→App | Create-demo-org form (shape/course/advanced counts) → `POST /api/admin/demo-schools {action:'create'}` — server `verifyAdmin`, rate-limited (10/hr/admin), validates `orgShape`, audit-logs; course-fetch failure is `console.warn`-only, no user message; existing-orgs table with expand/collapse detail, show-expired toggle, overdue/stale styling; per-row actions Extend/Refresh/Expire/Purge, each a `POST` re-verified server-side (Purge specifically re-checks `status==='expired'` before hard-delete); Purge has a native `confirm()` warning it's irreversible; per-row busy state; action failures → error banner |

### AdminOnboardingView.vue — `/admin/onboarding`, child of `AdminContainer`

| # | Direction | Message |
|---|-----------|---------|
| 37-57 | App→User / User→App / App→App | "This is the live source" notice; `GET /api/admin/onboarding-messages`; message list with active/inactive toggle pill; editor panel (title/channel/subject/body/trigger/notes/active) with live markdown preview; Save → `POST {action:'update'}` (server validates channel enum, whitelists editable fields); **Active/Inactive toggle has no confirmation despite silently deactivating a live series message, and toggle failure has NO error surfaced at all** (`return`s silently) |

### AdminReleaseNotes.vue — `/admin/release-notes`, child of `AdminContainer`

| # | Direction | Message |
|---|-----------|---------|
| 58-83 | App→User / User→App / App→App | Form (Version*/Released/Headline/Bullets/Publish); **list + writes go DIRECTLY through the Supabase client — no server API at all**, gated only by RLS (`is_ssi_admin()`); client validates version+≥1 bullet before insert/update; Publish/Unpublish toggle has **no confirmation** despite immediately flipping learner-visible content, and **success has no feedback at all** (only failure shows a flash); Delete has a native `confirm()` |

### AdminStatsView.vue — `/admin/stats`, child of `AdminContainer`

| # | Direction | Message |
|---|-----------|---------|
| 84-89+ | App→User / User→App / App→App | Insight Engine board tab-strip (Lifecycle/Rate-compare/Course Scoreboard/Content Friction/Difficulty turns/Coverage/Health strip); tab click swaps `defineAsyncComponent`-loaded board, falls back to `boards[0]` if unresolved |

### AdminTryLinks.vue — not fully covered in this pass (file listed but truncated before detail; flagged for a follow-up pass if Tom wants it deepened)

**Findings (this group):**
- **G1 — Class 3 (MISSING TWIN, silent failure).** Onboarding message active/inactive toggle: failure path returns with **zero** App→User signal — the toggle visually reverts with no explanation, or worse, the admin can't tell if a "deactivate" silently failed and the message is still live. `AdminOnboardingView.vue:149-167` (esp. `:159`).
- **G2 — Class 2 (UNVALIDATED) / architectural inconsistency.** Release Notes reads and writes go straight through the Supabase client with no server endpoint, no request-shape validation beyond a client-side trim-check, unlike every other admin write surface in this audit which routes through a `verifyAdmin`-gated API. Gated only by RLS `is_ssi_admin()`. `AdminReleaseNotes.vue:70-86,109-122,133-145,147-161`.
- **G3 — Class 3 (MISSING TWIN).** Release Notes publish/unpublish: success has no confirmation at all (only failure flashes); this immediately changes what real learners see. `AdminReleaseNotes.vue:133-145`.
- **G4 — Class 4 (UNSPECIFIED CONTENT).** Demo-schools course-fetch failure is silent (`console.warn` only) — the create form's course dropdown just renders empty with no explanation. `AdminDemoSchools.vue:72-74`.

---

## Group 7: Methodology & Board surfaces

### AdminMethodology.vue — `/admin/methodology`, child of `AdminContainer`

| # | Direction | Message |
|---|-----------|---------|
| 1-4 | App→User / User→App / App→App | "Open discussions" header, 4 static paper cards, click → external `<a target="_blank">` to a static doc. **This is the fully-compliant reference shape for the resolved-session gate** — `AdminContainer`'s reactive `isDenied` watch covers it with no gap found. |

### BoardReportView.vue — `/admin/board`, child of `AdminContainer`

| # | Direction | Message |
|---|-----------|---------|
| 5-36 | App→User / App→App / User→App | Header + error/loading states; `fetchMetrics()` → `GET /api/admin/board-metrics` (server `verifyAdmin` before any DB read); authored markdown report with resolved `{{metric:...}}` tokens; appendix metric grid; "Freeze & share" — client-validates label non-empty, `POST /api/admin/board-snapshot {action:'freeze',...}`, server independently re-validates label/reportMonth/markdown AND re-resolves every metric token, 422s the **whole** freeze if any token is unresolvable ("complete or not exist"); snapshots table with share-link copy (clipboard + execCommand fallback) and revoke (`POST {action:'revoke'}`, server re-verifies + 404s missing rows) — **revoke has no failure feedback at all**, only `finally` clears the busy flag |

**This is the most defense-in-depth screen audited across the whole area** — client gate (`AdminContainer`) PLUS an independent, fresh `verifyAdmin()` on every single server call, so even a fully bypassed client gate fails closed.

### MethodologyView.vue — `/methodology`, child of `MethodologyContainer` (a **separate** container from `AdminContainer`)

| # | Direction | Message |
|---|-----------|---------|
| 37-43 | App→User / User→App / App→App | Header, primer card, grid of 6 explainer cards (live/placeholder status); live cards `RouterLink` through; placeholder cards use `:to="''"` + `tabindex="-1"` + `aria-disabled` — **intended inert but not actually inert for mouse clicks** (see Finding below) |

### EmpiricalBaselineView.vue — `/methodology/empirical-baseline`, child of `MethodologyContainer`

| # | Direction | Message |
|---|-----------|---------|
| 44-55 | App→App / App→User | On mount, `usePopulationHours()` queries `course_enrollments` (`.limit(50000)`) **directly off the Supabase client with no server endpoint and no explicit admin/role check in the composable itself**; loading/error/empty states; 4 stat tiles; SVG histogram with 30h/100h anchor lines; static explainer prose |

**Findings (this group):**
- **H1 — Class 4 (UNSPECIFIED / mis-specified interactive state).** Methodology "placeholder" cards use `:to="''"` + `aria-disabled`, but Vue Router does not itself block a click on an empty `to` — only keyboard-tab is actually prevented (`tabindex="-1"`); `aria-disabled` is advisory-only. Mouse users can click a "Planned" card and get an undesigned-for navigation outcome. `MethodologyView.vue:127-134`.
- **H2 — Class 2 (UNVALIDATED) / architectural inconsistency, resolved-session-adjacent.** `EmpiricalBaselineView`'s population-hours query has **no server-side admin check** of its own — unlike the two Board endpoints (`verifyAdmin` on every call), it relies solely on (a) the router guard at navigation time and (b) RLS on `course_enrollments` (own-row RLS live since 2026-06-10, per project memory) to cap blast radius to "the admin chart UI painted for a non-admin, with n=1 data" rather than a full population leak — but that's incidental protection from an unrelated RLS policy, not a designed admin check. `usePopulationHours.ts:83-96`.
- **H3 — Class 3 (MISSING TWIN, minor).** `MethodologyView` has no data fetch of its own but also no local gate — it leaks the *existence and titles* of methodology pages to an unresolved/non-admin session for the brief window before `MethodologyContainer` (if it mirrors `AdminContainer`'s pattern — not independently confirmed in this pass) corrects. Low severity: titles only, no learner data.

---

## Group 8: Admin/Group Read-View Containers (delta only — base screens already in `docs/schools-trinity-audit.md` Screens 2-8)

> `AdminSchoolsContainer.vue` and `AdminGroupContainer.vue` wrap the SAME `DashboardView`/`TeacherDashboard`/`ClassDetail`/`StudentsView`/`TeachersView`/`AnalyticsView`/`SchoolsView` components already audited for `/schools`. This section covers ONLY the admin-context wrapper delta for 9 routes: `admin-school-{dashboard,classes,class-detail,students,teachers,analytics}` and `admin-group-{dashboard,schools,analytics}`.

### AdminSchoolsContainer.vue delta

| # | Direction | Message |
|---|-----------|---------|
| D1-D4 | App→App | Route-id watch → `loadContext(id)`, guarded only on `id` + `auth.learner` both truthy (**not** admin-checked); `loadFromSchoolId` seeds `currentUser` with `educational_role:'school_admin'`, the REAL admin's own `user_id`/`learner_id` (attribution stays on the admin — not impersonation) |
| D5 | App→App | `provide('isAdminView', true)` — hides write controls (create class, invite teacher, remove student/teacher, settings) in every wrapped child view |
| D6-D7 | App→User | Render on success; `loadError` text on exception |
| D8 | App→App | Internal nav from wrapped children routed through `useSchoolsNav().schoolsLink()`, which prefixes `/admin/schools/:id/...` when `isAdminView`, keeping the admin inside the same school's scope |
| D9 | App→App | `onUnmounted → ctx.clear()` — scope can't leak into whatever mounts next |
| D10 | — | **NOT FOUND**: no breadcrumb, school-name badge, or "you are viewing X as admin" indicator anywhere — `AdminTopBar` shows only "Back to App" + static "SSi Admin" brand |
| D11 | — | **NOT FOUND**: no guard-bypass / stale-role-cache re-validation at the container level (see Finding below) |

### AdminGroupContainer.vue delta (structurally identical, mirrored 1:1)

| # | Direction | Message |
|---|-----------|---------|
| E1-E7 | App→App / App→User | Same pattern via `loadFromGroupId` (`educational_role:'govt_admin'`, `group_path`, `organization_name`); `schoolsLink()` for group scope only has real targets for `schools`/`analytics` — every other kind falls back to the group dashboard itself (no `/admin/groups/:id/classes` etc.) |
| E8-E9 | — | **NOT FOUND**: same breadcrumb gap (D10) and same guard-bypass gap (D11) |
| — | App→App | **Third context mechanism, confirmed by code reading only**: a govt_admin drilling into a school card from inside a group dashboard uses `selectSchoolToView()` (a separate `viewingSchool` layer) — but when an ssi_admin does this from `/admin/groups/:id`, `schoolsLink()`'s `params.schoolId` override does a full route nav into `/admin/schools/:schoolId`, re-running the entire D1/D9 teardown-reinit chain in the *other* container. Not run live. |

### AdminContainer.vue (the `/admin/*` proper baseline, for contrast)

| # | Direction | Message |
|---|-----------|---------|
| F1-F3 | App→App / App→User | `restoreFromCache()` hydrates synchronously; `knowsAnswer = isInitialized \|\| isResolved`; while unresolved OR denied, shows spinner only — router-view/nav withheld entirely |
| F4-F5 | App→App | **`watch(isDenied, …)` reactively bounces to `/` the instant resolution completes as non-admin — and this watch is genuinely reactive, not one-shot, so it also catches a same-session downgrade for anything nested under `AdminContainer`.** This is exactly the mechanism the two read-view containers are missing. |

**Findings (this group):**
- **I1 — Class 2 (UNVALIDATED), resolved-session bug class, most severe finding in this audit.** `/admin/schools/:id` and `/admin/groups/:id` are top-level routes, NOT children of `/admin` — they get only the global deferring `beforeEach`, and neither container calls `useUserRole()`/`useResolvedSession()` at all. Their only gate checks that *some* identity resolved, not that it's an *admin* identity. **Failure scenario**: a school_admin/teacher with a cold role cache deep-links to `/admin/schools/<other-school-id>`; the global guard defers (by design); the container loads and renders that OTHER school's real dashboard/roster/analytics because its gate never checks role. Once the role cache does resolve to non-admin, **nothing reacts** — there is no `isDenied` watch here — so the view stays rendered indefinitely. This is the identical protection `AdminContainer.vue` (F4/F5) already implements, structurally absent on these two containers despite sitting behind the same nominal `/admin/*` guard string. Confirmed by grep across `composables/`, `containers/`, `router/` — no `useUserRole`/`useResolvedSession`/`canAccessAdmin` reference in either file. `AdminSchoolsContainer.vue` (whole file), `AdminGroupContainer.vue` (whole file), contrast `AdminContainer.vue:26-35`.
- **I2 — Class 3 (MISSING TWIN).** `loadFromSchoolId`/`loadFromGroupId` discard the `error` half of their `.single()` lookups — an invalid/deleted/stale `:id` (e.g. a bookmark to a school deleted by the delete-cascade feature landed `2d090ab3`) produces no "not found" error anywhere; the admin instead sees ordinary empty-state UI ("No classes yet") indistinguishable from a genuinely empty real school. `useSchoolContext.ts:329-358,365-396`.
- **I3 — Class 4 (UNSPECIFIED CONTENT).** No breadcrumb or "viewing school/group X as admin" indicator anywhere in the read-view chrome — an admin navigating between several schools in a session has no on-screen confirmation of which org's live data they're currently looking at. `AdminTopBar.vue:23` + absence across both containers.

---

# Findings Ledger — ranked, all groups

Classes: **1** UNTYPED · **2** UNVALIDATED · **3** MISSING TWIN · **4** UNSPECIFIED CONTENT · **5** UNREACHABLE/ORPHAN.

## Critical — resolved-session bug class (brief's named priority)

1. **[Class 2] `/admin/schools/:id` and `/admin/groups/:id` read-view containers have NO admin-role check at all** — only "is some identity resolved," no reactive re-check on downgrade, unlike `AdminContainer` proper. Most severe finding in the audit; affects 9 routes. `AdminSchoolsContainer.vue`, `AdminGroupContainer.vue` (whole files) vs `AdminContainer.vue:26-35`. *(Group 8, I1)*
2. **[Class 2] Mid-session admin-role downgrade is never re-checked anywhere in the app** — `useUserRole` resolves once at sign-in with no realtime subscription or poll; `AdminContainer`'s reactive watch only catches the deferred-then-resolves-non-admin case, never a genuine live downgrade. A de-platformed ssi_admin keeps full access to every screen under `AdminContainer` until reload/sign-out. `useUserRole.ts` (`initialize()`, `canAccessAdmin` computed). *(Group 4, cross-cutting)*
3. **[Class 2] `/admin/classes/:id` (AdminClassDetail.vue) is a standalone route with zero role verification** — its own data-loading trusts whatever learner object it's handed. `router/index.ts:~523-527`; `AdminClassDetail.vue` whole file; `useSchoolContext.ts:329-355`. *(Group 5, F1)*
4. **[Class 2] `/admin/users/:learnerId/progress` (AdminUserProgress.vue) is standalone with no admin check** — only guards "a learner is logged in," not that they're an admin. `AdminUserProgress.vue:33-34,39-42`. *(Group 4)*

## High — silent failures (the paywall-tap / metrics-write class)

5. **[Class 3] Grant-entitlement failure on AdminUserDetail is completely silent** — no error banner, no pill, form just stays open. `AdminUserDetail.vue:372-392`. *(Group 2, F2)*
6. **[Class 3] Onboarding message active/inactive toggle failure is completely silent**, and the toggle itself has no confirmation despite live-deactivating a real message series. `AdminOnboardingView.vue:149-167`. *(Group 6, G1)*
7. **[Class 3] Release Notes publish/unpublish success has no confirmation at all** — it immediately flips real learner-visible content with only a failure flash, never a success one. `AdminReleaseNotes.vue:133-145`. *(Group 6, G3)*
8. **[Class 3] BoardReportView snapshot-revoke has no failure feedback.** `BoardReportView.vue:127-141`. *(Group 7)*
9. **[Class 3] `useSchoolContext`'s school/group lookups discard Supabase `error`** — invalid/deleted `:id` renders a plausible-looking empty org rather than a "not found" state, across both AdminClassDetail and the two read-view containers. `useSchoolContext.ts:340-355,376-396,417`. *(Groups 5 & 8, F2/I2)*

## Medium — architectural inconsistency / unvalidated inputs

10. **[Class 2] Release Notes reads and writes bypass the server-API pattern entirely**, going straight through the Supabase client (RLS-only gate) unlike every other admin write surface audited. `AdminReleaseNotes.vue:70-161`. *(Group 6, G2)*
11. **[Class 2] EmpiricalBaselineView's population-hours query has no server-side admin check**, relying only on router-guard timing + incidental RLS on `course_enrollments`. `usePopulationHours.ts:83-96`. *(Group 7, H2)*
12. **[Class 2] AdminUserDetail's grant-entitlement course-codes field has zero format validation** before POST. `AdminUserDetail.vue:673`. *(Group 2, F4)*
13. **[Class 4] Role-update failure on AdminUserDetail shows a generic "Failed" pill with no reason** (self-demotion 403 vs bad-value vs network error indistinguishable). `AdminUserDetail.vue:541-544`. *(Group 2, F1)*
14. **[Class 4] AdminUsers and AdminAttention render error banner + success-shaped content simultaneously** (`v-else` scoped to the wrong sibling) — AdminAttention specifically shows the misleading "All 0 subscribers are active and healthy" on a fetch failure. `AdminUsers.vue` (loading/error block), `AdminAttention.vue:49-79`. *(Group 4)*
15. **[Class 4] Activity's 24h session query silently caps at 100 rows** with no "more exist" signal, under-reporting every derived stat on a busy day. `useAdminActivity.ts:97-102`. *(Group 5, F5)*
16. **[Class 3] Practice-minutes RPC failure on AdminCourses is console-only** — every tile silently shows "0m" indistinguishable from a genuine zero. `useAdminCourses.ts:87-89`. *(Group 5, F4)*
17. **[Class 4] Real DB/RLS errors on AdminClassDetail's class lookup collapse to the same generic "Class not found" as a genuinely absent id.** `AdminClassDetail.vue:40-45`. *(Group 5, F3)*
18. **[Class 4] No breadcrumb or "viewing X as admin" indicator anywhere in the admin/group read-view chrome.** `AdminTopBar.vue:23`. *(Group 8, I3)*
19. **[Class 4] Methodology "placeholder" cards are not actually click-inert for mouse users** — `:to="''"` doesn't block a click, only `tabindex` blocks keyboard focus. `MethodologyView.vue:127-134`. *(Group 7, H1)*

## Low — cosmetic / minor

20. **[Class 5] Dead "No player events recorded." markup can never render** (parent already gates on events existing). `AdminUserDetail.vue:895,900-901,940-942`. *(Group 2, F3)*
21. **[Class 5] Analytics sub-tabs have no URL representation** — unlinkable, always resets to Overview on reload. `AdminAnalytics.vue:9-18,45`. *(Group 5, F6)*
22. **[Class 3] Various fetch failures are `console.warn`-only with zero App→User signal**: `/api/groups` in AdminAccess (`:381-388`), courses-query in AdminAccess (`:397-402`), allowlist fetch in AdminAccess (`:263-279`), demo-schools course fetch (`AdminDemoSchools.vue:72-74`), clipboard-write failure in `InviteLinkField.vue:17-25`.
23. **[Class 2] Shared Expires/Max-uses fields on AdminAccess are not reset on mode-tab switch**, only after a successful submit — minor stale-state carryover between Invite/Direct modes. `AdminAccess.vue:87-88,464-465,532-533`.
24. **[Class 2] Direct-access entitlement codes have no numeric bound on `max_uses`/`expires_at`** server-side (the privileged-code bounding function is only wired for the grant-mode path). `api/entitlement/create.ts:145-157`.

---

*Compiled from 8 parallel worker audits, 2026-07-17. Some individual worker outputs were truncated in transit (visible where a group's table ends mid-sentence) — the findings captured above are complete for what each worker returned; a small number of trailing sub-states (deepest tail of AdminAccess's allowlist flow, AdminSetup's entitlements-tab detail past the race noted, AdminTryLinks.vue in full) were not reached before truncation and would need a targeted follow-up pass if Tom wants full coverage there.*
