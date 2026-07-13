# Bug-class audit — schools + admin surface (2026-07-13)

Audit-only sweep of `packages/player-vue/src/views/schools/`, `views/admin/`,
`components/schools/`, `composables/schools/`, `containers/SchoolsContainer.vue`,
`views/RedeemCode.vue`, `views/onboarding/Onboarding.vue`, and the `api/`
endpoints they call, for five bug classes seen live in tonight's soak. No code
was changed as part of this audit; this document is the only commit.

Ranked by likelihood a real school hits it during the Gwynedd pilot. Every
finding below was verified by reading the actual code (or, for grant claims,
the live `supabase/schema.sql`) — nothing here is speculative.

**Outstanding at time of writing:** two Class 4 sub-sweeps (admin act-as /
read-only views; teacher join-code + student class-join combined trace) had
not reported back when this report was compiled. If they land later, fold
them in as an addendum rather than re-running the whole sweep.

---

## Critical — will 403 on first touch, hits the pilot's first-run path directly

### 1. [Class 1] `schools` table has no `authenticated` write grant — 5 live call sites still write to it directly
**File:** `supabase/schema.sql:15168` (`GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.schools TO authenticated;` — no INSERT/UPDATE/DELETE; only `service_role` has `GRANT ALL`).

This is the exact same root cause tonight's `SchoolsSetup.vue` group-dropdown 403 was (commit `4007ac03`) — but that fix only repointed one call site. Five more remain raw:

| # | File:line | Call | User-visible failure |
|---|---|---|---|
| 1a | `useSchoolData.ts:256` `confirmSchoolName` | `.from('schools').update({school_name, name_confirmed})` | Invite-born admin's first-run "confirm your school name" card silently fails to save (error is surfaced as a message, but the feature is dead) |
| 1b | `SetupView.vue:125` `saveSchool` | `.from('schools').update(updates)` | Admin onboarding wizard step 1 ("name your school") 403s — **blocks the entire setup wizard** for any new school admin |
| 1c | `SettingsView.vue:175` `saveSchoolProfile` | `.from('schools').update({school_name})` | School settings → rename school fails silently past the "Saving…" state |
| 1d | `SchoolsSetup.vue:793` `deleteSchool` (admin panel) | `.from('schools').delete()` | ssi_admin "Delete school" button 403s, feature entirely broken |
| 1e | `SchoolsSetup.vue:488` `createGroup` | `.from('groups').insert(insertData)` | ssi_admin "Create new group" (region/group hierarchy) 403s — same missing-grant shape, `groups` also has SELECT-only for `authenticated` |

**Fix size:** needs-endpoint for 1a/1b/1c (self-service, no admin endpoint exists yet — `api/admin/update-school.ts` is `verifyAdmin`-gated for ssi_admin only and only touches `group_id`); small/needs-endpoint for 1d/1e (extend the admin-mediation pattern already used for `create-school.ts` / `update-school.ts`).

**Why #1 overall:** proven live tonight (the group-dropdown incident), and 1b sits directly in the onboarding wizard every new Gwynedd school admin will hit on day one.

---

## High — confirmed defects, real user-facing breakage

### 2. [Class 4] Student class-invite redemption drops the class's `course_code`
**File:** `api/code/validate.ts:130-140` → `useInviteCode.ts:86-90` → `RedeemCode.vue:288-313` → `api/code/redeem.ts:476-478`

`validate.ts` returns the class's real `course_code`; it's stored client-side as `pendingCode.value.courseName` and then never read again — not written to `localStorage['ssi-last-course']` (the pattern `DashboardView.vue:270` / `WithTeacher.vue:181` already use) and not passed as a redirect query param. `redeem.ts`'s student redirect is a bare `'/'`.

**User-visible failure:** "Taking you to your first lesson…" lands the student on `App.vue`'s cold-boot default course logic instead of their class's actual course — a French class's students can land in a Chinese course.

**Fix size:** small — no new endpoint. Either return `course_code` in the redeem response and redirect with `?course=`, or have `doRedeem()` write `localStorage['ssi-last-course']` before redirecting.

### 3. [Class 5] Offline lease upsert failure is silently logged — trial abuse vector
**File:** `api/entitlement/offline-lease.ts:268` — `if (upErr) console.error('[offline-lease] upsert error (non-fatal):', upErr.message)`, no error surfaced or retried.

**User-visible failure:** none to the user, but a device can silently re-mint a fresh 30-day trial repeatedly if the upsert that's supposed to record the one-shot lease keeps failing — defeats the anti-reset design.

**Fix size:** small — alert/metric on repeated failure at minimum; ideally fail closed rather than silently granting.

### 4. [Class 5] Remove-student / remove-teacher fail with zero user feedback
**File:** `ClassDetail.vue:221-231` `handleRemoveStudent`, `TeachersView.vue:83-95` `handleRemoveTeacher`

Both do `const { error } = await supabase.from('user_tags').update(...)` then `if (!error) fetch...()` — on error, nothing happens: no message, row stays in the table, button click produces no visible feedback either way.

**User-visible failure:** teacher clicks "Remove" on a student/teacher; if the write fails (RLS, network), the row silently stays — teacher has no idea it didn't work and may assume it did.

**Fix size:** one-liner each — add an `else` branch that surfaces the error.

### 5. [Class 4] `SetupView.vue` step 3 re-prompts for the course already picked at signup
**File:** `SetupView.vue:158` — `selectedCourses` never seeds from `schools.trial_course_code` (already written by `provision.ts` at signup).

**User-visible failure:** a new admin re-confirms the same course tile the wizard already knows about — minor friction, not a hard failure, but a handoff drop by definition.

**Fix size:** one-liner.

---

## Medium — real but narrower blast radius

