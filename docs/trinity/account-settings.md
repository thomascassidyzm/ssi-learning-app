# Trinity Compliance Audit — Account / Subscription / Misc

> **Date**: 2026-07-17
> **Scope**: `SettingsView.vue` (`/schools/settings`), `UpgradeView.vue` (`/schools/upgrade`, `/tutors/dashboard/upgrade`, `/teach/upgrade`), and the in-player `SettingsScreen.vue` (reached from inside the player via the gear icon — not a route)
> **Trinity**: App→User (output) | User→App (input) | App→App (processing)
> **Protocol**: `trinity-campaign-brief.md` — three validation sessions (System→User, User→System, System→System) per screen; findings classed 1–5.
> **Note on staleness**: `docs/schools-trinity-audit.md` Screen 10 audited an earlier `SettingsView.vue` (2026-04-11, 3 sections, localStorage-only). The live file has since grown a 4th "Billing" section wired to real Paddle/server state — this document supersedes that Screen 10 entirely for `SettingsView.vue`.

---

## Screen 1: School/Tutor Settings — School Profile (`SettingsView.vue`)

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Display section nav (School profile / Localisation / Data & privacy / Billing — Billing hidden unless `isSchoolAdmin`) |
| 2 | App→User | Display school name input, pre-populated from `activeSchool`/`currentSchool`, readonly unless `canEditSchool` (`isSchoolAdmin && !isAdminView`) |
| 3 | App→User | Display "Type" field — always readonly, hardcoded string "Bilingual immersion · primary + lower secondary" regardless of actual school (see finding) |
| 4 | App→User | Display City / Region inputs (readonly unless `canEditSchool`) |
| 5 | App→User | Display Contact email input, defaults to school's saved `contact_email` else the admin's real signup email |
| 6 | App→User | Display "About" textarea |
| 7 | App→User | Show "Only a school admin can edit the school profile" hint when `!canEditSchool` |
| 8 | User→App | Edit school name / city / region / contact email / about (only when `canEditSchool`) |
| 9 | User→App | Click "Save changes" |
| 10 | App→App | `POST /api/school/update-profile` with `{ school_name }` only — city/region/email/about are typed but **never sent** (see finding) |
| 11 | App→User | Button shows "Saving…" → "Saved" (2s) on success |
| 12 | App→User | On failure: `console.error` only — **no user-visible error** (see finding) |
| 13 | User→App | Click "Cancel" button |
| 14 | App→App | **No handler bound — button is inert** (see finding) |

## Screen 2: School/Tutor Settings — Localisation (`SettingsView.vue`)

| # | Direction | Message |
|---|-----------|---------|
| 15 | App→User | Display language dropdown (English/Cymraeg/Español/Breton), timezone dropdown (5 options), week-start dropdown, "Show flags" toggle |
| 16 | User→App | Select language / timezone / week start / toggle flags |
| 17 | User→App | Click "Save changes" |
| 18 | App→App | Save `timezone` + `language` to `localStorage` only — **`weekStart` and `showFlags` are never persisted anywhere** (see finding) |
| 19 | App→User | Button shows "Saving…" (fixed 250ms `setTimeout`, not a real request) → "Saved" (2s) |

## Screen 3: School/Tutor Settings — Data & Privacy (`SettingsView.vue`)

