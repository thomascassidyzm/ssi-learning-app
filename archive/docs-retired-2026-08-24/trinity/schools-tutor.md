# Trinity P2 — Schools + Tutor Dashboard (20-screen audit)

> **Date**: 2026-07-17
> **Scope**: Full `/schools` namespace (11 screens previously audited 2026-04-11, now stale — all
> re-verified against current code below) + globals (TopNav, God Mode/act-as) + admin read-view
> family (`/admin/schools/:id`, `/admin/groups/:id`, `/admin/classes/:id`,
> `/admin/users/:learnerId/progress`) + the `/tutors` namespace (never previously audited).
> **Protocol**: `~/command-surface/trinity-campaign-brief.md` — APML Phase 7, Trinity messages
> (App→User / User→App / App→App), findings classed 1–5 (1 UNTYPED, 2 UNVALIDATED, 3 MISSING TWIN,
> 4 UNSPECIFIED CONTENT, 5 UNREACHABLE/ORPHAN).
> **Method**: dispatched to 5 parallel worker passes, each doing a full re-read of current source
> (not a patch of the old doc) and cross-checking `docs/audits/2026-07-13-bug-class-audit.md` so
> already-fixed bugs aren't re-flagged. Synthesized and ranked below; source files (unedited) follow
> in full as sections 2 onward.

## 1. Coverage map

