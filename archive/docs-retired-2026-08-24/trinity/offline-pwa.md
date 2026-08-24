# Trinity Compliance Audit — Offline / PWA / Boot / Recovery

> **Date**: 2026-07-17
> **Scope**: cross-cutting states keyed by TRIGGER CONDITION, not route — boot, cold-load,
> network loss mid-round, PWA update, kill switch, offline lease, recovery/reset. These states
> can occur on top of ANY screen (player, schools, admin) since they live in `index.html`,
> `main.js`, `App.vue`, and `LearningPlayer.vue`, not in a routed view.
> **Method**: Trinity Principle (App→User / User→App / App→App), Phase 7 verbatim checks,
> findings classed 1–5 per `~/command-surface/trinity-campaign-brief.md`.
> Verified against `dev` @ `2d090ab3`.

---

## State 1: Cold boot (healthy path)

`index.html` → `main.js` → `App.vue onMounted`.

| # | Direction | Message |
|---|-----------|---------|
| 1 | App→User | Paint pure-CSS spinner (`.app-loading`, `index.html:66-84`) immediately, before any JS runs |
| 2 | App→App | Inline watchdog arms itself only if `navigator.serviceWorker.controller` exists (`index.html:132`) — first-ever visits are never watched |
| 3 | App→App | `main.js` executes, marks `window.__ssiBoot.mainExecMs` (perf timestamp, `main.js:11`) |
| 4 | App→App | `createApp(App).mount('#app')` (`main.js:106-107`) |
| 5 | App→App | `window.__SSI_BOOTED = true` set immediately after mount (`main.js:113`) — the ONE signal the inline watchdog polls for |
| 6 | App→User | Remove `.app-loading` class (`main.js:116`) — spinner gone, app visible |
| 7 | App→App | `App.vue onMounted`: `invalidateStaleCaches()` (build-version compare, clears stale script caches + non-preserved runtime caches on a version bump) |
| 8 | App→App | `restoreActAs()` — re-primes schools act-as context after a reload (non-fatal on failure) |
| 9 | App→App | `checkKillSwitch()` — fetches `/api/sw-config`, 5s timeout (see State 6) |
| 10 | App→App | Create Supabase client synchronously (before children mount, so `<GodModePanel>` etc. can read it in their own `onMounted`) |
| 11 | App→App | Init progress/session stores, `auth.initialize()`, entitlements + subscription (non-blocking), offline lease `initialize()` chained after entitlements resolve |
| 12 | App→App | `fetchEnrolledCourses()` → resolve default course (URL param → DB/localStorage → preferred default) |

### Findings — State 1

- **[Class 3 MISSING TWIN]** `restoreActAs()`, `checkKillSwitch()`, offline-lease `initialize()`, and the access-claim call are ALL fired with only a `console.warn` on failure (`App.vue:519-521, 525-527, 566-569, 585-587`) — no App→User message exists for any of them. A learner whose act-as context silently fails to restore, or whose entitlement claim silently fails, gets no signal at all; the only trace is a browser console line no user will ever see.
- **[Class 4 UNSPECIFIED CONTENT]** The only boot-time App→User content is the CSS spinner — no "loading course…" or similar text ever appears during a slow cold load before mount. If `main.js`'s module fetch is slow but not failing (e.g. slow 2G first visit, explicitly exempted from the watchdog by design), the user watches a spinner with zero content for however long that takes, with no elapsed-time feedback.

---

## State 2: Boot watchdog — fast path (script/module load failure)

`index.html` inline `<script>`, armed only when an SW already controls the page.

| # | Direction | Message |
|---|-----------|---------|
| 13 | App→App | Capture-phase `error` listener on `window` for any failed `<script>`/`<link>` tag load (`index.html:203-209`) |
| 14 | App→App | `heal()` called — guarded by `healTriggered` (once) and a `sessionStorage` attempt counter (max 2 per session) |
| 15 | App→User | Attempt 1/2: swap spinner for `<p>Updating the app…</p>` (`.ssi-boot-heal`, `index.html:151-155`) |
| 16 | App→App | Unregister all SW registrations + delete all Cache Storage EXCEPT `ssi-auth-handoff` (`index.html:174-190`) — IndexedDB (audio, progress) and localStorage deliberately untouched |
| 17 | App→App | `window.location.reload()` |
| 18 | App→User | Attempt 3+ (2 prior attempts exhausted): floor screen — `<p>The app needs a fix.</p>` + one button "Fix the app" (`.ssi-boot-floor`, `index.html:158-162`) |
| 19 | User→App | Tap "Fix the app" |
| 20 | App→App | `fullHeal()` — same unregister+wipe+reload as the automatic ladder |

