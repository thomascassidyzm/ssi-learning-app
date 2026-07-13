# Bug-class audit — schools + admin surface (2026-07-13)

Audit-only sweep of `packages/player-vue/src/views/schools/`, `views/admin/`,
`components/schools/`, `composables/schools/`, `containers/SchoolsContainer.vue`,
`views/RedeemCode.vue`, `views/onboarding/Onboarding.vue`, and the `api/`
endpoints they call, for five bug classes seen live in tonight's soak. No code
was changed as part of this audit; this document is the only commit.

Ranked by severity × likelihood a real school hits it during the Gwynedd
pilot. Every finding below was verified by reading the actual code (or, for
grant claims, the live `supabase/schema.sql`) — nothing here is speculative.
All 5 dispatched audit workers (+ their sub-sweeps) have now reported; this
is the complete sweep.

---

## Critical

### 1. [Class 4] Cross-tenant data exposure/write risk in admin act-as / read-only views
Three compounding bugs, all in the ssi_admin "view any school/group/learner" surface:

**1a. Stale scope leaks into the admin's own `/schools`.**
`useSchoolContext.ts:51,107-111` — `currentUser` is a module-level singleton, overwritten by every `Admin*Container`'s `loadFromSchoolId`/`loadFromGroupId`/`loadFromLearnerId`, but never cleared on unmount; `loadFromAuth` (called by the admin's own `/schools`) explicitly no-ops once anything is populated.

**1b. Shared dashboard components hardcode `/schools/...` self-paths.**
`DashboardView.vue`, `TeacherDashboard.vue`, `StudentsView.vue`, `SchoolsView.vue` are all mounted both as the learner's own `/schools/*` AND as `admin-school-*`/`admin-group-*` read-only routes, but every internal nav link is a hardcoded `/schools/...` path with no `isAdminView`/`:id` awareness.

**1c. `ClassDetail.vue` reads the wrong route param under admin nesting.**
`router/index.ts:428-431` defines `classes/:classId` nested under `/admin/schools/:id`, but `ClassDetail.vue:167,178` reads `route.params.id`, which resolves to the parent **school** id, not the class id.

**User-visible failure:** an ssi_admin who views another school/group/learner's dashboard, then navigates to their own `/schools` without a hard reload, sees the *other* entity's dashboard rendered as their own — and any write there attributes to the real admin against the wrong tenant's data. Clicking any class/student/teacher/analytics link from an admin read-view (1b) silently ejects into the admin's own scope while carrying the stale context from 1a, with write controls live. 1c is currently unreachable (blocked by 1b) but a landmine for any deep link once 1b is fixed.

**Fix size:** 1a small (clear singleton on unmount / key `loadFromAuth` on source, not presence); 1b small-to-medium (shared components need to build links relative to the current route prefix); 1c one-liner, ship together with 1b.

**Why #1:** this is the only finding in the whole sweep that's a genuine cross-tenant security/data-integrity issue rather than a broken feature — an admin's own actions can land against the wrong school's data without any error surfacing.

---

## Very high — will 403 on first touch, hits the pilot's first-run path directly

### 2. [Class 1] `schools`/`groups` tables have no `authenticated` write grant — 7 live call sites still write to them directly
**File:** `supabase/schema.sql:15168,15586` — `authenticated` has `SELECT,REFERENCES,TRIGGER,MAINTAIN` only on both tables; only `service_role` has `GRANT ALL`.

This is the exact same root cause as tonight's `SchoolsSetup.vue` group-dropdown 403 (fixed in commit `4007ac03`) — that fix repointed only one call site. Seven more remain raw:

| # | File:line | Call | User-visible failure |
|---|---|---|---|
| 2a | `useSchoolData.ts:256` `confirmSchoolName` | `.from('schools').update({school_name, name_confirmed})` | **Shipped tonight in `676d6f1c` and DOA on arrival** — the invite-born admin's brand-new "confirm your school name" first-run card fails every time. Worth prioritizing since it's new and currently non-functional. |
| 2b | `SetupView.vue:125` `saveSchool` | `.from('schools').update(updates)` | Admin onboarding wizard step 1 ("name your school") 403s — **blocks the entire setup wizard** for any new school admin, reached via two separate entry paths (direct setup + teacher join-code flow) |
| 2c | `SettingsView.vue:175` `saveSchoolProfile` | `.from('schools').update({school_name})` | School settings → rename school fails silently past the "Saving…" state |
| 2d | `SchoolsSetup.vue:793` `deleteSchool` (admin panel) | `.from('schools').delete()` | ssi_admin "Delete school" button 403s, feature entirely broken |
| 2e | `SchoolsSetup.vue:488` `createGroup` | `.from('groups').insert(insertData)` | ssi_admin "Create new group" (region/group hierarchy) 403s |
| 2f | `useSchoolContext.ts` (teacher join-code re-redemption path) | same singleton-staleness root cause as #1a, triggered via `SchoolsContainer.vue:33-42`'s one-shot watcher | Stale school context surfaces on a second join-code redemption in the same session |