| # | Screen | Route(s) | Status vs old audit | Section |
|---|---|---|---|---|
| 1 | Login (`SchoolsContainer.vue`) | `/schools` | Re-verified — grew substantially (platform gate, expired-trial wall) | §2 Screen 1 |
| 2 | Dashboard (`DashboardView.vue`) | `/schools` | Re-verified | §2 Screen 2 |
| 3 | Schools List (`SchoolsView.vue`) | `/schools/all` | Re-verified — reference-quality, no findings | §2 Screen 3 |
| 4 | Students (`StudentsView.vue`) | `/schools/students` | Re-verified — largely rewritten | §2 Screen 4 |
| 5 | Teachers (`TeachersView.vue`) | `/schools/teachers` | Re-verified — largely rewritten | §2 Screen 5 |
| 6 | Classes/Teacher Dashboard (`TeacherDashboard.vue`) | `/schools/classes` | Re-verified | §2 Screen 6 |
| 7 | Class Detail (`ClassDetail.vue`) | `/schools/classes/:id` | Re-verified | §3 Screen 7 |
| 8 | Analytics — **DRIFT: now `TeacherInsightsView.vue`**, not `AnalyticsView.vue` | `/schools/analytics` | Full new audit | §5 |
| 9 | Student Progress — **DRIFT: moved off `/schools` entirely** | `/admin/users/:learnerId/progress` (via `AdminUserProgress.vue`) | Full new audit at new location | §7 (govt-admin read-views) |
| 10 | Settings (`SettingsView.vue`) | `/schools/settings` | Re-verified — largely rewritten | §3 Screen 10 |
| 11 | Admin Setup — **SCOPE CORRECTION: old table documented the wrong file** | `/schools/setup` is `SetupView.vue` (self-serve wizard); the ssi_admin console the old table actually described is `views/admin/SchoolsSetup.vue` (out of this pass's scope) | Re-verified `SetupView.vue`; `SchoolsSetup.vue` flagged for follow-up | §3 Screen 11 |
| — | `/schools/play` (new, unaudited before) | `/schools/play` | New audit | §6 |
| — | `/schools/upgrade` (new, unaudited before) | `/schools/upgrade` | New audit | §6 |
| — | Global: Top Navigation | shared | Re-verified | §3 |
| — | Global: God Mode Panel — **file removed, replaced by `useActAs.ts`** | n/a | New audit — **feature currently has no UI entry point** | §3 |
| — | Admin read-view: `/admin/schools/:id/*` | new | New audit | §7 |
| — | Admin read-view: `/admin/groups/:id/*` | new | New audit | §7 |
| — | Admin read-view: `/admin/classes/:id` | new | New audit | §7 |
| — | `/tutors` namespace (6 screens: shell, dashboard, upgrade, onboarding door, play, `/with/:code`) | `/tutors`, `/tutors/dashboard/*` | Never audited before — full new tables | §4 |

**Screen count**: 20 (11 re-verified originals + 2 drift-relocated + 2 newly-discovered `/schools`
routes + 2 globals + 3 admin read-view families [counted as one coverage unit each in the table
above, four route families total including the drift-relocated Student Progress] + 6 `/tutors`
screens), matching the brief's 20-screen scope.

## 2. Master finding ledger (ranked, all sections)

Every finding below is confirmed by reading the actual current source (file:line cited in its full
writeup in the section indicated) — none are speculative. Ranked by user-visible severity ×
likelihood across the whole area, worst first.

| Rank | Finding | Class | File:line | Section |
|---|---|---|---|---|
| 1 | Tutor login sells "start earning by running classes" but a first-time signer-in via this screen (not `/tutors` onboarding) is silently bounced back to `/tutors` on a 404 from `/api/teacher/me` — zero App→User message. Broken money-funnel entry. | 3/4 | `TeachContainer.vue:163-166`, `TeachDashboard.vue:232-235` | §4 Screen 1 Finding 1 |
| 2 | God Mode / act-as is completely unreachable — `useActAs().actAs()` has zero callers anywhere in the codebase; no UI button exists to step into a persona. The 2026-04-11-documented capability does not exist in the live app. | 5 | `useActAs.ts:43-49` | §3 Global: God Mode |
| 3 | `ClassDetail.vue`'s rename-class control is not gated by `isAdminView`, unlike the adjacent Remove-student control — an ssi_admin in a read-only cross-tenant view (`/admin/classes/:id` or nested under `/admin/schools/:id`) can fire a real write against another school's class name. Same bug shape as the already-fixed critical finding #1 in the 07-13 bug-class audit, reintroduced by a later, unaudited change. Confirmed independently from both the view side (§3) and the container side (§7). | 4 | `ClassDetail.vue:311-319` | §3 Screen 7 Finding 3; §7 Finding C |
| 4 | Govt-admin group read-view's "Create school" (and two adjacent first-run "save name" controls) are NOT gated by `isAdminView`, unlike every other write control across all four admin read-view families — a live, server-reachable `POST /api/govt/create-school` from inside a supposedly read-only view. | 2 | `SchoolsView.vue:235`, `DashboardView.vue:611,562,587` | §7 Route family 2, Finding 1 |
| 5 | Play-as-class silently refuses to launch on Dashboard and Classes screens — a teacher clicks "▶ Play" and nothing happens with zero feedback, on a code path whose own comments cite a real prior incident (phantom `cym_for_eng_north` course code, 2026-07-16). Same root cause also affects Class Detail and the standalone `/schools/play` route ("Learn" mid-session doesn't exit the class session — see #6). | 3 | `usePlayAsClass.ts:70-101`, `DashboardView.vue:265-270`, `TeacherDashboard.vue:287-289`, `ClassDetail.vue:244-246` | §2 Screens 2/6; §3 Screen 7 Finding 2 |
| 6 | On `/schools/play`, clicking the always-visible "Learn" pill mid-class-session does not remount the player (same route, query-only change) — the player silently keeps running the CLASS's identity/session/cursor under a URL that now reads as personal practice. Enabled by finding #7 (the only cleanup function on this screen is dead code). | 1 | `SchoolsTopBar.vue:166-176`, `PlayerContainer.vue:392-409` | §6 `/schools/play` Finding F2 |
| 7 | `handleExit`/`clearClassContext` — the one function that both ends belt-session state and clears class context on exit — is dead code: not bound to any template control, not exposed, unreachable from any real user action on `/schools/play`. Root cause of #6. | 5 | `LearningPlayer.vue:10304-10318`, `PlayerContainer.vue:412-433` | §6 `/schools/play` Finding F3 |
| 8 | Read-fetch failures are invisible on 4 of 6 core screens (Dashboard, Students, Teachers, Classes) — every composable correctly sets an `error` ref, but only Screen 3 (SchoolsView) displays it. Same shape as the already-fixed write-side "False-Saved" cluster from the 07-13 audit, just unfixed on the read side. One shared fix pattern, four call sites. | 3 | `DashboardView.vue:24-45`, `StudentsView.vue:17`, `TeachersView.vue:12`, `TeacherDashboard.vue:24` (contrast: `SchoolsView.vue:242-245`, the correct pattern) | §2 cross-screen finding |
| 9 | School-lane subscribe on `/schools/upgrade` sets `checkoutOpen=true` BEFORE `startSchoolCheckout()`'s own validation — a validation failure (missing price id, expired session) leaves the page permanently dead (no button, no retry) short of a full reload. The tutor lane in the same file correctly validates first. | 3 | `UpgradeView.vue:181-187` vs `:292-323,349` | §6 Upgrade Finding 1 |
| 10 | School-lane `isSubscribed` check ignores `school_past_due` (unlike the tutor lane, hardened after a documented double-bill incident) — a school with a declined card sees "Subscribe your school" again and can open a second concurrent Paddle subscription. | 3 | `UpgradeView.vue:130-132` vs `api/school/subscription.ts:161-168,227` | §6 Upgrade Finding 2 |
| 11 | Class capacity (`is_full`/seats) on the tutor student-signup link (`/with/:code`) is checked once at page load; the Paddle webhook's join branch has no server-side capacity re-check at all. Two concurrent joiners can oversell a class past its 20-student cap. | 2 | `WithTeacher.vue:501-503,522`, `api/teacher/paddle-webhook.ts:370-964` (no capacity check found) | §4 Screen 6 Finding 11 |
| 12 | `/admin/users/does-not-exist/progress` silently renders a fully-populated-looking EMPTY progress page (0 streak, "No courses yet", greeting "Demat, there.") instead of any error/404 — worst of three instances of the same silent-degrade pattern across the admin read-view family. | 3 | `AdminUserProgress.vue:31-49`, `useSchoolContext.ts:403-429`, `StudentProgressView.vue` fetch guard | §7 Route family 4, Finding 4 |
| 13 | Invalid `:id` on `/admin/schools/:id` and `/admin/groups/:id` silently degrades to a dashboard/labels with blank/`undefined` fields rather than showing the (already-built) error UI — the `.single()` query error is destructured and discarded. Only `/admin/classes/:id` gets this right. | 5 | `useSchoolContext.ts:340-358` (schools), `:365-396` (groups) | §7 Route families 1/2, Findings 2/3 |
| 14 | No success confirmation or webhook-activation-lag handling after school OR tutor checkout on `/schools/upgrade` — unlike the consumer/learner lane, which explicitly polls for exactly this. A school admin who just paid can see nothing different from before paying and reasonably conclude the payment failed. | 3/4 | `useSchoolCheckout.ts:108`, `SettingsView.vue` (no `just_subscribed` handling), `UpgradeView.vue:344` | §6 Upgrade Findings 3, 4 |
| 15 | Govt-admin "confirm your school's name" first-run card is dead code (gated `isSchoolAdmin`, rendered only inside the mutually-exclusive `isGovtAdmin` branch); school admins — who actually need it — have no equivalent card anywhere on Dashboard. | 5 | `DashboardView.vue:84-86,587-608,404-542` | §2 Screen 2 Finding |
| 16 | Deep-link preview note on `/schools/analytics` ("Opened in learner view… seeded preview") renders unconditionally in real mode even though the underlying scope switch is demo-gated — a teacher clicking "View →" on a real student sees a note that misdescribes the real class-level data actually shown. | 4 | `TeacherInsightsView.vue:229` vs `:406-410` | §5 Finding 1 |
| 17 | Silent no-op on missing/expired auth token during `/schools/analytics`'s real-mode fetch — a teacher with real classes sees "No classes yet" (identical to genuinely having none), no retry, no re-login prompt. | 3 | `TeacherInsightsView.vue:334-336` | §5 Finding 2 (worst in that section) |
| 18 | `TeacherInsightsView.vue`'s `useClassesData`/`useSchoolData` fetch errors never surfaced — same read-side-silent-failure shape as finding #8, on the analytics screen. | 3 | `TeacherInsightsView.vue:92,94` | §5 Finding 3 |
| 19 | Settings' four Data & Privacy toggles present as live settings (styled on/off, immediate visual flip) but are pure client-side decoration with zero persistence — a school admin toggling one off has no way to know it did nothing. Same "false-Saved" shape as the already-fixed 07-13 cluster, never wired here. | 1/3 | `SettingsView.vue:51-76,255-258` | §3 Screen 10 Finding 3 |
| 20 | Settings' hardcoded "Type" field shows the identical literal string ("Bilingual immersion · primary + lower secondary") for every school regardless of actual type — renders as real, specific content, not a placeholder. | 4 | `SettingsView.vue:288` | §3 Screen 10 Finding 2 |
| 21 | `saveSchoolProfile()` only sends `school_name` to the server — city/region/contact-email/about edits are silently dropped even though the shared "Saved" confirmation implies all fields persisted. | 4 | `SettingsView.vue:190` | §3 Screen 10 Finding 4 |
| 22 | Settings "Cancel" button has no `@click` handler at all — still open, confirmed live (matches 07-13 audit finding #11, never actually fixed in this file). | 2 | `SettingsView.vue:314` | §3 Screen 10 Finding 1 |
| 23 | `ClassDetail.vue`'s remove-student failure produces zero user feedback — still open, confirmed live (matches 07-13 audit finding #5, flagged as a one-liner but not actually fixed). | 5 | `ClassDetail.vue:265-276` | §3 Screen 7 Finding 1 |
| 24 | `SetupView.vue` step 3 (course selection) never seeds from `schools.trial_course_code`, already written at signup — still open, confirmed live (matches 07-13 audit finding #6). | 4 | `SetupView.vue:145` | §3 Screen 11 Finding 1 |
| 25 | Onboarding's tutor-track 409 ("trial already used") escape button reads "Go to your school dashboard" regardless of track — a solo tutor, never asked about a school, sees copy that doesn't match their signup. | 4 | `Onboarding.vue:962` | §4 Screen 4 Finding 7 |
| 26 | Login's "Not signed in" join-code error is a dead end — no sign-in link, no reload prompt, only the unrelated "Sign out" button remains as an escape hatch. | 4 | `SchoolsContainer.vue:225-229` | §2 Screen 1 Finding |
| 27 | "No teachers match" empty-row copy references a search box that no longer exists on the Teachers screen (removed in a rewrite, the filtering machinery and empty-state string were left behind) — currently unreachable but dead/orphaned UI. | 2 | `TeachersView.vue:23,52-56,223-226` | §2 Screen 5 Finding |
| 28 | `MAX_CLASSES`/`MAX_STUDENTS_PER_CLASS` on the tutor dashboard are UI-only constants never re-checked server-side beyond blocking the button — unverified whether `api/teacher/classes.ts` enforces the cap. | 2 | `TeachDashboard.vue:486-519` | §4 Screen 2 Finding 4 |
| 29 | No cancel/back control once the inline Paddle checkout is open on `/schools/upgrade` in either lane — an admin who wants to change seat count or billing period mid-checkout must reload the page. | 5 | `UpgradeView.vue:531` (no sibling control), `:419-467,470-525` | §6 Upgrade Finding 5 |
| 30 | `updateSeats()` doesn't branch on the server's `requires_checkout` signal — low severity today (gated behind `isSubscribed`) but a dead-end error text with no actionable button if that gate is ever stale. | 2 | `UpgradeView.vue:190-211` vs `api/school/update-seats.ts:126-132` | §6 Upgrade Finding 6 |

Remaining lower-severity/narrow findings (search-box copy leftovers, clipboard-fallback gaps, stale
"admin tab" claims in old docs, sign-out-failure reload masking, hardcoded literal route paths
instead of named routes, `weekStart`/`showFlags` fields that silently never persist, OTP-success
gaps, minor `demoMode` note edge cases) are catalogued in full in their source sections below —
omitted from the top-30 ledger for brevity but not dropped from the record.

## 3. Corrections applied to `docs/schools-trinity-audit.md`

Both drifts named in the task brief are confirmed and corrected in that file directly (see the
commit): Screen 8 now points to `TeacherInsightsView.vue`'s real table (§5 below); Screen 9 now
points to `StudentProgressView.vue`'s new home under `/admin/users/:learnerId/progress` (§7 below).
A third drift was found and corrected in the same pass: the old Screen 11 table documented
`views/admin/SchoolsSetup.vue` (the ssi_admin org console) under the heading of `SetupView.vue`
(a completely different self-serve onboarding wizard) — see §3 Screen 11 below for the full
scope-correction note; `SchoolsSetup.vue` itself is flagged for a follow-up audit pass, out of this
task's scope.

---

# Section 2 — Screens 1–6 (re-verified against current code)

<!-- BEGIN verify-screens-1-6-partial.md -->
# Trinity Compliance — Re-verification, Screens 1–6 (partial)

> **Date:** 2026-07-17
> **Supersedes for these six screens:** `docs/schools-trinity-audit.md` (dated 2026-04-11 — stale; all six files below have
> roughly doubled in size since, and several are now materially different components).
> **Method:** full re-read of current source for each file, against the Phase 7 protocol in
> `~/command-surface/trinity-campaign-brief.md` (Session 1 App→User / Session 2 User→App / Session 3 App→App), cross-checked
> against `docs/audits/2026-07-13-bug-class-audit.md` so already-fixed bugs are not re-flagged.
> **Scope:** Screens 1–6 only (Login, Dashboard, Schools List, Students, Teachers, Classes/Teacher Dashboard). Screens 7–11 +
> globals are untouched by this pass — still governed by the 2026-04-11 doc until separately re-verified.

---

## Screen 1: Login (`containers/SchoolsContainer.vue`)

The 2026-04-11 table only covered the email/OTP/no-access steps. Current file (928 lines, was ~half that) adds a platform
subscription gate, a tutor-misroute redirect, an auth/role-race loading state, and an expired-trial paywall screen — none of
which existed in the old doc.

### State gating (which pane renders)

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→App | Compute `showLogin` / `showNoAccess` / `showDashboard` / `showExpired` / `isRoleLoading` from `auth`, `useUserRole`, and `ctx` (`SchoolsContainer.vue:72-102`) |
| 2 | App→User | Show spinner "Loading..." while `isAuthLoading \|\| isRoleLoading` (`:294-297`) |
| 3 | App→App | `isRoleLoading` gates on `isRoleInitialized` specifically so a cold auth-resolved-but-roles-still-loading window can't be misread as "no access" (`:85-94`, comment documents the race explicitly) |
| 4 | App→App | Compute `isTutorNoSchool` (teacher/tutor role signal with no `school_id`) and, if `showNoAccess && isTutorNoSchool`, `router.replace('/tutors/dashboard')` (`:104-132`) |
| 5 | App→App | Compute `platformActive`/`platformBypass` — ssi_admin, act-as, and unauthenticated sessions bypass; only a real expired school/tutor is blocked. Fails OPEN (defaults true) for legacy rows / pre-migration DBs (`:63-70`) |

### Email step

| # | Direction | Message |
|---|-----------|---------|
| 6 | App→User | Display email input, placeholder "you@school.edu" (`:349-358`) |
| 7 | App→User | Display "Send me a code →" button, disabled until `isEmailValid && !isLoginLoading` (`:360-366`) |
| 8 | App→User | Display error banner (`role="alert"`) if `loginError` set (`:345-347`) |
| 9 | User→App | Type email |
| 10 | App→App | Validate email via regex → `isEmailValid` computed (`:54-56`) |
| 11 | User→App | Submit (click / Enter) → `handleSendOtp` |
| 12 | App→App | Call `supabase.auth.signInWithOtp({ email })` (`:140-142`) |
| 13 | App→User | Button label flips to "Sending…" while loading |
| 14 | App→User | On success: transition to OTP step (`:147`) |
| 15 | App→User | On failure: `loginError.value = error.message \|\| 'Unable to send code'` (`:144`) |

### OTP step

| # | Direction | Message |
|---|-----------|---------|
| 16 | App→User | Display 6-digit OTP input, centred/monospace (`:384-397`) |
| 17 | App→User | Display "Verify and sign in →" button, disabled until 6 digits (`:399-405`) |
| 18 | App→User | Display "Resend code" and "Use a different email" secondary actions (`:407-419`) |
| 19 | User→App | Type OTP |
| 20 | App→App | Enable/disable Verify via `loginOtp.length < 6` |
| 21 | User→App | Submit → `handleVerifyOtp` |
| 22 | App→App | Call `supabase.auth.verifyOtp({ email, token, type: 'email' })` (`:161-165`) |
| 23 | App→User | On success: no explicit UI transition here — relies on `useAuth`'s `onAuthStateChange` → `useUserRole().initialize()` → reactive `showDashboard` (comment at `:170-172` documents this is deliberate, not a bug) |
| 24 | App→User | On failure: `loginError.value = error.message \|\| 'Invalid code'` (`:167`) |
| 25 | User→App | Click "Resend code" → re-runs `handleSendOtp` (`:412`) |
| 26 | User→App | Click "Use a different email" → `handleBackToEmail`: reset to email step, clear OTP + error (`:180-184`) |

### No Access screen

| # | Direction | Message |
|---|-----------|---------|
| 27 | App→User | Display "You're signed in, but…" + authed email + join-code input (`:428-452`) |
| 28 | User→App | Type join code |
| 29 | User→App | Submit → `handleRedeemCode` |
| 30 | App→App | POST `/api/code/validate` (`:212-217`) |
| 31 | App→User | On invalid code: `joinCodeError.value = validateData.error \|\| 'Invalid code'` (`:220`) |
| 32 | App→App | Get session token via `supabase.auth.getSession()` (`:225`) |
| 33 | App→User | On no session: `joinCodeError.value = 'Not signed in'` (`:227`) — dead-end copy, see Finding 4 |
| 34 | App→App | POST `/api/code/redeem` with bearer token (`:232-242`) |
| 35 | App→User | On redeem failure: `joinCodeError.value = redeemData.error \|\| 'Failed to redeem code'` (`:246`) |
| 36 | App→User | On success: "Code redeemed! Loading dashboard..." (`:250`) |
| 37 | App→App | `setTimeout(() => window.location.reload(), 500)` (`:252`) |
| 38 | User→App | Click "I'm setting up a new school →" → `/schools1` (`:464-466`, verified real route at `router/index.ts:285`) |
| 39 | User→App | Click "I'm a tutor — go to my dashboard →" → `/tutors/dashboard` (`:467-469`) |
| 40 | User→App | Click "Just here to learn →" → `/` (`:470-472`) |
| 41 | User→App | Click "Not your account? Sign out" → `handleSignOut`: sign out then hard-navigate to `/schools` (`:195-202`) |

### Expired / past-due (new since 2026-04-11 — not in the old doc at all)

| # | Direction | Message |
|---|-----------|---------|
| 42 | App→User | If `showExpired`: full-page "Your free trial has ended" card + embedded `<UpgradeView />` (`:482-493`) |
| 43 | App→User | If authenticated + dashboard shown + `ctx.platformPastDue`: persistent dunning banner "There's a problem with your school's payment…" linking to `/schools/upgrade` (`:503-506`) |

### Findings — Screen 1

- **[Class 4 — MISSING TWIN] "Not signed in" join-code error is a dead end, not a recovery path.**
  `SchoolsContainer.vue:225-229` — if `getSession()` returns no token (session expired mid-flow), the user sees "Not signed
  in" but the form stays exactly as-is: no sign-in link, no reload prompt, no escape hatch other than the unrelated
  "Sign out" button at the bottom of the same form. A user who just typed a join code has no obvious next action.
  *Not in the 07-13 audit* (that audit covers write-grant/silent-catch classes, not this dead-end copy).

- **[Class 5 — ORPHAN] OTP success has no dedicated App→User message.**
  `handleVerifyOtp` (`:155-178`) shows nothing on success — it relies entirely on an external auth-state listener + a
  reactive computed to eventually swap the pane. This is *documented as deliberate* in the code comment, and the loading
  spinner (`isAuthLoading`) covers the visible gap in the normal case — but if `useUserRole().initialize()` is slow or
  fails silently, the user is left on the OTP form with the Verify button re-enabled and no "Verifying…"/success state
  to explain why nothing happened. Low severity (the general auth-loading spinner usually catches this window) but worth
  naming since it's a genuine App→User gap, not a false read.

---

## Screen 2: Dashboard (`views/schools/DashboardView.vue`)

Grew from ~90 lines of table to 1143 lines total. Structurally the three views (Teacher/School Admin/Govt Admin) are the
same shape as 2026-04-11, but content is materially different: density modes, first-run cards, admin-view read-only gating,
and `usePlayAsClass` all postdate the old doc.

### Shared / cross-cutting

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Show govt drill-down breadcrumb (`group ← · school`) when `isViewingSchool` (`:276-283`) |
| 2 | User→App | Click breadcrumb back arrow → `clearViewingSchool()` (`:277`) |
| 3 | App→App | `fetchSchools()` / `fetchClasses()` / `fetchSchoolLinks()` on `currentUser` watch (`immediate: true`) (`:155-164`) |
| 4 | App→App | Separate `viewingSchool` watch (`immediate: true`) re-fetches classes for govt drill-down — the comment at `:166-179` explains why this is a second watch, not a duplicate of #3, and why a prior `onMounted` duplicate was removed (`:181-186`) |

### Teacher view

| # | Direction | Message |
|---|-----------|---------|
| 5 | App→User | Greeting with name, class-count summary line, today's date (`:289-298`) |
| 6 | App→User | "+ Create class" action — hidden under `isAdminView` (`:296`) |
| 7 | App→User | Stat strip: Students / Hours practised / Sessions / Classes (`:300-317`) |
| 8 | App→User | Compact-density table OR detailed card grid, gated on `density === 'compact'` (`:320-398`) |
| 9 | App→User | Per-class benchmark (`Bench` component) — silently absent (`—`) if the report hasn't loaded, no loading indicator of its own (`:342`, `:380-383`) |
| 10 | App→User | Loading empty state "Loading your classes…" while `classesLoading && !teacherClasses.length` (`:351-353`, `:391-393`) |
| 11 | App→User | Empty state "No classes yet" + create-class CTA (hidden under admin view) (`:354-357`, `:394-397`) |
| 12 | User→App | Click class name/row → `router-link` to `schoolsLink('class-detail', {classId})` (`:333`, `:369`) |
| 13 | User→App | Click "▶ Play" / "▶ Play as class" — gated on `canPlayAsClass` (`:347`, `:387`) |
| 14 | App→App | `handlePlayClass(cls)` → `launchClassSession(cls)` (`:265-270`) — **return value discarded, see Finding 1** |

### School Admin view

| # | Direction | Message |
|---|-----------|---------|
| 15 | App→User | Greeting + admin stats summary line (`:405-417`) |
| 16 | App→User | "+ Invite teacher" / "School settings" actions — hidden under admin view (`:412-416`) |
| 17 | App→User | First-run setup banner (only when `currentSchool` loaded, zero classes AND zero students, not admin view) linking to `/schools/setup` (`:423-436`) |
| 18 | App→User | 5-stat strip: Students / Teachers / Classes / Hours / Your classes (`:438-459`) |
| 19 | App→User | Classes table with course/students/avg practice + Play column gated on `canPlayAsClass` (`:461-519`) |
| 20 | App→User | Quick-links panel (Students / Teachers / Analytics), routed via `schoolsLink()` so it resolves correctly under admin read-view (`:521-540`) |
| 21 | User→App | Click "View all →" on Classes card → `schoolsLink('classes')` (`:470`) |
| 22 | User→App | Click "+ Create class" → `/schools/classes?create=1`, hidden under admin view (`:466-469`) |

### Govt Admin view

| # | Direction | Message |
|---|-----------|---------|
| 23 | App→User | Greeting: school/group name + summary line (schools count or drill-down stats) (`:548-559`) |
| 24 | App→User | "Full schools list →" action via `schoolsLink('schools-list')` (`:557`) |
| 25 | App→User | First-run "Name your group" card, gated `isGovtAdmin && !isViewingSchool && groupSummary.name_confirmed === false` (`:562-583`) |
| 26 | User→App | Type group name, click Save (or Enter) → `saveGroupName()` (`:568-577`) |
| 27 | App→App | Call `renameGroup(groupId, name)`; on success `fetchSchools()`; on failure `groupNameError = 'Could not save — try again.'` (`:62-75`) |
| 28 | App→User | First-run "Confirm your school's name" card, gated `isSchoolAdmin && currentSchool.name_confirmed === false` (`:587-608`) — note: this card is gated on `isSchoolAdmin`, rendered inside the `isGovtAdmin` template branch; since the two roles are mutually exclusive per the outer `v-if/else-if` chain (`:288/404/547`) this card is structurally unreachable — see Finding 2 |
| 29 | User→App | Type school name, click Save → `saveSchoolName()` (`:92-101`) |
| 30 | App→App | Call `confirmSchoolName(schoolId, name)`; on failure `schoolNameError = 'Could not save — try again.'` |
| 31 | App→User | "Schools in your group" card: create-school inline form + generated admin/teacher invite links + copy buttons (`:611-659`) |
| 32 | User→App | Type school name, click "Create school" → `handleCreateSchool()` (`:126-138`) |
| 33 | App→App | Call `createSchoolInMyGroup(name)`; on success, refetch schools + links (`:136`) |
| 34 | App→User | Show generated `InviteLinkField`s for admin/teacher join codes (`:627-630`) |
| 35 | User→App | Click "Copy link" on a legacy pending link → `copyLink(id, code)` (`:652`) |
| 36 | App→User | Show "Copied!" for 2s (`:116-123`) |
| 37 | App→User | Schools grid: tile per school (avatar, health dot, student/hours stats) (`:661-689`) |
| 38 | User→App | Click a school tile → `selectSchoolToView(school)` (`:666`) |
| 39 | App→App | All child composables re-scope to that school (`viewingSchool` watch, `:175-179`) |
| 40 | App→User | Drill-down: stat strip + classes table for the viewed school (`:691-751`) |
| 41 | User→App | Click a class row in drill-down → `schoolsLink('class-detail', {classId, schoolId: viewingSchool?.id})` (`:728-730`) |

### Findings — Screen 2

- **[Class 3 — MISSING TWIN] Play-as-class failures are silent.** `handlePlayClass` (`:265-270`) awaits
  `launchClassSession(cls)` and discards the boolean result. `usePlayAsClass.ts` (`composables/schools/usePlayAsClass.ts:70-101`)
  deliberately *refuses to launch* — logging only to `console.error`/`console.warn` — when the class isn't fully loaded
  (missing `id`/`course_code`) or when the class's `course_code` doesn't resolve in the catalogue (the file's own comment
  cites a real incident: "two live classes carried the phantom `cym_for_eng_north`, 2026-07-16"). In both cases the teacher
  clicks "▶ Play", nothing happens, and there is zero on-screen indication why — no toast, no disabled state, no retry.
  This is genuinely new (the file is dated 2026-07-16, after the 07-13 bug-class audit) and not covered by any existing
  fix. Same defect recurs on Screen 6 (`TeacherDashboard.vue:287-289`). **File:line:** `DashboardView.vue:265-270`,
  `usePlayAsClass.ts:70-101`.

- **[Class 5 — ORPHAN] Govt-admin "confirm school name" card is unreachable.** `showNameSchoolCard` (`:84-86`) depends on
  `isSchoolAdmin`, but it's only rendered inside the `v-else-if="isGovtAdmin"` template block (`:547`). The top-level
  chain is `v-if="isTeacher"` / `v-else-if="isSchoolAdmin"` / `v-else-if="isGovtAdmin"` (`:288`, `:404`, `:547`) — a user
  can't simultaneously satisfy `isSchoolAdmin` and `isGovtAdmin`'s branch, so `:587-608` never renders for anyone. The
  *actual* school-admin-facing version of this card doesn't appear to exist in the School Admin template block at all
  (`:404-542`) — school admins with `name_confirmed === false` currently see no name-confirmation prompt anywhere on this
  screen. **File:line:** `DashboardView.vue:84-86`, `:587-608` (dead code), `:404-542` (missing the school-admin
  equivalent).

- **[Class 3 — MISSING TWIN] `fetchSchools()`/`fetchClasses()` failures are invisible.** `useSchoolData()` and
  `useClassesData()` both expose an `error` ref (`useSchoolData.ts:320-321`, `useClassesData.ts:313-314`), but
  `DashboardView.vue`'s destructure of both composables (`:24-45`) never pulls `error` — unlike `SchoolsView.vue`
  (Screen 3), which does surface it as a "Couldn't refresh this list" banner. A failed fetch here just leaves stats/tables
  at their last-known (possibly stale-empty) state with no visible sign anything went wrong. Same gap recurs on Screens
  4, 5 and 6 below. **File:line:** `DashboardView.vue:24-45` vs `SchoolsView.vue:15-25,242-245` (the correct pattern,
  for contrast).

---

## Screen 3: Schools List (`views/schools/SchoolsView.vue`) — Govt Admin Only

Roughly 4x the size of the 2026-04-11 version (9 rows → this). Now includes CSV export, sort, refresh, visibility-based
refetch, an add-school modal, and — notably — is the ONE screen among these six that already does surface fetch errors.

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Hero: eyebrow (org/group name), title "All schools", lede summarising school/awaiting-admin count (`:214-219`, `:56-72`) |
| 2 | App→User | Refresh (⟳), Export, "+ Add school" buttons in hero-actions (`:220-236`) |
| 3 | User→App | Click refresh → `handleRefresh()` (guarded against re-entry while already refreshing) (`:33-41`) |
| 4 | App→App | `fetchSchools()` |
| 5 | App→User | **Failed refresh shows a banner, not a silent no-op** — `fetchError` renders "Couldn't refresh this list — showing the last data loaded. {error}" + Retry button (`:242-245`) — comment at `:239-241` explicitly names this as the fix for a "stale claim/count sitting on screen with no visible sign anything was wrong" pattern |
| 6 | App→User | KPI grid: Schools / Students / Teachers / Classes / Practice hours / "Active in 7d" (the last is a permanent em-dash placeholder — unwired metric, not a bug, see note) (`:247-272`) |
| 7 | User→App | Type in search box → filters `filteredSchools` by name (`:43-54`, `:278-284`) |
| 8 | User→App | Change sort dropdown (hours/students/name) (`:285-289`) |
| 9 | App→User | Table updates live from the `filteredSchools` computed |
| 10 | App→User | "No schools match '{query}'" / "No schools to show" empty row (`:360-365`) |
| 11 | App→User | Per-row: school avatar/initial, city (`—`, unwired), student/teacher/class counts, hours, joined date, health/awaiting-admin pill, admin/teacher join-code copy chips (`:309-359`) |
| 12 | User→App | Click a school row → `handleSchoolClick(school)` (`:313`) |
| 13 | App→App | Under admin read-view: `router.push(schoolsLink('schools-list', {schoolId}))` — drills into that school's OWN read-view, not the self-viewing singleton (fixed per bug-class-audit #1b, code comment at `:94-96` cites it explicitly) |
| 14 | App→App | Otherwise: `selectSchoolToView(school)` + `router.push('/schools')` (`:101-102`) |
| 15 | User→App | Click a copy-code chip (Admin/Teacher), `@click.stop` so it doesn't also trigger the row click (`:334-355`) |
| 16 | App→User | Show "Copied!" state on the clicked chip for 2s (`:141-149`) |
| 17 | User→App | Click "Export" → `handleExport()` — real CSV download, not a placeholder (`:157-177`) |
| 18 | User→App | Click "+ Add school" → opens modal, resets all modal-local state (`:120-126`) |
| 19 | App→User | Modal: name input, Create/Cancel buttons (`:376-407`) |
| 20 | User→App | Type name, click "Create school" → `handleCreateSchool()` (`:133-139`) |
| 21 | App→App | `createSchoolInMyGroup(name)` |
| 22 | App→User | On success: modal shows generated admin/teacher `InviteLinkField`s + explanatory hint, button becomes "Done" (`:386-393`, `:396`) |
| 23 | App→User | On failure: `createError` rendered inline in the modal (`:385`) |
| 24 | User→App | Click "Done"/"Cancel" → `closeAddModal()`; if a school was created, refetches the list (`:128-131`) |
| 25 | App→App | Auto-refetch on tab visibility/window focus (debounced 400ms) so a school created via redemption in another tab appears without a manual refresh (`:179-209`) |

### Findings — Screen 3

None. This screen is the reference implementation for the fetch-error-visibility pattern flagged as missing on Screens 2,
4, 5, 6 — no new defects found here. (Minor non-defect note: the "Active in 7d" KPI and the "City" column are permanent
`—` placeholders with no backing data source — cosmetic, not a Trinity violation, since they're not claiming to be live
data that silently failed to load.)

---

## Screen 4: Students (`views/schools/StudentsView.vue`)

This is now a genuinely different screen from the 2026-04-11 version: the old slide-in detail panel, the "Add Student"
button, and the un-implemented `handleExport`/`handleAddStudent` placeholders are **all gone**, replaced by belt/health
filters, a "View →" link that opens a scoped analytics view, a real CSV export, and an invite-hint banner. None of the
2026-04-11 findings about this screen still apply to the current code.

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Page head: title, subtitle summarising total/active-this-week/needs-attention counts (`:164-168`, `:116-118`) |
| 2 | App→User | "Export CSV" button, shown only if any students exist (`:170-172`) |
| 3 | App→User | "+ Invite students" button, hidden under admin view (`:173-175`) |
| 4 | User→App | Click "+ Invite students" → `handleInvite()` |
| 5 | App→User | Shows a 5s hint banner "Students join classes using an invite link. Open a class to share it." (`:148-151`, `:179-183`) — this REPLACES the old "not yet implemented" dead button; it's a real (if minimal) answer, not a placeholder |
| 6 | App→User | Filters bar: search input + Class/Belt/Health dropdowns (`:185-221`) |
| 7 | User→App | Type in search → filters by name (case-insensitive) (`:94-104`) |
| 8 | User→App | Select class/belt/health filter → narrows `filtered` (`:100-102`) |
| 9 | App→User | Table: avatar/initials, name, LEGOs mastered subtitle, class, belt dot, LEGO progress bar, hours/wk, health dot, last-active, "View →" link (`:238-277`) |
| 10 | User→App | Click "View →" → `viewStudent(s)` (`:275`) |
| 11 | App→App | `router.push({ path: schoolsLink('analytics'), query: { scope: 'learner', learner, name } })` — opens the teacher's learner-scoped analytics view in-shell (`:120-130`). Code comment flags the underlying per-learner rate data is still deferred wiring; the view renders a seeded preview until then — a known, declared limitation, not a silent failure |
| 12 | User→App | Click "Export CSV" → `exportCsv()` — real CSV of the currently filtered rows (`:132-145`) |
| 13 | App→User | "No students match those filters" empty state + "Reset filters" button, shown when filters produce zero rows but students exist (`:282-292`) |
| 14 | App→User | "No students yet" empty state (genuinely zero students) (`:294-299`) |
| 15 | App→App | `fetchStudents()` on mount and on `selectedUser` change (`:153-159`) |

### Findings — Screen 4

- **[Class 3 — MISSING TWIN] `fetchStudents()` failures are invisible.** `useStudentsData()` exposes an `error` ref
  (`useStudentsData.ts:30`, set at `:156`) but `StudentsView.vue`'s destructure (`:17`: `const { students: studentsData,
  fetchStudents } = useStudentsData()`) never pulls it. A failed students query renders the same "No students yet" empty
  state a genuinely-empty school would show — a teacher with students who can't see them has no way to tell the
  difference from a school with zero students. Same class of defect as Screen 2's finding; not covered by the 07-13 audit.
  **File:line:** `StudentsView.vue:17`.

---

## Screen 5: Teachers (`views/schools/TeachersView.vue`)

Also materially rewritten since 2026-04-11: no more slide-in detail panel, no more "Add Teacher" modal with a create-teacher
API call — staff now join purely via the shared `teacher_join_code` link, matching the fix noted in bug-class-audit #11
("Resend invite" removed as dead UI because there's no real invited-state concept). `handleRemoveTeacher`'s error surfacing
(bug-class-audit #5) is confirmed present in current code.

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Page head: title, subtitle (count · active · pending-invites if any) (`:142-146`, `:61-71`) |
| 2 | App→User | "Export CSV" (if teachers exist), "Bulk import CSV" + "+ Invite teacher" (both `canManageStaff`-gated: school admin AND not admin-view) (`:148-157`, `:20`) |
| 3 | User→App | Click "Bulk import CSV" → `handleBulkImport()` → 5s hint: "Bulk CSV import is coming soon. For now, share the teacher invite link…" (`:86-90`, `:161-164`) — an honest "not built yet" message, not a silent dead button |
| 4 | User→App | Click "+ Invite teacher" → `handleInvite()` → 5s hint pointing at the join-link panel below (`:92-96`, `:165-168`) |
| 5 | App→User | Teachers table: avatar/initials, name, joined date, role pill, class/student/hours-wk counts, status dot, Remove button (`canManageStaff`-gated) (`:176-230`) |
| 6 | User→App | Click "Remove" → `handleRemoveTeacher(userId, name)` — native `confirm()` first (`:98-108`, `:216-217`) |
| 7 | App→App | Call `removeTeacher(userId)` |
| 8 | App→User | On success: `fetchTeachers()` refetches the list (`:103`) |
| 9 | App→User | On failure: `removeError` rendered in a dismissable-by-timeout(?) banner, `role="alert"` — actually persists until next action, not auto-dismissed (`:170-174`) — **confirmed fixed per bug-class-audit #5**, not re-flagged |
| 10 | App→User | "No teachers match \"{searchQuery}\"" empty row (**bug**: message interpolates `searchQuery` but there is no search input on this screen — see Finding below) (`:223-226`) |
| 11 | App→User | "No teachers yet" empty state when zero teachers (`:232-237`) |
| 12 | App→User | Tip cards (invite-links explainer, roles explainer) always shown (`:240-252`) |
| 13 | App→User | Join-card: `InviteLinkField` for the teacher join link, "Show code instead" toggle, plain-code + copy button (`canManageStaff`-gated) (`:253-284`) |
| 14 | User→App | Click "Show code instead" → reveals plain join code + copy button (`:261-267`) |
| 15 | User→App | Click "Copy code" → `copyJoinCode()` |
| 16 | App→User | Button label flips to "Copied" for 2s (`:73-84`) |
| 17 | App→App | `fetchTeachers()` + `fetchSchools()` on mount and on `selectedUser` change (`:125-137`) |

### Findings — Screen 5

- **[Class 2 — UNVALIDATED/dead reference] "No teachers match" empty row references a search box that doesn't exist.**
  `TeachersView.vue:223-226` renders `No teachers match "{{ searchQuery }}".` inside `<tr v-if="filtered.length === 0">`,
  and `searchQuery`/`filtered` are real, wired reactive state (`:23`, `:52-56`) — but there is **no search input rendered
  anywhere in the template**. `filtered` can currently only ever equal `teachers.value` in full (since nothing sets
  `searchQuery`), so this empty-row branch is presently unreachable — but it's dead/orphaned UI copy for a filter path
  that has no corresponding input, left over from an earlier version of this screen (compare the 2026-04-11 doc, which
  did have a "Display search box" row — the search box was removed, the filtering logic and its empty-state string were
  not). Low risk (unreachable today) but worth a one-line cleanup: either remove the dead `searchQuery`/`filtered`
  machinery or reinstate the search input. **File:line:** `TeachersView.vue:23,52-56,223-226`.

- **[Class 3 — MISSING TWIN] `fetchTeachers()`/`fetchSchools()` failures are invisible.** Same shape as Screens 2 and 4:
  `useTeachersData()` exposes an `error` ref (`useTeachersData.ts:34`, set on fetch failure at `:168-169`) that
  `TeachersView.vue`'s destructure (`:12`: `const { teachers: teachersData, fetchTeachers, removeTeacher } =
  useTeachersData()`) never surfaces. Only the separate, correctly-wired `removeError` (write-path) is shown — a failed
  *read* silently renders whatever was last successfully fetched (or the empty state, indistinguishable from a genuinely
  staff-less school). **File:line:** `TeachersView.vue:12`.

---

## Screen 6: Classes / Teacher Dashboard (`views/schools/TeacherDashboard.vue`)

Grew from ~22 rows to a 770-line file: course/health/sort filters, real 7-day practice-hours from a dedicated API, a
school-platform-trial course lock, per-row share-link copying, and the same `usePlayAsClass` launch path as Screen 2.

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Page head: title ("Classes" / "My Classes" by role), subtitle (count · students · hours this week) (`:334-337`, `:185-196`) |
| 2 | App→User | "Export CSV" (if classes exist), "+ New class" (hidden under admin view) (`:340-346`) |
| 3 | App→User | Summary strip: Excellent/Good/Needs-eyes counts + course count (`:350-379`) |
| 4 | App→User | Filters bar: Course / Health / Sort dropdowns, shown only if classes exist (`:382-411`) |
| 5 | User→App | Change course/health/sort filter → re-derives `filtered` (`:152-168`) |
| 6 | App→User | Classes table: name+join-code, course, students, belt, avg seeds, hours/wk, activity sparkline, health, share button, play button (`:414-473`) |
| 7 | User→App | Click anywhere on a row (or Enter, `role="button"`, keyboard-accessible) → `openClass(cls)` (`:432-439`) |
| 8 | App→App | Stashes class summary to `sessionStorage['ssi-class-detail']`, navigates to `schoolsLink('class-detail', {classId})` (`:272-283`) — **confirmed fixed**: uses `schoolsLink()`, not the previously-broken hardcoded `router.push({name:'class-detail'})` flagged in bug-class-audit wave 2 |
| 9 | User→App | Click "Copy link" (`@click.stop`) → `copyShareLink(cls)` (`:463-465`, `:298-306`) |
| 10 | App→User | Button flips to "Copied ✓" for 2s |
| 11 | User→App | Click "▶ Play as class" (`@click.stop`, gated `canPlayAsClass`) → `handlePlayClass(cls)` (`:468`, `:287-289`) |
| 12 | App→App | `launchClassSession(cls)` — **return value discarded, same defect as Screen 2, see Finding 1 there** |
| 13 | App→User | "No classes match those filters" + Reset button, when filters zero out a non-empty list (`:476-486`) |
| 14 | App→User | "No classes yet" + "+ Create your first class" (hidden under admin view), when genuinely zero classes (`:489-497`) |
| 15 | User→App | Click "+ New class" / "+ Create your first class" → `openCreateModal()` (`:224-226`) |
| 16 | App→App | Auto-opens create modal if `router.currentRoute.query.create` is set (deep-link from Dashboard's "Create class" CTA), only when not admin-view (`:206`) |
| 17 | App→User | `CreateClassModal`: name input, course dropdown — locked to the school's single trial course if `platform_status !== 'active'` (`:507-514`, `:41-63`) |
| 18 | User→App | Fill form, submit → `handleCreateClass(params)` (`:232-257`) |
| 19 | App→App | Guards on missing `school_id`: `createClassError = 'No school found for your account…'` without calling the API (`:236-239`) |
| 20 | App→App | Otherwise calls `createClass({...})` |
| 21 | App→User | On success: closes create modal, opens `ClassCreatedModal` with the new class + join code (`:247-250`) |
| 22 | App→User | On failure: `createClassError = 'Failed to create class. Please try again.'`, shown as a dismissable toast (`:252`, `:499-505`) |
| 23 | User→App | Click "Go to Class" in `ClassCreatedModal` → `handleGoToCreatedClass()` (`:259-265`) |
| 24 | App→App | Navigates via `schoolsLink('class-detail', {classId})` — **confirmed fixed**, same as #8 |
| 25 | App→App | `loadSchoolTrial()` (fails silently/non-fatal by design — comment at `:52-54` states "no lock applied" is the deliberate fail-open behaviour) and `loadPractice7d()` (fails silently/non-fatal by design, `:89-91`) on mount for school admins not in admin-view |

### Findings — Screen 6

- **[Class 3 — MISSING TWIN, same defect as Screen 2 Finding 1] Play-as-class failures are silent here too.**
  `handlePlayClass` (`:287-289`) discards `launchClassSession`'s return value exactly as `DashboardView.vue` does. Same
  file:line root cause (`usePlayAsClass.ts:70-101`), same fix would cover both call sites. Not double-counted as a
  separate defect below — listed once, against both screens.

- **[Class 3 — MISSING TWIN] `fetchClasses()` failures are invisible.** `useClassesData()` exposes an `error` ref
  (`useClassesData.ts:103`, set at `:313-314`) that `TeacherDashboard.vue`'s destructure (`:24`: `const { classes:
  classesData, fetchClasses, createClass, getClassReport } = useClassesData()`) never surfaces — same pattern as
  Screens 2, 4, 5. **File:line:** `TeacherDashboard.vue:24`.

---

## Cross-screen pattern (not a per-screen finding — the same root cause repeats four times)

**[Class 3 — MISSING TWIN, recurring] Read-fetch failures have no App→User twin on 4 of 6 screens.** Every schools
composable (`useSchoolData`, `useClassesData`, `useStudentsData`, `useTeachersData`) correctly sets a shared `error` ref
on fetch failure — this part of the contract is honoured consistently. But only **Screen 3 (SchoolsView.vue)** actually
destructures and displays it. Screens 2 (DashboardView), 4 (StudentsView), 5 (TeachersView), and 6 (TeacherDashboard) all
call `fetchSchools()`/`fetchClasses()`/`fetchStudents()`/`fetchTeachers()` without ever reading the corresponding `error`
ref, so a failed read on any of these four screens is indistinguishable from "genuinely empty" or "still showing
slightly-stale-but-fine data." This is the read-side mirror of the write-side "False-Saved" cluster the 07-13 audit
already found and fixed (finding #10 there) — same failure shape, different half of the request lifecycle, not
previously flagged. Fix size: small and mechanical per screen (destructure `error`, render the same banner pattern
`SchoolsView.vue:242-245` already uses) — four call sites, one pattern, no design ambiguity.

---

## Summary

| Metric | Count |
|--------|-------|
| Screens re-verified this pass | 6 (Screens 1–6) |
| Findings — Class 1 (untyped) | 0 |
| Findings — Class 2 (unvalidated) | 1 (Screen 5: dead search-box empty-state copy) |
| Findings — Class 3 (missing twin) | 6 distinct root causes (Play-as-class silent failure ×1 root cause, shown on 2 screens; fetch-error-invisible ×4 screens with 1 shared root pattern; Screen 1's "not signed in" dead end counted separately under Class 4) |
| Findings — Class 4 (unspecified content / dead end) | 2 (Screen 1: "Not signed in" dead end; Screen 2: unreachable/missing school-admin name-confirm card) |
| Findings — Class 5 (unreachable/orphan) | 1 (Screen 2: govt-admin name-confirm card is dead code under the current template gating) |
| **Total genuinely current findings** | **9** (excluding the cross-screen summary, which restates 4 of the Class-3 items rather than adding a new one) |

### Worst 3 findings (by user-visible severity × likelihood)

1. **Play-as-class silently refuses to launch** (Screens 2 & 6, `usePlayAsClass.ts:70-101`, `DashboardView.vue:265-270`,
   `TeacherDashboard.vue:287-289`) — a teacher/admin clicks the primary "Play" action and, on a real live bug class this
   code's own comments describe as having already happened once ("phantom `cym_for_eng_north`" course code, 2026-07-16),
   nothing happens with zero on-screen explanation.
2. **Read-fetch failures are invisible on 4 of 6 screens** (Dashboard, Students, Teachers, Classes) — the exact same
   class of defect as the already-fixed write-path "False-Saved" cluster, just on the read side, and not yet fixed here.
   Mechanical, one shared fix pattern, four call sites.
3. **Govt-admin "confirm your school's name" first-run card is dead code**, and school admins (the role that actually
   needs this prompt, per the invite-born-admin flow described in the surrounding code comments) appear to have no
   equivalent card on Screen 2 at all — a genuine first-run UX gap for exactly the users the feature was built for.

All other findings (Screen 1's OTP-success silent gap, Screen 1's "Not signed in" dead end, Screen 5's orphaned
search-empty-state copy) are lower severity/likelihood and listed in full above.

<!-- END verify-screens-1-6-partial.md -->


---

# Section 3 — Screens 7, 10, 11 + Globals (re-verified against current code)

# Trinity Compliance Re-verification — Screens 7/10/11 + Globals (partial)

> **Date**: 2026-07-17
> **Scope**: Re-verify against CURRENT code (superseding the 2026-04-11 tables in
> `docs/schools-trinity-audit.md`, which are stale — all five files below have
> grown substantially since).
> **Protocol**: `~/command-surface/trinity-campaign-brief.md` (APML Phase 7).
> **Cross-checked against**: `docs/audits/2026-07-13-bug-class-audit.md` — findings
> already fixed there are NOT re-flagged; findings that doc lists as still-open
> are re-verified against current source and flagged again only if confirmed.

---

## Screen 7: Class Detail — `packages/player-vue/src/views/schools/ClassDetail.vue`

The old table (rows 153–173) is stale: no session-history section exists any
more; a rename-class affordance, admin-view gating (`isAdminView`), a
govt-admin "back to school" breadcrumb, and a shared `usePlayAsClass` launch
path have all been added since. Rewritten below from current source (773
lines).

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display breadcrumb: "Classes" (or the viewed school's name, for a govt-admin drill-down) / class name |
| 2 | App→User | Display class name (h1) with inline rename (pencil) icon |
| 3 | App→User | Display course label (language name derived from `course_code`) |
| 4 | App→User | Display meta row: belt-of-class, student count, current LEGO position |
| 5 | App→User | Display "Play as class" button (only for school staff, hidden for govt-admin/read-only admin view) |
| 6 | App→User | Display roster search box |
| 7 | App→User | Display roster table (avatar, name, health dot, belt, LEGOs mastered, practice hours, last active, Remove action) |
| 8 | App→User | Display "No students match…" / "No students have joined this class yet." empty states |
| 9 | App→User | Display "Course Journey" rail card (JourneyBar + LEGOs-mastered-avg + belt-remaining note) |
| 10 | App→User | Display "Belt distribution" rail card (BeltStrip + legend), or "No students enrolled yet." |
| 11 | App→User | Display "Practice min/student/week" benchmark card, or "Benchmark loading..." |
| 12 | App→User | Display "Invite students" rail card with shareable link (`InviteLinkField`) |
| 13 | User→App | Click "Show code instead" |
| 14 | App→User | Reveal raw join code + "students enter it at saysomethingin.com/redeem" hint |
| 15 | User→App | Click "Copy code" |
| 16 | App→App | `navigator.clipboard.writeText` |
| 17 | App→User | Show "Copied" label for 2s |
| 18 | User→App | Click breadcrumb / back |
| 19 | App→App | `router.push('/schools')` (govt drill-down) or `router.push({name:'classes'})` |
| 20 | User→App | Click rename (pencil) icon |
| 21 | App→User | `window.prompt` for new class name |
| 22 | App→App | `classes.update({class_name})` |
| 23 | App→User | On failure: `window.alert('Could not rename the class. Please try again.')` |
| 24 | App→User | On success: silently refetches — roster header updates with new name |
| 25 | User→App | Click "Play as class" |
| 26 | App→App | `usePlayAsClass().launchClassSession()` — forces active course, stores class to localStorage, navigates to player |
| 27 | User→App | Type in roster search box |
| 28 | App→App | Filter `filteredStudents` by name |
| 29 | App→User | Update visible roster rows |
| 30 | User→App | Click "Remove" on a roster row (hidden entirely in admin read-view) |
| 31 | App→App | `user_tags.update({removed_at})` scoped to that student+class tag |
| 32 | App→App | On success: `fetchClassDetail()` refetch — row disappears |

### Findings

1. **[Class 5 — STILL OPEN, confirmed live]** `handleRemoveStudent` (`ClassDetail.vue:265-276`) — the `if (!error) fetchClassDetail(...)` pattern means a failed remove (RLS/network) produces **zero user feedback**: no error banner, no alert, row stays in the table with no visual change either way. This is exactly finding #5 in the 2026-07-13 bug-class audit ("Remove-student / remove-teacher fail with zero user feedback") — it was flagged as a one-liner fix but is **not actually fixed** in `ClassDetail.vue` as of this read (the sibling `TeachersView.vue` case may differ — not re-checked here, out of this screen's scope).
2. **[Class 3 — new, not previously flagged]** `handlePlay` (`ClassDetail.vue:244-246`) discards the boolean `launchClassSession()` returns. `usePlayAsClass.ts` explicitly documents that it "refuses to launch a half-loaded class" and "returns false when it refuses, so callers can keep the button disabled/inert instead" — but `ClassDetail.vue` never checks the return value, so a refused/failed launch (e.g. a class whose `course_code` doesn't resolve to a real course — the exact "phantom `cym_for_eng_north`" scenario the composable's own comment describes) produces a silent no-op click with no App→User message at all.
3. **[Class 5 — narrow, low severity]** `copyJoinCode` (`ClassDetail.vue:255-263`) has no fallback and no error surface if `navigator.clipboard.writeText` rejects (older Safari / non-secure context) — the `catch { /* ignore */ }` swallows it silently, unlike `AdminAccess.vue`'s `copyText()` which has a `document.execCommand('copy')` fallback. Narrow blast radius (clipboard API is broadly supported in the app's target browsers) but inconsistent with the rest of the codebase's pattern.

No re-flag: the admin route-param bug (`route.params.id` vs `classId`) is fixed and explicitly commented at `ClassDetail.vue:38-43`; the cross-tenant `isAdminView` write-gating (Remove button, rename affordance is NOT gated — see below) matches the fixed pattern from bug-audit #1.

**One gap in the admin-view gating worth a second look:** the Remove-student button is correctly hidden with `v-if="!isAdminView"` (line 394), but the **rename** button/icon (lines 311-319) has no `isAdminView` gate at all — an ssi_admin viewing another school's class read-only can still click rename, which fires a real write (`classes.update`) against that school's data. This is the same class of bug bug-audit #1 fixed elsewhere (write controls live under a read-only admin view) but was introduced by a later commit (`renameClass` post-dates the audit) and was never covered by that fix pass. **[Class 4/1 — worth prioritizing, matches the exact shape of the audit's #1 critical finding]**

---

## Screen 10: Settings — `packages/player-vue/src/views/schools/SettingsView.vue`

Completely rewritten since 2026-04-11 (674 lines vs. the old flat three-panel
layout). Now a 4-section sidebar layout (School profile / Localisation / Data
& privacy / Billing), admin-gated editing, live subscription status, and a
Paddle billing-portal link. The old table (rows 189–210) no longer matches
anything in the file and is fully superseded below.

### School profile

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display section nav (School profile / Localisation / Data & privacy / Billing — Billing hidden for non-school-admins) |
| 2 | App→User | Display school name, city, region, contact email inputs (pre-populated, read-only for non-admins / admin read-view) |
| 3 | App→User | Display a hardcoded "Type" field: literal string "Bilingual immersion · primary + lower secondary" for every school |
| 4 | App→User | Display "About" textarea |
| 5 | App→User | Display "Only a school admin can edit the school profile." hint when read-only |
| 6 | User→App | Edit school name / city / region / contact email / about (school admins only) |
| 7 | User→App | Click "Save changes" |
| 8 | App→App | `POST /api/school/update-profile` with `school_name` only — city/region/email/about are NOT sent |
| 9 | App→User | Button label cycles "Save changes" → "Saving…" → "Saved" (2s) |
| 10 | App→User | On failure: `console.error` only — no visible error to the user |
| 11 | User→App | Click "Cancel" |
| 12 | App→App | **No handler — button has no `@click` at all** |

### Localisation

| # | Direction | Message |
|---|-----------|---------|
| 13 | App→User | Display language / timezone / week-start dropdowns, "Show flags" toggle |
| 14 | User→App | Change any localisation field |
| 15 | User→App | Click "Save changes" (hidden in admin read-view) |
| 16 | App→App | Writes `language` + `timezone` to `localStorage` — `weekStart` and `showFlags` are NEVER persisted anywhere (not even localStorage) |
| 17 | App→User | Button label cycles "Save changes" → "Saving…" (250ms, artificial) → "Saved" (2s) |

### Data & privacy

| # | Direction | Message |
|---|-----------|---------|
| 18 | App→User | Display 4 toggles (analytics sharing, student messaging, real-names visibility, inactive-account retention) |
| 19 | User→App | Click a toggle |
| 20 | App→App | `toggleDataItem()` flips an in-memory `ref` only — comment explicitly says "visual placeholders — no DB column yet" |
| 21 | App→User | Toggle visually flips to "on"/"off" — no save confirmation because nothing is saved |
| 22 | User→App | Click "Download all data (.csv)" |
| 23 | App→App | Query `class_student_progress` for the school, build CSV client-side |
| 24 | App→User | Button label "Preparing…" during export; browser download triggers on success |
| 25 | App→User | On failure: `console.error` only — no visible error |

### Billing

| # | Direction | Message |
|---|-----------|---------|
| 26 | App→User | Display current plan line (name + seat count + £/seat), sourced from live `GET /api/school/subscription` when subscribed, else local stepper default |
| 27 | User→App | Click "Subscribe / choose seats →" / "Manage subscription & seats →" |
| 28 | App→App | `router-link` to `/schools/upgrade` |
| 29 | User→App | Click "Billing & invoices" (subscribed only) |
| 30 | App→App | `GET /api/school/portal` → redirect to Paddle portal URL |
| 31 | App→User | Button "Opening…" while in flight; on failure shows `portalError` inline |

### Findings

1. **[Class 2 — dead CTA, STILL OPEN per bug-audit #11]** "Cancel" button (`SettingsView.vue:314`) has no `@click` handler whatsoever — confirmed still true in current source, matching the audit's `SettingsView.vue:296` finding (line number shifted with the rewrite, defect unchanged). Edits typed into the profile fields have no discard path.
2. **[Class 4 — new, not previously flagged]** The "Type" field (`SettingsView.vue:288`) is a **hardcoded literal string** — `value="Bilingual immersion · primary + lower secondary"` — not bound to any school data. Every school, regardless of actual type, sees the identical fake description. This isn't a placeholder-styled empty state; it renders as real, specific-looking content for every single school.
3. **[Class 1/3 — new]** The four Data & Privacy toggles (`SettingsView.vue:51-76`, `toggleDataItem` at :255-258) present as live settings (styled on/off switches, immediate visual flip) but are pure client-side decoration with no persistence and no App→User indication that they're inert. A school admin toggling "Allow students to message each other" off has no way to know it did nothing — this is the same "false-Saved" shape as bug-audit #10's cluster (which was fully fixed elsewhere), just never wired up here in the first place.
4. **[Class 4 — new]** `saveSchoolProfile()` only sends `school_name` to the server (`SettingsView.vue:190`), silently dropping city/region/contact-email/about edits the user just made and was told were "Saved" — the success state is genuine for the one field that persists, but implies (via one shared button + one shared "Saved" message) that all the edited fields were saved.
5. **[Class 3 — new]** Both `saveSchoolProfile()` (line 199-201) and `handleExportData()` (line 238-240) catch errors with `console.error` only — no visible failure state reaches the user. `saveSchoolProfile` resets to `'idle'` (button reverts to "Save changes" with no explanation), and a failed export just silently never downloads anything.
6. **[Class 4 — narrow]** Localisation's `weekStart` and `showFlags` fields have UI, a change handler (implicit via `v-model`), and a "Save changes" button that visibly confirms — but neither field is ever written anywhere (not localStorage, not server). They reset to defaults on reload with no indication this happened.

---

## Screen 11: Admin Setup — `packages/player-vue/src/views/schools/SetupView.vue`

**Critical scope correction, confirmed by reading both files:** the 2026-04-11
audit's "Screen 11: Admin Setup" table (rows 211–283 — Create School / Schools
Management / Create Staff / Groups Management / Course Grants) was **already
documenting the wrong file even at the time it was written.** That entire
ssi_admin console — school creation, group hierarchy, course-grant
management, per-school entitlement badges — lives in
`packages/player-vue/src/views/admin/SchoolsSetup.vue` (1000+ lines, confirmed
by the 2026-07-13 bug-class audit's own citations: `SchoolsSetup.vue:793`
`deleteSchool`, `:488` `createGroup`, `:1193`/`:1360`/`:1035` empty-state
gating — none of which exist in `SetupView.vue`).

`SetupView.vue` (1130 lines, this read) is something entirely different: a
**self-service, first-time school-onboarding wizard** for a school admin who
has just signed up — four steps (Your school → Add staff → Choose courses →
Create classes), reached from a Dashboard banner (`DashboardView.vue:420-425`,
explicitly commented "`/schools/setup` has no nav tab, so this banner is its
entry point"), gated on the school having zero classes and zero students.

**Recommendation:** the old audit's Screen 11 table should be retitled to
cover `SchoolsSetup.vue` (the actual ssi_admin console it was describing), and
a NEW screen entry added for this self-serve `SetupView.vue` wizard.
`SchoolsSetup.vue` itself is out of this task's assigned scope (not one of
the five files handed to this worker) — flagging for a follow-up pass rather
than auditing it here.

### Trinity table for the ACTUAL current `SetupView.vue` (self-serve wizard)

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display 4-step rail (Your school / Add staff / Choose courses / Create classes), clickable to jump steps |
| 2 | App→User | Step 1: school name + region inputs (pre-populated) |
| 3 | User→App | Edit school name / region |
| 4 | User→App | Click "Continue" (or jump to a later step) |
| 5 | App→App | `saveSchool()` → `POST /api/school/update-profile` |
| 6 | App→User | On failure: inline `setup-error` banner ("School name is required" / "No school context…" / server error) |
| 7 | App→User | Step 2: display teacher + admin invite links (`InviteLinkField`), or "Your invite links will appear here once your school is saved." if not yet saved |
| 8 | App→User | Display "Already on the team" list if teachers exist |
| 9 | App→User | Step 3: display course tiles (checkbox-selectable), or empty state "no courses available yet — get in touch" |
| 10 | User→App | Toggle a course tile |
| 11 | App→App | Add/remove from `selectedCourses` set (client-only — filters step 4, grants nothing) |
| 12 | App→User | Step 4: display existing classes table if any exist |
| 13 | App→User | Display draft-class rows (name input + course dropdown, filtered by step 3's selection) |
| 14 | User→App | Type class name / select course per draft row |
| 15 | User→App | Click "+ Add another class" |
| 16 | App→App | Push a new blank draft row |
| 17 | User→App | Click the "×" remove icon on a draft row |
| 18 | App→App | Splice that row out |
| 19 | User→App | Click "Finish setup" |
| 20 | App→App | `persistClasses()` — creates each unsaved valid draft via `useClassesData.createClass` |
| 21 | App→User | On any class-creation failure: inline error banner surfaces `classesError` or a fallback message |
| 22 | App→User | On full success: "Setup complete" message → `router.push('/schools')` |
| 23 | User→App | Click "Save & exit" at any step |
| 24 | App→App | Persists step 1 (if on it) and/or step 4 drafts, then navigates to `/schools` regardless of outcome |
| 25 | User→App | Click "Back" |
| 26 | App→App | Decrement step (disabled on step 1) |

### Findings

1. **[Class 4 — STILL OPEN, confirmed live, matches bug-audit #6]** Step 3 (`selectedCourses`, `SetupView.vue:145`) never seeds from `schools.trial_course_code`, which `api/onboarding/provision.ts` already wrote at signup. A new admin who picked a course during signup is asked to re-pick the identical course in the wizard with zero prefill — confirmed still true, no seeding logic exists anywhere in this file.
2. **[Class 5 — narrow]** `handleSaveExit()` (`SetupView.vue:275-284`) calls `persistClasses()` on step 4 but **discards its boolean return** and navigates to `/schools` regardless of success — unlike `handleContinue()` (line 250-251), which correctly checks the same return and stays put on failure. A user who hits "Save & exit" on step 4 with a class-creation failure gets silently redirected away from the error they need to see (the `setup-error` banner renders for a frame, if at all, before the route change unmounts it).
3. **[Class 5 — narrow, self-correcting]** Once a school creates its first class or student, the Dashboard banner that is `SetupView.vue`'s only entry point disappears (`DashboardView.vue:425` gate: `!totalClasses && !totalStudents`) — an admin who completes step 4 partially (e.g. only Step 1+2, no classes yet) but then a student self-enrolls via a shared code before the admin returns to finish course/class setup loses the UI path back into the wizard entirely (direct URL still works, but is undiscoverable). Low severity — the wizard's job (get the school off zero) is done by that point — but worth noting since Step 2 (staff invites) and Step 3 (course selection) could still be legitimately unfinished.

---

## Global: Top Navigation — `packages/player-vue/src/components/schools/shared/TopNav.vue`

Substantially grown (909 lines) since 2026-04-11 — now shared across both
`schools` and `teach` (solo-tutor) contexts via a `mode` prop, with a
`forceTabs` demo/preview mode, and sign-out routed through the shared auth
composable rather than a raw Supabase call. Rewritten below (behavioural
logic only; styling unchanged in substance).

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display logo (routes to `/tutors/dashboard` in `teach` mode, `/schools` otherwise) + build number |
| 2 | App→User | Display nav tabs: Dashboard/Teachers/Students/Classes/Analytics for school roles; single "Upgrade" tab in `teach` mode; "Schools" tab additionally for govt admins; full tab set + "Insights" in `forceTabs` (demo/preview) mode |
| 3 | App→User | Display active tab highlighted (route-prefix match) |
| 4 | App→User | Display "Admin" chip button (ssi_admin only, hidden in demo mode) |
| 5 | App→User | Display "Learn something new yourself" button (hidden in demo mode) |
| 6 | App→User | Display school badge (avatar initials + school name) when signed in and not in `teach` mode |
| 7 | App→User | Display "Sign In" / "Get Started" buttons when signed out |
| 8 | App→User | Display user avatar menu (initials) when signed in |
| 9 | App→User | Display loading skeleton while auth state resolves |
| 10 | User→App | Click logo |
| 11 | App→App | `router-link` navigation (mode-dependent target) |
| 12 | User→App | Click a nav tab |
| 13 | App→App | `router-link` navigation to that tab's route |
| 14 | User→App | Click "Admin" chip |
| 15 | App→App | `router.push('/admin')` |
| 16 | User→App | Click "Learn something new yourself" |
| 17 | App→App | `router.push('/')` |
| 18 | User→App | Click "Sign In" / "Get Started" |
| 19 | App→App | Emits `signIn` / `signUp` events (parent container — `SchoolsContainer.vue` — owns the actual auth UI) |
| 20 | User→App | Click user avatar |
| 21 | App→User | Toggle user dropdown (name, email, Settings link, Sign Out) |
| 22 | User→App | Click "Settings" in dropdown |
| 23 | App→App | `router-link` to `/schools/settings`, dropdown closes |
| 24 | User→App | Click "Sign Out" |
| 25 | App→App | `auth.signOut()` (or raw Supabase fallback), then `window.location.reload()` unconditionally (even if sign-out throws) |
| 26 | User→App | Click hamburger (mobile) |
| 27 | App→User | Slide-in mobile menu panel (tabs + Admin + "My Learning") + backdrop |
| 28 | User→App | Click a mobile menu item / backdrop |
| 29 | App→App | Navigate + close mobile menu |

### Findings

1. **[Class 5 — no user-facing consequence, but a real dead entry]** The Setup/first-run banner in `DashboardView.vue` is the *only* UI path to `/schools/setup` (per that file's own comment) — `TopNav.vue` has **no** "Setup"/"Admin Setup" tab or dropdown entry at all, unlike the 2026-04-11 audit's row 290 ("Display admin tab (/schools/setup) if admin"), which no longer reflects reality. Not a defect (the banner is a deliberate, documented entry point), but the old table's claim is stale and should not be treated as current behaviour.
2. **[Class 4 — cosmetic, misleading to a future reader]** The code comment at `TopNav.vue:90` ("School info from God Mode selected user") references the removed god-mode/impersonation feature. Functionally harmless (still correctly sources from `useSchoolContext().currentUser`, which is populated by the current act-as mechanism), but stale terminology worth a one-line comment fix given how much confusion mixed identity/terminology has caused elsewhere in this codebase (see CLAUDE.md's Identity rationalisation section).
3. **[Class 3 — narrow]** `handleSignOut` (`TopNav.vue:116-127`) always reaches `window.location.reload()` in its `finally`, even when `auth.signOut()`/`supabaseRef.value.auth.signOut()` throws — meaning a failed sign-out is invisible: the page reloads and, if the session token is still valid client-side, the user may appear to still be signed in with no error ever shown. Low risk (sign-out failures are rare and self-evident on reload if they matter) but technically a silent App→App failure with no App→User twin.

---

## Global: God Mode Panel — **file no longer exists; feature is now `useActAs.ts` + `ActingAsBanner.vue`, and it is currently ORPHANED**

The 2026-04-11 audit's "Global: God Mode Panel (GodModePanel.vue)" (rows
304–320 — toggle button, side panel, user search/list, click-to-impersonate,
full page reload as that user) **describes a component that has been
deliberately removed.** Confirmed by search: no `GodModePanel.vue` (or any
`*godmode*`/`*god-mode*` file) exists anywhere under `packages/player-vue/src`.

`App.vue:96-101` actively **wipes the old god-mode localStorage keys**
(`ssi-god-mode-user`, `ssi-god-fab-pos`) on every load, and
`useActAs.ts`'s own doc-comment is explicit about why: *"This is NOT JWT
impersonation — the removed god-mode kind that fought RLS."* The replacement
is `useActAs()` (client-side persona overlay: sets `useUserRole`'s
`actingAs` state + `useSchoolContext`'s scope, never touches the admin's own
auth session) paired with a persistent `ActingAsBanner.vue` ("Viewing as
{persona} · Exit" pill, bottom-center) rendered globally from `App.vue`.

### Trinity table for the CURRENT act-as mechanism

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display "Viewing as {name} · {role}" banner (bottom-center pill) whenever `isActingAs` is true |
| 2 | User→App | Click "Exit" on the banner |
| 3 | App→App | `useActAs().exitActAs()` → clears the persona overlay + school context, `router.push('/admin/access')` |
| 4 | App→App | `useActAs().restoreActAs()` — called once from `App.vue` on mount, rehydrates the persona overlay + school scope from `sessionStorage` after a reload |
| — | *(no entry point)* | `useActAs().actAs(persona)` — the function that actually STEPS INTO a persona — is fully implemented (sets the overlay, clears + reloads school context, navigates to `/schools`) but is **never called from anywhere in the codebase** |

### Findings

1. **[Class 5 — UNREACHABLE, the headline finding for this component]** `actAs()` (`useActAs.ts:43-49`) has no caller anywhere in `packages/player-vue/src` — confirmed by exhaustive grep across every `.vue`/`.ts` file. `App.vue` only imports `restoreActAs` (reload rehydration). There is **no UI affordance anywhere** — no button on `AdminUsers.vue`, `AdminUserDetail.vue`, or `AdminAccess.vue` (the closest replacement console, which manages access *codes*, not live persona-switching) — that lets an ssi_admin actually invoke `actAs()` and step into a persona. The entire "God Mode" capability the 2026-04-11 audit documented (an admin picking a real user and viewing the app as them) currently has **no way to be triggered** in the live app: `ActingAsBanner.vue` and `exitActAs()`/`restoreActAs()` exist and work, but the door into the feature was either removed alongside the old panel and never rebuilt, or is mid-migration and was never wired to a caller. This is a genuine product gap, not a cosmetic one — whatever workflow depended on "view as this teacher/admin" (support, debugging tenant-specific issues) has no working entry point today.
2. **[Class 4 — consequence of #1]** Because there is no entry point, the read-only admin views that DO exist and work (`/admin/schools/:id`, `/admin/groups/:id`, `/admin/classes/:id`, `/admin/users/:learnerId/progress` — per CLAUDE.md's Schools Dashboard section) are the only live way an ssi_admin can currently inspect another user's dashboard — and those are explicitly read-only/no-live-session, a materially different capability than what `useActAs` promises ("step into a persona and open the live schools dashboard as them"). Any workflow that assumed live act-as is available is silently unsupported.

---

## Background note: Student Progress (`StudentProgressView.vue`) has drifted out of the `/schools` router entirely

Briefly checked per the task brief (another worker owns its full new-location
table, so no full re-verification here). Confirmed: `router/index.ts` has
**zero** references to `StudentProgressView` or a `student-progress` route —
the component file still exists (577 lines, reads `course_enrollments` /
`seed_progress` / recent sessions for `currentUser.value.learner_id`) but is
currently unmounted from the app's routing table. The 2026-04-11 audit's
"Screen 9: Student Progress" table (rows 183–188) describes a screen that is
no longer reachable at the URL that table implies (`/schools/student-progress`
per the Schools Dashboard architecture doc). This corroborates the task
brief's framing that ownership of this screen's Trinity table has moved
elsewhere — it should NOT be treated as still live at its old location by
whichever worker owns the new one.

---

## Summary

| Metric | Count |
|--------|-------|
| Screens/globals fully re-verified | 6 (ClassDetail, SettingsView, SetupView, TopNav, God Mode/act-as, + scope-correction note on Admin Setup) |
| Background-only note | 1 (StudentProgressView — router drift, no full table per task brief) |
| Findings — Class 1 (untyped) | 1 (Settings data-privacy toggles) |
| Findings — Class 2 (unvalidated / dead CTA) | 1 (Settings "Cancel" button, confirmed still open) |
| Findings — Class 3 (missing twin / silent failure) | 5 (ClassDetail play-launch discard; Settings profile-save + export silent catch; TopNav sign-out-failure reload; Settings toggles double-counted with Class 1 above) |
| Findings — Class 4 (unspecified/misleading content) | 5 (ClassDetail rename ungated under admin-view; Settings hardcoded "Type" field; Settings partial-field-save-implies-full-save; Settings dead weekStart/showFlags fields; God Mode read-only-views-are-not-act-as) |
| Findings — Class 5 (unreachable/orphan) | 5 (SetupView Save&Exit swallows failure; SetupView entry-point disappears post-first-class; TopNav stale "admin tab" claim; **God Mode `actAs()` fully orphaned — no caller anywhere**) |

### Worst 3 findings

1. **God Mode / act-as is completely unreachable** (`useActAs.ts` — `actAs()` has zero callers in the entire codebase). The old audit's "God Mode Panel" capability — an ssi_admin stepping into a live persona's dashboard — does not currently exist as a usable feature, despite the replacement machinery (state management, exit flow, reload-rehydration, the `ActingAsBanner`) being fully built and presumably tested. Whoever needs this (support/debugging a specific school's live state) has no way to trigger it today.
2. **The 2026-04-11 audit's "Screen 11: Admin Setup" table was written against the wrong file.** It documents `SchoolsSetup.vue` (school/group/course-grant admin console) under the heading of `SetupView.vue` (a completely different first-time self-serve onboarding wizard). Anyone using the old doc as a reference for either file gets confidently wrong information about what that screen does.
3. **`ClassDetail.vue`'s rename-class control is not gated by `isAdminView`**, while the adjacent Remove-student control on the same page correctly is — an ssi_admin in a read-only cross-tenant view can fire a real write against another school's class name. This is the identical bug shape (write controls live under a read-only admin view) that bug-audit finding #1 already fixed elsewhere in this file, just reintroduced by a later, unaudited change (the rename feature post-dates that fix).

**Output file**: `docs/trinity/verify-screens-7-11-globals-partial.md` (this file). Not committed, not pushed, per task instructions.

---

# Section 4 — /tutors namespace (never previously audited)

# Tutors Namespace — Trinity Compliance Audit

> **Date**: 2026-07-17
> **Scope**: `/tutors` namespace (never previously audited) — the freelance-tutor
> product line, distinct from `/schools`.
> **Trinity**: App→User (output) | User→App (input) | App→App (processing)
> **Protocol**: `trinity-campaign-brief.md` — Phase 7 three-session validation
> (System→User / User→System / System→System), findings classed 1–5.
> **Precedent/format**: `docs/schools-trinity-audit.md` (2026-04-11)

Screens covered:
1. `TeachContainer.vue` — tutor shell (auth, platform gate, nav)
2. `TeachDashboard.vue` — route `teach-dashboard`
3. `UpgradeView.vue` — route `teach-upgrade` (dual-rendered with `schools-upgrade`)
4. `Onboarding.vue` — route `onboard-tutor` (`/tutors`), tutor track only
5. `teach-play` route (`PlayerContainer.vue` inside `TeachContainer.vue`) — brief
6. `WithTeacher.vue` — route `with-teacher` (`/with/:code`)

---

## Screen 1: Tutor Shell (`TeachContainer.vue`)

### Loading / Login

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Show full-screen spinner + "Loading…" while `auth.isLoading` (`TeachContainer.vue:152-155`) |
| 2 | App→User | Display login card: "SaySomethingin **Teach**" wordmark + subtitle "Sign in to your teacher account, or use this email to start earning by running classes for your students." (`TeachContainer.vue:159-166`) |
| 3 | App→User | Display error banner if `loginError` set (`:174-173`) |
| 4 | User→App | Type email into input (`:178-186`) |
| 5 | App→App | Validate email via regex `isEmailValid` → enable/disable Continue (`:91-93`) |
| 6 | User→App | Submit form (click Continue / Enter) (`:175`) |
| 7 | App→App | `supabase.auth.signInWithOtp({ email })` (`:100-114`) |
| 8 | App→User | Button shows loading state (`isLoginLoading`) (`:191-193`) |
| 9 | App→User | On failure: show error in banner (`:104-106,109-110`) |
| 10 | App→User | On success: transition to OTP form (`:108`) |
| 11 | App→User | Display OTP input (6-digit, monospace, centred) (`:203-217`) |
| 12 | User→App | Type 6-digit OTP (`:207`) |
| 13 | App→App | Validate length ≥ 6 → enable/disable Verify (`:222`) |
| 14 | User→App | Submit OTP (click Verify / Enter) (`:198`) |
| 15 | App→App | `supabase.auth.verifyOtp({ email, token, type: 'email' })` (`:122-126`) |
| 16 | App→User | On failure: show error message (`:127-129,132`) |
| 17 | User→App | Click "Back" → reset to email step, clear OTP + error (`:227-229,138-142`) |

### Platform gate (async, fail-open)

| # | Direction | Message |
|---|-----------|---------|
| 18 | App→App | On auth+supabase ready, `checkPlatform()` fires (`:66-72`) |
| 19 | App→App | ssi_admins / act-as sessions bypass the gate entirely (`:39-43`) |
| 20 | App→App | `GET /api/school/subscription` with bearer token; only an explicit `{active:false}` sets `platformExpired` (`:51-58`) |
| 21 | App→App | Network/server error → fail open, `platformExpired` stays false (`:59-60`) |
| 22 | App→User | If expired: show "Trial ended" pill, headline "Your free month has ended", reassurance copy, embed `UpgradeView` (`:236-243`) |
| 23 | App→User | Else (not expired, not loading): render `TopNav mode="teach"` + routed child inside `main.main-content` (`:246-255`) |

### Findings

1. **[Class 3 — MISSING TWIN / Class 4 — UNSPECIFIED CONTENT] Login copy sells a signup path that silently dead-ends with no message.** The login subtitle explicitly invites *new* tutors: "use this email to **start earning by running classes**" (`TeachContainer.vue:163-166`). But this screen has no role gate and no teacher-provisioning call — it is auth-only. Successful OTP verification here for someone who has never been through `/tutors` onboarding flips `showDashboard` true (platform check fail-opens per finding above), mounts `TeachDashboard.vue`, which calls `GET /api/teacher/me`; that 404s for a non-teacher and the response handler does `router.replace('/tutors')` with **zero App→User message** (`TeachDashboard.vue:232-235`). The person who just followed the "start earning" copy is silently bounced to the signup door with no visible explanation of why they were redirected. **Highest-severity finding in this audit** — it's a broken money-funnel path, not a cosmetic gap.
2. **[Class 4 — UNSPECIFIED CONTENT] No loading indicator for the platform-subscription check.** Between `showLogin` going false and `checkPlatform()` resolving, `showDashboard` is already true (it only depends on `isAuthenticated`/`showExpired`/`isAuthLoading`, not `platformChecked`) — this is intentional fail-open design (comment at `:74-76`), but it means a legitimately-expired tutor briefly sees the live dashboard before the trial wall snaps shut on the next tick. Acceptable per the documented fail-open policy, but there is no loading state communicating "checking your subscription…" — worth a one-line note if this ever gets tightened.

---

## Screen 2: `TeachDashboard.vue` (route `teach-dashboard`)

### Load / error / empty

| # | Direction | Message |
|---|-----------|---------|
| 24 | App→User | Show loading spinner while `isLoading` (`:591-593`) |
| 25 | App→User | Show error card if `errorMessage` set (e.g. "Not signed in", or `/api/teacher/me` error body) (`:595-597,346-349,239`) |
| 26 | App→App | `loadAll()`: fetch live course catalogue (unauthenticated, always), then teacher/classes, then in parallel subscription/rosters/payout-recipient/commissions (`:341-367`) |
| 27 | App→App | `GET /api/teacher/me` 404 → `router.replace('/tutors')`, no message (see Finding 1) (`:232-235`) |

### Header / plan

| # | Direction | Message |
|---|-----------|---------|
| 28 | App→User | "Welcome, {display_name}." + metrics (classes used / X, paying students) (`:601-614`) |
| 29 | User→App | Click "+ New class" (`:616-622`) |
| 30 | App→App | `openAddClass()`: if `atClassCap`, set error, don't open form (`:472-475`) |
| 31 | App→User | At-cap notice banner when `atClassCap` (`:627-630`) |
| 32 | App→User | Stone row: Classes X/10, Paying students, Earning rate £/mo, Accrued this month (`:633-650`) |
| 33 | App→User | Subscription panel: trial copy (unsubscribed) vs plan terms (subscribed) (`:653-664`) |
| 34 | App→User | `checkoutError` shown inline (`:666`) |
| 35 | User→App | Click "Subscribe — £15/month" (`:678-680`) |
| 36 | App→App | `startTrial()`: double-subscribe guard → `hasSubscription` routes to `openPortal()` instead of a second checkout (`:378-381`) |
| 37 | App→App | Guard: `teacherId` must be resolved before opening checkout, else block with error (`:386-390`) |
| 38 | App→App | Guard: Paddle `priceId` must be configured, else block with error (`:391-395`) |
| 39 | App→App | Open Paddle overlay checkout with `kind: 'tutor_platform'`, `teacher_id`, `supabase_user_id` (`:407-423`) |
| 40 | App→User | On failure: show `checkoutError` (`:424-425`) |
| 41 | App→User | Past-due row: "Payment failed" + "Update payment method" button (`:686-697`) |
| 42 | App→User | Cancelled row: "Cancelled" + access-until date + "Manage subscription" (`:699-709`) |
| 43 | App→User | Active row: "Active" + next charge date + "Manage subscription" (`:711-721`) |
| 44 | User→App | Click "Update payment method" / "Manage subscription" → `openPortal()` (`:694,706,718`) |
| 45 | App→App | `GET /api/teacher/portal`; on success redirect to `portalUrl`; on failure show error (never silent) (`:441-456`) |

### Create class (inline panel)

| # | Direction | Message |
|---|-----------|---------|
| 46 | App→User | Inline "New class" panel with name input + course select (or locked single-course notice on trial) (`:725-773`) |
| 47 | User→App | Type class name / pick course (`:737,751-756`) |
| 48 | App→App | On trial, course list is locked to `teacher.teaching_languages`; falls back to full catalogue if empty (`:140-146`) |
| 49 | User→App | Click "Create class" (`:764-770`, disabled until name+course present) |
| 50 | App→App | `POST /api/teacher/classes` (`:496-506`) |
| 51 | App→User | On failure: show `createClassError` (`:508-511,759`) |
| 52 | App→User | On success: append class, close panel (`:512-513`) |

### Per-class roster panels

| # | Direction | Message |
|---|-----------|---------|
| 53 | App→User | Per-class card: name, course, "X of 20 students", "▶ Play as class" button (`:783-804`) |
| 54 | User→App | Click "▶ Play as class" (`:800-803`) |
| 55 | App→App | `playAsClass()`: store `ssi-last-course` + `ssi-active-class` to localStorage, force-switch active course, `router.push('/tutors/dashboard/play', {query:{class:id}})` (`:194-208`) |
| 56 | App→User | Share-link input (readonly, select-on-focus) + "Copy link" button (`:806-820`) |
| 57 | User→App | Click "Copy link" (`:816`) |
| 58 | App→App | `navigator.clipboard.writeText()`, silently swallow failure (`:460-468`) |
| 59 | App→User | Button label flips to "Copied" for 2s (`:818`) |
| 60 | App→User | Roster table (student, seeds, LEGOs mastered, last active) or "No students yet" empty state (`:823-852`) |
| 61 | App→User | "No classes yet" empty state with "+ New class" CTA (`:856-868`) |

### Earnings / payout

| # | Direction | Message |
|---|-----------|---------|
| 62 | App→User | Earnings grid: accrued, pending, lifetime paid, threshold (`:871-897`) |
| 63 | App→User | Progress bar toward £100 payout threshold (`:899-901`) |
| 64 | User→App | Click "Set up Wise payout" / "Request Wise payout" (`:909-917`) |
| 65 | App→App | `requestPayout()`: no recipient → open bank-details form; recipient exists → set `payoutQueued=true` (no separate request endpoint — monthly cron disburses) (`:521-546`) |
| 66 | App→User | "Payout queued for the next run…" confirmation copy (`:904-907`) |
| 67 | User→App | Fill + submit Wise recipient form (account holder, sort code, account number) (`:927-965`) |
| 68 | App→App | Client-side validation: name present, sort code = 6 digits, account number = 8 digits (`:551-556`) |
| 69 | App→App | `POST /api/teacher/payout-recipient` (`:562-573`) |
| 70 | App→User | On failure: show `payoutError`; on success: hide form, store recipient (`:577-581`) |

### Findings

3. **[Class 5 — ORPHAN/fragile] `playAsClass()` hardcodes the literal path `/tutors/dashboard/play` instead of the named route `teach-play`** (`TeachDashboard.vue:207`). Every other tutor-surface navigation in this codebase resolves by name; if the route path is ever restructured (as the `/teach` → `/tutors` migration already did once, per the router's own back-compat redirects) this call site won't get caught by a route-rename refactor and will silently 404 or hit the wrong screen. Low likelihood, but zero-cost to fix (`router.push({ name: 'teach-play', query: { class: cls.id } })`).
4. **[Class 2 — UNVALIDATED] `MAX_CLASSES` / `MAX_STUDENTS_PER_CLASS` are UI-only constants, never sent to or re-checked by the server.** `submitAddClass()` (`:486-519`) POSTs to `/api/teacher/classes` with no cap enforcement visible client-side beyond `atClassCap` blocking the *button*; nothing stops a second browser tab, a replayed request, or a future API client from creating an 11th class. (Server-side enforcement in `api/teacher/classes.ts` was not audited in this pass — flagged as unverified, not confirmed broken.)

---

## Screen 3: `UpgradeView.vue` at route `teach-upgrade`

Same component renders at both `/schools/upgrade` (`schools-upgrade`) and
`/tutors/dashboard/upgrade` (`teach-upgrade`) — lane is picked by
`isSchoolLane` (`UpgradeView.vue:68-70`), not by route.

| # | Direction | Message |
|---|-----------|---------|
| 71 | App→App | Lane selection: `isSchoolAdmin` or `currentUser.school_id` present → school (per-seat) lane; else tutor (single-seat) lane (`:68-70`) |
| 72 | App→User | Tutor lane: "Subscribe" headline, "£15/month (or £150/year)… three paying students cover your subscription" (`:472-476`) |
| 73 | App→User | Monthly/Annual billing toggle; Annual disabled (with title tooltip) if its Paddle price id isn't configured (`:479-501`) |
| 74 | User→App | Click billing toggle (`:486,496`) |
| 75 | App→App | `setBilling()`: if checkout already open, re-price it in place via `paddle.Checkout.updateItems` rather than forcing cancel+restart (`:89-112`) |
| 76 | App→User | Show current-price total for selected period (`:503-506`) |
| 77 | App→App | `watch(currentUser)`: resolves tutor teacher id + subscription status once `currentUser` lands (guards against firing before async context resolves) (`:361-374`) |
| 78 | App→User | CTA reads "Loading…" until `tutorTeacherId` + `tutorSubLoaded` both resolve (`:517-524`) |
| 79 | User→App | Click "Subscribe — £X/period" (`:517-525`) |
| 80 | App→App | `subscribeTutor()`: double-subscribe guard — if `tutorPlatformActive`, route to portal instead of a second checkout (`:292-299`) |
| 81 | App→App | Guard: priceId must be configured for the selected period, else block with error (`:300-308`) |
| 82 | App→App | Resolve `teacherId` via `/api/teacher/me` then a direct `teachers` table fallback; block checkout if unresolved (`:231-259,318-322`) |
| 83 | App→App | Open Paddle **inline** checkout (mounted into `.paddle-inline-frame`) with `kind:'tutor_platform'`, `teacher_id`, `supabase_user_id`, `billing` (`:323-346`) |
| 84 | App→User | On failure: show `tutorError`; reset `checkoutOpen` (`:347-350`) |
| 85 | App→User | Already-active tutor sees "Manage subscription" button instead of Subscribe (`:509-516`) |
| 86 | User→App | Click "Manage subscription" → `openTutorPortal()` (`:513`) |
| 87 | App→App | `GET /api/teacher/portal`; success → redirect; failure → `tutorError` (never silent) (`:279-290`) |

### Findings

5. **[Class 4 — UNSPECIFIED CONTENT, minor] Route-vs-behaviour drift the brief asked to check for: none found.** `UpgradeView.vue` genuinely behaves identically at `teach-upgrade` and `schools-upgrade` — the lane switch is entirely data-driven (`isSchoolLane`), not route-driven, so a solo tutor hitting either URL sees the tutor lane and a school admin sees the school lane. This is correct and intentional (confirmed by reading `:68-70` and the file header comment `:26-30`), not a defect — noted here because the brief specifically asked to look for a difference and there isn't a meaningful one (the school lane is unreachable from `/tutors/dashboard/upgrade` in practice since only tutors land on that route, and vice versa — the shared surface is future-proofing, not a live bug).
6. **[Class 3 — MISSING TWIN, low severity] Inline-checkout mount has no failure-to-mount signal.** If `getPaddle()` resolves but the iframe fails to render into `.paddle-inline-frame` (CSS/DOM timing, ad-blocker, etc.), `checkoutOpen` stays `true` and the CTA button disappears (`v-else-if="!checkoutOpen"`, `:517-525`) with nothing but an empty frame area — no timeout/retry/error path if Paddle itself never calls back. Same shape as the parallel `subscribeSchool()` path in this file, so it's a shared component-wide gap, not tutor-specific.

---

## Screen 4: Onboarding tutor door (`Onboarding.vue`, route `onboard-tutor`, `/tutors`)

Tutor-specific behaviour only (`props.track === 'tutor'`); school-track logic
(heritage door, `/schools1`/`/schools2`) excluded per scope.

### Step "choose"

| # | Direction | Message |
|---|-----------|---------|
| 88 | App→User | Left panel: heading "Start teaching", blurb "Teach the SSi way… earn from every learner you bring" (`onboardingTracks.ts:65-70`) |
| 89 | App→User | Left panel checklist (tutor-specific copy): "No planning, no marking…", "Press play…", "Every learner's practice and progress on your dashboard" (`Onboarding.vue:33-38`) |
| 90 | App→User | Cardiff University proof stat (shared across tracks) (`:604-620`) |
| 91 | App→User | "Free for N days — no card needed" offer line, computed per selected course (`:668,343-346`) |
| 92 | App→User | Heading "Which language will you teach?" + track blurb (`:670-671`) |
| 93 | User→App | Open target-language dropdown, type to filter (English pinned first, A–Z) (`:681-732`) |
| 94 | App→App | Tutor door NEVER shows the "Free for a year" badge — `yearTrialTargets` explicitly excludes `props.track !== 'school'` (`:210-220`) |
| 95 | User→App | Select target language / course (`:715,804,833`) |
| 96 | App→App | Auto-select the sole course when a target language resolves to exactly one, or a search narrows to exactly one (`:129-149`) |
| 97 | App→User | Collapsed "You're teaching {course}" claim tile with "Free for N days" + "Change language" (only shown when 2+ options exist) (`:738-758`) |
| 98 | App→User | Catalogue-outage state: "We couldn't load the language list. Try again." (never "no languages exist") (`:762-767`) |
| 99 | App→User | "Your learners mainly speak" — long scrollable/searchable list (tutor doors are long-list, not the heritage showcase) (`:772-816`) |
| 100 | App→User | Already-signed-in visitor: "Continuing as {email}" + "Not you? Sign out" instead of email/OTP capture (`:857-862`) |
| 101 | User→App | Type email (fresh visitor) (`:864-875`) |
| 102 | App→App | `canSend` = valid email + course selected + not busy (`:312`) |
| 103 | User→App | Click "Send my code" / "Continue" (signed-in) (`:879-900`) |
| 104 | App→App | Signed-in path: `continueSignedIn()` → `finishProvisioning()` directly, no OTP (`:401-412`) |
| 105 | App→App | Fresh path: `supabase.auth.signInWithOtp({email})` (`:444`) |
| 106 | App→User | On failure: `error` banner (`:446,877`) |
| 107 | App→User | On success: step → 'otp' (`:449`) |

### Step "otp"

| # | Direction | Message |
|---|-----------|---------|
| 108 | App→User | "Check your email" + 6-digit cell display, synced to hidden input (`:906-943`) |
| 109 | User→App | Type/paste OTP (`:931-942`) |
| 110 | App→User | Delivery-hint fallback ("school email filters often block these codes…") after 20s on first send, or immediately on resend (`:284-288,450-456,982-991`) |
| 111 | User→App | Click "Confirm & start" (`:964-974`) |
| 112 | App→App | `verify()`: `supabase.auth.verifyOtp()` once per address (guards against re-verifying an already-consumed token on a same-email retry) (`:489-519`) |
| 113 | App→User | On OTP failure: `error` banner (`:505-506`) |
| 114 | App→App | On success: `finishProvisioning()` → `POST /api/onboarding/provision` with `{track:'tutor', course_code}` (`:468-487`) |
| 115 | App→App | Server re-derives track + course validity — the client selection is never trusted blindly (`api/onboarding/provision.ts:19,73-74`) |
| 116 | App→App | 409 (trial already burned for this email+track) → `requiresCheckout = true`, stay on OTP step (`:476-479`) |
| 117 | App→User | **On the 409 path: button reads "Go to your school dashboard" regardless of track** (`:954-963`) |
| 118 | User→App | Click "Change email" / "Resend code" (`:977,979`) |

### Step "done"

| # | Direction | Message |
|---|-----------|---------|
| 119 | App→User | Returning user: "Welcome back" + "Go to my dashboard" (no finishing form) (`:1005-1011`) |
| 120 | App→User | New user: "{course} is ready" + "Free until {date}. No card needed to start." (`:1016-1019`) |
| 121 | App→User | Optional finishing details: name field always shown; **institution field never shown for tutor track** (`cfg.collectInstitution === false`) (`:1038,onboardingTracks.ts:70`) |
| 122 | User→App | Fill name (optional), click "Continue" (`:1052-1054`) |
| 123 | App→App | `continueIn()`: `POST /api/onboarding/profile` only if name/institution non-empty (`:533-541`) |
| 124 | App→User | On failure: surfaced error, does NOT navigate away so it's actually seen (`:548-561`) |
| 125 | App→App | Clear stale role cache (`useUserRole().clear()`), then full navigation to server-provided `redirectTo` (`/tutors/dashboard` for tutor track, confirmed server-side) (`:572-573`, `api/onboarding/provision.ts:385`) |

### Findings

7. **[Class 4 — UNSPECIFIED CONTENT, confirmed] Wrong copy on the 409 "trial already used" escape button for tutors.** `Onboarding.vue:962` hardcodes the label **"Go to your school dashboard"** on the button unconditionally — including on the tutor track (`props.track === 'tutor'`), where `goToDashboard()` (`:524-527`) correctly routes to `/tutors/dashboard` but the visible text tells a solo tutor they have a "school dashboard", which doesn't exist in their mental model (they were never asked about a school — `cfg.collectInstitution` is false for tutor, per Finding above). Minimum fix: `{{ track === 'tutor' ? 'Go to your dashboard' : 'Go to your school dashboard' }}`.
8. **[Class 4 — UNSPECIFIED CONTENT, low severity] `panelFacts` and blurb correctly branch per track; no other track-leak found in the choose/otp/done copy** beyond Finding 7 — called out because the brief specifically asked to hunt for a school/tutor mix-up and this audit found exactly one instance, isolated to the 409 escape hatch.

---

## Screen 5: `teach-play` route (PlayerContainer inside TeachContainer) — brief

Focus: what's tutor-specific about *entering/exiting* play here, not the
player's internals (already covered by other audits).

| # | Direction | Message |
|---|-----------|---------|
| 126 | App→App | Entry: `TeachDashboard.playAsClass()` writes `ssi-last-course` + `ssi-active-class` to localStorage, force-switches the active course via `switchActiveCourseTo()` (avoids racing `PlayerContainer`'s own async catalogue fetch), then navigates (`TeachDashboard.vue:194-208`) |
| 127 | App→App | `PlayerContainer` detects `route.name === 'teach-play'` → `isTeachEmbedded = true`, which (a) hides the player's own legacy dark "Back to classes" bar (redundant under the tutor's white nav) and (b) repositions the player's fixed-position overlays to anchor below `TeachContainer`'s nav instead of the viewport top (`PlayerContainer.vue:44-59`) |
| 128 | App→App | `checkClassContext()` reads `?class=` query param + localStorage to populate `classContext` for the session (`:392-409`) |
| 129 | User→App | Exit / "go home" action inside the player (`handleGoHome`) |
| 130 | App→App | `handleGoHome()`: if `classContext` set, detects launch surface via `router.currentRoute.value.path.startsWith('/tutors/dashboard')`, clears context, and routes back to `/tutors/dashboard` (not the generic learner home or `/schools/classes`) (`:421-433`) |
| 131 | App→User | `TeachContainer`'s `TopNav mode="teach"` stays fixed above the player throughout — its only tab is "Upgrade" (`TopNav.vue:56-57`), so the tutor's only in-nav escape from a live class session is that single link plus the logo (→ `/tutors/dashboard`) |

### Findings

9. **[Class 5 — ORPHAN, low severity] Exit-surface detection is a raw path-prefix string match, not a named-route check.** `handleGoHome()` compares `router.currentRoute.value.path.startsWith('/tutors/dashboard')` (`PlayerContainer.vue:427`) rather than checking `route.name === 'teach-play'` (which the same file already computes two lines away as `isTeachEmbedded`, `:57-58`). Functionally fine today, but it's the same "hardcoded path over named route" pattern flagged in Finding 3 — one string literal drifting out of sync with the router (e.g. a future `/tutors/dashboard` → `/tutor` rename) breaks this silently instead of at compile/route-definition time.
10. **No dedicated "leaving your class" confirmation.** Unlike `ClassDetail.vue` in the schools surface (which the house audit didn't flag either), there's no evidence of a confirm-before-exit dialog on `handleGoHome()` — an accidental tap mid-session drops the tutor straight back to the dashboard. Not confirmed as a regression (the schools equivalent has the same shape), so recorded as a shared, pre-existing gap rather than a tutor-specific defect.

---

## Screen 6: `WithTeacher.vue` (route `with-teacher`, `/with/:code`)

Included: this is the tutor ecosystem's primary external-facing message
surface — the link every tutor shares with prospective students, and the
one screen where price/commission correctness is directly money-critical.

### Load

| # | Direction | Message |
|---|-----------|---------|
| 132 | App→User | Loading spinner while resolving the code (`:403-405`) |
| 133 | App→App | `GET /api/teacher/by-code?code=` (`:125`) |
| 134 | App→User | "This link is temporarily unavailable" (paused referral/class, distinct from a wrong code) (`:407-416,131-133`) |
| 135 | App→User | "We couldn't find that class" (genuinely wrong code) (`:418-427,134-136`) |
| 136 | App→User | Success: class name, course label, "with {teacher.display_name}", optional photo/bio (`:429-442`) |

### Pricing (money-critical)

| # | Direction | Message |
|---|-----------|---------|
| 137 | App→App | Price tier derived from `classInfo.school_id`: null → tutor/ACT class £10/mo; set → school class £5/mo (`:39,42`) |
| 138 | App→App | Free-tier course (`course_is_free`) → student joins with **no Paddle checkout at all** (`:41,169-174`) |
| 139 | App→User | Free-course block: "This course is **free** — no card needed." (`:444-456`) |
| 140 | App→User | Paid block: Monthly/Annual toggle, price, "£X off the regular price — unlocked by your teacher's class" (`:458-499`) |
| 141 | App→App | Webhook re-derives the SAME price/tier fact server-side from `class.school_id` and freezes it — client price is display-only, never authoritative (`:35-37`) |
| 142 | User→App | Click "Start learning" / "Join free" (`:518-527`) |
| 143 | App→App | `handleStartLearning()`: not signed in → `showLogin=true`; signed in → `proceedAfterAuth()` (`:154-163`) |
| 144 | App→App | Free course → `joinFree()`: idempotent enrol + roster-tag, then `goToPlayer()` (`:169-174,252-266`) |
| 145 | App→App | Paid course → `openCheckout()`: double-charge guard via `hasActiveSubscription()` — an already-subscribed learner is linked to the class client-side and sent straight to the player, never a second checkout (`:298-313`) |
| 146 | App→App | Genuinely new paid signup: Paddle overlay checkout opened with `kind:'student_via_teacher'`, `teacher_id`, `class_id`, `supabase_user_id`; enrolment/roster-tag done by the webhook, not the client (`:315-329`) |
| 147 | App→User | `isFull` → "This class is full. Ask your teacher to open another class." blocks the CTA (`:501-503,522`) |
| 148 | App→User | On checkout-open failure: `checkoutError` shown (`:330-331,505`) |
| 149 | App→User | Already-subscribed path: reassurance copy + "Continue to SaySomethingin" (`:508-516`) |

### Inline OTP login (unauthenticated visitor)

| # | Direction | Message |
|---|-----------|---------|
| 150 | App→User | "Sign in or create your SaySomethingin account to continue." (`:531`) |
| 151 | User→App | Email → OTP → verify, same shape as the other two login forms in-scope (`:535-579`) |
| 152 | App→App | On verify success: `refreshSession()`, hide login, `proceedAfterAuth()` — i.e. resumes straight into the free-join or checkout path it was interrupted from (`:373-375`) |
| 153 | App→User | Trust footer: "Same SaySomethingin account, same ten languages, same method." (`:582-584`) |

### Findings

11. **[Class 2 — UNVALIDATED, confirmed] Class capacity (`is_full`/`seats_remaining`) is checked only once, at page load — never re-validated at the moment of payment.** `by-code.ts` computes `is_full`/`seats_remaining` once per `GET` (`api/teacher/by-code.ts:207-208`); the client blocks the CTA on that stale snapshot (`WithTeacher.vue:501-503,522`). The Paddle webhook path for `kind === 'student_via_teacher'` (`api/teacher/paddle-webhook.ts:370-964`) has no capacity re-check anywhere in that branch — confirmed by grep, no `is_full`/`seats_remaining`/capacity reference in the webhook handler at all. Two students loading the join page in the same window before either completes checkout can both be admitted past a class's `MAX_STUDENTS_PER_CLASS` (20) cap with no server-side gate catching the overshoot.
12. **[Class 3 — MISSING TWIN, low severity, but noted for completeness] New (non-already-subscribed) paid signups never confirm the webhook actually landed before redirecting.** `openCheckout()`'s genuinely-new-subscriber branch (`:315-329`) opens Paddle with `successUrl: '${origin}/?just_subscribed=1'` and does nothing else — the enrolment + roster-tag is entirely the webhook's job. This is **not a bug**: `useSubscription.ts:344-345` already polls `pollUntilActive()` for exactly this `just_subscribed=1` signal app-wide, so the learner isn't bounced off a paywall mid-redirect. Recorded only because the brief's Session-3 checklist asks explicitly whether every App→App process has a verified App→User twin, and this one is verified-present, just not visible from this file alone.

---

## Cross-Screen Observations

- **The three independent OTP login forms** (`TeachContainer.vue`, `Onboarding.vue`, `WithTeacher.vue`) are each internally Trinity-complete (loading/error/success all present), but are three separate implementations of the identical email→OTP→verify shape with copy that has already drifted once (Finding 1's misleading "start earning" line exists only in `TeachContainer.vue`, not the other two). Not a Trinity defect per se — flagged as a maintenance-cost observation per the BSC frame in `CLAUDE.md`, not a compliance finding.
- **Hardcoded literal route paths instead of named routes** appear twice in the tutor surface in this pass alone (Findings 3 and 9) — both harmless today, both silent-failure-on-rename risks tomorrow. Worth a single sweep (`grep -rn "'/tutors/dashboard" packages/player-vue/src`) rather than three separate future bug tickets.
- **Capacity/cap enforcement (Finding 4, Finding 11) is UI-only in two independent places** (teacher's own class-count cap; a class's student cap) — same shape of gap, same fix pattern (a server-side count-and-reject at the write site), suggesting one shared fix rather than two.

---

## Summary

| Metric | Count |
|--------|-------|
| Screens covered | 6 (TeachContainer, TeachDashboard, UpgradeView@teach-upgrade, Onboarding@tutor-track, teach-play, WithTeacher) |
| Trinity messages catalogued | 153 |
| Findings | 12 |
| — Class 1 (UNTYPED) | 0 |
| — Class 2 (UNVALIDATED) | 2 (#4, #11) |
| — Class 3 (MISSING TWIN) | 3 (#1, #6, #12) |
| — Class 4 (UNSPECIFIED/WRONG CONTENT) | 4 (#1 dual-classed, #2, #5, #7, #8) |
| — Class 5 (ORPHAN/fragile) | 3 (#3, #9, #10) |
| Confirmed via direct code read (not guessed) | All 12 |

---

# Section 5 — /schools/analytics (TeacherInsightsView.vue — replaced AnalyticsView.vue for this route)

# Trinity Compliance Audit — TeacherInsightsView.vue (`/schools/analytics`)

> **Date**: 2026-07-17
> **Scope**: `packages/player-vue/src/insight/TeacherInsightsView.vue`, as it renders at
> route name `analytics`, path `/schools/analytics` (`router/index.ts:178-189`), mounted with
> `props: { embedded: true }` inside `SchoolsContainer.vue` (which supplies `SchoolsTopBar` —
> `SchoolsContainer.vue:497`). This component **replaced** the old `AnalyticsView.vue` for this
> route (see `docs/schools-trinity-audit.md` Screen 8, which documents the pre-replacement
> component and is now stale for this route).
> **Trinity**: App→User (output) | User→App (input) | App→App (processing)
> **Protocol**: `~/command-surface/trinity-campaign-brief.md` — Phase 7 Session 1/2/3, finding
> classes 1–5.

## `embedded` prop — verified

`TeacherInsightsView.vue:64` (`defineProps<{ embedded?: boolean }>()`) and
`TeacherInsightsView.vue:392` (`<TopNav v-if="!props.embedded" :force-tabs="true" />`) confirm: when
embedded, the view's own `TopNav` is suppressed, and `.tiv-scroll--embedded` (line 394, styled
573-582) drops the full-viewport scroll/height/padding. `SchoolsContainer.vue:497` renders
`SchoolsTopBar` unconditionally for the schools shell, which is the nav the embedded view relies on
in its place — confirmed, not assumed.

## Widgets/boards actually used

`TeacherInsightsView.vue` imports only `RateCompare` from `./components/RateCompare.vue` (line 43),
plus `FrostSelect` and `TopNav` (chrome, not insight widgets). It does **not** import
`InsightWidget.vue`, `DiscoveryFeed.vue`, or anything from `widgets/` or `boards/` — those exist
alongside it in `src/insight/` but belong to the separate admin `InsightsView.vue` cockpit. Grep for
`InsightWidget|DiscoveryFeed|widgets/|boards/` in the file returns nothing. `RateCompare.vue` itself
is pure `props.data` in / template out (no user interaction, no fetch) with its own quiet empty
state (`RateCompare.vue:114-116`, `isEmpty` computed at line 33) — no findings inside it.

## Demo vs real mode

`isInsightDemo()` (`data/demo.ts:28-31`) gates on `?demo` in the URL. Demo mode uses the seeded,
deterministic `demoRates.ts` fixture (no DB call). Real mode fetches the caller's own classes via
`useClassesData` and calls `GET /api/school/rate-compare`. Only the headline metric (rate of
progress) and compare-to selector are real; the other 5 `HERO_RATES` and the learner-level drill
are demo-only (`TeacherInsightsView.vue:29-32`).

---

## Trinity Table

### Header / framing

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display kicker "Your {class/school/group}" (`:399`, `entityNoun` `:192`) |
| 2 | App→User | Display header title spanning demo/class/school/group levels (`:401`, `headerTitle` `:205-210`) |
| 3 | App→User | Display subtitle "How you're doing on **{course}**…" (`:402-405`) |
| 4 | App→User | Display deep-link preview note when `route.query.name` is present (`:406-410`) — **see Finding 1: content wrong outside demo mode** |

### Controls: course / level / entity pickers

| # | Direction | Message |
|---|-----------|---------|
| 5 | App→User | Display Course select, real mode only (`:419-422`) |
| 6 | User→App | Select a course | `selectedCourse` v-model (`:421`) |
| 7 | App→App | `realCourseOptions` derived from `realClassOptions`, deduped+sorted (`:118`); auto-picks first course when none selected (`:120-122`) |
| 8 | App→User | Display Level segmented control, only when role has >1 level (`:427-439`) |
| 9 | User→App | Click a Level segment | sets `realEntityLevel` (`:436`) |
| 10 | App→App | `availableRealEntityLevels` computed by role (teacher: class only; school_admin: class/school; govt_admin: class/school/group) (`:130-134`) |
| 11 | App→App | Watch resets `realEntityLevel` to `'class'` if current selection becomes invalid for the role (`:136-138`) |
| 12 | App→User | Display "Your classes" select (demo, or real when level=class) (`:443-446`) |
| 13 | User→App | Select a class | `selectedClassKey` v-model (`:445`) |
| 14 | App→App | Watch keeps `selectedClassKey` valid as course/level change, defaults to first option (`:148-151`) |
| 15 | App→User | Display "Your schools" select (govt_admin, level=school) (`:450-453`) |
| 16 | User→App | Select a school | `selectedGovtSchoolId` v-model (`:452`) |
| 17 | App→User | Display fixed "Your school" text (school_admin, level=school — has exactly one) (`:454-457`) |
| 18 | App→User | Display fixed "Your group" text (govt_admin, level=group) (`:460-463`) |
| 19 | App→App | `schoolOptionsForCourse` — only govt schools that have a class on the selected course (`:163-167`) |
| 20 | App→App | Watch keeps `selectedGovtSchoolId` valid as course/level change (`:170-173`) |
| 21 | App→App | `realEntityId`/`realEntityLabel` resolve per level (class id / school id / `currentUser.group_id`) (`:176-191`) |

### Drill (demo-only) / metric / compare-to

| # | Direction | Message |
|---|-----------|---------|
| 22 | App→User | Display "View" segmented control (Whole class / A learner) — demo only (`:467-483`) |
| 23 | User→App | Click a View segment | sets `scope` (`:474`, `:480`) |
| 24 | App→User | Display Learner picker, demo + scope=learner only (`:486-489`) |
| 25 | User→App | Select a learner | `learnerEntityId` v-model (`:488`) |
| 26 | App→App | Watch keeps demo learner selection coherent as metric/scope/class change (`:300-311`) |
| 27 | App→User | Display Measure select (demo: all 6 `HERO_RATES`) (`:493-496`) |
| 28 | User→App | Select a measure | `metricId` v-model (`:495`) |
| 29 | App→User | Display fixed "Measure" text (real mode: locked to rate-of-progress) (`:497-500`) |
| 30 | App→User | Display "Compare to" select (`:503-506`) |
| 31 | User→App | Select a compare-to option | `averageId` v-model (`:505`) |
| 32 | App→App | `averageSelectOptions` — demo: full ladder; real: `REAL_COMPARE_OPTIONS_BY_LEVEL[level]` (course-scoped + course-agnostic "all courses" options) (`:253-275`) |
| 33 | App→App | Watch resets `averageId` to the level's first option when level changes (real only) (`:276-280`) |
| 34 | App→User | Display one-line measure description (`:510`, `tiv-metric-desc`) |

### Deep-link from Students table

| # | Direction | Message |
|---|-----------|---------|
| 35 | App→App | Read `route.query.scope`/`name`/`learner` on mount (`:224-229`) |
| 36 | App→App | If demo AND `scope=learner`: set `scope.value = 'learner'` (`:229`) — **real mode: no-op, see Finding 1** |
| 37 | App→User | Show `requestedLearnerName` preview note if `route.query.name` present, regardless of mode (`:406-410`) — **see Finding 1** |

### Real data fetch

| # | Direction | Message |
|---|-----------|---------|
| 38 | App→App | `fetchRealComparison()` — no-op in demo mode (`:324`) |
| 39 | App→App | No-op if `course`/`entityId` unresolved yet (`:329`) |
| 40 | App→App | Get session token via `client.auth.getSession()` (`:334-335`) |
| 41 | App→App | **Silent no-op if no token** (`:336`) — **see Finding 2: MISSING TWIN** |
| 42 | App→App | `GET /api/school/rate-compare` with course/entity/level/compare-to params, bearer auth (`:337-345`) |
| 43 | App→App | Throw on non-2xx (`:346`) → caught, sets `realFetchFailed` (`:353-355`) |
| 44 | App→App | On `insufficientData: true`: set `realInsufficientReason` (server reason or fallback string) (`:348-349`) |
| 45 | App→App | On success: set `realData` (`:351`) |
| 46 | App→App | Watch re-fetches whenever course/level/entityId/averageId change (`:360`) |
| 47 | App→User | Show "Loading your {entity}'s rate…" while `isLoadingReal` (`:518-520`) |
| 48 | App→User | Show `insufficientReason` text when set (`:521-523`) |
| 49 | App→User | Show "Couldn't load…try again shortly" when `realFetchFailed` (`:524-526`) |
| 50 | App→User | Fallback "No classes yet…" when none of the above and no `comparison` (`:527-529`) — **see Finding 2: this is the state reached on silent auth failure too** |
| 51 | App→User | Render `RateCompare` widget when `comparison` resolved (`:515-517`) |

### Classes/schools fetch (feeds the pickers)

| # | Direction | Message |
|---|-----------|---------|
| 52 | App→App | `watch(currentUser, …, { immediate: true })` fetches classes (and schools for govt_admin) once identity resolves; covers both already-resolved (SPA nav) and late-resolving (direct load/reload) cases (`:103-107`) — regression-tested, see below |
| 53 | App→App | `useClassesData().fetchClasses()` — role-scoped (teacher/school_admin/govt_admin) (`:92`) |
| 54 | App→App | `useSchoolData().fetchSchools()` — govt_admin only (`:94`, `:106`) |
| 55 | App→App | `useClassesData` sets its own `error` ref on fetch failure (`useClassesData.ts:312-314`) — **never read by this view, see Finding 3: MISSING TWIN** |
| 56 | App→App | `useSchoolData` sets its own `error` ref on fetch failure (`useSchoolData.ts:320-321`) — **never read by this view, see Finding 3: MISSING TWIN** |

---

## Regression tests validated (Session 1/2/3 evidence)

Both test files exist and pass the "fix wired" check by construction (they assert against the real
`useSchoolContext()` composable, not a mock):

- `TeacherInsightsView.classesFetch.test.ts:32-49` — proves the immediate `watch(currentUser, …)`
  shape fetches once identity resolves, and the old one-shot-call shape (lines 16-30) never fires.
- `TeacherInsightsView.currentUserRetry.test.ts:38-57` — same proof plus the already-resolved SPA-nav
  case (`:59-73`).

These validate that message **#52** in the table above is real (component code
`TeacherInsightsView.vue:103-107` matches the tested "fix" shape exactly), closing what the tests
call the "/schools/analytics dead on direct load" bug class. No further finding needed here — this
is the one Session-3 flow with direct test coverage.

---

## Findings (classed 1–5)

### Finding 1 — UNSPECIFIED CONTENT (class 4): deep-link preview note shows wrong content in real mode
**File/line**: `TeacherInsightsView.vue:229` (scope switch, demo-gated) and `:406-410` (note render,
NOT demo-gated).

The scope-switch-to-`'learner'` on a `?scope=learner` deep link is gated `if (demoMode && …)`
(`:229`), so in real (non-demo) mode the view stays in `scope: 'class'` — the widget renders real
class-level data. But the preview note itself (`:406`, `v-if="requestedLearnerName"`) has no
`demoMode` guard: `requestedLearnerName` derives purely from `route.query.name` (`:225-228`), so
navigating to `/schools/analytics?name=Some+Student&scope=learner` (exactly the deep link the
Students table "View →" constructs, per the view's own comment at `:218-223`) renders, in real
mode: "Opened in learner view for **Some Student**. The figures below are a seeded preview — live
per-learner rates arrive once your school's telemetry is wired." — while the widget beneath is
actually showing real, class-level (not learner-level, not seeded) data. The message asserts a
state (learner view, seeded preview) that is false for a real-mode caller.

**Failure scenario**: A teacher (real, non-demo) clicks "View →" on a student in
`/schools/students`, landing on `/schools/analytics?scope=learner&learner=<id>&name=Aoife`. They
see "Opened in learner view for Aoife… seeded preview" above a widget that is in fact their real
whole-class comparison — the note actively misdescribes what's on screen.

### Finding 2 — MISSING TWIN (class 3): silent no-op on missing auth token during real fetch
**File/line**: `TeacherInsightsView.vue:334-336` inside `fetchRealComparison()` (`:323-359`).

`if (!token) return` exits the `try` block with no error/reason set. `finally` still clears
`isLoadingReal` (`:357`), but neither `realFetchFailed` nor `realInsufficientReason` is set, so the
template falls through every conditional (`comparison` null, `isLoadingReal` false,
`insufficientReason` null, `realFetchFailed` false) to the final default at `:527-529`: "No classes
yet — once you have a class with sessions, its rate compares here." An expired/missing session is
reported to the user identically to "you have no classes" — an App→App process (auth resolution)
with no distinct App→User twin for its failure mode.

**Failure scenario**: A teacher's Supabase session token has expired/is not yet hydrated when this
view mounts (e.g. a slow token refresh race). `client.auth.getSession()` resolves with no
`access_token`; the fetch never fires; the teacher — who has classes — sees "No classes yet", which
is factually wrong and offers no path to recovery (re-login isn't suggested).

### Finding 3 — MISSING TWIN (class 3): composable fetch errors never surfaced
**File/line**: `TeacherInsightsView.vue:92` (`useClassesData` destructure — `error` not taken) and
`:94` (`useSchoolData` destructure — `error` not taken); validating the errors exist at
`useClassesData.ts:312-314` and `useSchoolData.ts:320-321`.

`useClassesData()` and `useSchoolData()` both expose an `error` ref that they populate on a failed
Supabase fetch (`useClassesData.ts:312-314`: `error.value = err instanceof Error ? err.message :
'Failed to fetch classes'`; same pattern in `useSchoolData.ts:320-321`). `TeacherInsightsView.vue`
destructures only `{ classes: realClasses, fetchClasses }` (`:92`) and `{ schools: govtSchools,
fetchSchools }` (`:94`) — the `error` field is never pulled in, never bound in the template. A
failed classes/schools fetch (network blip, RLS denial, transient 500) leaves `realClasses`/
`govtSchools` empty with no visible error; the view degrades silently to whatever empty state its
downstream pickers produce (empty Course select → `realCourseOptions` `[]` → the pickers render
with nothing to choose, and eventually the widget area shows the generic "No classes yet" message
at `:527-529`) rather than a genuine "couldn't load your classes" message.

**Failure scenario**: A govt_admin's `fetchSchools()` call fails (e.g. RLS/network). `govtSchools`
stays `[]`. The "Your schools" select at level=school (`:450-453`) renders with zero options and no
indication anything went wrong — indistinguishable from "you have no schools in scope", which is
never actually true for a govt_admin.

---

## Finding count by class

| Class | Count |
|---|---|
| 1 — UNTYPED | 0 |
| 2 — UNVALIDATED | 0 |
| 3 — MISSING TWIN | 2 |
| 4 — UNSPECIFIED CONTENT | 1 |
| 5 — UNREACHABLE/ORPHAN | 0 |
| **Total** | **3** |

## Worst finding

**Finding 2** (silent no-op on missing auth token, `TeacherInsightsView.vue:334-336`) — it's the one
finding that actively lies to a user who has real, legitimate data ("No classes yet" to a teacher
who has classes), with no retry affordance and no signal that anything is wrong, on a route this
audit's own regression tests exist specifically to keep from going dark again.

---

# Section 6 — /schools/play and /schools/upgrade (new routes, never previously audited)

# Schools Play Route — Trinity Compliance Audit

> **Date**: 2026-07-17
> **Scope**: `/schools/play` only — the `schools-play` route (`router/index.ts:209-216`), rendered
> as a child of `SchoolsContainer` with `PlayerContainer` as its component. Covers entry into and
> exit from a class-play session from the schools shell: the route guard, the two entry mechanisms
> (Play-as-class, Learn), the embedded shell/top-bar wiring, and class-session start/end.
> **Explicitly out of scope**: generic player internals (phase cycling, audio playback, belt
> progress, round loading) — those are `LearningPlayer`'s own concern, not schools-specific.
> **Trinity**: App→User (output) | User→App (input) | App→App (processing)

---

## Screen: Class Play Session (`schools-play` route)

### Route guard & shell mount (inherited from parent `/schools`)

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→App | Parent `/schools` `beforeEnter` guard runs for `/schools/play` too (child routes inherit it) — restores role cache, redirects ssi_admins to `/admin/setup`, redirects non-members to `/tutors/dashboard` or `/` (`router/index.ts:94-122`) |
| 2 | App→User | A plain learner (`hasSchoolRole=false`) hitting `/schools/play` is bounced to `/` before the route ever mounts — validated by `schoolsGuard.test.ts:50-54` |
| 3 | App→User | A school-role user (teacher/school_admin/govt_admin) reaches `/schools/play` directly — validated by `schoolsGuard.test.ts:56-60` |
| 4 | App→App | `SchoolsContainer` mounts `SchoolsTopBar` + `router-view` unconditionally for any authenticated, entitled school member — `schools-play` gets no special auth/platform handling beyond the shared `showDashboard` gate (`SchoolsContainer.vue:496-527`) |
| 5 | App→User | `isPlayRoute` (`route.name === 'schools-play'`) strips `.main-content`'s padding/max-width so the player fills the area below the top bar instead of sitting in a centred card (`SchoolsContainer.vue:274, 508, 553-559`) |
| 6 | App→User | `SchoolsTopBar` stays mounted and visible above the player for the entire session — tabs, school badge, user menu, and the "Learn" button all remain clickable (`SchoolsContainer.vue:496-527`, `SchoolsTopBar.vue:117-193`) |

### Entry 1 — Play-as-class (from Dashboard / TeacherDashboard / ClassDetail)

| # | Direction | Message |
|---|-----------|---------|
| 7 | User→App | Click "▶ Play" / "▶ Play as class" on a class row (`DashboardView.vue:347,387`, `TeacherDashboard.vue:468`) or "Play as Class" on Class Detail (`ClassDetail.vue:336`) |
| 8 | App→App | All three call the ONE shared launch path, `usePlayAsClass().launchClassSession(cls)` (`usePlayAsClass.ts:71-106`) |
| 9 | App→App | Permission check: `canPlayAsClass = isSchoolStaff && !isAdminView` — govt_admins and the ssi_admin read-only god-view are excluded (`usePlayAsClass.ts:39-43`). All three call sites also gate the BUTTON itself on `v-if="canPlayAsClass"`, so a non-staff role never sees the control at all |
| 10 | App→App | Guard: refuses to launch if `cls.id` or `cls.course_code` is missing — prevents the "half-loaded class" bug where `ClassDetail`'s Play was clickable before its fetch completed (`usePlayAsClass.ts:71-76`) |
| 11 | App→App | Forces the app onto the class's course FIRST via `switchActiveCourseTo()` (catalogue lookup, Supabase fallback) — avoids racing `PlayerContainer`'s own `onMounted` class-context check against `App.vue`'s async course-catalogue fetch (`usePlayAsClass.ts:46-60, 77-90`) |
| 12 | App→App | Refuses to launch (logs `console.error`, writes nothing) if the class's `course_code` doesn't resolve to a real course row — the "phantom course code" bug (`usePlayAsClass.ts:83-90`) |
| 13 | App→App | On success: writes `localStorage['ssi-last-course']` and `localStorage['ssi-active-class']` (id, name, course_code, current_seed, last_lego_id, class_learner_id, teacherUserId, timestamp), then `router.push({ path: '/schools/play', query: { class: cls.id } })` (`usePlayAsClass.ts:91-105`) |
| 14 | App→User | On ANY refusal (10 not-staff, permission fail, missing id/course, or 12 course-not-found) — **nothing is shown to the user.** `handlePlayClass`/`handlePlay` in all three call sites (`DashboardView.vue:264-270`, `TeacherDashboard.vue:286-289`, `ClassDetail.vue:243-246`) `await` the call and ignore its boolean return value entirely. See Finding F1. |
| 15 | App→User | `ClassDetail` additionally disables the button itself via `:disabled="!canLaunch"` while the class row is still loading (`ClassDetail.vue:239-241, 336`) — this ONE refusal path (10, missing id) does get a UI signal (disabled control); the course-not-found refusal (12) does not, even there |
| 16 | App→App | `PlayerContainer.onMounted` reads `?class=<id>` from the URL, then `localStorage['ssi-active-class']` (or `sessionStorage['ssi-demo-active-class']` in demo mode), parses it into `classContext`, and force-selects the class's course if it isn't already active (`PlayerContainer.vue:392-409, 506-517`) |
| 17 | App→User | `LearningPlayer` renders with `classContext` set → belt progress, cursor, and every progress write key off the CLASS's learner id (`class_learner_id`), not the driving staff member's own (`LearningPlayer.vue:684-692`) |
| 18 | App→App | `startClassSessionTracking()` fires once the session/round data finishes initializing (guarded on `props.classContext` truthy) — `INSERT class_sessions (class_id, teacher_user_id, start_lego_id)`; teacher_user_id read from the AUTH uid; skipped entirely (no row, no error) if there is no auth uid, e.g. a guest (`LearningPlayer.vue:757-784, 11961-11964`) |
| 19 | App→User | No App→User confirmation that a class session actually started or that its `class_sessions` insert failed — only a `console.error`/`console.log` (`LearningPlayer.vue:778-783`). See Finding F4. |
| 20 | App→App | The player's own legacy `.class-bar` ("Back to classes") banner is suppressed here — `isTeachEmbedded` (true for `schools-play`) hides it so the schools top bar is the single nav source (`PlayerContainer.vue:52-59, 522`, `LearningPlayer.vue:13462`) |

### Entry 2 — "Learn" (own practice, no class)

| # | Direction | Message |
|---|-----------|---------|
| 21 | App→User | `SchoolsTopBar` always renders a "Learn" pill button, `<router-link to="/schools/play">` (no `?class=` query), for every authenticated school-role user regardless of current route (`SchoolsTopBar.vue:166-176`) |
| 22 | User→App | Click "Learn" |
| 23 | App→App | Router navigates to `/schools/play` with no query. `PlayerContainer`'s `checkClassContext()` finds no `class` param → returns `false` without touching `classContext` (`PlayerContainer.vue:392-409`) |
| 24 | App→User | Player renders staff member's own personal course/progress (the common, first-visit case, since `PlayerContainer` mounts fresh with `classContext.value === null`) |

### Exit paths

| # | Direction | Message |
|---|-----------|---------|
| 25 | User→App | Click any `SchoolsTopBar` tab (Dashboard/Students/Classes/Teachers/Analytics/Settings) while on `/schools/play` |
| 26 | App→App | Router navigates to a different route record/component → `PlayerContainer`/`LearningPlayer` unmount → `LearningPlayer`'s `onUnmounted` fires `endClassSessionTracking()`: `UPDATE class_sessions SET ended_at, end_lego_id, cycles_completed, duration_seconds` (`LearningPlayer.vue:12443-12472, 787-802`) |
| 27 | App→User | No App→User confirmation the session was recorded/ended, and no App→User surfacing if the `UPDATE` errors — `console.error`/`console.log` only (`LearningPlayer.vue:799-800`). Same MISSING TWIN shape as #19. |
| 28 | User→App | Click "Learn" (SchoolsTopBar) **while already in a class-play session** (`/schools/play?class=X` → `/schools/play`) |
| 29 | App→App | Same route name (`schools-play`), only the query string changes — Vue Router does NOT remount `PlayerContainer` on a same-route query-only navigation. `checkClassContext()` lives in `onMounted` only; it never re-runs. `classContext.value` is never cleared. See Finding F2 (the headline defect). |
| 30 | App→User | The class-bar is still suppressed (`isTeachEmbedded` is still true — `schools-play` regardless of class param), so there is no visual sign anything is wrong; the URL now reads `/schools/play` with no class id, but the player is silently still running the class's session (class's learner id, class's cursor, the still-open `class_sessions` row from step 18) |
| 31 | App→App | `handleExit` (`LearningPlayer.vue:10304-10318` — stops playback, ends belt session, `emit('close')`) is **dead code**: not bound to any template control, not in `defineExpose` (`LearningPlayer.vue:12793-12821`), and its only listener (`PlayerContainer`'s `@close="handleGoHome"`, line 537) is therefore unreachable from any real user action on this route. `handleGoHome`'s `clearClassContext()` (`PlayerContainer.vue:412-433`) is consequently also unreachable in normal use. See Finding F3. |
| 32 | App→App | Because of #31, `localStorage['ssi-active-class']` is never explicitly cleared on exit by any code path reachable from this screen — it is only overwritten by the next `launchClassSession` call, or wiped incidentally by `App.vue`'s unrelated stale-demo-tier cleanup (`App.vue:89-94`). No functional leak results today because entry (#16, #23) requires the URL's own `?class=` param before it will read that key — but it is stale storage with no owning code path. |

---

## Findings (classed 1–5)

### F1 — MISSING TWIN (class 3): `launchClassSession` failure has no App→User message
**File/line:** `usePlayAsClass.ts:71-106`; call sites `DashboardView.vue:264-270`, `TeacherDashboard.vue:286-289`, `ClassDetail.vue:243-246`.
`launchClassSession` returns `false` on three distinct refusal paths — not-staff, missing `id`/`course_code`, and course-code-not-in-catalogue — logging only to `console.warn`/`console.error`. All three call sites `await launchClassSession(cls)` and discard the boolean. A teacher who clicks "Play as class" on a class whose `course_code` doesn't resolve (the exact "phantom `cym_for_eng_north`" bug the guard at line 83-90 exists to prevent) sees **the button do nothing** — no toast, no disabled state, no retry hint. `ClassDetail`'s `canLaunch` (line 239) only covers the "still loading" refusal, not the course-not-found one, and `DashboardView`/`TeacherDashboard` don't cover any refusal.

### F2 — UNTYPED / silent state divergence (class 1): "Learn" click during a class session doesn't exit it
**File/line:** `SchoolsTopBar.vue:166-176` (Learn link) → `PlayerContainer.vue:392-409` (`checkClassContext`, `onMounted`-only).
Clicking "Learn" while playing a class navigates `/schools/play?class=X` → `/schools/play` — same route record, so Vue Router does not remount `PlayerContainer`. `checkClassContext()` only runs in `onMounted`, so `classContext.value` is never cleared and the player keeps running the class's session (class learner id, class cursor, the open `class_sessions` row) under a URL that now reads as personal practice. This is the strongest, directly-reachable defect on this screen — every school-staff user has the "Learn" button visible on every `/schools/play` render, including mid-class-session (row #6/#21).
**Fix shape (not applied — audit only):** either give `router-link to="/schools/play"` a `:key` that changes when leaving class mode, or add a `watch(() => route.query.class, ...)` in `PlayerContainer` mirroring the existing `onMounted` logic, calling `clearClassContext()` when the param disappears.

### F3 — UNREACHABLE/ORPHAN (class 5): `handleExit` / `clearClassContext` dead code
**File/line:** `LearningPlayer.vue:10304-10318` (`handleExit`, not in `defineExpose` at `12793-12821`, no template binding anywhere in the file); `PlayerContainer.vue:412-433` (`clearClassContext`/`handleGoHome`, only reachable via `@close` which nothing fires).
The one function that both ends belt session state AND clears `classContext`/`ssi-active-class` on exit is not wired to anything a user can click. This is the root cause enabling F2 and the stale-storage tail in row #32 — there is no "leave the class cleanly" code path on this screen at all; the only clean exits are route changes to a *different* route (which unmount-and-reinit, sidestepping the need for `handleExit`).

### F4 — MISSING TWIN (class 3): class-session start/end writes have no App→User confirmation or failure surfacing
**File/line:** `LearningPlayer.vue:757-784` (`startClassSessionTracking`), `787-802` (`endClassSessionTracking`).
Both the `INSERT class_sessions` on entry and the `UPDATE class_sessions ... ended_at` on exit log only to `console.error`/`console.log` on failure. A teacher has no way to know a session failed to record (e.g. RLS/network failure on the insert) — the class simply plays with no session row, silently, and no retry or banner exists. Lower severity than F1/F2 (this is the class's analytics history, not the live session), but same failure shape as the house doc's "paywall-tap / metrics-write bug class" reference case.

### F5 — UNVALIDATED (class 2, minor): guest teacher_user_id silently skips session logging
**File/line:** `LearningPlayer.vue:759-763`.
`startClassSessionTracking` returns early with no error and no user-facing signal if `(auth as any)?.userId?.value` is falsy (a guest). Given `canPlayAsClass` already requires `isSchoolStaff` (a real, authenticated role), this path may be unreachable in practice — flagged as unconfirmed rather than a live defect; worth a one-line check against whether a school-staff session can ever have no auth uid.

---

## Summary

| Metric | Count |
|--------|-------|
| Screens/routes audited | 1 (`schools-play`) |
| Trinity messages | 32 |
| App→User | 10 |
| User→App | 4 |
| App→App | 18 |
| Findings | 5 |
| — MISSING TWIN (class 3) | 2 (F1, F4) |
| — UNTYPED (class 1) | 1 (F2) |
| — UNREACHABLE/ORPHAN (class 5) | 1 (F3) |
| — UNVALIDATED (class 2) | 1 (F5, unconfirmed severity) |
| Worst finding | **F2** — clicking the always-visible "Learn" button mid-class-session silently leaves the player running the class's identity/session under a URL that reads as personal practice; enabled by F3 (the only cleanup function on this screen is dead code) |

No fixes applied — per the campaign brief, fixes wait for founder review.

---

# Trinity Compliance Audit — UpgradeView.vue

> **Date**: 2026-07-17
> **Scope**: `packages/player-vue/src/views/schools/UpgradeView.vue`, route `schools-upgrade` (`/schools/upgrade`, `router/index.ts:217-222`), rendered inside `SchoolsContainer.vue`. Also reachable embedded in a trial-expired wall (per the component's own header comment).
> **Trinity**: App→User (output) | User→App (input) | App→App (processing)
> **Also read**: `useSchoolCheckout.ts`, `lib/paddle.ts`, `UpgradeView.laneResolution.test.ts`, `api/school/subscription.ts`, `api/school/update-seats.ts`, `SettingsView.vue`, `useSubscription.ts` (consumer-lane comparison).

This is a money-path screen: two lanes off one surface — **school_admin** (per-teacher-seat subscription, quantity checkout + in-place seat PATCH) and **solo tutor** (single-seat subscription, portal-managed). Findings pay special attention to Class 3 (missing success/failure twins around Paddle checkout).

---

## Screen: Upgrade (UpgradeView.vue)

### Lane resolution (shared, runs before either lane renders)

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→App | Resolve `currentUser` from `useSchoolContext()` (async — may be null on first render) |
| 2 | App→App | `watch(currentUser, ..., {immediate:true})` re-decides `isSchoolLane` once identity resolves (`:355-374`) — **validated**, see `UpgradeView.laneResolution.test.ts` all 3 cases |
| 3 | App→App | School lane branch: `loadSubscription()` + `fetchTeachers()` fire once per resolution (`:363-365`) |
| 4 | App→App | Tutor lane branch: `resolveTutorTeacherId()` + `loadTutorSubscription()` fire once per resolution (`:369-372`) |

### School lane — not yet subscribed

| # | Direction | Message |
|---|-----------|---------|
| 5 | App→User | Display "Subscribe your school" title (`:384-386`) |
| 6 | App→User | Display per-seat price lede (£15/mo or £150/yr) (`:387-390`) |
| 7 | App→User | Display Monthly/Annual toggle, Annual disabled + tooltip if `!annualAvailable` (`:395-417`) |
| 8 | User→App | Click Monthly / Annual tab |
| 9 | App→App | `setBilling()` — no-op if same period or annual unavailable; re-prices an already-open checkout in place via `updateItems` (`:89-112`) |
| 10 | App→User | Display seat stepper (−/input/+), seat total in £, `/mo` or `/yr` suffix (`:419-434`) |
| 11 | User→App | Click −/+ or type a seat count |
| 12 | App→App | `setSeats()` clamps to `Math.max(1, Math.floor(n) || 1)` — **validated**: NaN/0/negative/decimal all coerce safely (`:124-126`) |
| 13 | App→User | Display checkout error if `checkoutError` set (`:445`) |
| 14 | User→App | Click "Subscribe — £X" (disabled while `!schoolId \|\| isOpeningCheckout \|\| !schoolSubLoaded`) (`:459-467`) |
| 15 | App→App | `subscribeSchool()`: re-check `loadSubscription()` if not yet loaded, bail if already subscribed (double-subscribe guard) (`:174-180`) |
| 16 | App→App | Set `checkoutOpen = true`, call `startSchoolCheckout()` (`:181-187`) — **see Finding 1: this line runs BEFORE `startSchoolCheckout`'s own validation** |
| 17 | App→App | `startSchoolCheckout()` validates priceId/schoolId/supabase session, sets `checkoutError` and returns early on any failure (`useSchoolCheckout.ts:46-67`) |
| 18 | App→App | On success: `paddle.Checkout.open()` mounts the inline iframe into `.paddle-inline-frame`, `customData.kind='school_platform'` (`useSchoolCheckout.ts:82-110`) |
| 19 | App→User | Sized inline Paddle iframe renders (`:531`, `.paddle-inline-frame`) |
| 20 | App→App | On Paddle checkout success: parent window redirected to `/schools/settings?just_subscribed=1` (`useSchoolCheckout.ts:108`) |

### School lane — already subscribed (seat management)

| # | Direction | Message |
|---|-----------|---------|
| 21 | App→User | Display "Manage your seats" title (`:384-386`) |
| 22 | App→User | Billing toggle hidden (seat-edit path is monthly-oriented) (`:395`) |
| 23 | App→User | Display honest "N teachers joined · M seats paid" note, with over-capacity warning if joined > paid (`:437-443`) |
| 24 | User→App | Change seat stepper |
| 25 | App→User | Button reads "Update to N seats — £X/mo", disabled if `seatCount === paidSeats` (`:453-456`) |
| 26 | User→App | Click "Update to N seats" |
| 27 | App→App | `updateSeats()` → `POST /api/school/update-seats` with auth header (`:190-211`) |
| 28 | App→User | Show "Updating…" on button while in flight (`:454-456`) |
| 29 | App→User | On success: `seatsMessage` = "Updated to N seats" or "No change" (`:205`) |
| 30 | App→User | On failure: `seatsMessage` = server's `data.error` or "Could not update seats" (`:203, 207`) |
| 31 | App→App | Server resolves caller's school from session only, never body (`api/school/update-seats.ts:72-92`) — **validated**: non-admin tag → 403 + audit log (`:93-112`); no school → 404 |
| 32 | App→App | Server clamps seats to `[1, 1000]`, rejects non-numeric with 400 (`api/school/update-seats.ts:57-62`) |
| 33 | App→App | Server translates Paddle `past_due`/`quantity_out_of_range` errors into admin-actionable messages (`:174-181`) |

### Tutor lane — not yet subscribed

| # | Direction | Message |
|---|-----------|---------|
| 34 | App→User | Display "Subscribe" title + lede (£15/mo or £150/yr, "3 paying students cover it") (`:472-476`) |
| 35 | App→User | Display Monthly/Annual toggle (same widget as school lane) (`:479-501`) |
| 36 | App→User | Display single-seat total (no stepper) (`:503-506`) |
| 37 | App→User | Display `tutorError` if set (`:507`) |
| 38 | User→App | Click "Subscribe — £X" (disabled while `tutorBusy \|\| !tutorTeacherId \|\| !tutorSubLoaded`) (`:517-525`) |
| 39 | App→App | `subscribeTutor()`: re-check `loadTutorSubscription()` if not yet loaded; if already platform-active, route to portal instead of checkout (double-subscribe guard) (`:292-299`) |
| 40 | App→App | Validate price id configured, else `tutorError` set and abort (`:300-308`) |
| 41 | App→App | Validate supabase session + email, resolve `teacherId`, else `tutorError` set and abort (`:309-322`) — **note: all validation happens BEFORE `checkoutOpen = true` (`:323`), unlike the school lane (Finding 1)** |
| 42 | App→App | `paddle.Checkout.open()` opens inline checkout, `customData.kind='tutor_platform'` (`:324-346`) |
| 43 | App→User | Sized inline Paddle iframe renders |
| 44 | App→User | On thrown error: `tutorError = err.message`, `checkoutOpen` reset to `false` (`:347-350`) — **this reset exists for the tutor lane but has no equivalent for the school lane** |
| 45 | App→App | On Paddle success: parent window redirected to `successUrl = window.location.href` (i.e. back to this same route, no query param) (`:344`) |

### Tutor lane — already subscribed

| # | Direction | Message |
|---|-----------|---------|
| 46 | App→User | Button reads "Manage subscription" (`:509-516`) |
| 47 | User→App | Click "Manage subscription" |
| 48 | App→App | `openTutorPortal()` → `GET /api/teacher/portal`, redirects `window.location.href` to Paddle's portal URL on success (`:279-290`) |
| 49 | App→User | On failure (no session / no portalUrl / fetch throws): `tutorError = 'Could not open the billing portal — try again'` (`:289`) |

---

## Findings (classed 1–5)

### Finding 1 — CLASS 3 (MISSING TWIN) — school-lane checkout-open flag set before validation, no reset on failure
**File/line**: `UpgradeView.vue:181` (`checkoutOpen.value = true`) called immediately before `startSchoolCheckout()` at `:182-187`; `useSchoolCheckout.ts:53-67` returns early (setting `checkoutError` only) on missing price id / missing `schoolId` / missing supabase session, **without ever touching `checkoutOpen`**.
Template gating: the "Subscribe" button only renders `v-else-if="!checkoutOpen"` (`:459-467`); the seat-edit button only renders `v-if="isSubscribed"` (`:449-457`). If `startSchoolCheckout` fails any of its three validations, `checkoutOpen` stays `true` forever, so **neither button re-renders** — the admin is left staring at `checkoutError`'s text above an empty, never-mounted `.paddle-inline-frame` div, with no control on the page to retry short of a full page reload.
Contrast: the tutor lane (`:292-353`) does all equivalent validation (price id, supabase session, email, teacher id resolution) **before** setting `checkoutOpen = true` at `:323`, and resets it to `false` in the `catch` block at `:349` if `paddle.Checkout.open()` itself throws. The school lane is the odd one out.
**Failure scenario**: a school admin whose `VITE_PADDLE_SCHOOL_TEACHER_PRICE_MONTHLY` env var and the fallback teacher price are both unset (or whose Supabase session has silently expired) clicks "Subscribe". `checkoutError` shows a message, but the page is now permanently dead — no button, no way back — until they reload `/schools/upgrade` from scratch.

### Finding 2 — CLASS 3 (MISSING TWIN) — school lane ignores `school_past_due`, re-opening a double-bill risk the tutor lane was explicitly fixed for
**File/line**: `UpgradeView.vue:130-132` (`isSubscribed = computed(() => platformStatus.value === 'active')`) vs. `api/school/subscription.ts:161-168,227` which computes and returns a dedicated `school_past_due` field specifically so — per its own comment — "the client can show a payment-problem banner instead of a silent grace." Neither `UpgradeView.vue` nor `SettingsView.vue` reads `school_past_due` anywhere (confirmed by grep — zero matches for the field name in either file).
The tutor lane in the same component was hardened against exactly this: `tutorPlatformActive.value = data?.teacher_paid === true` (`:273`), where `teacher_paid` is server-computed as `['active','past_due'].includes(status)` (`api/school/subscription.ts:181`) — the comment at `:268-272` explains this was a fix for "a raw `status==='active'` check missed `past_due`: a declined-card tutor saw 'Subscribe' and could open a second concurrent subscription."
**Failure scenario**: a school's card is declined and Paddle sets `platform_status = 'past_due'` (still billing, still dunning). `isSubscribed` becomes `false`, so the school lane shows "Subscribe your school" again with the initial-checkout CTA rather than "Manage your seats". If the admin clicks it, `subscribeSchool()` sees `isSubscribed.value === false` and opens a **second** initial checkout — a second live Paddle subscription, double-billing the school. This is precisely the incident class the tutor-lane fix (`:268-272`) documents having already happened once.

### Finding 3 — CLASS 3 (MISSING TWIN) — no success confirmation or activation-lag handling after school checkout, unlike the consumer lane
**File/line**: `useSchoolCheckout.ts:108` redirects Paddle's successUrl to `/schools/settings?just_subscribed=1`; `SettingsView.vue:97-104,168-171` fetches `/api/school/subscription` exactly once on mount and never inspects `route.query.just_subscribed` (confirmed by grep — no match in the file).
Compare to the consumer/learner lane: `useSubscription.ts:316-343` explicitly polls (`pollUntilActive`, up to 30s) when `just_subscribed=1` is present, specifically because "the activating webhook may lag the page load by a few seconds — without this the just-subscribed learner would briefly re-hit the paywall."
**Failure scenario**: a school admin completes payment in the inline checkout, Paddle redirects to Settings, and the `subscription.updated` webhook hasn't landed yet. Settings' one-shot fetch reads `platform_status` as still `trial`/unset and shows no success banner and no "still activating…" state — the admin, having just paid, sees nothing different from before paying, and reasonably concludes the payment failed (silent-failure UX on a money path).

### Finding 4 — CLASS 4 (UNSPECIFIED CONTENT) — tutor-lane post-checkout return has no success signal either
**File/line**: `UpgradeView.vue:344` sets `successUrl: window.location.href` (i.e. back to the current `/schools/upgrade` — or wherever this component is embedded — with no query param at all). On return, `watch(currentUser, ...)` (`:361-374`) re-fires `loadTutorSubscription()`, and if the webhook has landed, the button silently becomes "Manage subscription" (`:509-516`). If it hasn't landed yet, the "Subscribe — £X" CTA re-renders unchanged.
**Failure scenario**: same webhook-lag window as Finding 3, but for a solo tutor: a successful payment can redirect back to a page that still shows "Subscribe — £15/mo" with no explanation, no toast, no distinguishing state from a never-attempted checkout — a tutor who clicks it again mid-lag is not guarded against by anything client-side (only the server-side `teacher_paid` check on the NEXT `subscribeTutor()` call protects against a genuine double-checkout, and only once the webhook has actually landed).

### Finding 5 — CLASS 5 (UNREACHABLE/ORPHAN) — no cancel/back control once the inline checkout is open
**File/line**: `UpgradeView.vue:531` (`<div v-show="checkoutOpen" class="paddle-inline-frame">`) with no sibling "Back"/"Cancel" button in either lane's template block (`:419-467`, `:470-525`). Once `checkoutOpen` becomes `true`, the only elements shown are the (now-hidden, per lane's `v-else-if`) buttons disappearing and the iframe appearing — there is no in-app control to abandon/close the inline checkout and return to plan selection (e.g. to change seat count after already opening checkout, since the seat stepper itself is separately disabled while `checkoutOpen` — `:422,428,431`).
**Failure scenario**: an admin opens checkout, then decides they picked the wrong seat count or billing period before completing payment. Seat controls are disabled (`:422-431`); the only recourse is the billing toggle (still live, re-prices in place per Finding-adjacent code at `:96`) — seats cannot be changed once checkout is open, and there's no way to close the iframe and start over except a full page reload.

### Finding 6 — CLASS 2 (UNVALIDATED, minor) — `updateSeats()` doesn't branch on the server's `requires_checkout` signal
**File/line**: `api/school/update-seats.ts:126-132` returns `409 { error: 'No active subscription; start one first', requires_checkout: true }` when the school has no `provider_subscription_id`. `UpgradeView.vue:190-211` (`updateSeats()`) only reads `data.error` into `seatsMessage`; it never checks `data.requires_checkout` to redirect the admin into `subscribeSchool()`'s initial-checkout path instead.
**Failure scenario**: low severity in practice since the seat-edit button only renders when `isSubscribed` is already `true` (`:449`) — but if `isSubscribed` is ever stale/wrong (e.g. exactly the Finding 2 `past_due` gap, or a race on `paidSeats`), the admin sees a dead-end error text ("start one first") with no button on the page that starts one, since the initial-Subscribe CTA is hidden by the same `v-if="isSubscribed"` / `v-else-if` split.

---

## Summary

| Metric | Count |
|--------|-------|
| Screens audited | 1 (UpgradeView.vue, both lanes) |
| Trinity messages catalogued | 49 |
| App→User | 20 |
| User→App | 13 |
| App→App | 16 |
| **Findings** | **6** |
| Class 1 (UNTYPED) | 0 |
| Class 2 (UNVALIDATED) | 1 (Finding 6) |
| Class 3 (MISSING TWIN) | 4 (Findings 1, 2, 3, 4) |
| Class 4 (UNSPECIFIED CONTENT) | 1 (Finding 4, dual-classed with 3) |
| Class 5 (UNREACHABLE/ORPHAN) | 1 (Finding 5) |
| **Worst finding** | **Finding 1** — school-lane `checkoutOpen` set before validation, no failure reset → a validation failure permanently kills the page with no retry control, on the money-path screen |

**Test coverage note**: `UpgradeView.laneResolution.test.ts` validates exactly one thing — the `watch(currentUser, ...)` lane-resolution fix (message #2 above). None of the checkout-open, success/failure, seat-update, or portal-redirect messages have any test coverage; every finding above was traced by reading the actual source, not by a failing/passing test.

---

# Section 7 — Admin read-view family (/admin/schools/:id, /admin/groups/:id, /admin/classes/:id, /admin/users/:learnerId/progress)

# Admin Read-Views (`/admin/schools/:id`, `/admin/groups/:id`, `/admin/classes/:id`, `/admin/users/:learnerId/progress`) — Trinity Compliance Audit

> **Date**: 2026-07-17
> **Scope**: The four `ssi_admin`/`god`-only read-view route families that let an admin see any school/group/class/learner's dashboard without impersonation (`packages/player-vue/src/router/index.ts:451-533`, shipped `8bf028da` "phase 4", 2026-04-23).
> **Trinity**: App→User (output) | User→App (input) | App→App (processing)
> **House format**: mirrors `docs/schools-trinity-audit.md` (2026-04-11).

---

## Session 1/2/3 — shared write-up (the common admin-read-view pattern)

All four route families share one container-guard shape: `AdminSchoolsContainer.vue`, `AdminGroupContainer.vue`, `AdminClassDetail.vue`, `AdminUserProgress.vue` each (a) gate the route itself via the global router guard, (b) resolve a `:id`/`:learnerId` route param into a `useSchoolContext` scope, (c) `provide('isAdminView', true)`, and (d) mount the *same* child views the real school/govt-admin uses (`DashboardView`, `TeacherDashboard`, `ClassDetail`, `StudentsView`, `TeachersView`, `AnalyticsView`, `SchoolsView`, `StudentProgressView`) — no separate "admin-view" component tree exists.

**Session 1 (System→User).** Loading state is specified for all four (`schools-loading` / spinner + copy). Error content exists for two of four (`AdminClassDetail.vue:82-84`, `AdminUserProgress.vue:86-103` both render `loadError`) but is **absent as a reachable state** for the other two — see Finding 2 below; the underlying loaders never populate it. No 404-specific copy anywhere — every "not found" case degrades to either a generic error string or (worse) silent blank content, never a distinct "this school/group/learner doesn't exist" message.

**Session 2 (User→System).** Auth/authorization: `router.beforeEach` (`router/index.ts:674-686`) gates `to.path.startsWith('/admin')` — covers all four families in one guard — deferring (not denying) while the role cache is unresolved, denying (`next('/')`) once it resolves `canAccessAdmin === false`. This is **client-side only**; see Session 3 for the server-side backstop. Input validation on the route param itself: none of the four loaders validate `:id` shape before querying — a malformed UUID just produces a Postgres query with no rows, indistinguishable from "valid but nonexistent" (same downstream gap as Finding 2).

**Session 3 (System→System).** The container doc-comments assert "queries still run under the real admin's Supabase session... RLS-ready: when RLS lands, admin access will flow through admin-bypass rules, not a fake identity" (`AdminSchoolsContainer.vue:7-13`, matching CLAUDE.md's Schools Dashboard section). This is **now true for learner-scoped reads**: `can_view_learner_data(p_learner_id)` (`supabase/migrations/20260716c_can_view_class_learner_data.sql:24-56`) explicitly OR-branches on `is_ssi_admin()` and `is_god_user()`, and its own doc-comment confirms `course_enrollments_scoped_select` calls it. So an admin's read of another learner's `course_enrollments` is server-validated, not merely client-scoped — **confirmed, not assumed**. I could not find the `CREATE POLICY` statements for `seed_progress`, `lego_progress`, or `learner_speaking_opportunities` (all read by `StudentProgressView.vue`) checked into `supabase/migrations/` — per CLAUDE.md's canary doctrine these were very likely applied live and never back-filed as a migration. This is a **citation gap, not a defect**: I can confirm the pattern exists and is doctrine-conformant for one of the four tables the view reads; the other three are plausible-but-unverified from the repo alone. Org-level tables (`schools`, `groups`, `classes`) were **RLS-off by design** at the time this session was written, per CLAUDE.md's "Tighten RLS on the schools org tables" section. **Correction, 2026-08-06: that has since changed** — CLAUDE.md's org-table RLS pass has landed; all six org tables (including `schools`, `groups`, `classes`) now carry `relrowsecurity=true` with real policies, verified live. `loadFromSchoolId`/`loadFromGroupId`/`AdminClassDetail`'s class→school lookup reads are therefore no longer unscoped at the DB layer — re-verify their actual behaviour under the new policies before relying on this session's "unscoped" finding. The **write-side gate** (`isAdminView` hiding write controls in child views) is a client-side-only mechanism with no server-side backstop for the one write path that escapes it — see Finding 1.

---

## Route family 1: `/admin/schools/:id/*` (AdminSchoolsContainer.vue → school_admin scope)

| # | Direction | Message |
|---|-----------|---------|
| 1 | User→App | Admin navigates to `/admin/schools/:id`(`/classes`\|`/classes/:classId`\|`/students`\|`/teachers`\|`/analytics`) |
| 2 | App→App | Global router guard checks `canAccessAdmin` (client-side; defers if role cache unresolved) — `router/index.ts:674-686` |
| 3 | App→App | `AdminSchoolsContainer` watches `[route.params.id, auth.learner]`, calls `ctx.loadFromSchoolId(id, realAdmin, supabase)` once both resolve — `AdminSchoolsContainer.vue:66-70` |
| 4 | App→App | `loadFromSchoolId` queries `schools` by `id`, sets `currentUser` with `educational_role: 'school_admin'`, keeps the **real** admin's `user_id`/`learner_id` for write attribution — `useSchoolContext.ts:329-358` |
| 5 | App→User | Show spinner "Loading school…" while `isLoading` |
| 6 | App→User | On error (thrown from `loadContext`'s try/catch — currently unreachable, see Finding 2): show `loadError` text |
| 7 | App→App | `provide('isAdminView', true)` — read by every mounted child view |
| 8 | App→User | Render `DashboardView`/`TeacherDashboard`/`ClassDetail`/`StudentsView`/`TeachersView`/`AnalyticsView` with write controls hidden (Create Class, Save Settings, Add Student, Add Teacher, Remove Teacher, Play-as-class) |
| 9 | User→App | Admin navigates away / route unmounts |
| 10 | App→App | `onUnmounted(() => ctx.clear())` — deterministic scope teardown so it can't leak into the next-mounted view — `AdminSchoolsContainer.vue:74` |

**Write-control audit for this family (validated by grep across every child view mounted here):**

| View | Write actions | Gated by `isAdminView`? |
|---|---|---|
| DashboardView (school_admin branch) | Create class links (×4) | ✅ `v-if="!isAdminView"` — `DashboardView.vue:296,356,396,512` |
| TeacherDashboard | Create Class button (×2) | ✅ `v-if="!isAdminView"` — `TeacherDashboard.vue:343,494` |
| ClassDetail | Play-as-class, Remove student | ✅ `canPlayAsClass = isSchoolStaff && !isAdminView` — `usePlayAsClass.ts:43`; Remove-student row action `v-if="!isAdminView"` — `ClassDetail.vue:394,397` |
| StudentsView | Add Student (`handleInvite`) | ✅ `v-if="!isAdminView"` — `StudentsView.vue:173`. No other write path exists in the file (verified: no `.insert`/`.update`/`.delete` calls outside `handleInvite`). |
| TeachersView | Bulk import, Invite, Remove teacher | ✅ all three gated via `canManageStaff = isSchoolAdmin && !isAdminView` — `TeachersView.vue:20,151,154,217` |
| AnalyticsView | none (period filter only, no writes) | N/A — genuinely read-only, confirmed no `.insert`/`.update`/`.delete`/mutating `fetch` in the file |

This route family is **compliant**: every write surface reachable through it is genuinely inert for an admin.

### Findings — Route family 1

1. **[Class 5 — ORPHAN/UNREACHABLE] The declared error state can never render.** `loadContext` (`AdminSchoolsContainer.vue:37-57`) only sets `loadError` inside its `catch` block, but `loadFromSchoolId` (`useSchoolContext.ts:340-358`) never throws — a `.single()` query for a nonexistent `schoolId` returns `{ data: null, error: {...} }` which is **destructured and discarded** (`const { data: school } = ...`), and the function proceeds to set `currentUser` with `school_name`/`region_code`/`group_id` all `undefined`. Visiting `/admin/schools/does-not-exist` never shows the "Couldn't load" error UI (`schools-loading` div at `AdminSchoolsContainer.vue:84-86`) — it silently renders a dashboard with blank school name/labels. **No 404 state exists for an invalid `:id`.**

---

## Route family 2: `/admin/groups/:id/*` (AdminGroupContainer.vue → govt_admin scope)

| # | Direction | Message |
|---|-----------|---------|
| 11 | User→App | Admin navigates to `/admin/groups/:id`(`/schools`\|`/analytics`) |
| 12 | App→App | Same global router guard as family 1 |
| 13 | App→App | `AdminGroupContainer` watches `[route.params.id, auth.learner]`, calls `ctx.loadFromGroupId` — `AdminGroupContainer.vue:57-61` |
| 14 | App→App | `loadFromGroupId` queries `groups` by `id`, sets `currentUser` with `educational_role: 'govt_admin'` — `useSchoolContext.ts:365-396` |
| 15 | App→User | Show spinner "Loading group…" while `isLoading` |
| 16 | App→User | On error: show `loadError` (same unreachability defect as Finding 2 — see Finding 3) |
| 17 | App→App | `provide('isAdminView', true)` |
| 18 | App→User | Render `DashboardView`/`SchoolsView`/`AnalyticsView` (govt_admin branches) |
| 19 | User→App | Click a school card in the group dashboard or schools list |
| 20 | App→App | `handleSchoolClick` correctly drills into the **nested admin route** (`schoolsLink('schools-list', { schoolId })` → `/admin/schools/:schoolId`) rather than ejecting the admin into their own `/schools` scope — `SchoolsView.vue:93-103`, citing the prior fix at `docs/audits/2026-07-13-bug-class-audit.md #1b` |
| 21 | App→App | `onUnmounted(() => ctx.clear())` |

**Write-control audit for this family:**

| View | Write actions | Gated by `isAdminView`? |
|---|---|---|
| DashboardView (govt_admin branch) | Save group name (`saveGroupName`), Save school name (`saveSchoolName`), **Create school** (`handleCreateSchool`) | ❌ **NOT gated** — see Finding 1 |
| SchoolsView | **Create school** (`handleCreateSchool` via the "+ Add school" button), Export (client-side CSV, non-mutating) | ❌ **NOT gated** — see Finding 1 |
| AnalyticsView | none | N/A — read-only |

### Findings — Route family 2

1. **[Class 2 — UNVALIDATED, HIGHEST SEVERITY] The admin read-view is not actually read-only: "Create school" is a live write with no `isAdminView` guard.**
   - `SchoolsView.vue:235` — `<button type="button" class="btn-play" @click="openAddModal">+ Add school</button>` carries **no** `v-if="!isAdminView"`, unlike every other write control in every other file audited here. `openAddModal` → `handleCreateSchool` (`SchoolsView.vue:133-139`) → `createSchoolInMyGroup()` (`useGovtAdminActions.ts:98-116`) → `POST /api/govt/create-school`.
   - Same gap in the govt_admin dashboard: `DashboardView.vue:611-626` — the "Add schools / Create school" card is gated only by `v-if="!isViewingSchool"` (an unrelated drill-down flag), not `isAdminView`. Two adjacent first-run cards in the same file (`showNameGroupCard` line 562, `showNameSchoolCard` line 587 — `saveGroupName`/`saveSchoolName`) have the same gap, reachable whenever `groupSummary.name_confirmed === false` for the group being viewed.
   - **Blast radius, verified server-side** (`api/govt/create-school.ts:77-87`): the endpoint derives `group_id` from the **caller's own** `govt_admins` row, never from the client payload or the `:id` being viewed — so this is not a cross-group write into the group the admin is looking at. But the consequence is still live and wrong in two distinct ways depending on the caller: (a) if the ssi_admin viewing `/admin/groups/:id` **also** happens to hold a `govt_admins` row for a *different* group (plausible — admins can wear both hats), clicking "+ Add school" while reading group X silently creates a real school in group Y with no indication that's what happened — a **misleading-target write**; (b) if the ssi_admin has no `govt_admins` row at all (the typical case), the call 403s with "Only a government admin governing a group can create schools" — a confusing failure with no admin-view-aware messaging.
   - This directly contradicts the family's own contract, stated in the container's doc-comment: "Provides `isAdminView = true` so child views can hide write controls" (`AdminGroupContainer.vue` mirrors `AdminSchoolsContainer.vue:10`). It is the one write surface that was missed when that contract was implemented.
   - **Fix shape** (not applied — audit only): wrap all four controls (`SchoolsView.vue:235`, `DashboardView.vue:611`, `:562`, `:587`) in `v-if="!isAdminView"`, matching every sibling write control audited above.

3. **[Class 5 — ORPHAN/UNREACHABLE] Same unreachable-error-state defect as Finding 2, for groups.** `loadFromGroupId` (`useSchoolContext.ts:365-396`) also discards the `.single()` error and proceeds with `group?.path`/`group?.name` as `undefined` rather than throwing — `AdminGroupContainer.vue`'s `loadError` branch is dead code for an invalid `:id`.

---

## Route family 3: `/admin/classes/:id` (AdminClassDetail.vue, standalone)

| # | Direction | Message |
|---|-----------|---------|
| 22 | User→App | Admin navigates to `/admin/classes/:id` |
| 23 | App→App | Global router guard (family 1's guard, same `/admin` prefix match) |
| 24 | App→App | `loadContext` queries `classes` for `school_id` by `id`; **`if (!cls) throw new Error('Class not found')`** — `AdminClassDetail.vue:40-45` |
| 25 | App→App | On found: `ctx.loadFromSchoolId(cls.school_id, realAdmin, supabase)` — same loader as family 1, so it inherits Finding 2's silent-degrade behaviour if `cls.school_id` itself is somehow orphaned (FK-improbable, not exercised) |
| 26 | App→User | Show spinner "Loading class…" while `isLoading` |
| 27 | App→User | **On error: show `loadError` text — this one genuinely works.** "Class not found" IS reachable, unlike Findings 2/3. |
| 28 | App→App | `provide('isAdminView', true)` |
| 29 | App→User | Render `ClassDetail.vue`, which resolves its own `:classId` via `route.params.classId || route.params.id` (`ClassDetail.vue:43`) — correctly handles the param-name mismatch between this standalone route (`:id`) and the nested family-1 route (`:classId`) |
| 30 | App→App | `onUnmounted(() => ctx.clear())` |

**Write-control audit:** identical to `ClassDetail.vue`'s coverage under family 1 (same component, same `isAdminView` gates) — compliant.

### Findings — Route family 3

None. This is the **best-implemented** of the four families: it's the only one that actually validates its route param against a real row and shows a working, distinct error message on failure.

---

## Route family 4: `/admin/users/:learnerId/progress` (AdminUserProgress.vue → StudentProgressView.vue, standalone)

**Does `AdminUserProgress.vue` render/reuse `StudentProgressView.vue`, or reimplement it?** — **It renders it as a genuine child component**, not a reimplementation. Confirmed:
- `AdminUserProgress.vue:13` imports `StudentProgressView from '@/views/schools/StudentProgressView.vue'`.
- `AdminUserProgress.vue:105` — `<StudentProgressView v-else />` — mounted with **zero props**; all context flows through the shared `useSchoolContext` singleton (`ctx.loadFromLearnerId(...)` at line 39, read back inside `StudentProgressView.vue:21` via `const { currentUser } = useSchoolContext()`) and the `isAdminView` provide/inject pair (`AdminUserProgress.vue:29` provides, `StudentProgressView.vue:24` injects).
- `StudentProgressView.vue` itself documents this at line 254: "This page is admin/teacher-facing ONLY (`AdminUserProgress.vue` is its **sole mount point**)... but the branch stays keyed on `isAdminView` (default `false`) so a genuine future self-view route gets the learner-voice copy for free." So the same file already anticipates being reused for a learner's own `/schools/student-progress` (the original CLAUDE.md-documented route) with no admin context — it's one component serving both, branched purely on the injected boolean, not two divergent implementations.

| # | Direction | Message |
|---|-----------|---------|
| 31 | User→App | Admin navigates to `/admin/users/:learnerId/progress` |
| 32 | App→App | Global router guard |
| 33 | App→App | `loadContext` queries `learners` by `id`; `if (!learner) return` — **early return, no throw** — `AdminUserProgress.vue:31-49`, `useSchoolContext.ts:403-429` |
| 34 | App→User | Show spinner "Resolving learner context…" while `isLoading` |
| 35 | App→User | On error: show `loadError` banner (reachable only for genuine exceptions — network/DB errors — never for "no such learner", see Finding 4) |
| 36 | App→App | `provide('isAdminView', true)` |
| 37 | App→App | `StudentProgressView.fetchProgress()` reads `currentUser.value.learner_id`; guards `if (!currentUser.value?.learner_id) return` — `StudentProgressView.vue:42` |
| 38 | App→App | Server-side read validation: `course_enrollments_scoped_select` policy calls `can_view_learner_data(learner_id)`, which OR-branches on `is_ssi_admin()`/`is_god_user()` — `20260716c_can_view_class_learner_data.sql:24-32` — **confirmed for this one table** (see Session 3 write-up for the other three) |
| 39 | App→User | Render belt/journey/course-list UI, second-person copy suppressed (`isAdminView` branches at `StudentProgressView.vue:259-288`) |
| 40 | User→App | Click "Keep going" CTA |
| 41 | App→App | **Blocked in admin view**: `handleKeepGoing` returns immediately if `isAdminView` — `StudentProgressView.vue:164-168`, explicitly documented as "Self-view only... an admin viewing another learner's progress must never launch a live play session as them" — this is the one write-adjacent action in this family and it's correctly gated |
| 42 | App→App | `onUnmounted(() => ctx.clear())` |

### Findings — Route family 4

4. **[Class 3 — MISSING TWIN, compounding the pattern from Findings 2/3] `/admin/users/does-not-exist/progress` silently renders a blank progress page instead of any error or 404.** This is the **worst instance** of the shared silent-degrade pattern because, unlike families 1/2, the guard here (`if (!learner) return` at `useSchoolContext.ts:417`) doesn't even proceed with a partially-populated `currentUser` — it leaves `currentUser.value` at its prior/`null` state entirely. Trace: `AdminUserProgress.vue`'s `finally` block still sets `isLoading = false` (line 46), and `loadError` was never set (no exception thrown), so the template falls past both the loading and error branches straight to `<StudentProgressView v-else />` (line 105) with `currentUser === null`. Inside `StudentProgressView.vue`, `fetchProgress()`'s guard (`!currentUser.value?.learner_id`) returns before setting `isLoading` or `error` at all (both stay at their initial `false`/`null`), so the component renders its **fully-populated success template** with every array/count at its zero-value: "No courses yet" empty card, "Demat, there." greeting (`display_name` undefined → falls back to `'there'`), 0d streak, 0h this week. **An admin who mistypes or follows a stale `:learnerId` link gets a page that looks like a real, valid, empty learner — not an error.** No App→User failure message exists for this App→App failure (classic "MISSING TWIN" — the query fails to resolve a target but there's no paired failure message).

---

## Summary

| Metric | Count |
|---|---|
| Route families audited | 4 |
| Screens/components covered | 4 containers + 8 shared child views (DashboardView, TeacherDashboard, ClassDetail, StudentsView, TeachersView, AnalyticsView, SchoolsView, StudentProgressView) |
| Total findings | 4 |
| By class | Class 2 (UNVALIDATED): 1 · Class 3 (MISSING TWIN): 1 · Class 5 (ORPHAN/UNREACHABLE): 2 |
| Compliant / no findings | Route family 3 (`/admin/classes/:id`) — fully compliant, the reference implementation for the other three |

**Worst finding: Finding 1** (`SchoolsView.vue:235`, `DashboardView.vue:611,562,587`) — the govt-admin group read-view's "Create school" (and two adjacent first-run "save name") controls are **not** gated by `isAdminView`, unlike every other write control across all four route families. This breaks the family's own read-only contract in a live, server-reachable way (a real `POST /api/govt/create-school`), even though the server-side `group_id` derivation happens to prevent the worst-case cross-group write. It is a single, mechanical, low-risk fix (add `v-if="!isAdminView"` to four existing elements, matching the pattern already used correctly everywhere else in the same files) — flagged here, not applied, per the audit brief.

**Scoping — server-side vs. client route param:** genuinely server-side for learner-scoped reads (`can_view_learner_data()` confirmed for `course_enrollments`; plausible-but-unverified-in-repo for the other three tables `StudentProgressView` reads). **Correction, 2026-08-06:** the org tables (`schools`/`groups`/`classes`) are no longer RLS-off — CLAUDE.md's org-table RLS pass has landed (verified live: `relrowsecurity=true` with real policies on all six org tables). The route-level admin gate itself (`canAccessAdmin`) is client-side with no visible server-side re-check in the four loaders; anyone who forges past the router guard now hits real RLS policies on the org tables, not the permissive-by-design grant this session found — re-verify those loaders' actual behaviour under current policies before relying on this session's finding.

**Invalid/nonexistent `:id` → 404 state:** defined and working for **1 of 4** route families (`/admin/classes/:id`, Finding-free). The other three (`/admin/schools/:id`, `/admin/groups/:id`, `/admin/users/:learnerId/progress`) all silently degrade instead of erroring — Findings 2, 3, 4.