### 6. [Class 2] Two dead CTAs on the student's own progress view
**File:** `StudentProgressView.vue:288` (primary "▶ Keep going — LEGO N") and `:291` ("Pick a different LEGO") — both have no `@click` wired.

**User-visible failure:** the main action on a learner-facing view does nothing when clicked.

**Fix size:** one-liner each (wire to the existing navigation function used elsewhere on the page).

### 7. [Class 4] `Onboarding.vue` has no session awareness — bounces already-authed users through email+OTP again
**File:** `Onboarding.vue` (root cause), hit from two live call sites:
- `SchoolsContainer.vue:449` — "set up a new school" link forces an already-verified user through a second email+OTP (same shape as the redeem→`/schools1` bug fixed in `676d6f1c`, but that fix only routed around this call site, not the component).
- `TeachDashboard.vue:225-227` — a signed-in tutor with a missing `teachers` row gets bounced to `/tutors` email-entry instead of a recovery path.

**User-visible failure:** re-authentication friction for users who are already signed in; the tutor case looks like a broken account rather than a missing-row recovery.

**Fix size:** needs-design — flagged, not decided: make `Onboarding.vue` itself session-aware (fixes both call sites and any future ones) vs. point-patch each site again. Genuine scope choice for Tom, not a detail call.

### 8. [Class 5] "False-Saved" cluster across admin/teacher write paths (9 sites)
All confirmed by the dispatched worker; write fails but UI/response reports success (or the error is silently discarded) rather than surfacing failure:
- `api/admin/set-trial.ts` — update error not checked before responding success
- `api/teacher/class-teachers.ts` — same pattern on teacher add/remove
- `api/groups/[id].ts` — delete-order bug (dependent rows may survive a "successful" delete)
- `api/onboarding/profile.ts` + `Onboarding.vue` — two-layer: server discards the `schools.update` error (`api/onboarding/profile.ts:67-72`, `institutionSaved` computed from row count but never surfaced on failure), client doesn't check either
- `api/code/redeem.ts` — write error path not fully surfaced to caller
- `AdminUserDetail.vue:394,405` — `revokeEntitlement()`/`setTrial()` both return a `boolean` success flag that the caller discards entirely; admin gets no feedback either way
- `DashboardView.vue` — missing error destructure on a write
- `SetupView.vue` — shadowed error variable swallows a real failure

**Fix size:** small/one-liner each — no design ambiguity per the worker's read; mechanical "surface the error" fixes.

### 9. [Class 2] Six more dead/ungated UI spots
- `SettingsView.vue:296` — "Cancel" in the school profile panel unwired; edits stay in the inputs with no discard.
- `TeachersView.vue:195-201` — "Resend invite" unwired (currently unreachable since status is hardcoded `'active'`, but will misbehave silently once invite-status is wired up — latent).
- `AdminUserDetail.vue:906-908` — "No player events recorded" renders unconditionally under the populated events table.
- `SchoolsSetup.vue:1193` — schools table empty-state card renders ungated.
- `SchoolsSetup.vue:1360` — staff table, same pattern.
- `SchoolsSetup.vue:1035` — groups tree panel, same pattern.

**Fix size:** one-liner each (add `v-if`/`v-else` list-length guard, or wire the missing handler).

---

## Low — narrow, latent, or self-correcting

### 10. [Class 5] Latent silent-failure sites not yet wired to a live caller
**File:** `useClassesData.ts` — `endClassSession`, `updateClassProgress` — will bite once a caller depends on their success signal; not currently reachable in a way that causes user-visible harm.

### 11. [Class 5] Billing-adjacent silent catches — Paddle is the source of truth
**File:** `api/school/update-seats.ts`, `api/subscription/cancel.ts` — errors are logged but not surfaced; low risk because the Paddle webhook is authoritative and self-corrects on the next sync. Debugging blind spot only.

---

## Clean — swept, no findings

- **Class 3 (cache/state clobbers):** every schools composable checked (`useSchoolContext`, `useCourseAccess`, `useGovtAdminActions`, `actAsPersonas`, `classTeacherScope`, `useSchoolData`, `useClassesData`, `useStudentsData`, `useTeachersData`, `useAnalyticsData`, `populateDemoData`) rebuilds shared state wholesale from a fresh query on every write — no partial-payload-over-good-state clobber pattern found outside the two already-fixed spots (`useUserRole.initialize`, the redemption role write).
- **Class 1/2 clean files:** `AnalyticsView`, `ClassDetail` (aside from the finding above under a different class), `DashboardView`, `SchoolsView`, `StudentsView`, `TeacherDashboard`, `UpgradeView`, 14 other `Admin*.vue` files, all 5 analytics tabs, `ClassCreatedModal`, `CreateClassModal`, all 16 `shared/` components, `SchoolsContainer` (aside from finding #7), `RedeemCode`, `Onboarding` (aside from finding #7) — every handler traces to real logic, every empty-state correctly guarded, no raw writes to grant-revoked tables found.

---

## Open items for Tom

1. **Fix-vs-review call:** all of #2–#9 (Class 2, 4, 5 minus #7) are small/one-liner/no-design-ambiguity per the auditing workers — same low-risk shape as tonight's already-shipped fixes. Ready to action on your go-ahead.
2. **#7 (`Onboarding.vue` session-awareness) is a genuine scope/design choice**, not a detail call — needs your direction before anyone touches it.
3. **#1 (schools/groups write grants)** needs the admin-mediation pattern extended to 5 more call sites — mechanical once you say go, but touches auth-sensitive code so flagging explicitly rather than just doing it.
4. Two Class 4 sub-sweeps (admin act-as/read-only views; teacher join-code + student class-join) had not reported back at compile time — worth a follow-up pass if you want full coverage confirmed.