### Findings — State 2

- **[Verified strength, no finding]** This is the one boot-adjacent surface with a designed, honest App→User message at every step (per `docs/pwa-lifecycle-design.md` §2.1, Tom's ruling 2026-07-09: "no step may require a user to understand caching, service workers, or browser menus"). The floor screen deliberately never mentions `/reset`, caching, or service workers — matches the ruling exactly.
- **[Class 5 ORPHAN — confirmed by design, not a defect]** `/reset` (a route alias for `?reset=1`) exists as a support-only alias never surfaced by the app itself, per the same ruling — noting this so a future auditor doesn't flag it as a dead end; it is a deliberate hidden power-user path (a phone-support script), consistent with `docs/pwa-lifecycle-design.md:167-169`.

---

## State 3: Boot watchdog — slow path (mount never happens)

| # | Direction | Message |
|---|-----------|---------|
| 21 | App→App | `setTimeout` 15s: if `window.__SSI_BOOTED` still unset, call `heal()` (`index.html:212-215`) |
| 22-26 | (same as State 2, #14-20) | Same heal ladder / floor screen |

### Findings — State 3

- **[Class 4 UNSPECIFIED CONTENT]** For 15 full seconds before the watchdog fires, the user sees only the plain CSS spinner with no differentiation from an ordinary slow load (State 1) — there is no progressive "this is taking longer than usual" message between 0s and the 15s heal trigger. Not wrong, but a silent 15-second wait is a long time with zero content for a mobile learner on a bad connection to judge whether anything is happening at all.

---

## State 4: `?wedge=1` dev cheat (rehearsal, dev builds only)

| # | Direction | Message |
|---|-----------|---------|
| 27 | User→App | Tester navigates to `...?wedge=1` on a dev build |
| 28 | App→App | `__ENABLE_WEDGE_CHEAT__` gate (false on staging/prod, `vite.config.js:203`) + `sessionStorage` armed-once guard (`main.js:57-64`) |
| 29 | App→App | `poisonPrecacheForWedgeTest()` — overwrites 2 precached JS chunk bodies with garbage (`main.js:66-90`, target selection via `utils/wedgeCheat.ts`) |
| 30 | App→App | Reload — poisoned chunks now fail to load → State 2 fires for real |

### Findings — State 4

- No findings — this is a test harness, not a learner-facing state, and is correctly gated out of staging/production builds (verified: `__ENABLE_WEDGE_CHEAT__` reuses the exact `swSelfUpdate` env carve-out, `vite.config.js:22-23,203`).

---

## State 5: PWA update available (new SW waiting)

`PwaUpdatePrompt.vue`, mounted unconditionally in `App.vue` template.

| # | Direction | Message |
|---|-----------|---------|
| 31 | App→App | `useRegisterSW` registers SW; `registration.update()` polled every 60s (`PwaUpdatePrompt.vue:31-47`) |
| 32 | App→App | `needRefresh` fires (new SW installed, waiting) |
| 33 | App→App | `verifyAgainstLiveBuild()` — fetches `/version.json`, compares build number; suppresses if the page is actually already current (`PwaUpdatePrompt.vue:56-68`) |
| 34 | App→User | Banner "New version available" with Update / Later buttons — held back while `isPlaying` (never interrupts an active cycle) |
| 35 | User→App | Tap "Later" |
| 36 | App→App | `userDismissed = true` — banner hides; a persistent "blue dot" (elsewhere, e.g. logo) takes over as the subtle ongoing indicator |
| 37 | User→App | Tap "Update" (from banner or the blue dot, same handler) |
| 38 | App→App | `updateServiceWorker(true)` → posts SKIP_WAITING; 3s fallback timer forces `window.location.reload()` if `controllerchange` doesn't fire |
| 39 | App→User | Page reloads on new build |

### Findings — State 5

- **[Verified strength, no finding]** The build-identity re-verification (#33) is a genuinely good defensive check — a stale `needRefresh` signal that would otherwise show a pointless banner for a build the user is already on is caught. This is Trinity-clean: every App→App check here has a defined consequence.
- **[Class 4 UNSPECIFIED CONTENT — minor]** The "Later"-dismissed blue-dot indicator is described in the component comment (`PwaUpdatePrompt.vue:6-8`) but its own visual content isn't specified in this file — it lives in a different component. Not a defect, but the Trinity table for this state is only complete once that component (LearningPlayer's logo/header area) is cross-referenced; flagging so it isn't silently assumed covered.

---

## State 6: Remote kill switch

`useServiceWorkerSafety.ts`, invoked from `App.vue onMounted`.

| # | Direction | Message |
|---|-----------|---------|
| 40 | App→App | `checkKillSwitch()` — `fetch('/api/sw-config')`, 5s abort timeout, `cache:'no-store'` |
| 41 | App→App | Non-OK response or timeout/offline → treated as "no action", continue normally (fail-open) |
| 42 | App→App | `config.killSwitch === true` → check `sessionStorage` guard (`ssi-sw-killswitch-handled`) to prevent reload-loop |
| 43 | App→App | Unregister all SWs + clear all caches |
| 44 | App→App | `window.location.reload()` |
| 45 | App→App | `config.forceUpdate === true` (and no kill switch) → `triggerServiceWorkerUpdate()`, silently |

### Findings — State 6

- **[Class 3 MISSING TWIN — confirmed]** The ENTIRE kill-switch flow has zero App→User message. A learner mid-session can have their service worker unregistered, every cache cleared, and the page silently reloaded — with no explanation ever shown. `config.message` is fetched and logged (`console.warn`, `useServiceWorkerSafety.ts:92-94`) but **never rendered to the user** — the field exists in the type and is read, but there is no UI consumer anywhere in the codebase (verified: no reference to this message string outside this file). This is exactly the "silent side-effect" class the brief calls out — an operator-triggered action with real user-visible consequences (reload, cache loss) and no learner-facing twin.
- **[Class 1 UNTYPED]** `forceUpdate` (#45) silently calls `registration.update()` + posts `SKIP_WAITING` to a waiting worker with no App→User signal at all — this is a genuinely silent forced update path that bypasses even the "never interrupt playing audio" banner logic in `PwaUpdatePrompt.vue`. If this fires while a cycle is playing, audio could be killed with zero warning — the opposite of Tom's hard rule (2026-05-21/22, restated in `docs/pwa-lifecycle-design.md` §4) that no auto-update may interrupt playing audio. This is a real path around that rule, gated only on an admin flipping a remote config flag.

---

## State 7: Network loss mid-round (the "silent playback fallback")

`useOfflinePlay.ts` graceful-degradation composable + `LearningPlayer.vue`'s own `isOnline` tracking.

| # | Direction | Message |
|---|-----------|---------|
| 46 | App→App | `window.addEventListener('offline', ...)` fires → `isOnline.value = false` (`LearningPlayer.vue:3786-3789`) |
| 47 | App→App | `offlinePlaybackActive()` computed flips true (`(offlineActive \|\| !isOnline) && !offlineLeaseLocked`, `LearningPlayer.vue:9236-9237`) |
| 48 | App→App | Belt-pill nav: `offlineUnavailableBeltNames` computed greys out any belt whose landing-round audio isn't actually in the persistent IndexedDB cache (`LearningPlayer.vue:9250-9264`) |
| 49 | App→App | Audio source resolution continues from `ssi-audio-cache-v2` for anything already cached; uncached audio for the CURRENT cycle has no defined fallback traced in this composable |

### Findings — State 7 — **the confirmed cross-cutting gap**

- **[Class 3 MISSING TWIN — CONFIRMED, this is finding #1 for the whole area]** **There is no app-wide offline indicator anywhere.** `isOnline` (`LearningPlayer.vue:3578`) is commented "Online/offline state for UI indicators" but its ONLY two consumers are (a) gating the offline-lease-lock paywall overlay (`v-if="offlineLeaseLocked && !isOnline"`, `LearningPlayer.vue:13016`) and (b) internal fetch-skip guards (lines 9488, 9514, 9550). It is never rendered as a standalone "you're offline" badge/toast/banner anywhere in the template. A learner who loses connectivity mid-round gets: audio continues if cached (silently, no acknowledgement that anything changed), or — if the current cycle's audio ISN'T cached — no defined UI at all in this file.
- **[Class 3 MISSING TWIN — CONFIRMED, the graceful-degradation hierarchy is dead code]** `useOfflinePlay.ts` implements a full 4-level degradation hierarchy (normal → belt-only → USE-phrases → repeat, `useOfflinePlay.ts:7-19`) with a purpose-built `getDegradationMessage()` function (lines 290-303) that returns learner-facing strings like `"Playing from your offline library"` / `"Repeating last lesson — go online to continue"`. **Verified by grep: `getNextPlayableCycle`, `canPlayCycle`, `markCycleAsPlayed`, `refreshCachedPool`, and `getDegradationMessage` have ZERO call sites anywhere in the codebase outside the composable's own file and its unit test.** `LearningPlayer.vue` instantiates `useOfflinePlay` (line 3770) purely to read `getCachedItems` through a vestigial, always-null `beltLoader` ref (the file's own comment at lines 3562-3568 calls this "VESTIGIAL as of 2026-06-02"). The entire designed App→User degradation-messaging system for mid-round network loss is unreachable code — a learner never sees ANY of these messages under ANY condition. This is the single worst finding in this area: a fully-built Trinity-compliant message set (App→App process → App→User twin) exists in source and is completely disconnected from the actual playback path.
- **[Class 5 ORPHAN — confirmed]** `beltLoader` itself is dead (never populated, per the same 2026-06-02 comment) — meaning `getCachedItems()` always returns `[]`, so even the legacy (non-Cycle) `getNextItemInfinite()` path is unreachable too. Both halves of `useOfflinePlay`'s public API are orphaned.
- **[Class 2 UNVALIDATED]** Whatever the ACTUAL current-cycle-audio-unavailable-while-offline behavior is (likely inside the audio controller / cycle player, outside this composable), it is not visible from `LearningPlayer.vue`'s own offline-handling code and was not traced to a defined UI outcome in this pass — flagging as unresolved scope, not asserting it's broken, since the real fallback logic may live in `CyclePlayer.ts` / `AudioController`, outside this area's file set as reviewed.

---

## State 8: Offline lease (the "Spotify handshake" — 30-day offline entitlement)

`useOfflineLease.ts`, initialized in `App.vue onMounted` after entitlements resolve; checked per-course in `LearningPlayer.vue`.

| # | Direction | Message |
|---|-----------|---------|
| 50 | App→App | `checkOfflineLease()` on boot (`LearningPlayer.vue:10714`) — refreshes `offlineLease.isCourseLeaseValid(code)`, fail-open on error |
| 51 | App→App | `statusFor(code)` → `'expired'` or `'clock-untrusted'` → `offlineLeaseLocked.value = true` |
| 52 | App→User | IF locked AND offline: paywall-styled overlay — "Free offline trial ended" (non-payer) or "Offline access paused" (payer), with expiry date if known, and a "Try to reconnect" button (`LearningPlayer.vue:13016-13038`) |
| 53 | User→App | Tap "Try to reconnect" |
| 54 | App→App | `offlineLease.renewLeases()` → `checkOfflineLease()` re-evaluates |
| 55 | App→App | On genuine reconnect (`online` event): `handleOnline()` also proactively calls `renewLeases()` then re-checks, so the lock UI clears promptly (`LearningPlayer.vue:3782-3784`) |
| 56 | App→User | Mode-tray "Offline" row shows live download/lease state via `offlineDownloadHeadline`/`offlineDownloadLabel` — `'locked'` state renders "Offline paused — reconnect to renew" (`useOfflineDownloadStatus.ts:70-71, 92-93`) |

### Findings — State 8

- **[Verified strength, no finding]** This is the most Trinity-complete state in the whole area: every App→App lock/unlock transition has a defined App→User twin (overlay AND mode-tray row), content is specific (trial vs paid, expiry date), and the recovery action is a single explicit button. Good reference implementation for what State 6/7 are missing.
- **[Class 4 UNSPECIFIED CONTENT — minor]** IF `offlineLeaseLocked` is true but `isOnline` is ALSO true (a transient state — e.g. the lease check ran stale before a reconnect fully re-validated), the overlay condition `v-if="offlineLeaseLocked && !isOnline"` (line 13016) means NO overlay shows, but nothing else is shown either — the learner sees normal-looking UI while (per the flag) still notionally locked, for however long it takes `handleOnline`'s `renewLeases()` chain to resolve. Not confirmed broken (this window is likely sub-second in practice) but the content for that in-between beat is unspecified.

---

## State 9: Install prompt / banner

`InstallBanner.vue` (async-loaded, always mounted in `App.vue`), design gaps documented pre-existing in `docs/pwa-lifecycle-design.md` §1.2 / §2.2 (Stage 3, **not yet implemented** as of this pass — verified: no `installState.ts` util exists in the repo).

| # | Direction | Message |
|---|-----------|---------|
| 57 | App→App | `beforeinstallprompt` captured once globally in `App.vue` (`e.preventDefault()`, stored as `installPrompt`) |
| 58 | App→App | `isStandalone` check (`matchMedia('display-mode: standalone')` OR `navigator.standalone`) — independently duplicated in `InstallBanner.vue`, `InstallGuide.vue`, `SettingsScreen.vue`, `utils/authHandoff.ts` |
| 59 | App→User | Banner shown after first round completes, if `!isStandalone` |
| 60 | User→App | Tap banner with a captured BIP prompt → native install flow (Chromium) |
| 61 | User→App | Tap banner with NO captured prompt → routes to `/install` → `InstallGuide.vue` |

### Findings — State 9

- **[Class 5 ORPHAN — confirmed, pre-documented, still live]** Installed-Firefox-on-Android does not reliably report `display-mode: standalone` (documented root cause in `docs/pwa-lifecycle-design.md:92-96`), so `isStandalone` is false INSIDE an already-installed app → banner fires → user taps → no BIP (Firefox never fires it) → `InstallGuide.vue` shows 3s of loading dots then Chrome-specific instructions ("Tap the menu ⋮ **in Chrome**", `InstallGuide.vue:144-147` per the design doc's citation) to a Firefox user who already has the app installed. This is a live, reproduced dead end (Jonathan's symptom 2) — confirmed still present since the design doc's Stage 3 fix (`utils/installState.ts` + guidance matrix) has not shipped.
- **[Class 4 UNSPECIFIED CONTENT — confirmed, pre-documented]** Desktop Firefox/Safari users (no PWA install support at all) hit `InstallGuide.vue`'s `desktop` flow, which shows "Preparing install" loading dots forever — a genuine dead end with no honest "no install here" fallback content.
- **[Class 1 UNTYPED]** No `appinstalled` listener exists anywhere (verified absent), so the app has no way to know a user just installed and immediately suppress the banner in the still-open browser tab — an install action produces no App→App acknowledgment at all until the next `isStandalone` check (next load).

---

## State 10: Recovery — `?reset=1`

`App.vue`, top of script setup, runs before Vue mounts.

| # | Direction | Message |
|---|-----------|---------|
| 62 | User→App | Navigate to any URL with `?reset=1` |
| 63 | App→App | `localStorage.clear()`, `sessionStorage.clear()` |
| 64 | App→App | Enumerate + delete every IndexedDB database (fire-and-forget, errors swallowed) |
| 65 | App→App | `unregisterAllServiceWorkers()` + `clearAllCaches()` (both `.catch(() => {})`) |
| 66 | App→App | Strip `reset` param from URL, `window.location.href = ...` (hard navigation reload) |
| 67 | App→User | Fresh boot, clean state (no explicit "your data was cleared" confirmation screen — the user just lands on a reset app) |

### Findings — State 10

- **[Class 3 MISSING TWIN]** No App→User acknowledgment exists anywhere in this flow — not even a toast on the subsequent load. A support agent talking a user through `/reset` (per the pwa-lifecycle-design doc's intended use) has no way to confirm to the user "that worked" beyond "does the app look different now?". Contrast with State 8's lease-lock UX, which names exactly what happened.
- **[Class 2 UNVALIDATED — confirmed by design, not a code bug]** `?reset=1` has zero confirmation step (no "are you sure" gate) — this is consistent with it being a hidden/support-only alias never surfaced by the app's own UI (per the pwa-lifecycle-design ruling), so an accidental visit is the actual risk surface, not a malicious one. Flagging as a live characteristic worth confirming Tom still wants un-gated, now that Stage 1 (the `/reset` route alias) is presumably closer to shipping.
- **[Cross-reference, not a new finding]** `docs/pwa-lifecycle-design.md` §2.3 documents that this reset path does NOT clear `ssi_learning_position_*` today, and traces a resurrection bug from that gap (position "undoes" the reset hours later via the forward-only sync guard). That fix (Stage 2 of the design) was not verified as shipped in this pass — the code at `App.vue:56-84` matches the doc's "as of 2026-07-09" citation with no `ssi_learning_position_*` removal added since. **Recommend a follow-up pass specifically confirming whether Stage 2 (Authority ruling) has landed**, since it directly affects whether this Trinity table's App→App step #63 (`localStorage.clear()`) already covers position or not — a plain `localStorage.clear()` WOULD incidentally clear position keys too (unlike the narrower `invalidateStaleCaches` path), so this specific reset flow may already be safe on this axis even if Stage 2's OTHER fixes (deploy-wipe, 7-day expiry) haven't landed. Not resolved in this pass — logged as open.

---

## State 11: Demo-state / stale-flag cleanup (boot-time housekeeping)

| # | Direction | Message |
|---|-----------|---------|
| 68 | App→App | If `ssi-dev-tier === 'paid'` in localStorage but no active demo session flag → silently strip demo keys (`App.vue:89-94`) |
| 69 | App→App | Unconditionally wipe dead god-mode storage keys every boot (`App.vue:99-101`) — a one-way migration cleanup, not state-dependent |
| 70 | App→App | Clear `ssi-position-writes-suspended` one-shot flag at the start of every fresh boot (`App.vue:109`) |

### Findings — State 11

- No findings — these are silent App→App housekeeping steps with no user-facing consequence by design (stale key cleanup, migration debris), correctly typed as App→App only.

---

## Ledger — Findings by class, this area

| Class | Count | Worst instance |
|---|---|---|
| 3. MISSING TWIN | 6 | Kill switch has zero learner-facing message despite reloading the page and wiping caches mid-session (State 6) |
| 3. MISSING TWIN (dead code) | 1 | `useOfflinePlay`'s entire degradation-message system is unreachable — designed messages that can never render (State 7) |
| 1. UNTYPED | 2 | Remote `forceUpdate` can SKIP_WAITING mid-audio with no warning, bypassing the documented never-interrupt rule (State 6) |
| 4. UNSPECIFIED CONTENT | 4 | Firefox-Android install dead-end still shows Chrome-only copy inside an already-installed app (State 9, pre-documented, unfixed) |
| 5. ORPHAN | 3 | `beltLoader` + both halves of `useOfflinePlay`'s public API are unreachable (State 7) |
| 2. UNVALIDATED | 2 | `?reset=1` has no confirmation gate (by design, flagged for re-confirmation) |

**Worst 3 findings overall:**

1. **State 7 — the confirmed cross-cutting gap.** No app-wide offline indicator exists anywhere, AND the one degradation-messaging system built for this exact purpose (`useOfflinePlay.getDegradationMessage()`) is entirely disconnected from the live playback path — verified zero call sites outside its own file/test. A learner loses connectivity mid-round and gets no acknowledgment whatsoever, while a fully-designed message set for exactly this moment sits dead in the codebase.
2. **State 6 — kill switch is entirely silent.** An operator-triggered remote flag can unregister every service worker, clear every cache, and reload the page — mid-session, potentially mid-audio via `forceUpdate`'s SKIP_WAITING path — with zero App→User message. `config.message` is fetched from the server and logged to console but has no UI consumer anywhere.
3. **State 9 — Firefox/Android install dead-end, still live.** Pre-documented in `docs/pwa-lifecycle-design.md` (2026-07-09) as Jonathan's reproduced symptom; the fix (Stage 3, `installState.ts`) has not shipped as of this pass (verified: file doesn't exist). An already-installed Firefox user is told to install via "the menu in Chrome."

---

*Audit method note: every message above cites the file:line it was read from. Nothing in this
table was inferred from a screenshot or from memory of a design doc — components and composables
were read directly against `dev @ 2d090ab3` in this pass. Findings that duplicate a
pre-existing, still-open design-doc finding are marked "confirmed, pre-documented" rather than
re-discovered independently, per the evidence standard.*
