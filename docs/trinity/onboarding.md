# Onboarding — Trinity Compliance Audit

> **Date**: 2026-07-17
> **Scope**: Learner-app onboarding surfaces — `Onboarding.vue` (19 states), `WithTeacher.vue` (10 states), `RedeemCode.vue` + `/group` shared machine (10 states), `TryLinkGateway.vue` (3 states). 42 states total.
> **Trinity**: App→User (output) | User→App (input) | App→App (processing)
> **Protocol**: `~/command-surface/trinity-campaign-brief.md` — Phase 7 verbatim validation (Sessions 1–3), findings classed 1–5.
> **Numbering note**: each screen (file) runs its own continuous `#` sequence, restarting at 1 — this audit combines four independently-produced screen tables and per-screen numbering was kept for traceability back to source line citations, rather than force-fitting one document-wide sequence (deviates from `docs/schools-trinity-audit.md`'s single-sequence convention for that reason).

---

## Census finding (up front)

**Three independently hand-rolled OTP UIs exist in this scope**, each with its own state machine, its own error copy, and its own validation depth: `Onboarding.vue` (email→OTP, `step==='otp'`), `WithTeacher.vue` (`loginStep==='email'|'otp'`), `RedeemCode.vue` (`step==='auth'|'otp'`). A fourth, unrelated OTP UI (`SchoolsContainer.vue`) is out of scope but referenced for divergence comparison per `docs/schools-trinity-audit.md`. Divergences are tabled in **Finding L1** below.

---

## Screen 1: Onboarding.vue

### State 1 — Persistent brand panel (`<aside class="ob-panel">`, renders across all steps)

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display wordmark + track heading (`cfg.heading`) — L600-601 |
| 2 | App→User | Display Cardiff University proof stat, "1 in 2 pupils in the top 10%…" — L607-620 |
| 3 | App→User | Display track-specific checklist (`panelFacts`) — L624-631, computed L32-45 |
| 4 | App→App | Compute evolving panel copy keyed on `step` + `selectedCourseLabel` — L313-316, L636-647 |
| 5 | App→User | Display evolving line text (varies by step) — L635-648 |
| 6 | App→User | Display step marker (3 dots + progress rail) — L651-656, L1351-1352 |

**Phase 7**: Session 1 fully specified — every visible string traces to a computed or literal. `cfg.heading`/`cfg.blurb` source from `onboardingTracks.ts`, out of this file's scope.

### State 2 — Choose-step header

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display trial offer line, e.g. "Free for 30 days — no card needed" (only once a course is selected) — L668, computed L343-346 |
| 2 | App→User | Display H1 "Which language will you teach?" — L670 |
| 3 | App→User | Display track blurb (`cfg.blurb`) — L671 |

### State 3 — Target-language picker (dropdown)

| # | Direction | Message |
|---|-----------|---------|
| 1 | User→App | Click "You'll teach" trigger button — L681-694 |
| 2 | App→App | `openTarget()`: toggle `targetOpen`, reset `targetQuery` — L251-254 |
| 3 | App→User | Display trigger label (`pickerValueLabel`) — L690, computed L239-244 |
| 4 | App→User | Display dropdown menu: search input + option list — L696-731 |
| 5 | User→App | Type in target search (`targetQuery`) — L699-706 |
| 6 | App→App | Filter `visibleTargetOptions` by query — L230-236 |
| 7 | App→User | Display "No languages match "X"" empty state — L728-730 |
| 8 | User→App | Click a language/course option — L708-726 |
| 9 | App→App | `selectTarget(value)`: commit `targetLang`/`selectedCourse`, close menu — L259-270 |
| 10 | App→User | Show "Free for a year" badge on year-trial targets — L721, computed L212-220 |
| 11 | User→App | Press Escape while menu open — L679, `closeTarget()` L255-258 |
| 12 | User→App | Click backdrop to close menu — L695 |
| 13 | App→App | Refocus trigger button on close (a11y) — L257 |

### State 4 — Selected-course confirmation tile

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display "You're teaching {course}" claimed tile + checkmark — L738-747 |
| 2 | App→User | Display "Free for N days" echo — L743, computed L342 |
| 3 | User→App | Click "Change language" (only rendered when >1 option exists) — L751-756 |
| 4 | App→App | Clear `selectedCourse` — L755 |

### State 5 — Catalogue-outage error

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display "We couldn't load the language list." — L763 |
| 2 | User→App | Click "Try again" — L765 |
| 3 | App→App | `retryCatalogue()`: re-fetch `/api/courses/available`, reapply default target — L382-385, L352-364 |
| 4 | App→User | On success: `catalogueError` resets false, list re-renders — L354 (reactive) |
| 5 | App→User | On repeat failure: same static error text re-shown — L358/360 |

### State 6 — Learner-language list, searchable variant (`showSearch === true`, non-heritage)

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display legend "Your learners mainly speak" — L779 |
| 2 | App→User | Display search input — L784-790 |
| 3 | User→App | Type learner-language search (`langQuery`) — L785 |
| 4 | App→App | Filter `visibleCourses` — L101-111 |
| 5 | App→User | Display filtered radio list of course rows — L791-812 |
| 6 | User→App | Select a course radio — L798-804 |
| 7 | App→App | Set `selectedCourse` — L804 |
| 8 | App→User | Display "Loading languages…" if `!coursesLoaded` — L813 |
| 9 | App→User | Display "No languages match "X"" — L814 |
| 10 | App→User | Display "No languages available for this signup yet" — L815 |

### State 7 — Learner-language list, showcase grid (`showSearch === false`, non-heritage)

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display tile grid of course cards — L820-841 |
| 2 | User→App | Select a course tile radio — L827-833 |
| 3 | App→App | Set `selectedCourse` — L833 |
| 4 | App→User | Display "Loading languages…" — L842 |
| 5 | App→User | Display "No languages available for this signup yet" — L843 |

### State 8 — Heritage-door fallback (`isHeritageDoor === true`)

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display "Loading languages…" while catalogue loads — L850 |
| 2 | App→User | Display "No languages available for this signup yet" when zero heritage target options — L851-853 |

Confirmed intentional (not a gap): the dropdown (State 3) is the sole picker on this door; states 4–8's list views correctly never render when the heritage door has 2+ options and none picked yet.

### State 9 — Signed-in shortcut greeting (`isSignedIn === true`)

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display "Continuing as {email}" — L858 |
| 2 | User→App | Click "Not you? Sign out" — L859-861 |
| 3 | App→App | `useDifferentEmail()`: `supabase.auth.signOut()`, clear `email`/`error` — L416-425 |
| 4 | App→User | Implicit: UI reactively switches to email-input form once `isSignedIn` flips false — L857/864 |

### State 10 — Email input + Send/Continue

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display email input, placeholder "you@example.com" — L864-875 |
| 2 | User→App | Type email — L868 |
| 3 | App→App | Validate email format via regex (`emailValid`) — L311 |
| 4 | App→App | Compute `canSend` = valid email + course selected + not busy — L312 |
| 5 | App→User | Display error banner if `error` set — L877 |
| 6 | User→App | Click "Send my code" / press Enter in email field — L873, L890-900 |
| 7 | App→App | `sendCode()`: call `supabase.auth.signInWithOtp({email})` — L437-462 |
| 8 | App→User | On failure: set `error`, stay on step — L445-448 |
| 9 | App→User | On success: transition to `otp` step + fine-print "We'll email you a 6-digit code…" — L449, L901 |
| 10 | App→App | Start 20s delivery-hint timer on fresh send; show immediately on resend — L450-456 |
| 11 | User→App | Click "Continue" (signed-in shortcut) — L879-889 |
| 12 | App→App | `continueSignedIn()` → `finishProvisioning()` → POST `/api/onboarding/provision` — L401-412, L468-487 |
| 13 | App→User | On provisioning failure: set `error`, possibly `requiresCheckout` — L476-479 |
| 14 | App→User | On provisioning success: set `trial`/`redirectTo`, transition to `done` step — L481-486 |

### State 11 — OTP step (email→OTP hand-rolled UI #1)

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display eyebrow "Almost there" — L907 |
| 2 | App→User | Display title "Check your email" — L908 |
| 3 | App→User | Display subtext "Enter the 6-digit code we sent to **{{ email }}**" — L909-911 |
| 4 | App→User | Display 6-cell OTP display, cells fill as digits are typed — L913-930 |
| 5 | User→App | Type/paste code into the (visually transparent) OTP input — L931-942 |
| 6 | App→App | Sanitize input to digits only, capped at 6 (`watch(otp, …)`) — L275-278 |
| 7 | App→User | Display hint "Paste the whole code — we'll sort it out." — L944-946 |
| 8 | App→User | Display error banner (`role="alert"`) if `error` set — L949 |
| 9 | App→App | Choose which primary button renders based on `requiresCheckout` — L955 vs. L964 |
| 10 | App→User | If `requiresCheckout`: show "Go to your school dashboard" button — L954-963 |
| 11 | User→App | Click "Go to your school dashboard" — L960 |
| 12 | App→App | `goToDashboard()` — clear role cache, hard-navigate via `window.location.href` — L524-527 |
| 13 | App→User | Else: show "Confirm & start" button, disabled until 6 digits entered — L964-974 |
| 14 | User→App | Click "Confirm & start" / press Enter in the OTP field — L941, L971 |
| 15 | App→App | `verify()` — guards `otp.length < 6`; calls `supabase.auth.verifyOtp()` unless the same email already verified — L489-511 |
| 16 | App→User | On `verifyOtp` failure: set `error` = e.message or "That code did not work" — L505-507 |
| 17 | App→App | On `verifyOtp` success: call `finishProvisioning()` — L512-513 |
| 18 | App→App | `finishProvisioning()` — `POST /api/onboarding/provision` with bearer token — L468-475 |
| 19 | App→User | On provision failure: set `error`, and set `requiresCheckout` if server flags it — L476-479 |
| 20 | App→User | On provision success: capture `trial`, set `isReturning`, transition `step` → `'done'` — L481-486 |
| 21 | App→User | Show spinner on the active primary button while `busy` — L959, L969 |
| 22 | User→App | Click "Change email" — L977 |
| 23 | App→App | `changeEmail()` — reset `step` → `'choose'`, clear `otp`/`error`/`requiresCheckout` — L430-435 |
| 24 | User→App | Click "Resend code" (disabled while `busy`) — L979 |
| 25 | App→App | `sendCode()` re-invoked as a resend (`isResend = step === 'otp'`) — L437-462 |
| 26 | App→User | On resend success: immediately reveal the delivery-hint panel (no distinct "code resent" message) — L451-452 |
| 27 | App→User | On send/resend failure: set `error` — L445-448, L457-458 |
| 28 | App→App | Auto-reveal the delivery hint 20s after the *original* (non-resend) send if unresolved — L453-456 |
| 29 | App→User | Fade-in delivery-hint panel: school-filter guidance + fallback admin email link — L982-991 |
| 30 | App→User | Left brand-panel evolving line switches to OTP copy — L640-643 |

### State 12–19 — Done step (branches on `isReturning`)

| # | Direction | Message |
|---|-----------|---------|
| 31 | App→User | Display arrival checkmark animation, decorative (`aria-hidden`) — L996-1002 |
| 32 | App→App | Branch render on `isReturning` — L1005 vs. L1015 |
| 33 | App→User | *(returning)* Display title "Welcome back" — L1006 |
| 34 | App→User | *(returning)* Display subtext "You're already set up — let's get you back to your dashboard." — L1007 |
| 35 | App→User | *(returning)* Display error banner if `error` set — L1008 |
| 36 | App→User | *(returning)* Display "Go to my dashboard" button with busy spinner — L1009-1011 |
| 37 | User→App | *(returning)* Click "Go to my dashboard" — L1009 |
| 38 | App→App | *(returning)* `continueIn()` invoked — shared function, see rows 44-51 |
| 39 | App→User | *(new user)* Display title "**{{ selectedCourseLabel }}** is ready" — L1016 |
| 40 | App→User | *(new user)* Display trial-end sentence if `trialEndLabel` set, else generic "no card needed" fallback — L1017-1022 |
| 41 | App→User | *(new user)* Display "A couple of details (optional)" heading — L1025 |
| 42 | App→User | *(new user)* Display name input, placeholder "What shall we call you?" — L1027-1036 |
| 43 | User→App | *(new user)* Type display name — L1031 |
| 44 | App→User | *(new user)* Display institution input, shown only if `cfg.collectInstitution` — L1038-1047 |
| 45 | User→App | *(new user)* Type institution — L1042 |
| 46 | App→User | *(new user)* Display error banner if `error` set — L1050 |
| 47 | App→User | *(new user)* Display "Continue" button with busy spinner — L1052-1054 |
| 48 | User→App | *(new user)* Click "Continue" — L1052 |
| 49 | App→App | `continueIn()` — trim name/institution; if either non-empty, `POST /api/onboarding/profile` — L533-542 |
| 50 | App→User | *(new user)* Display fine print "You can change these anytime in your settings." — L1055 |
| 51 | App→User | On profile `POST` non-OK: set generic `error` from server `data.error` — L548-549 |
| 52 | App→User | On `institution_saved === false` (falsy despite institution typed): specific error "Your school name didn't save…" — L550-551 |
| 53 | App→User | On `display_name_saved === false`: specific error "Your name didn't save…" — L552-553 |
| 54 | App→App | On any of the above errors: stop, reset `busy`, do NOT navigate — user can retry — L558-561 |
| 55 | App→App | On success (or nothing to save): clear stale role cache, hard-navigate to `redirectTo` — L572-573 |
| 56 | App→User | On unexpected exception (network throw etc.): set `error`, reset `busy` — L574-577 |
| 57 | App→User | Left brand-panel evolving line switches to done copy — L644-646 |

*(File verified to have no further steps/branches beyond line 1061 — template closes there; lines 1063-2171 are `<style scoped>` only.)*

---

## Screen 2: WithTeacher.vue

### State 1 — Loading & Initial Fetch

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display loading spinner while `isLoading` is true — L403-405 |
| 2 | App→App | `onMounted` triggers `loadClass()`; `code` computed from `route.params.code`, uppercased — L97-100, 152 |
| 3 | App→App | If no `code`: set `notFound = true`, `isLoading = false`, return early — L118-121 |
| 4 | App→App | Fetch `GET /api/teacher/by-code?code=...` — L125 |
| 5 | App→App | On 404/`!res.ok`: parse JSON body; if `body.reason === 'unavailable'` set `unavailableMessage`, else set `notFound = true` — L126-136 |
| 6 | App→App | On success: populate `teacher`, `classInfo`, `seatsRemaining`, `isFull` from response body — L138-142 |
| 7 | App→App | On fetch/parse exception (network error, non-JSON): set `notFound = true` — L143-144 |
| 8 | App→App | `finally`: set `isLoading = false` — L145-147 |
| 9 | App→App | `refreshSession()` — call `supabase.auth.getSession()`, populate `userEmail`/`userId` — L110-115, 149 |

### State 2 — Not Found

| # | Direction | Message |
|---|-----------|---------|
| 10 | App→User | Display heading "We couldn't find that class." — L419 |
| 11 | App→User | Display copy "Double-check the link your teacher gave you, or head to the SaySomethingin home page." — L420-423 |
| 12 | App→User | Display "Go to SaySomethingin" button linking to `/` — L424-426 |
| 13 | User→App | Click "Go to SaySomethingin" — L424-426 |

### State 3 — Unavailable (paused link)

| # | Direction | Message |
|---|-----------|---------|
| 14 | App→User | Display heading "This link is temporarily unavailable." — L408 |
| 15 | App→User | Display copy: `{{ unavailableMessage }}` + fixed suffix "Your teacher may have paused new sign-ups…" — L409-412 |
| 16 | App→User | Display "Go to SaySomethingin" button linking to `/` — L413-415 |
| 17 | User→App | Click "Go to SaySomethingin" — L413-415 |

### State 4 — Join Card (teacher & class info)

| # | Direction | Message |
|---|-----------|---------|
| 18 | App→User | Display eyebrow "You're joining" — L430 |
| 19 | App→User | Display class name `{{ classInfo.class_name }}` — L431 |
| 20 | App→User | Display course label via `labelForCourse(classInfo.course_code)` — L102-104, 432 |
| 21 | App→User | Display "with **{{ teacher.display_name }}**" — L434-436 |
| 22 | App→User | Display teacher photo if `teacher.photo_url` is set — L438-440 |
| 23 | App→User | Display teacher bio if `teacher.bio` is set — L442 |

### State 5 — Pricing Display (free vs. paid)

| # | Direction | Message |
|---|-----------|---------|
| 24 | App→App | Compute `isFreeCourse` from `classInfo.course_is_free === true` — L41 |
| 25 | App→App | Compute `isSchoolClass` from `!!classInfo.school_id` — L39 |
| 26 | App→User | *[free]* Display "Free" as the price amount — L444-446 |
| 27 | App→User | *[free]* Display pitch "This course is free — no card needed…" — L448-451 |
| 28 | App→User | *[free]* Display hint "You'll have your own SaySomethingin account…" — L452-455 |
| 29 | App→User | *[paid]* Display Monthly/Annual billing toggle tabs — L459-479 |
| 30 | User→App | Click "Monthly" tab — L460-467 |
| 31 | User→App | Click "Annual" tab — L468-478 |
| 32 | App→App | `setBilling(b)` sets `billing.value = b` — L52-54 |
| 33 | App→User | Display annual badge "N months free" — L477 |
| 34 | App→User | Display price amount, monthly/annual — L482-484 |
| 35 | App→User | Display price period, "/ month" or "/ year" — L484 |
| 36 | App→User | *[monthly]* Display "That's £X off the regular price" pitch — L486-490 |
| 37 | App→User | *[annual]* Display "That's 2 months free" pitch — L491-494 |
| 38 | App→User | Display hint "Your subscription supports **{{ teacher.display_name }}**." — L495-498 |

**Phase 7**: the client price is explicitly documented as display-only — the webhook re-derives and freezes the authoritative price server-side (L35-45). Best-specified state in the file.

### State 6 — Full Class Error

| # | Direction | Message |
|---|-----------|---------|
| 39 | App→App | `isFull` flag set from API response `data.is_full` — L142 |
| 40 | App→User | Display error banner "This class is full. Ask your teacher to open another class." — L501-503 |
| 41 | App→App | `handleStartLearning()` silently no-ops when `isFull` is true — L155 |
| 42 | App→User | "Start learning" / "Join free" button rendered `:disabled="isOpeningCheckout || isFull"` — L522 |

### State 7 — Already Subscribed

| # | Direction | Message |
|---|-----------|---------|
| 43 | App→App | `hasActiveSubscription()` calls `GET /api/subscription` with bearer token — L269-284 |
| 44 | App→App | If subscribed: `linkLearnerToClass()` called client-side (idempotent enrol + roster tag); on throw, `checkoutError` set — L304-309 |
| 45 | App→App | Set `alreadySubscribed = true` (unconditionally, outside the try/catch) — L310 |
| 46 | App→User | Display hint "You already have an active subscription… You're all set to start this class." — L509-512 |
| 47 | App→User | Display "Continue to SaySomethingin" button — L513-515 |
| 48 | User→App | Click "Continue to SaySomethingin" — L513-515 |
| 49 | App→App | `goToPlayer()`: store `classInfo.course_code` to `localStorage['ssi-last-course']` (best-effort), then `window.location.href = '/'` — L178-185 |

### State 8 — Pre-Login CTA & Checkout/Join Dispatch

| # | Direction | Message |
|---|-----------|---------|
| 50 | App→User | Display "Join free"/"Start learning" button, `:disabled="isOpeningCheckout || isFull"`, `:loading="isOpeningCheckout"` — L518-527 |
| 51 | User→App | Click "Join free"/"Start learning" — L524, `handleStartLearning` |
| 52 | App→App | `handleStartLearning()`: guard no-op if missing `teacher`/`classInfo`/`isFull` — L155 |
| 53 | App→App | If not signed in: `showLogin = true`, return (defers to State 9) — L157-159 |
| 54 | App→App | If signed in: `proceedAfterAuth()` — L162 |
| 55 | App→App | `proceedAfterAuth()`: branch free (`joinFree`) vs paid (`openCheckout`) — L167-174 |
| 56 | App→App | `joinFree()`: `linkLearnerToClass()` then `goToPlayer()` — L252-266 |
| 57 | App→User | On `joinFree` failure: `checkoutError` shown in banner — L262, L505 |
| 58 | App→App | `openCheckout()`: guard missing `studentPriceId` → `checkoutError` set, return — L290-293 |
| 59 | App→App | `openCheckout()`: double-charge guard via `hasActiveSubscription()` → routes to State 7 (already-subscribed) — L304-313 |
| 60 | App→App | `getPaddle().Checkout.open()` with `customData` contract (`teacher_id`, `class_id`, `supabase_user_id`) — L315-329 |
| 61 | App→User | On checkout-open failure: `checkoutError` set — L330-331 |
| 62 | App→User | Display `checkoutError` banner — L505 |
| 63 | App→User | Display "Same SaySomethingin account, same ten languages, same method." fine print — L582-584 |

### State 9 — Login: Email Step (hand-rolled OTP UI #2)

| # | Direction | Message |
|---|-----------|---------|
| 64 | App→User | Display "Sign in or create your SaySomethingin account to continue." — L531 |
| 65 | App→User | Display `loginError` banner if set — L533 |
| 66 | App→User | Display email input, autofocus — L536-543 |
| 67 | User→App | Type email — L537 |
| 68 | User→App | Submit form / click "Send code" — L535, L544-551 |
| 69 | App→App | `isEmailValid` gates submit button — L547 |
| 70 | App→App | `handleSendOtp()`: guard `isEmailValid && supabase.value` — L338 |
| 71 | App→App | Call `supabase.auth.signInWithOtp({ email })` — L343-345 |
| 72 | App→User | On error: `loginError` set — L347 |
| 73 | App→App | On success: `loginStep = 'otp'` — L350 |
| 74 | User→App | Click "Cancel" — L552 |
| 75 | App→App | `cancelLogin()`: reset `showLogin`/`loginStep`/`loginEmail`/`loginOtp`/`loginError` — L389-395 |

### State 10 — Login: OTP Step (hand-rolled OTP UI #2, continued)

| # | Direction | Message |
|---|-----------|---------|
| 76 | App→User | Display "We've emailed a 6-digit code to **{{ loginEmail }}**." — L556-558 |
| 77 | App→User | Display OTP input, `inputmode="numeric"`, `pattern="[0-9]*"`, `maxlength="6"` — L559-569 |
| 78 | User→App | Type OTP — L560 |
| 79 | User→App | Submit form / click "Verify and continue to payment" — L555, L570-577 |
| 80 | App→App | `loginOtp.length < 6` gates submit button — L573 |
| 81 | App→App | `handleVerifyOtp()`: guard `length < 6 && supabase.value` — L359 |
| 82 | App→App | Call `supabase.auth.verifyOtp({ email, token, type: 'email' })` — L364-368 |
| 83 | App→User | On error: `loginError` set — L370 |
| 84 | App→App | On success: `refreshSession()`, `showLogin = false`, `proceedAfterAuth()` — L373-375 |
| 85 | User→App | Click "Back" — L578 |
| 86 | App→App | `handleBackToEmail()`: `loginStep = 'email'`, clear otp+error — L383-387 |

---

## Screen 3: RedeemCode.vue (the `/group` shared machine)

### State 1 — `validating` (initial mount gate)

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display spinner — L522 |
| 2 | App→User | Display "Checking code..." status text — L523 |
| 3 | App→App | `onMounted`: close global auth modal via `useAuthModal().close()` — prevents App.vue's boot-time modal racing this page — L184 |
| 4 | App→App | Resolve `code` from `route.params.code` \|\| `route.query.code` — L69 |
| 5 | App→App | If no code AND `variant==='landing'`: set error, `step='invalid'` — L189-193 |
| 6 | App→App | If no code AND `variant==='bare'`: `step='enter-code'` — L194-195 |
| 7 | App→App | If code present: `validateAndProceed(code)` → `validateCode()` → `POST /api/code/validate` — L197 |
| 8 | App→App | On valid: branch by `isSignedIn`/`isPossessionEligible` → `step='confirm'\|'details'\|'auth'` — L213-221 |
| 9 | App→App | On invalid: `error.value = validationError.value \|\| 'This code is invalid or has expired'`, `step='invalid'` — L202-207 |

### State 2 — `enter-code` (bare `/redeem`)

| # | Direction | Message |
|---|-----------|---------|
| 10 | App→User | Display "Enter your code" heading — L528 |
| 11 | App→User | Display "Type the code your teacher or admin gave you." — L529 |
| 12 | App→User | Display error banner if `error` set — L531-540 |
| 13 | App→User | Display code input, placeholder "ABC-123" — L542-556 |
| 14 | App→User | Display "Continue" button, disabled while loading or empty — L558-561 |
| 15 | User→App | Type code into input (`v-model="manualCode"`) — L547 |
| 16 | User→App | Submit form / click Continue — L527 |
| 17 | App→App | Guard: no-op if `manualCode` empty after trim — L225 |
| 18 | App→App | `router.replace({ name: 'redeem-code', params: { code } })` — makes code shareable/refreshable — L231 |
| 19 | App→App | Re-run `validateAndProceed(code)` — same chain as State 1 rows 7-9 — L232 |

### State 3 — `invalid`

| # | Direction | Message |
|---|-----------|---------|
| 20 | App→User | Display error icon circle — L566-572 |
| 21 | App→User | Display "Invalid Code" heading — L573 |
| 22 | App→User | Display error detail — server's specific reason or missing-link copy — L205, L190 |
| 23 | App→User | Display "Try another code" button — hidden when `variant==='landing'` — L575 |
| 24 | App→User | Display "Go to App" button — L576 |
| 25 | User→App | Click "Try another code" → inline `step='enter-code'; error=''` — L575 |
| 26 | User→App | Click "Go to App" → `goHome()` — L576 |
| 27 | App→App | `goHome()`: `clearPendingCode()` + `router.push('/')` — L501-504 |

### State 4 — `confirm` (existing session identity check)

| # | Direction | Message |
|---|-----------|---------|
| 28 | App→User | Display "You're signed in as **{{userEmail}}**" — L609 |
| 29 | App→User | Display "Continue as {{userEmail}}" button — L610-612 |
| 30 | App→User | Display "Use a different email" link — L613-615 |
| 31 | User→App | Click "Continue as..." → `doRedeem()` — L610 |
| 32 | User→App | Click "Use a different email" → `useDifferentEmail()` — L613 |
| 33 | App→App | `useDifferentEmail()`: `client.auth.signOut()`, clear email/error, `step='auth'` (always — even for possession-eligible codes) — L250-261 |
| 34 | App→App | `doRedeem()` invoked directly — full redemption chain (see State 9) |

### State 5 — `details` (default door for possession-eligible invites)

| # | Direction | Message |
|---|-----------|---------|
| 35 | App→User | Display instruction text via `authInstructionText` computed — L622, L133-148 |
| 36 | App→User | Display error banner if set — L624-633 |
| 37 | App→User | Display "Your name" input, optional — L635-646 |
| 38 | App→User | Display Email input, `.invalid` styling on bad format — L648-664 |
| 39 | App→User | Display "Continue" button, disabled until valid email or loading — L666-674 |
| 40 | App→User | Display "Prefer to verify with an emailed code first? Use email code instead" — L676-679 |
| 41 | User→App | Fill name field — L640-645 |
| 42 | User→App | Fill email field — L655-663 |
| 43 | User→App | Submit form / click Continue — L621 |
| 44 | User→App | Click "Use email code instead" — L678 |
| 45 | App→App | `isEmailValid` regex gates Continue button — L122-125 |
| 46 | App→App | `handlePossessionSubmit()`: guard client readiness; `possessionRedeem()` → `POST /api/auth/possession-redeem` — L267-270, L276 |
| 47 | App→App | On success: `client.auth.setSession(...)` with returned tokens, then `doRedeem()` — L278-281, L286 |
| 48 | App→App | On `setSessionError`: set error message, stay on `details` — L282-284 |
| 49 | App→App | On `result.reason==='already_registered'`: `step='already-registered'` — L289-292 |
| 50 | App→App | On other failure: `error.value = result.error \|\| 'Something went wrong. Please try again.'` — L293 |
| 51 | App→App | `switchToEmailCode()`: clear error, `step='auth'` — L301-304 |

### State 6 — `already-registered`

| # | Direction | Message |
|---|-----------|---------|
| 52 | App→User | Display "An account already exists for **{{email}}**." — L686 |
| 53 | App→User | Display "Sign in instead" button — L687-689 |
| 54 | App→User | Display "Use a different email" link — L690-692 |
| 55 | User→App | Click "Sign in instead" → `handleSignInInstead()` — L687 |
| 56 | User→App | Click "Use a different email" → inline `step='details'; error=''` — L690 |
| 57 | App→App | `handleSignInInstead()`: `step='auth'`, clear error, call `handleSendOtp()` — L308-312 |

### State 7 — `auth` (hand-rolled OTP UI #3, email entry)

| # | Direction | Message |
|---|-----------|---------|
| 58 | App→User | Display instruction text — L700 |
| 59 | App→User | Display error banner if set — L702-711 |
| 60 | App→User | Display email input — L713-729 |
| 61 | App→User | Display "Continue" button, disabled until valid email or loading — L731-739 |
| 62 | User→App | Fill email field — L720-728 |
| 63 | User→App | Submit form / click Continue — L699 |
| 64 | App→App | `isEmailValid` regex gates Continue button — L122-125 |
| 65 | App→App | `handleSendOtp()`: guard client readiness; `client.auth.signInWithOtp({ email })` — L318-321, L327 |
| 66 | App→App | On `otpError`: `error.value = otpError.message \|\| 'Unable to send code. Please try again.'` — L328-330 |
| 67 | App→App | On success: `step='otp'`, reset delivery hint, start 20s delivery-hint timer — L332-335 |

### State 8 — `otp` (hand-rolled OTP UI #3, continued)

| # | Direction | Message |
|---|-----------|---------|
| 68 | App→User | Display mail icon — L745-750 |
| 69 | App→User | Display "Check your email for a 6-digit code" — L751 |
| 70 | App→User | Display target email address — L752 |
| 71 | App→User | Display "It may take a moment to arrive. Check your spam folder if needed." — L753 |
| 72 | App→User | Display error banner if set — L756-765 |
| 73 | App→User | Display OTP input — 6-digit, `inputmode="numeric"`, `maxlength="6"` — L767-782 |
| 74 | App→User | Display "Verify" button, disabled until 6 chars or loading — L784-792 |
| 75 | App→User | Display "Didn't get the code? Resend" — L794-797 |
| 76 | App→User | Display delivery-hint fallback (content differs by `isPossessionEligible`) after 20s or immediately on resend — L799-814 |
| 77 | App→User | Display "Back" button — L816-821 |
| 78 | User→App | Type OTP code — L772 |
| 79 | User→App | Submit form / click Verify — L743 |
| 80 | User→App | Click "Resend" — L796 |
| 81 | User→App | Click "Go back and skip the email code" inside delivery hint, possession-eligible only — L803 |
| 82 | User→App | Click "Back" → inline `step='auth'; error=''; otpCode=''` — L816 |
| 83 | App→App | Guard: `otpCode.length < 6` → button disabled, no-op — L345, L788 |
| 84 | App→App | `handleVerifyOtp()`: guard client readiness; `client.auth.verifyOtp({ email, token, type: 'email' })` — L347-350, L356-360 |
| 85 | App→User | On `verifyError`: `error.value = verifyError.message \|\| 'Invalid code. Please try again.'` — L361-363 |
| 86 | App→App | On success: call `doRedeem()` directly — L369 |
| 87 | App→App | `watch(isSignedIn, ...)` fires independently when auth state changes while `step==='otp'` → also calls `doRedeem()`; guarded by `step.value === 'otp'` so it cannot re-fire post-navigation — L243-247 (single-flight resolved in `useInviteCode.ts:111`) |
| 88 | App→App | `handleResendOtp()`: `showDeliveryHint.value = true` immediately, re-call `signInWithOtp()` — L410, L412 |
| 89 | App→App | On resend `otpError`: `error.value = 'Unable to resend code. Please try again.'`; on success: clear error — L413-414, L416 |
| 90 | App→App | `backToDetails()`: clear error+otpCode, `step='details'` — L399-403 |

### State 9 — `redeeming`

| # | Direction | Message |
|---|-----------|---------|
| 91 | App→User | Display `displayTitle` heading — L581 |
| 92 | App→User | Display `displayDetail` text if present — L582 |
| 93 | App→User | Display spinner — L583 |
| 94 | App→User | Display "Activating your code..." — L584 |
| 95 | App→App | `doRedeem()` entry: `step='redeeming'`, clear error — L424-426 |
| 96 | App→App | Guard: no `supabase` client → error "App not ready.", `step='auth'` — L429-434 |
| 97 | App→App | Guard: no session/access_token yet (auth propagation delay) → `step='auth'`, **no error message shown** — L436-442 |
| 98 | App→App | Call `redeemCode(token)` — L444 |
| 99 | App→App | On success: set `redeemLabel`, refresh entitlements if `codeKind==='entitlement'` — L445-449 |
| 100 | App→App | Optimistically set role via `useUserRole().initialize()` keyed on code type — L450-457 |
| 101 | App→App | `await auth?.refreshRole?.()` — re-sync role from DB to win the race against the auth listener's own concurrent `ensureLearnerExists()` — L458-464 |
| 102 | App→App | If `result.courseCode`: `switchActiveCourseTo(result.courseCode)` — force-switch active course now, not next boot — L465-473 |
| 103 | App→App | `useSchoolContext().clear()` — force a fresh fetch under the new role/class — L474-481 |
| 104 | App→App | On success: `step='success'`, set `redirectUrl`, schedule `router.push` after 4000ms — L482-486 |
| 105 | App→User | On failure (`!result.success`): `error = result.error \|\| 'Failed to redeem code'`, `step='auth'` — L487-489 |
| 106 | App→User | On thrown exception: `error='Something went wrong'`, `step='auth'` — L491-494 |

### State 10 — `success`

| # | Direction | Message |
|---|-----------|---------|
| 107 | App→User | Display success checkmark icon — L588-593 |
| 108 | App→User | Display `successHeading` title — L594 |
| 109 | App→User | Display `redeemLabel` detail text — L595 |
| 110 | App→User | Display `successSubtext` redirect copy — L596 |
| 111 | App→User | Display "Continue" button — L597 |
| 112 | User→App | Click "Continue" — L597 |
| 113 | App→App | `goToRedirect()`: `router.push(redirectUrl.value)` — L497-499 |
| 114 | App→App | Auto-redirect: `setTimeout(() => router.push(redirectUrl.value), 4000)` fires regardless of manual click — L484-486 |

---

## Screen 4: TryLinkGateway.vue

### State 1 — `validating`

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display spinner — L67 |
| 2 | App→User | Display "Checking your link..." — L68 |
| 3 | App→App | `onMounted`: resolve `code` from `route.params.code` — L12 |
| 4 | App→App | If no code: `status='error'`, `errorMessage='No try link code provided'` — L14-18 |
| 5 | App→App | `POST /api/try-link/validate` with `{ code }` — L21-25 |
| 6 | App→App | On `!response.ok`: parse body, `status='error'`, `errorMessage = data.error \|\| 'This link is no longer valid'` — L27-32 |
| 7 | App→App | On thrown exception (network error): `status='error'`, `errorMessage='Something went wrong. Please try again.'` — L55-58 |

### State 2 — `valid` (redirecting)

| # | Direction | Message |
|---|-----------|---------|
| 8 | App→App | Populate `label` from response, `status='valid'` — L35-36 |
| 9 | App→App | If `data.entitlementToken` present: write `ssi-try-token`/`ssi-try-exp` to `sessionStorage` — **no `else` branch if absent** — L42-45 |
| 10 | App→App | Always write `ssi-try-link` = code to `sessionStorage`, regardless of whether a token was granted — L46 |
| 11 | App→App | DEV-only: also set `ssi-demo-tier='paid'` in dev builds — L47-49 |
| 12 | App→User | Display success checkmark icon — L73-77 |
| 13 | App→User | Display "Welcome to SaySomethingin" title — L78 |
| 14 | App→User | Display `label` subtitle if present — L79 |
| 15 | App→User | Display "Loading your courses..." — L80 |
| 16 | App→App | `setTimeout(() => window.location.href = '/', 1200)` — hard navigate after 1.2s, unconditionally — L52-54 |

### State 3 — `error`

| # | Direction | Message |
|---|-----------|---------|
| 17 | App→User | Display error icon — L85-90 |
| 18 | App→User | Display "Link not valid" title — L92 |
| 19 | App→User | Display `errorMessage` — L93 |
| 20 | App→User | Display "Visit SaySomethingin" link to `https://www.saysomethingin.com` (external, no in-app retry) — L94 |

---

## Findings Ledger (classed 1–5, most severe first)

### L1 — [class 5, ORPHAN-adjacent / divergence] Three independently hand-rolled OTP UIs with materially different behaviour, no shared component
`Onboarding.vue` (`step==='otp'`, L906-992) · `WithTeacher.vue` (`loginStep`, L529-580) · `RedeemCode.vue` (`step==='auth'|'otp'`, L699-821)

| Behaviour | Onboarding.vue | WithTeacher.vue | RedeemCode.vue |
|---|---|---|---|
| Digit sanitisation | Strips non-digits, caps at 6 (L275-278) | None — raw `pattern="[0-9]*"` HTML attr only, unenforced in JS | None — same HTML-attr-only pattern |
| Resend feedback | Reveals delivery-hint panel, no distinct success message | No resend affordance at all | Reveals delivery-hint panel immediately (L410) |
| Delivery-hint timing | 20s auto-reveal | N/A (not present) | 20s auto-reveal, or immediate on resend |
| Error copy on verify failure | "That code did not work" | "Invalid code" (raw Supabase message, no fallback wording override beyond `\|\| 'Invalid code'`) | "Invalid code. Please try again." |
| Post-verify success routing | `finishProvisioning()` → done step | `refreshSession()` → `proceedAfterAuth()` (may go straight to Paddle checkout — see L2) | `doRedeem()` — full redemption chain |
| Back/cancel affordance | "Change email" full reset | "Back" (email step only) / no top-level cancel once in OTP | "Back" full reset to `auth` step |

No shared composable, no shared validation depth, three different error-copy conventions for the same underlying Supabase call. A learner who has seen one onboarding OTP screen has to re-learn UI conventions at the other two.

### L2 — [class 4, UNSPECIFIED CONTENT] WithTeacher.vue's OTP button is mislabelled for the free-course path
`WithTeacher.vue:576` (button text "Verify and continue to payment") · `WithTeacher.vue:373-375` (`proceedAfterAuth()` after verify)

The OTP submit button is hardcoded "Verify and continue to payment" regardless of `isFreeCourse`. For a free class, `proceedAfterAuth()` calls `joinFree()`, not checkout — a learner joining a free class is told they're about to pay, then isn't. The static copy was never conditioned on the same `isFreeCourse` flag that governs every other price-facing string in this file (State 5).

### L3 — [class 3, MISSING TWIN] "Already subscribed" success message can render simultaneously with a join-failure error, unreconciled
`WithTeacher.vue:304-313` (`openCheckout()`'s double-charge branch)

`alreadySubscribed.value = true` (L310) is set unconditionally, outside the `try/catch` that surrounds `linkLearnerToClass()` (L305-309). If that call throws, `checkoutError` is also set. Both the "you're all set, continue" hint (L509-512) and the error banner (L505) are rendered by the same template with no `v-if` precedence between them — a learner can see "you're all set" and an error banner in the same view, with no signal which one to trust.

### L4 — [class 3, MISSING TWIN] Silent bounce to email/OTP re-entry with no explanation when the auth session isn't ready yet post-verify
`RedeemCode.vue:436-442` (`doRedeem()`)

If OTP verification just succeeded but `client.auth.getSession()` hasn't yet propagated a token (a real race — Supabase's own `onAuthStateChange` vs. promise resolution order, acknowledged in the file's own comments at L239-242), `doRedeem()` silently sets `step='auth'` with **no error message at all** (contrast with the two adjacent failure branches at L429-434 and L487-494, both of which do set `error`). The learner who just successfully entered a code is bounced back to "enter your email" with zero indication anything happened, let alone why.

### L5 — [class 2, UNVALIDATED] Manual code entry has materially weaker validation than every other input in RedeemCode.vue
`RedeemCode.vue:225` (`handleManualCodeSubmit` guard) vs. `RedeemCode.vue:122-125` (`isEmailValid` regex used to gate every email-based Continue button in the same file)

Submitting `enter-code` with an empty/whitespace-only code silently no-ops (guard returns early, no error set) — every other form in this file (email steps, OTP steps) shows the user *why* their submission didn't proceed. This is the one input path with no user-visible feedback for the invalid case.

### L6 — [class 4, UNSPECIFIED CONTENT] `validating` step has no stuck/timeout state
`RedeemCode.vue:522-523` (state 1) — also applies identically to `Onboarding.vue`'s equivalent implicit loading states and `TryLinkGateway.vue:67-68`

If `/api/code/validate` (or the onboarding/try-link equivalents) never resolves — dropped connection, hung serverless function — the spinner + "Checking code..." text persists indefinitely. No timeout, no "taking longer than usual" content, no retry affordance is defined for this state anywhere in the three redemption-adjacent files.

### L7 — [class 3, MISSING TWIN] TryLinkGateway can advance to "valid" and redirect the learner with no entitlement granted, and no error shown
`TryLinkGateway.vue:42-45` (entitlement token write is conditional) vs. `TryLinkGateway.vue:34-54` (success path is unconditional)

`status.value = 'valid'` (L36) fires regardless of whether `data.entitlementToken` was present in a 200 response. If the server ever returns 200 without a token (a contract violation, but nothing here defends against it), the UI shows the full "Welcome" success screen, writes no entitlement, and hard-redirects to `/` after 1.2s (L52-54) — the learner lands back in the app with no error, no token, and no explanation why the try-link doesn't unlock anything.

### L8 — [class 2, UNVALIDATED] `useDifferentEmail()` in RedeemCode.vue always routes to the OTP-gated `auth` step, even for possession-eligible codes
`RedeemCode.vue:250-261` (`useDifferentEmail()`, called from State 4 `confirm`)

A possession-eligible learner who is signed in under the wrong email and clicks "Use a different email" is unconditionally sent to `step='auth'` (the OTP-required door), even though their code type would otherwise let them skip the OTP wait entirely via the `details` step. The mode switch (from no-OTP to OTP-required) happens silently — no message tells the user why they're now being asked to wait for an email code when the flow they started didn't require one.

### L9 — [class 3, MISSING TWIN] Sign-out failure in Onboarding.vue is swallowed with no user-visible error
`Onboarding.vue:416-425` (`useDifferentEmail()`)

`try { await signOut() } finally { … }` has no `catch`. If `signOut()` rejects, the exception propagates unhandled; `finally` still resets local state, but no error message is ever shown and the session may remain signed in underneath a UI that now behaves as if it succeeded.

### L10 — [class 3, MISSING TWIN] `sendCode()` no-ops silently if the Supabase client isn't ready
`Onboarding.vue:438`

Guarded separately from the `canSend` computed (which only checks email validity + course selection + `busy`, not client readiness — L311-312). If `supabase` injection is genuinely delayed, clicking "Send my code" does nothing, with no error and no indication to the user that the click was received.

### L11 — [class 4, UNSPECIFIED CONTENT] Compound-disabled Send button in Onboarding.vue gives no per-condition feedback
`Onboarding.vue:311-312` (`canSend` computed), button at `Onboarding.vue:891-900`

`canSend` folds two independent unmet conditions (invalid email vs. no course picked) into one silent disabled state — a user who typed a valid email but hasn't picked a language sees the identical UI as one who typed a bad email, with no copy distinguishing the two.

### L12 — [class 3, MISSING TWIN] Signed-in user hitting a 409/`requiresCheckout` on the choose step has no reachable escape button
`Onboarding.vue:476-479` (`finishProvisioning()` sets `error`+`requiresCheckout` without changing `step`) · `Onboarding.vue:401-412` (`continueSignedIn()`, the only entry point for signed-in users) · `Onboarding.vue:954-963` (the only "Go to your school dashboard" button, gated on `step==='otp'`, a step signed-in users never enter)

A signed-in user whose trial is already burned clicks "Continue" on the choose step; the error banner shows text, but the one button that reads `requiresCheckout` and offers a way forward lives inside a template branch this user can structurally never reach.

### L13 — [class 4, UNSPECIFIED CONTENT] `selectedCourseLabel` can render an empty headline on the done step with no fallback
`Onboarding.vue:1016` vs. the OTP step's equivalent copy at `Onboarding.vue:642`, which explicitly falls back to `'your first words'`

If the catalogue hasn't finished loading or `selectedCourse` no longer matches a live course code, the done-step headline renders the broken sentence "  is ready" — the earlier OTP-step copy handles this exact case with a fallback string; the done-step copy doesn't.

### L14 — [class 4, UNSPECIFIED CONTENT / dead markup] "Go to your school dashboard" button declares a loading state that can never fire
`Onboarding.vue:958-963` (button declares `:loading="busy"`) vs. `Onboarding.vue:524-527` (`goToDashboard()` is synchronous, never touches `busy`)

The spec exists in markup but was never wired — clicking gives zero visual feedback while `window.location.href` resolves.

### L15 — [class 3, MISSING TWIN] Resending a code has no distinct success acknowledgement (Onboarding.vue)
`Onboarding.vue:451-452` (resend success reveals the delivery-hint panel) · `Onboarding.vue:982-991` (the only panel shown, worded as troubleshooting: "Still nothing? School email filters often block these codes outright...")

Clicking "Resend code" succeeds silently — the only visible change is copy framed for *failure*, with no "we've sent a new code" acknowledgement anywhere in the resend path.

### L16 — [class 2, UNVALIDATED] Name/institution fields on the Onboarding.vue done step carry no client-side validation
`Onboarding.vue:1029-1036` (name input) · `Onboarding.vue:1040-1047` (institution input) · `Onboarding.vue:533-534` (`continueIn()` only `.trim()`s before posting)

Arbitrary-length or garbage input is trimmed and posted straight to `/api/onboarding/profile` with zero client-defined format/length/content rule — whatever surfaces depends entirely on undocumented server behaviour.

### L17 — [class 4, UNSPECIFIED CONTENT, minor] Loading spinners with no accompanying text/`aria-live` region
`WithTeacher.vue:404` · similar pattern in `RedeemCode.vue`/`Onboarding.vue` spinners that do carry adjacent status text (those are compliant) — WithTeacher's initial-fetch spinner is the one bare exception, no text, no `role="status"`.

### Minor / logged, not actioned
- `Onboarding.vue:857-903` "Change language" tap requires a second click on the trigger to reopen the picker rather than reopening it directly — extra tap, not a broken path.
- `RedeemCode.vue:454-458` watcher/direct-call race on `doRedeem()` is correctly single-flighted (`useInviteCode.ts:111`) and explicitly commented — verified not a defect.
- `Onboarding.vue:402` dead defensive guard (`if (!selectedCourse.value) return` in `continueSignedIn()`) is unreachable since the calling button is already disabled on the same condition — noted for completeness, not a live gap.
- `RedeemCode.vue:113-114` auto-redirect timer (4000ms) and the manual "Continue" click both call `router.push` to the same `redirectUrl` — harmless double-navigation, not a defect.

---

## Coverage summary

- **Screens covered**: 4 (Onboarding.vue, WithTeacher.vue, RedeemCode.vue, TryLinkGateway.vue)
- **States tabled**: 42 (19 + 10 + 10 + 3)
- **Findings**: 17 classed + 4 logged-not-actioned
  - Class 1 (UNTYPED): 0
  - Class 2 (UNVALIDATED): 3 (L5, L8, L16)
  - Class 3 (MISSING TWIN): 8 (L3, L4, L7, L9, L10, L12, L15, and L17 is class 4 not 3 — recount: L3, L4, L7, L9, L10, L12, L15 = 7)
  - Class 4 (UNSPECIFIED CONTENT): 6 (L2, L6, L11, L13, L14, L17)
  - Class 5 (UNREACHABLE/ORPHAN): 1 (L1, divergence framing)
- **Worst 3**: L1 (three divergent hand-rolled OTP UIs, no shared component), L3 (WithTeacher.vue simultaneous success/error render with no reconciliation), L4 (RedeemCode.vue silent bounce to re-entry with zero explanation after a successful verify).