| # | Direction | Message |
|---|-----------|---------|
| 20 | App→User | Display 4 toggle rows: share anonymised analytics, allow student messaging, show real names, retain inactive accounts |
| 21 | User→App | Click a toggle |
| 22 | App→App | `toggleDataItem()` flips local `ref` only — **no DB column backs any of these four; every toggle is decorative and resets on reload** (see finding — this doc's version of finding #2 from the April audit, now worse: 4 fully-wired-looking toggles, not a placeholder note) |
| 23 | App→User | Display "Download all data (.csv)" button |
| 24 | User→App | Click "Download all data" |
| 25 | App→App | Query `class_student_progress` filtered by `school_id`, build CSV client-side, trigger browser download |
| 26 | App→User | Button shows "Preparing…" during query |
| 27 | App→User | On failure: `console.error` only — **no user-visible error**, button just returns to idle (see finding) |

## Screen 4: School/Tutor Settings — Billing (`SettingsView.vue`, admin-only tab)

| # | Direction | Message |
|---|-----------|---------|
| 28 | App→User | Display plan card: school name + seat count + "(active)" suffix if subscribed |
| 29 | App→User | Display per-seat price line (hardcoded £15, does not reflect annual billing — see finding) |
| 30 | App→User | Display "Subscribe / choose seats →" (not subscribed) or "Manage subscription & seats →" (subscribed) link to `/schools/upgrade` |
| 31 | App→User | Display "Billing & invoices" button (only if subscribed) |
| 32 | User→App | Click "Billing & invoices" |
| 33 | App→App | `GET /api/school/portal` → redirect to `data.portalUrl` (Paddle-hosted portal) |
| 34 | App→User | Button shows "Opening…" while pending |
| 35 | App→User | On failure: show `portalError` inline (`role="alert"`) — validated content path |

---

## Screen 5: Upgrade / Paywall — School lane (`UpgradeView.vue`, `isSchoolAdmin` or has `school_id`)

| # | Direction | Message |
|---|-----------|---------|
| 36 | App→User | Display title "Subscribe your school" (not subscribed) / "Manage your seats" (subscribed) |
| 37 | App→User | Display Monthly/Annual billing toggle (Annual disabled + tooltipped if `paddleConfig.schoolTeacherAnnualPriceId` unset) |
| 38 | App→User | Display seat stepper (−/input/+), live total (`£{schoolTotalGbp}{periodSuffix}`) |
| 39 | App→User | Display honest actual-vs-paid note: "`{joinedTeacherCount}` teachers joined · `{paidSeats}` seats paid", plus an amber over-note if joined > paid |
| 40 | User→App | Click Monthly/Annual toggle |
| 41 | App→App | `setBilling()` — if a checkout is already open, re-price it in place via `paddle.Checkout.updateItems()` rather than restarting |
| 42 | User→App | Adjust seat stepper (−/+/type a number) |
| 43 | App→App | `setSeats()` clamps to `Math.max(1, …)` — floors, never negative/zero |
| 44 | User→App | Click "Subscribe — £X" (not yet subscribed) |
| 45 | App→App | Double-subscribe guard: re-confirm `!isSubscribed` from server before opening an INITIAL Paddle checkout (blocks a second concurrent subscription) |
| 46 | App→App | `startSchoolCheckout()` opens Paddle inline checkout into `.paddle-inline-frame` |
| 47 | App→User | Button reads "Loading…" until `schoolSubLoaded`, then "Opening…" while checkout opens, else the price |
| 48 | App→User | On failure: `checkoutError` shown inline |
| 49 | App→User | On success: Paddle redirects the parent window to `successUrl` (this same page) — **no distinct in-app "you're subscribed" confirmation message; the user only learns it worked because the CTA re-renders as "Manage your seats" on next load** (see finding — MISSING TWIN) |
| 50 | User→App | Click "Update to N seats — £X/mo" (already subscribed, seat count changed) |
| 51 | App→App | `POST /api/school/update-seats` with `{ seats }` |
| 52 | App→User | Button shows "Updating…" → inline `seatsMessage` ("Updated to N seats" / "No change" / server error) |
| 53 | App→App | Button is `disabled` when `seatCount === paidSeats` (no-op update prevented) |

## Screen 6: Upgrade / Paywall — Tutor lane (`UpgradeView.vue`, solo tutor)

| # | Direction | Message |
|---|-----------|---------|
| 54 | App→User | Display title "Subscribe", lede explaining student fees offset the tutor's own subscription |
| 55 | App→User | Display Monthly/Annual toggle (same component, independent `annualAvailable` check against `paddleConfig.teacherAnnualPriceId`) |
| 56 | App→User | Display single-seat total `£{tutorTotalGbp}{periodSuffix}` |
| 57 | User→App | Click "Subscribe — £X" |
| 58 | App→App | Double-subscribe guard: `loadTutorSubscription()` if not yet resolved; if `tutorPlatformActive` (active OR `past_due`, so a retrying card doesn't look "not subscribed"), route to `openTutorPortal()` instead of a second checkout |
| 59 | App→App | Resolve `teacherId` via `/api/teacher/me` (fallback: direct `teachers` table lookup by `learner_id`); block the CTA until resolved |
| 60 | App→App | `paddle.Checkout.open()` with `customData: { kind: 'tutor_platform', teacher_id, supabase_user_id, billing }` |
| 61 | App→User | Button states: "Loading…" (teacherId/sub status unresolved) → "Opening…" (busy) → price |
| 62 | App→User | On failure: `tutorError` shown inline, `checkoutOpen` reset to false so the CTA reappears |
| 63 | User→App | Click "Manage subscription" (already active) |
| 64 | App→App | `GET /api/teacher/portal` → redirect to `portalUrl` |
| 65 | App→User | On failure: `tutorError` = "Could not open the billing portal — try again" |

---

## Screen 7: In-Player Settings (`SettingsScreen.vue` — gear icon inside the player, ~3,655 lines)

### 7a. Header / Build & version

| # | Direction | Message |
|---|-----------|---------|
| 66 | App→User | Header: "Settings" title, learning-time subtitle (`formattedLearningTime`), close (✕) button |
| 67 | App→User | Build/version card — tappable, shows commit SHA + build time; badges "Update available" when `showUpdateBadge` (SW update waiting OR a release note describes a newer build) |
| 68 | User→App | Tap build card |
| 69 | App→App | `handleUpdateToLatest()` — staged flow: check SW registration → drop non-audio caches → `SKIP_WAITING` on the waiting worker → reload |
| 70 | App→User | Staged "Fixing things…" overlay narrates each step with ✓ as it completes, then "Reloading…" |

### 7b. What's New (admin-curated release notes)

| # | Direction | Message |
|---|-----------|---------|
| 71 | App→User | Display latest release note (date, version, headline, first 4 bullets); "✦ In the latest version" marker only on the newest note when it describes a build the user doesn't have |
| 72 | App→User | Loading state: "Loading…" card while `notesLoading` |
| 73 | App→User | Empty case: section doesn't render at all if `releaseNotes.length === 0` — **no "no updates yet" state; silently absent** (minor, acceptable) |
| 74 | User→App | Click "Read more (N more)…" on a note |
| 75 | App→App | Expand that note's full bullet list (keyed per-note, independent of the all-notes toggle) |
| 76 | User→App | Click "See N earlier updates" |
| 77 | App→App | Toggle `showAllNotes` to reveal all notes vs. latest-only |

### 7c. Account (signed-out)

| # | Direction | Message |
|---|-----------|---------|
| 78 | App→User | "Sign in to save your progress across devices" + "Sign In" CTA |
| 79 | User→App | Click "Sign In" |
| 80 | App→App | `emit('close')` then `openAuth()` — closes Settings first so the auth modal (which renders behind it) is actually visible |

### 7d. Account (signed-in)

| # | Direction | Message |
|---|-----------|---------|
| 81 | App→User | Display name + email row (clickable, expands inline edit form) |
| 82 | User→App | Click row → toggle inline display-name form |
| 83 | User→App | Type new display name, click "Save" |
| 84 | App→App | `supabase.auth.updateUser({ data: { display_name } })`, then best-effort `learners` table update keyed on `auth.userId` (never the learner PK — correct per the RLS canon in CLAUDE.md) |
| 85 | App→User | Validation: empty name → "Name cannot be empty"; not connected → "Not connected"; success → "Name saved" |
| 86 | App→User | "Set Password" / "Change Password" row (label switches on `hasPassword`) |
| 87 | User→App | Fill password + confirm, click "Save Password" |
| 88 | App→App | Client-side validation: length ≥ 6, match confirm; then `auth.updatePassword()` |
| 89 | App→User | Errors: "Password must be at least 6 characters" / "Passwords do not match" / server error; success → "Password saved" |
| 90 | App→User | Unverified-primary-email banner (possession-onboarded accounts only) with "Verify now" |
| 91 | User→App | Click "Verify now" |
| 92 | App→App | Pre-fills the add-email flow with the primary email and immediately sends an OTP |
| 93 | App→User | "Linked Emails" row (clickable, shows count / "Add another email to sign in with") |
| 94 | User→App | Type new email, click "Send verification code" |
| 95 | App→App | Client regex validation; duplicate check against `verifiedEmails`; `supabase.auth.signInWithOtp({ email, shouldCreateUser: true })` |
| 96 | App→User | Errors: invalid email / already linked / send failure; success → advances to OTP step |
| 97 | User→App | Type 6-digit OTP, click "Verify" |
| 98 | App→App | `POST /api/email/verify` with `{ email, token }`, bearer auth |
| 99 | App→User | Button disabled until 6 digits entered; errors surfaced from API; success → "Email verified and linked", auto-closes form after 2s |
| 100 | User→App | Click "Sign Out" |
| 101 | App→App | `auth.signOut()` **inside a `try`, with `window.location.reload()` in `finally`** — reload always fires even if signOut throws, so the button never appears to do nothing (deliberate, documented) |

### 7e. Dashboards (role-gated)

| # | Direction | Message |
|---|-----------|---------|
| 102 | App→User | "Schools Dashboard" row (if `hasSchoolRole`) / "Admin Dashboard" row (if `hasAdminRole`) |
| 103 | User→App | Click either row |
| 104 | App→App | `router.push('/schools')` or `router.push('/admin')` |

### 7f. Interface Language

| # | Direction | Message |
|---|-----------|---------|
| 105 | App→User | Language row showing current label; expands a picker of 19 languages |
| 106 | User→App | Click a language option |
| 107 | App→App | `setLocale(code)` — persists to `localStorage['ssi-locale']`, closes picker |

### 7g. Speed (tester-only) / Tools

| # | Direction | Message |
|---|-----------|---------|
| 108 | App→User | Speed section (only if `isTester`) — 6 speed buttons (0.7×–1.25×) |
| 109 | User→App | Click a speed option |
| 110 | App→App | `setLearnerSpeed()` — removes the localStorage key entirely at 1.0× (the true default), else stores the value |
| 111 | App→User | "View Script" row (only if `showViewScript`, itself only settable from the hidden Developer section) |
| 112 | User→App | Click "View Script" |
| 113 | App→App | `emit('openExplorer')` |
| 114 | App→User | "QA Mode" toggle row (admin-only) — "Flag phrases that don't sound right" |
| 115 | User→App | Toggle QA Mode |
| 116 | App→App | Persists to `localStorage['ssi-enable-qa-mode']`, dispatches `ssi-setting-changed` |
| 117 | App→User | "Personalised pacing" toggle row (microphone-based adaptation, all users) |
| 118 | User→App | Toggle Personalised pacing |
| 119 | App→App | Persists to `localStorage['ssi-adaptation-consent']`, dispatches `ssi-setting-changed` — **this is a microphone-permission-adjacent consent toggle with no actual `getUserMedia` prompt visible in this file; the mic permission flow itself (and its own consent copy) lives elsewhere and is out of this audit's file scope** (flag for cross-reference) |

### 7h. Codes (signed-in only)

| # | Direction | Message |
|---|-----------|---------|
| 120 | App→User | "Enter a code" row → "Enter Code" button |
| 121 | User→App | Click "Enter Code" |
| 122 | App→App | Reveals join-code input form |
| 123 | User→App | Type code (auto-uppercases, strips invalid chars, auto-inserts `-` at position 3, caps at 7 chars) |
| 124 | User→App | Click "Go" (disabled until ≥5 chars) |
| 125 | App→App | `validateCode()` → on success shows `joinContext` (role label + school/group/class detail); on failure "Invalid or expired code" |
| 126 | User→App | Click "Confirm" |
| 127 | App→App | `redeemCode(token)`; on `codeKind === 'entitlement'` also `refreshEntitlements()` |
| 128 | App→User | Success → "Joined successfully!"; failure → server error message |
| 129 | User→App | Click "Cancel" (on context) or "Close" (on form) |
| 130 | App→App | Clears the relevant local state, collapses the form |

### 7i. Subscription (signed-in only)

| # | Direction | Message |
|---|-----------|---------|
| 131 | App→User | Subscribed: plan name, status line ("Ends `date`" if cancel-scheduled / "Renews `date`" / "Active") |
| 132 | App→User | Not subscribed: "Go Premium" row, "£15/month — unlimited access to all languages" |
| 133 | User→App | Click "Go Premium" |
| 134 | App→App | `startCheckout({ courseCode })` — signed-out users get the auth modal first, then auto-continue into Paddle (per file comment) |
| 135 | User→App | Click "Cancel subscription" (hidden once already cancel-scheduled) |
| 136 | App→App | Opens confirm dialog: "You'll stay on Premium until `date`, then it ends" |
| 137 | User→App | Confirm cancel |
| 138 | App→App | `cancelSubscription()` (in-app, not the hosted portal — deliberate, per comment: "keeps users in the app for the common action") |
| 139 | App→User | Success → dialog closes; failure → inline `cancelError`, defaulting to "Could not cancel. Please try Payment & invoices instead." |
| 140 | User→App | Click "Payment & invoices" |
| 141 | App→App | `openPortal()` (hosted Paddle portal — for card updates / invoices, the rarer case) |
| 142 | App→User | Failure → `portalFeedback` = "Unable to open billing portal. You may not have an active subscription." |

### 7j. Data (Reset / Delete)

| # | Direction | Message |
|---|-----------|---------|
| 143 | App→User | "Reset Progress" row — "Start fresh for this course" |
| 144 | User→App | Click → confirm dialog showing belt/seeds/minutes/sessions about to be lost |
| 145 | User→App | Confirm "Reset Progress" |
| 146 | App→App | Deletes `response_metrics`/`spike_events`/`lego_progress`/`seed_progress`/`sessions` rows scoped to `learner_id`+`course_id`; resets `course_enrollments` ratchet columns; clears the local position cache key; suspends position writes for the reload; resets local belt progress |
| 147 | App→User | Success → "Progress reset!" → auto-reload after 1.5s; failure → "Failed to reset progress" |
| 148 | App→User | "Delete Account" row (signed-in only) — "Permanently delete your account and all data" |
| 149 | User→App | Click → confirm dialog requiring the literal text `DELETE` to be typed |
| 150 | App→App | Confirm button stays `disabled` until `deleteConfirmMatch` (case-insensitive, trimmed) |
| 151 | User→App | Confirm "Delete Account" |
| 152 | App→App | Client-side cascading delete across `response_metrics`/`spike_events`/`lego_progress`/`seed_progress`/`sessions`/`course_enrollments`/`learners` (by `learner_id`/`id`), then `auth.signOut()`, `localStorage.clear()`, reload |
| 153 | App→User | Failure → "Failed to delete account. Please contact support." |

### 7k. Developer (ssi_admin only)

| # | Direction | Message |
|---|-----------|---------|
| 154 | App→User | Toggle rows: View Script, Debug Overlay, Verbose Logging, Listening Progression Audit, Fragile Progress Warning |
| 155 | User→App | Toggle any of the five |
| 156 | App→App | Each persists its own `localStorage` key and dispatches `ssi-setting-changed` |

### 7l. Troubleshooting (always visible)

| # | Direction | Message |
|---|-----------|---------|
| 157 | App→User | At-rest status line: app version + MB downloaded for offline |
| 158 | App→User | "Update to the latest version" row — "keeps downloads and progress" |
| 159 | User→App | Tap it |
| 160 | App→App | Same `handleUpdateToLatest()` staged flow as the build card (7a) |
| 161 | App→User | "Clear cache & reload" row (danger-styled) |
| 162 | User→App | Tap it |
| 163 | App→App | `openClearConfirm()` — fetches current offline-audio MB for the warning copy |
| 164 | App→User | Confirm dialog: warns about MB of offline downloads lost; guest-specific extra warning ("your progress on this device isn't backed up") with a "Create a free account to keep it" escape hatch |
| 165 | User→App | Click "Create a free account to keep it" |
| 166 | App→App | Closes the confirm + Settings, opens the auth modal |
| 167 | User→App | Confirm "Clear cache" |
| 168 | App→App | Snapshots `sb-*` auth localStorage keys, clears all IndexedDB + local/session storage, restores the auth keys, unregisters SWs, clears caches, reloads — staged overlay narrates each step |
| 169 | App→User | "Recover a lost position" row (signed-in + has a furthest point) — display-only unless `canRecover` |
| 170 | User→App | Tap (only when `canRecover`) |
| 171 | App→App | Opens confirm: "This will move you back to where `{furthest lego text}` was introduced" |
| 172 | User→App | Confirm "Move Position" |
| 173 | App→App | Updates `course_enrollments` cursor columns to the ratcheted ceiling, clears the local position cache, suspends position writes, reloads |
| 174 | App→User | Success → "Position recovered!"; failure → "Failed to recover position" |

### 7m. Install / Community / Legal / Footer

| # | Direction | Message |
|---|-----------|---------|
| 175 | App→User | "Install App" row (hidden once already running standalone/PWA) |
| 176 | User→App | Tap it |
| 177 | App→App | `router.push('/install')` |
| 178 | App→User | Community links (forum, classic Welsh listening) — external, `target="_blank"` |
| 179 | App→User | Legal links (Terms, Privacy, Refund policy) — external, `target="_blank"` |
| 180 | App→User | Brand footer: logo, tagline, legal entity address |

---

## Findings Ledger

Classes: **1** UNTYPED · **2** UNVALIDATED · **3** MISSING TWIN · **4** UNSPECIFIED CONTENT · **5** UNREACHABLE/ORPHAN

| Class | Screen | Finding | file:line |
|---|---|---|---|
| 2 | School Settings — Profile | `saveSchoolProfile()` only ever sends `{ school_name }` to the API. City, region, contact email, and about are all bound to editable inputs and appear to save on "Save changes", but are silently dropped — a school admin filling in city/region/email/about gets no error and no persistence, and will see the fields reset to blank/last-saved on next load with no warning. | `packages/player-vue/src/views/schools/SettingsView.vue:174-203,187-191` |
| 3 | School Settings — Profile | `saveSchoolProfile()` failure path only `console.error`s — `profileSaveStatus` resets to `'idle'` with **no error message shown to the user**. A failed save looks identical to never having clicked Save. | `packages/player-vue/src/views/schools/SettingsView.vue:199-202` |
| 5 | School Settings — Profile | The "Cancel" button next to Save Changes has no `@click` handler — it is visually a button but does nothing. | `packages/player-vue/src/views/schools/SettingsView.vue:314` |
| 4 | School Settings — Profile | The "Type" field ("Bilingual immersion · primary + lower secondary") is a hardcoded literal string for every school, not read from any school property — every school profile displays the same fake type. | `packages/player-vue/src/views/schools/SettingsView.vue:287-289` |
| 2 | School Settings — Localisation | "Week starts on" and "Show flags on courses" are bound to `ref`s with no persistence at all (contrast: `timezone`/`language` do write to `localStorage`) — they silently reset to default on every reload, and the "Saved" confirmation implies they were saved. | `packages/player-vue/src/views/schools/SettingsView.vue:205-213` |
| 1 | School Settings — Localisation | `saveLocalization()`'s "Saving…" state is a fixed 250ms `setTimeout`, not a real request/await — it's a fake-latency UI, not a processing message with a real System→System counterpart. | `packages/player-vue/src/views/schools/SettingsView.vue:205-213` |
| 2 | School Settings — Data & Privacy | All 4 toggles (`analytics`, `messaging`, `realnames`, `retention`) are local-only (`toggleDataItem` flips a `ref`, never persisted); this reads as a fully-wired privacy control panel (specific consequential copy: "Disabled by default in school accounts", "we delete them automatically") but every toggle resets on reload and has zero effect on any actual server behaviour. | `packages/player-vue/src/views/schools/SettingsView.vue:50-76,255-258` |
| 3 | School Settings — Data & Privacy | `handleExportData()` failure path only `console.error`s, no user-visible error — a failed export just silently returns the button to idle with no downloaded file and no explanation. | `packages/player-vue/src/views/schools/SettingsView.vue:238-242` |
| 4 | School Settings — Billing | The billing summary hardcodes `£{PRICE_PER_SEAT_GBP}` (monthly, £15) in the plan line regardless of whether the school is actually on the annual plan — an annual subscriber sees a misleading monthly-rate description of their own plan. | `packages/player-vue/src/views/schools/SettingsView.vue:82,402` |
| 3 | Upgrade — School lane | On successful initial checkout there is no distinct in-app "You're subscribed!" confirmation — Paddle redirects to the same page and the user infers success only from the CTA silently re-rendering as "Manage your seats" on the next data load. A slow/failed reload of `platformStatus` after a real charge would leave the admin looking at an unchanged "Subscribe" CTA with money already taken. | `packages/player-vue/src/views/schools/UpgradeView.vue:174-188` |
| 3 | In-Player Settings — Account/Delete | "Delete Account" deletes the `learners` row and dependent progress tables and calls `auth.signOut()`, but never deletes the underlying Supabase Auth user (no service-role/admin API call exists in this codebase for that). The auth identity — and its email/OTP login — survives a "deleted" account, so the same person can sign back in immediately and get a fresh, empty learner row under the same auth uid. Nothing in the confirm copy ("permanently delete your account") discloses this. | `packages/player-vue/src/components/SettingsScreen.vue:872-923` |
| 4 | In-Player Settings — Personalised pacing | The consent copy promises "No audio is recorded or stored" for a microphone-based feature, but the toggle here is only a `localStorage` consent flag — the actual `getUserMedia` prompt/permission flow (and whatever it does with the audio stream) lives outside this file. This audit cannot verify the promise from this file alone; needs cross-reference to the adaptation-engine composable actually consuming this flag. | `packages/player-vue/src/components/SettingsScreen.vue:994-998,1937-1947` |
| 4 | In-Player Settings — What's New | No empty-state message when there are zero release notes and loading has finished — the whole section just vanishes, which is fine, but is worth noting as the one un-messaged branch (`v-else-if="notesLoading"` has no matching `v-else` for the "loaded but empty" case). | `packages/player-vue/src/components/SettingsScreen.vue:1571,1603-1606` |

---

## Duplication divergence: `SettingsScreen.vue` (in-player) vs. routed `SettingsView.vue` / `UpgradeView.vue`

Both surfaces let a signed-in user reach subscription and billing controls, but they diverge in non-trivial, potentially confusing ways:

1. **Two independent subscription systems.** In-player Settings uses `useSubscription()`/`useCheckout()` (learner-premium subscription, `subscription.value.planName`, `£15/mo unlimited access`). The routed School Settings/Upgrade pages use a completely separate school/tutor-teacher-seat subscription (`platform_status`, `teacher_seats`, `/api/school/subscription`). A school-admin-who-is-also-a-learner could plausibly have both, but **neither surface shows or links to the other** — a school admin looking at the in-player "Go Premium" card has no way to know their school already has a separate teacher-seat plan, and vice versa.
2. **Cancellation flow differs.** In-player Settings cancels **in-app** (`cancelSubscription()`, no portal round-trip) with a confirm dialog stating the exact end date. The school lane (`UpgradeView.vue`) has **no in-app cancel at all** — only "Manage subscription" → hosted Paddle portal (tutor lane) or "Billing & invoices" → portal (school lane in `SettingsView.vue`). A school admin wanting to cancel must leave the app; a learner does not. This is a real UX asymmetry, not obviously intentional.
3. **Reset Progress only exists in-player.** There is no equivalent "reset my course progress" action anywhere in the routed school-admin settings, which is consistent (a school admin resetting their own learner progress is a different action from anything school-scoped) but worth flagging since a teacher-who-plays-as-a-learner has to know to find it in the player, not in `/schools/settings`.
4. **Delete Account only exists in-player**, and per the finding above does not delete the Supabase Auth identity. There is no equivalent "delete my school" self-service flow in `SettingsView.vue` — school deletion is admin-console-only (`SetupView.vue`, per the April audit's Screen 11), which is a deliberate, reasonable asymmetry (deleting a school affects many other users) but is the kind of "same word, different blast radius" gap worth a shared mental model between the two.
5. **Data export exists in both, with different scope and format.** `SettingsView.vue`'s "Download all data (.csv)" exports `class_student_progress` for the *whole school*. `SettingsScreen.vue` has no equivalent "export my own data" action at all — a learner (non-school-staff) account has no self-service data export, only account deletion.
6. **Localisation exists in both, independently.** `SettingsView.vue`'s Localisation tab (language/timezone/week-start/flags, all `localStorage`-only except two of four fields — see findings) is entirely separate from in-player Settings' "Interface Language" section (19-language picker, `localStorage['ssi-locale']`). These are two different keys (`ssi-language` vs `ssi-locale`) for what a user would reasonably assume is the same setting — changing your language in one surface does not change it in the other.