**Fix size:** needs-endpoint for 2a/2b/2c (self-service, no admin endpoint exists yet — `api/admin/update-school.ts` is `verifyAdmin`-gated for ssi_admin only and only touches `group_id`); small/needs-endpoint for 2d/2e (extend the admin-mediation pattern already used for `create-school.ts`/`update-school.ts`); small for 2f (same fix as #1a).

---

## High — confirmed defects, real user-facing breakage

### 3. [Class 4] Student class-invite redemption drops the class's `course_code` — two entry points, one root cause
**Entry point A (join code):** `api/code/validate.ts:130-140` → `useInviteCode.ts:86-90` → `RedeemCode.vue:288-313` → `api/code/redeem.ts:476-478`. Server knows the class's `course_code` at validate time; it's stored client-side and never read again — not written to `localStorage['ssi-last-course']` (the pattern `DashboardView.vue:270`/`WithTeacher.vue:181` already use) and not passed as a redirect param. `redeem.ts`'s student redirect is a bare `'/'`.

**Entry point B (admin-issued invite code):** same underlying gap in `validate.ts`/`redeem.ts` — `course_code`/`class_id` never carried through; the parallel `/with/:code` path does this correctly, proving the fix pattern already exists elsewhere in the codebase.

**User-visible failure:** "Taking you to your first lesson…" lands the student on `App.vue`'s cold-boot default course logic instead of their class's actual course — a French class's students can land in a Chinese course.

**Fix size:** small — no new endpoint, one fix covers both entry points. Either return `course_code` in the redeem response and redirect with `?course=`, or write `localStorage['ssi-last-course']` before redirecting.

### 4. [Class 5] Offline lease upsert failure is silently logged — trial abuse vector
**File:** `api/entitlement/offline-lease.ts:268` — `if (upErr) console.error('[offline-lease] upsert error (non-fatal):', upErr.message)`, no error surfaced or retried.

**User-visible failure:** none to the user, but a device can silently re-mint a fresh 30-day trial repeatedly if the upsert that's supposed to record the one-shot lease keeps failing — defeats the anti-reset design.

**Fix size:** small — alert/metric on repeated failure at minimum; ideally fail closed rather than silently granting.

### 5. [Class 5] Remove-student / remove-teacher fail with zero user feedback
**File:** `ClassDetail.vue:221-231` `handleRemoveStudent`, `TeachersView.vue:83-95` `handleRemoveTeacher`

Both do `const { error } = await supabase.from('user_tags').update(...)` then `if (!error) fetch...()` — on error, nothing happens: no message, row stays in the table, button click produces no visible feedback either way.

**User-visible failure:** teacher clicks "Remove" on a student/teacher; if the write fails (RLS, network), the row silently stays — teacher has no idea it didn't work and may assume it did.

**Fix size:** one-liner each — add an `else` branch that surfaces the error.

### 6. [Class 4] `SetupView.vue` step 3 re-prompts for the course already picked at signup
**File:** `SetupView.vue:158` — `selectedCourses` never seeds from `schools.trial_course_code` (already written by `provision.ts` at signup).

**User-visible failure:** a new admin re-confirms the same course tile the wizard already knows about — minor friction, not a hard failure, but a handoff drop by definition.

**Fix size:** one-liner.

---

## Medium — real but narrower blast radius

### 7. [Class 2] Two dead CTAs on the student's own progress view
**File:** `StudentProgressView.vue:288` (primary "▶ Keep going — LEGO N") and `:291` ("Pick a different LEGO") — both have no `@click` wired.

**User-visible failure:** the main action on a learner-facing view does nothing when clicked.

**Fix size:** one-liner each (wire to the existing navigation function used elsewhere on the page).

### 8. [Class 4] `Onboarding.vue` has no session awareness — bounces already-authed users through email+OTP again
**File:** `Onboarding.vue` (root cause), hit from two live call sites:
- `SchoolsContainer.vue:449` — "set up a new school" link forces an already-verified user through a second email+OTP (same shape as the redeem→`/schools1` bug fixed in `676d6f1c`, but that fix only routed around this call site, not the component).
- `TeachDashboard.vue:225-227` — a signed-in tutor with a missing `teachers` row gets bounced to `/tutors` email-entry instead of a recovery path.

**User-visible failure:** re-authentication friction for users who are already signed in; the tutor case looks like a broken account rather than a missing-row recovery.

**Fix size:** needs-design — flagged, not decided: make `Onboarding.vue` itself session-aware (fixes both call sites and any future ones) vs. point-patch each site again. Genuine scope choice for Tom, not a detail call.

### 9. [Class 4] Three more small handoff drops in student class-join
- **Join-instructions URL doesn't exist** — `ClassDetail.vue:409` points at `saysomethingin.com/join`; no such route (working equivalent is `/with/:code`). One-liner.
- **Settings-screen redemption ignores server's `redirectTo`** — `SettingsScreen.vue:647-673` discards the role-specific destination `redeem.ts` computed. One-liner.
- **SignInModal's post-auth redirect dropped by all 3 containers** — `PlayerContainer.vue`/`SchoolsContainer.vue`/`TeachContainer.vue` all ignore the `{ role, redirectTo }` payload from sign-in. Small, same fix × 3 sites.

### 10. [Class 5] "False-Saved" cluster across admin/teacher write paths (9 sites)
Write fails but UI/response reports success (or the error is silently discarded) rather than surfacing failure:
- `api/admin/set-trial.ts` — update error not checked before responding success
- `api/teacher/class-teachers.ts` — same pattern on teacher add/remove
- `api/groups/[id].ts` — delete-order bug (dependent rows may survive a "successful" delete)
- `api/onboarding/profile.ts:67-72` + `Onboarding.vue` — two-layer: server discards the `schools.update` error (`institutionSaved` computed from row count but never surfaced on failure), client doesn't check either
- `api/code/redeem.ts` — write error path not fully surfaced to caller
- `AdminUserDetail.vue:394,405` — `revokeEntitlement()`/`setTrial()` (`useAdminUserDetail.ts:433,469`) both return a `boolean` success flag that the caller discards entirely; admin gets no feedback either way
- `DashboardView.vue` — missing error destructure on a write
- `SetupView.vue` — shadowed error variable swallows a real failure

**Fix size:** small/one-liner each — no design ambiguity; mechanical "surface the error" fixes.

### 11. [Class 2] Six more dead/ungated UI spots
- `SettingsView.vue:296` — "Cancel" in the school profile panel unwired; edits stay in the inputs with no discard.
- `TeachersView.vue:195-201` — "Resend invite" unwired (currently unreachable since status is hardcoded `'active'`, but will misbehave silently once invite-status is wired up — latent).
- `AdminUserDetail.vue:906-908` — "No player events recorded" renders unconditionally under the populated events table.
- `SchoolsSetup.vue:1193` — schools table empty-state card renders ungated.
- `SchoolsSetup.vue:1360` — staff table, same pattern.
- `SchoolsSetup.vue:1035` — groups tree panel, same pattern.

**Fix size:** one-liner each (add `v-if`/`v-else` list-length guard, or wire the missing handler).

---

## Low — narrow, latent, or self-correcting

### 12. [Class 5] Latent silent-failure sites not yet wired to a live caller
**File:** `useClassesData.ts` — `endClassSession`, `updateClassProgress` — will bite once a caller depends on their success signal; not currently reachable in a way that causes user-visible harm.

### 13. [Class 5] Billing-adjacent silent catches — Paddle is the source of truth
**File:** `api/school/update-seats.ts`, `api/subscription/cancel.ts` — errors are logged but not surfaced; low risk because the Paddle webhook is authoritative and self-corrects on the next sync. Debugging blind spot only.

### 14. [Class 4] Dead code masking latent staleness risk
**File:** `RedeemCode.vue:288-301` — a transient role string assignment that's currently inert (corrected before any navigation, not user-visible) but shares shape with the staleness bugs above. No action needed now; noted for awareness only.

---

## Clean — swept, no findings

- **Class 3 (cache/state clobbers):** every schools composable checked (`useSchoolContext`, `useCourseAccess`, `useGovtAdminActions`, `actAsPersonas`, `classTeacherScope`, `useSchoolData`, `useClassesData`, `useStudentsData`, `useTeachersData`, `useAnalyticsData`, `populateDemoData`) rebuilds shared state wholesale from a fresh query on every write — no partial-payload-over-good-state clobber pattern found outside the two already-fixed spots (`useUserRole.initialize`, the redemption role write).
- **Class 1/2 clean files:** `AnalyticsView`, `SchoolsView`, `StudentsView`, `UpgradeView`, 14 other `Admin*.vue` files, all 5 analytics tabs, `ClassCreatedModal`, `CreateClassModal`, all 16 `shared/` components — every handler traces to real logic, every empty-state correctly guarded, no raw writes to grant-revoked tables found beyond what's listed above.

---

## Open items for Tom

1. **Priority call:** #1 (cross-tenant exposure in admin act-as views) and #2a (tonight's brand-new confirm-school-name card, DOA on arrival) are the two I'd lead with if you want fixes started — #1 for severity, #2a because it's regressed-on-arrival.
2. **Fix-vs-review call:** everything except #1, #2, and #8 is small/one-liner/no-design-ambiguity per the auditing workers — same low-risk shape as tonight's already-shipped fixes. Ready to action on your go-ahead.
3. **#8 (`Onboarding.vue` session-awareness) is a genuine scope/design choice**, not a detail call — needs your direction before anyone touches it.
4. **#2 (schools/groups write grants)** needs the admin-mediation pattern extended to 6 more call sites — mechanical once you say go, but touches auth-sensitive code so flagging explicitly rather than just doing it.
5. **Unresolved dispatch-queue issue** (outside this audit's scope, flagging since it recurred across multiple worker reports): a stray worker (`e6a74103-...`) picked up an unrelated task from a different session and reportedly can't be stopped via the dispatch API — worth a look when you have a sec.
