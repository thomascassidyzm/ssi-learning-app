# PWA Install + Update Lifecycle — Design

> **Status: DESIGN (2026-07-09).** No product code in this branch. Ground truth: Jonathan
> (Samsung S25FE, Android 16, OneUI, Firefox — meticulous beta tester), whose three symptom
> classes are each diagnosed against the actual code below. Companion spine:
> `docs/bundle-cutover-design.md` (server-issued artifact + server cursor) and
> `docs/position-and-ownership-model.md` (cursor-only position, locked 2026-07-04).
> Decision doctrine applied throughout; journal entry appended to `docs/DECISIONS.md`.

> **RULING (Tom, 2026-07-09) — the accepted fitness function, overrides this design where they
> differ.** Verbatim: *"We really need a solution which doesn't necessitate users doing
> anything in particular. The update itself has to basically do all the things that need to be
> done. All they need to do is click update app — and if this is complicated we need to rethink
> the design. We don't want to hassle them; we have to sell the advantages of a PWA to them so
> it has to be relatively straightforward."* Concretely: normal updates are fully automatic, at
> most one tap. Wedge recovery is fully automatic — the watchdog heals silently. The floor
> screen below (§2.1 Attempt 3) does NOT read out `/reset` instructions to the user; it is ONE
> button ("Fix the app") that runs the full heal routine itself. No step anywhere may require a
> user to understand caching, service workers, or browser menus. `/reset` still exists as a
> hidden power-user/support alias (a typed URL a support agent can read over the phone) — it is
> never something the app itself points a user at.

---

## 0. Executive summary, ranked by user pain

| # | Pain | Symptom (Jonathan, reproducible) | Root class (verified in code) | Design answer |
|---|------|----------------------------------|-------------------------------|---------------|
| 1 | **App death** — unusable until browser reinstall | Firefox browser update → installed app spins forever; clearing cookies/history didn't fix; happened twice | Every recovery path requires a *booted app*. `index.html` has a CSS-only spinner and no watchdog; `?reset=1` needs a URL bar the installed PWA doesn't have | **Boot watchdog + self-heal ladder in `index.html`** — inline, outside the SW, needs no server and no URL bar. The app becomes *constitutionally unable* to wedge: a boot that doesn't complete heals itself |
| 2 | **Progress lies** — trust-destroying for a learning product | Reset progress → position resurrected hours later; separately lost progress clearing browser data | No authority ruling. Local position wins over the server cursor unconditionally for 7 days (`LearningPlayer.vue` `resolveStartLegoId`); reset never clears the local key; a deploy *wipes* the local key | **Authority ruling**: server enrollment row is authoritative for signed-in learners; localStorage is a device cache trusted only when *fresher* than the server. Reset clears local; deploys stop touching position |
| 3 | **Wrong install prompts** — embarrassing, confusing | Chrome install instructions shown inside installed Firefox | Install detection = one `display-mode: standalone` check, duplicated 4×; `InstallGuide.vue` hardcodes Chrome for all of Android | **One `installState` module** with a launch-marker (`start_url` param) that works where media queries don't, plus per-browser guidance keyed on real browser detection |

Everything below is grounded in file:line citations against `dev` (eed2dabb).

---

## 1. Audit of the current implementation

### 1.1 Service worker + update flow

- **SW**: Workbox `generateSW` via vite-plugin-pwa (`packages/player-vue/vite.config.js:48-184`).
  Precache = app shell (`js,css,html,svg,woff2`), with audio/admin/schools/echarts excluded.
  `registerType: 'prompt'` on staging+prod; dev self-updates (`swSelfUpdate`, vite.config.js:22).
  Tom's hard rule (2026-05-21/22): never auto-interrupt a playing session — **kept, not renegotiated here**.
- **Navigations**: `NetworkFirst`, 3s timeout, `navigation-cache` (vite.config.js:126-134) — a
  reload online always gets the fresh shell.
- **Audio**: deliberately **not** SW-cached (vite.config.js:151-165, the iOS 206-range saga).
  Offline audio = IndexedDB `ssi-audio-cache-v2` (`src/cache/AudioCache.ts:23`) — independent of
  the SW. This separation is load-bearing and this design preserves it.
- **Update banner**: `PwaUpdatePrompt.vue` — 60s `registration.update()` poll, and the 1403ac0e
  hotfix: a waiting-SW signal is verified against `/version.json` build identity
  (`usePwaUpdate.ts:39-58`) before the banner shows. Sound; kept.
- **Recovery surfaces that exist today** — and what they all share:
  - `?reset=1` full wipe (`App.vue:51-79`) — needs a **URL bar**. The installed PWA has none.
  - Remote kill switch `/api/sw-config` (`useServiceWorkerSafety.ts:49`) — checked from
    `App.vue` `onMounted`, i.e. needs a **booted app**.
  - Settings → Troubleshoot flows (`SettingsScreen.vue:~1085-1180`, update-to-latest + full
    local wipe preserving `sb-*` auth) — needs a **booted app** and a navigable UI.
  - The 3s reload fallback in `PwaUpdatePrompt.onUpdate` — needs a booted app.

  **Every one of them sits above the boot line. Nothing defends the boot itself.**
- **The boot line**: `index.html` paints `.app-loading` (a pure-CSS spinner, index.html:66-84)
  and loads `/src/main.js` as a module. `main.js` mounts Vue and removes the spinner
  (`main.js:59-61`). If any module in the entry graph fails — stale precached chunk, corrupt
  cache entry after a browser update, SW serving a body that isn't JS — **the spinner spins
  forever**. That is Jonathan's "continually spinning disc," mechanically.
- Why "clear cookies/history" didn't save him: on Firefox Android that path doesn't reliably
  drop the SW registration + Cache Storage backing an *installed* PWA; only the full browser
  reinstall did. And why NetworkFirst didn't save him: the fresh `index.html` arrived fine —
  it's the **hashed JS chunks** (served CacheFirst out of the precache) that were dead.
  There is also no `vite:preloadError` handler anywhere (verified by grep), so a stale lazy
  chunk after a deploy throws instead of recovering.

### 1.2 Install detection + prompts

- `isStandalone` = `matchMedia('(display-mode: standalone)') || navigator.standalone` —
  **duplicated in four places**: `InstallBanner.vue:8`, `InstallGuide.vue:9`,
  `SettingsScreen.vue:543`, `utils/authHandoff.ts:38`.
- `beforeinstallprompt` captured once in `App.vue:236-239`, provided as `installPrompt`.
- `InstallBanner.vue` shows after the first round completes when `!isStandalone`. On tap with
  no captured prompt (every non-Chromium browser) it routes to `/install`.
- `InstallGuide.vue:84-90`: Android flow assumes Chromium. For 3 seconds it shows loading dots
  waiting for `beforeinstallprompt`; then `android-manual` — whose copy is literally
  *"Tap the menu ⋮ **in Chrome**"* (InstallGuide.vue:144-147). Firefox never fires
  `beforeinstallprompt`, so a Firefox Android user **always** lands on Chrome instructions.
- Desktop Firefox/Safari (no `beforeinstallprompt`, no PWA install at all): flow `desktop`
  shows "Preparing install" **loading dots forever** (InstallGuide.vue:285-290). A dead end.
- The manifest (vite.config.js:169-183) has **no `id` field**, `start_url: '/'` (no launch
  marker), and `theme_color`/`background_color` `#050508` — the deprecated cosmos dark, not
  Mist. No `appinstalled` listener exists anywhere.

**Jonathan's symptom 2, mechanically**: installed-Firefox on Android does not reliably report
`display-mode: standalone` (Firefox A2HS launches have long-standing display-mode
inconsistencies, and OneUI adds its own wrapper behaviours). So inside the installed app,
`isStandalone` = false → InstallBanner fires → tap → `/install` → no BIP → 3s → *"in Chrome"*.
Two defects compound: detection that trusts one signal, and guidance that assumes one browser.

### 1.3 Position persistence (the resurrection/loss class)

- **Local write**: every save goes to `ssi_learning_position_<course>` with absolute ids
  (`LearningPlayer.vue:2653-2704`) — legoId, seedId, cycleId, timestamp.
- **Server write** (signed-in): near-realtime — `updateCurrentCycle` on every cycle completion,
  `updateEnrollmentProgress` on round completion, **forward-only** via
  `.or(last_completed_round_index.is.null,…lt.roundIndex)` (`ProgressStore.ts:161-196`).
- **Resume read**: `resolveStartLegoId` (`LearningPlayer.vue:518-590`) checks **localStorage
  first, unconditionally** — the server enrollment row is only consulted when local has
  nothing. Local is discarded only when >7 days old (`LearningPlayer.vue:2726-2730`).
- **Reset progress** (`SettingsScreen.vue:1206-1298`): deletes the DB rows, nulls the cursor —
  and **never clears `ssi_learning_position_<course>`**. (The *recover-to-furthest* flow does,
  SettingsScreen.vue:215 — the two flows disagree.)
- **Deploy invalidation** (`App.vue:109-179` `invalidateStaleCaches`): on every build change it
  **deletes all `ssi_learning_position_*` keys** — treating position as build-scoped cache,
  which its own save-format comment refutes ("stable across script regeneration").

**Jonathan's resurrection, mechanically**: reset nulls the DB cursor but leaves the local key →
next boot, local-first resume lands him back at the old position → the first round completion
passes the forward-only guard (cursor is null, so `.is.null` matches) and **re-ratchets the old
position into the DB**. Hours later, "reset" has undone itself. Two mechanisms, one wound: no
authority ruling.

**Jonathan's loss, mechanically**: for a guest (or any learner whose truth is local), clearing
browser data deletes the only copy. Worse, two *designed* behaviours already destroy guest
position today: every deploy wipes it (`invalidateStaleCaches`), and any 8-day absence expires
it (the 7-day rule) — a returning guest starts at round 1.

---

## 2. The design

Three parts, one principle: **each layer must be recoverable from the layer below it, and the
bottom layer (index.html + the server) must never be able to wedge.**

### 2.1 Update lifecycle: the never-wedge boot (Stage 1)

What already works is kept unchanged: prompt-only SW on staging/prod, NetworkFirst navigations,
`/version.json` build-identity verification, the 60s update poll, audio outside the SW.
What's added is **defence of the boot line itself** — placed *outside* the SW, because a broken
SW cannot be asked to fix itself, and *inside* `index.html`, because that is the one artefact
guaranteed to be present in whatever (possibly stale) shell the SW serves.

**(a) Boot handshake.** `main.js` sets `window.__SSI_BOOTED = true` immediately after
`app.mount('#app')` (one line, next to the existing `app-loading` class removal).

**(b) Inline watchdog in `index.html`** (plain script, ~60 lines, no imports — it must run even
when every module fetch fails):

- **Arming condition**: only when `navigator.serviceWorker.controller` exists. First-ever
  visits (no SW yet) are never watched — a slow 2G first load must not trigger cache-nuking.
  An SW-controlled page that can't boot is precisely the wedge signature and has no innocent
  explanation.
- **Fast path**: a window `error` listener (capture phase) for failed `<script>`/module loads
  in the entry graph → heal immediately, don't wait. Two scope guards (2026-07-31, the
  always-play invariant; pure twins in `utils/bootHeal.ts` — `shouldHealOnBootFailure`,
  `isDeployFatalResourceUrl`):
  - **Never while offline** (`!navigator.onLine`) — an airplane-mode resource failure is a
    missing network, not a broken deploy, and the heal deletes the SW + precache: the only
    thing that makes offline work. Pre-guard, an offline cold start served the precached
    shell, the Google-Fonts stylesheet failed, the watchdog "healed", and the SW-less reload
    landed on the browser "No internet" page with every cache gone.
  - **Same-origin failures only** — the entry graph lives entirely on our origin (it's what
    the SW precaches). Fonts/CDNs being down or ad-blocked must never nuke the install.
- **Slow path**: timer at 15s. `__SSI_BOOTED` not set → heal — same offline guard: never
  heal without a network to rebuild from.
- **Heal ladder**, guarded by a `sessionStorage` attempt counter (max 2 auto-heals per session,
  so a genuinely-broken deploy can't reload-loop):
  1. *Attempt 1*: swap the spinner for a human message ("Updating the app…"), then unregister
     all SWs + delete all Cache Storage **except** `ssi-auth-handoff` (the iOS session bridge —
     `utils/authHandoff.ts:22` documents why it must survive) → reload. IndexedDB and
     localStorage are **not touched**: boot failure can only come from HTML/JS/CSS, which live
     exclusively in SW caches — audio downloads and progress are innocent by construction.
  2. *Attempt 2*: same wipe → reload.
  3. *Floor*: a static, dependency-free help screen (rendered by the inline script): "Close the
     app fully and open it again. Still stuck? Open **saysomethingin.app/reset** in your
     browser." — plus a Retry button. This is the honest floor: if two full SW wipes plus a
     network reload can't boot the app, the remaining causes (origin down, browser-level
     corruption) are outside the page's power, and the design surfaces that instead of spinning.

  `/reset` = a tiny **route alias for `?reset=1`** (one router entry), because a *typed-in* URL
  must be speakable over the phone; query strings aren't.
- **(c) `vite:preloadError` handler** in `main.js`: on a stale-chunk dynamic-import failure
  (deploy rotated hashed chunks mid-session), reload once (sessionStorage-guarded). Vite fires
  this exact event for this exact case; today it's unhandled and throws.

**Why the watchdog lives in index.html and not the SW** (searched, §4): a custom SW
(`injectManifest`) could self-heal *its own cache misses*, but the Firefox wedge class includes
"SW hangs/serves garbage" — no code inside the dying process can be its own lifeboat. The
watchdog is the only component that observes the failure from outside the SW while still being
first-party, offline-present, and zero-server.

**Interaction with the update banner**: none. The watchdog never fires on a healthy boot
(mount happens in ~1-3s), never during play (it disarms at boot), and heals only state the
Settings "update to latest" flow already deletes deliberately.

### 2.2 Install detection + guidance (Stage 3)

**One module, `utils/installState.ts`**, replacing the four duplicated checks. It answers two
distinct questions the current code conflates:

1. **"Am I running installed right now?"** — `runningInstalled`, true if ANY of:
   - `matchMedia('(display-mode: standalone)')` (also `fullscreen`, `minimum-ui`) — the
     standards path, works on Chromium + iOS Safari;
   - `navigator.standalone === true` — iOS;
   - **launch marker**: the manifest gains `start_url: '/?source=pwa'`, and boot consumes the
     param (records to sessionStorage before any `history.replaceState`). This is the signal
     that works where media queries lie — *every* launch from an installed icon carries it, on
     every browser, because the browser itself constructed the launch URL from the manifest.
     This is the direct fix for installed-Firefox reporting `display-mode: browser`;
   - `document.referrer.startsWith('android-app://')` — TWA/wrapper launches, free to check.

   **Manifest identity guard**: `id: '/'` is added in the *same commit* that changes
   `start_url` — with no explicit `id`, the id defaults to `start_url`, and changing it would
   fork the app's install identity on Chromium.

2. **"Was this device ever installed / can it install?"** — `installability`, one of:
   - `installed-here` — an `appinstalled` listener (new, in the module) persists a
     `ssi-installed-at` localStorage flag; also set whenever `runningInstalled` is true.
     Suppresses the banner in the *browser* tab of a device that already installed.
   - `native-prompt` — `beforeinstallprompt` captured (Chromium: Chrome/Edge/Samsung/Opera).
   - `manual` — browser supports install/A2HS but never fires BIP: Firefox Android, all iOS.
   - `none` — desktop Firefox, desktop Safari ≤ current: no PWA install exists. The guide
     shows "bookmark it / it works right here in the browser" instead of infinite dots.

   Browser detection done honestly (`isFirefox = /Firefox|FxiOS/`, `isSamsung =
   /SamsungBrowser/`, `isChrome = /Chrome/ && !Samsung && !Edge && !Opera` — today's naive
   `isChrome` counts Samsung Internet as Chrome, InstallGuide.vue:17).

**Guidance matrix** (what `/install` renders per state — replaces the Chrome-only copy):

| Context | Content |
|---|---|
| running installed | "You're all set" + redirect (exists today, kept) |
| Chrome/Edge/Samsung Android, BIP held | native Install button (exists, kept) |
| Chrome Android, no BIP after wait | "Menu ⋮ → Add to Home screen" — *and* "already installed? Open it from your home screen" (no-BIP on Chrome usually means already installed or ineligible; say so instead of guessing) |
| **Firefox Android** | "Menu ⋮ → **Add to Home screen**" with Firefox's own icons/wording |
| Samsung Internet, no BIP | "Menu ≡ → Add page to → Home screen" |
| iOS (Safari or any browser) | share-sheet walkthrough (exists, kept; per-browser share-button location already handled) |
| Desktop Chromium | omnibox install icon guidance / native button |
| Desktop Firefox/Safari | honest "no install on this browser — it works right here; on your phone, it installs as an app" |

`InstallBanner` gates on the module: never shown when `runningInstalled` or `installed-here`.

### 2.3 What is authoritative — the ruling (Stage 2)

**Ruling.** For a signed-in learner, `course_enrollments` (cursor `last_completed_lego_id` +
`current_cycle_index` + `last_practiced_at`) is **the** authority for position — consistent
with the cursor-only model (2026-07-04) and the bundle-cutover spine, where a position is
`(scriptArtifactId, roundIndex, slot)` resolved server-side. `ssi_learning_position_*` is a
**device cache of the same fact**: trusted only when it is *fresher than the server*, i.e.
`local.lastUpdated > server.last_practiced_at`. For a guest, local *is* the truth (there is
no server row), and the app must stop destroying it.

The single freshness comparison dissolves both of Jonathan's symptoms rather than patching
them separately:

| Scenario | Today | Under the ruling |
|---|---|---|
| Reset on this device, local key survives | resurrection (local-first + forward-only re-ratchet) | server row is fresher (reset stamped it) → server wins → genuinely fresh start |
| Reset on device A, device B has old local | same resurrection from B | same: server fresher → B adopts the reset |
| Played offline on this device | works | local fresher → local wins, syncs up — offline unharmed |
| Cross-device: played on phone, resumes on tablet | tablet's stale local wins for 7 days | phone's server writes are fresher → tablet follows the phone |
| Clearing browser data, signed in | position survives (server) but belt/local wiped confusingly | unchanged mechanically; now *stated*: server restores everything positional |
| Clearing browser data, guest | total loss, silent | total loss is physics (the data has one copy) — surfaced honestly: the existing clear-cache confirm already warns guests and offers account creation (`SettingsScreen.vue` `isGuestLearner` path); the ruling adds the same warning to browser-level guidance in `/install` copy ("your progress lives on this device until you create an account") |

**Concrete changes the ruling dictates:**

1. **Reset clears the device cursor** — add the one `localStorage.removeItem` that
   recover-to-furthest already has (SettingsScreen.vue:215) to `confirmReset`. Also stamp
   `last_practiced_at` in the reset UPDATE (it currently nulls it — a null timestamp must
   count as "server fresher than any local save" in the comparison, so resets always win).
2. **Deploys stop touching position** — delete the `ssi_learning_position_*` and
   `ssi_explorer_position_*` clearing from `invalidateStaleCaches` (App.vue:125-131). Position
   is stored as absolute ids precisely so it survives builds; wiping it on deploy is the code
   contradicting its own design — and it silently restarts every guest on every deploy.
3. **Delete the 7-day expiry** (LearningPlayer.vue:2726-2730). Under the ruling it's redundant
   for signed-in (server-fresher covers staleness) and actively harmful for guests (an
   8-day-absent guest currently restarts at round 1). The gap rule (`cycleResetMinutes`,
   fail-closed, LearningPlayer.vue:2786-2789) already handles "long pause → restart the
   round" — that's the pedagogical staleness rule, and it stays.
4. **The comparison itself**, in `resolveStartLegoId`: fetch the enrollment row in parallel
   with the round-map (both are single indexed reads on the same connection; the row is
   already fetched at boot by `fetchLearnerEnrollments`, App.vue:250-270), bounded by a ~2s
   race — server answered: apply the freshness rule; timed out / offline / guest: local wins
   (fail-to-local keeps offline exactly as it is today). Extracted as a pure
   `resolveAuthoritativePosition(local, enrollment)` in `utils/` with unit tests, the
   `resolveResumeAnchor.ts` pattern (5f4a8b1d) — enumerate the live data states: null cursor +
   fresh local, fresh cursor + stale local, both null, null `last_practiced_at`, guest.
5. **Classification table** (the standing reference — what each store IS):

   | Store | Class | May be wiped by |
   |---|---|---|
   | Supabase rows (enrollment, progress, sessions) | **authoritative** | learner intent only (reset) |
   | `sb-*` auth tokens | precious | sign-out; heal flows must preserve (Settings already snapshots them) |
   | `ssi-auth-handoff` cache | precious bridge | 30-day TTL; never by heal/deploy |
   | `ssi_learning_position_*` | device cache of authority, freshness-trusted | reset, sign-out; **never** by deploy/heal |
   | belt progress localStorage | derived display state | recomputable; wipe is cosmetic-only (recompute from server on restore) |
   | script cache (IDB), round-map cache, bundle store `ssi-course-bundles-v1` | disposable | anything — content_version, deploy, heal |
   | audio (IDB `ssi-audio-cache-v2`) | disposable-but-expensive | user intent + content_version; heal ladder deliberately spares it |
   | SW precache + runtime caches | disposable | deploy, heal, watchdog |

   Invariant, testable: **clearing every disposable store moves no learner's position; a
   signed-in learner can lose their device entirely and lose nothing but downloads.**

**Bundle-cutover coordination** (not duplication): the artifact design already makes the
server cursor + `resolveResumeAnchor` the spine (bundle-cutover-design.md §7). This ruling is
that same principle enforced *now*, on the legacy path — when the cutover lands, the local
cache simply starts holding `(scriptArtifactId, roundIndex, slot)` instead of
`(legoId, cycleId)`, and the freshness rule carries over unchanged.

---

## 3. Test matrix (hand to Jonathan-class testers)

Devices: real hardware, not emulators — SW/browser-update behaviour is the subject.
Dev URL for destructive scenarios: `ssi-learning-app-git-dev-zenjin.vercel.app`; staging for
the soak. Dev cheat to add (Stage 1, dev-builds only): **`?wedge=1`** — poisons the precache
(overwrites two precached chunk bodies with garbage) so testers can *watch the watchdog
recover*. An escape hatch nobody can rehearse is an escape hatch nobody trusts.

Browsers × platforms: Chrome/Android, **Firefox/Android**, **Samsung Internet/Android** (S25FE
default), Safari/iOS, Chrome/iOS, Chrome/desktop, Edge/desktop, Safari/macOS, Firefox/desktop.

| # | Scenario | Steps | Pass condition |
|---|---|---|---|
| T1 | Fresh install | Visit → play one round → banner appears → follow guidance to install | Guidance matches THIS browser (never "in Chrome" on Firefox); app installs or honest "no install here" on desktop FF/Safari |
| T2 | Installed self-knowledge | Open the **installed** app, play a round | No install banner, ever. `/install` says "you're all set" |
| T3 | Browser-tab-after-install | Install, then open the same URL in the browser tab | Banner suppressed (`installed-here` flag) |
| T4 | Normal update | Deploy to dev; in a running installed app wait ≤60s | Banner appears once, only when the build genuinely differs; Update reloads to new build; mid-audio no auto-interrupt |
| T5 | **Browser update during installed life** (the Firefox killer) | Install app → play → update the browser itself via Play Store → relaunch app | App boots (or watchdog heals within ~20s and then boots). Repeat on Firefox AND Samsung Internet |
| T6 | Wedge drill | `?wedge=1` (dev) → relaunch | Spinner ≤15s → "Updating the app…" → clean boot. Audio downloads survived; position survived; still signed in |
| T7 | Wedge floor | `?wedge=1` twice in one session with network offline | Static help screen with `/reset` instructions — never an infinite spinner |
| T8 | Offline launch | Install, play online, airplane mode, relaunch | Boots from cache; watchdog does NOT fire; cached audio plays |
| T9 | Offline first visit | Airplane mode on a fresh browser profile, visit | Browser error page is acceptable; NO cache-nuking (watchdog unarmed without a controller) |
| T10 | Reset stays reset | Signed in, play to round N, Settings → Reset → confirm → play 2 rounds → close → relaunch → also relaunch NEXT DAY | Position starts at round 1 post-reset and *stays* consistent with new play; never re-ratchets to N |
| T11 | Reset cross-device | Play on device A; reset on device B; reopen A | A adopts the reset (server fresher) |
| T12 | Clear browser data, signed in | Play to round N, clear site data in browser settings, revisit, sign in | Position back at round N (server); belt display recovers |
| T13 | Clear browser data, guest | Same as T12 without account | Loss occurs but was *warned about*; guest sees create-account nudge beforehand |
| T14 | Guest across deploy | Play as guest to round N; wait for a dev deploy; reload | Position N intact (deploy no longer wipes it) |
| T15 | Guest returns after 10 days | Play as guest; return in 10+ days (or clock-skew simulate) | Resumes round N, at round start (gap rule), NOT round 1 |
| T16 | Offline progress syncs | Signed in, airplane mode, play 3 rounds, reconnect, check another device | Other device resumes at the offline-advanced position (local-fresher won, then synced) |
| T17 | Mid-session deploy chunk skew | Keep app open across a deploy, navigate to a lazy surface (settings/schools) | No white screen: `vite:preloadError` reload-once recovers |
| T18 | iOS install handoff | Sign in in Safari → A2HS → open installed app | Still signed in (`ssi-auth-handoff` survived every new wipe path) |

T5 + T6 + T10 are the Jonathan regression suite — they encode his exact reports.

---

## 4. Searched & rejected (doctrine: search-first, frame-breakers included)

**For never-wedge updates:**
- **No SW at all** (frame-breaker: delete the failure source) — kills offline learning, a core
  product requirement (offline lease, downloads). Near-zero on Better. Rejected.
- **Custom SW via `injectManifest` with in-SW self-healing** — the SW cannot lifeboat its own
  hang, which is inside the observed failure class; and it trades a generated, boring SW for a
  bespoke one to maintain. Worse on Simpler, doesn't fully solve. Rejected; the watchdog
  observes from outside the SW.
- **`autoUpdate` SW registration** — re-litigates Tom's never-interrupt-audio rule (18f4c27
  revert). Not on the table.
- **Server-driven recovery only (kill switch)** — already exists and requires a booted app;
  can't reach the wedge. Kept as the policy-level tool it is.
- **App-shell servers as SSR/edge-rendered (no precache)** — rebuild-from-scratch option;
  dissolves stale-shell wedges but costs the offline shell entirely and a rearchitecture.
  Better×Cheaper both fail vs. a 60-line inline watchdog. Rejected.

**For install detection:**
- **TWA / store distribution** (frame-breaker: make Android install a store install) —
  genuinely dissolves install-detection on Android, but adds store presence cost, doesn't
  help Firefox-browser users at all, and is the separate native-migration track
  (`docs/native-migration-feasibility.md`). Rejected *for this problem*; noted for that track.
- **`getInstalledRelatedApps()`** — Chromium-only, needs `related_applications`, answers only
  "is my own origin's PWA installed" on the same browser. Strictly weaker than the launch
  marker + `appinstalled` flag. Folded in as an optional extra signal, not the mechanism.
- **UA-sniff harder** — UA lies increase (Client Hints reductions); the launch marker is
  browser-constructed truth. UA kept only for choosing *guidance copy*, never for state.

**For authority:**
- **Server-only position (no local)** — breaks guests and offline resume, both product
  requirements. Rejected.
- **CRDT/merge of positions** — a position is a single scalar cursor with a happens-after
  relation; LWW-by-practice-time IS the correct merge, the machinery would be ceremony.
  Rejected on Simpler.
- **Keep local-first but clear local on reset only** — fixes Jonathan's exact repro, leaves
  cross-device staleness and the deploy/7-day guest wipes in place. A patch, not the ruling;
  the freshness comparison costs the same and dissolves the family. Rejected.

No physical floor was hit anywhere except T13 (guest data has one copy — an information floor,
same class as the 2026-05-29 offline-resume finding); it is surfaced as honest UX, not coded
around.

---

## 5. Staged implementation order (each step shippable alone)

| Stage | Scope | Files | Executor | Ships when |
|---|---|---|---|---|
| **1. Watchdog + self-heal** | `__SSI_BOOTED` handshake; inline watchdog + heal ladder + floor screen; `vite:preloadError` reload-once; `/reset` route alias; `?wedge=1` dev cheat | `index.html`, `main.js`, `router/index.ts`, vite.config.js (dev-only wedge hook) | **Sonnet** — self-contained, no product-logic coupling; needs T6-T9 on real phones before staging | Immediately; highest pain |
| **2. Authority ruling** | reset clears local key + stamps `last_practiced_at`; deploy stops wiping position keys; delete 7-day expiry; `resolveAuthoritativePosition` util + unit tests wired into `resolveStartLegoId` | `SettingsScreen.vue`, `App.vue`, `LearningPlayer.vue`, new `utils/resolveAuthoritativePosition.ts` + test | **Sonnet with tests-first** — the util is pure and enumerable; the wiring touches the resume cascade, so the live-data-state enumeration (null cursor/fresh local etc.) is mandatory before merge (the 5f4a8b1d lesson) | After Stage 1 soaks on dev |
| **3. installState + guidance** | `utils/installState.ts` (launch marker, `appinstalled` flag, browser matrix); manifest `id:'/'` + `start_url:'/?source=pwa'` + Mist `theme_color`; InstallBanner + InstallGuide rewritten onto the module; delete 4 duplicate checks | `vite.config.js` (manifest), new util, `InstallBanner.vue`, `InstallGuide.vue`, `SettingsScreen.vue`, `authHandoff.ts` | **Sonnet** — mechanical consolidation + copy matrix; T1-T3 across the browser grid | Parallel with Stage 2 (no overlap) |
| **4. Tester campaign** | Run §3 matrix with Jonathan (+Colombo team on staging) | — | Human testers, matrix as the brief | After 1-3 on staging |

Explicitly **deferred, with reasons**: wedge-event telemetry beacon (no consumer yet — tester
reports are the consumer this quarter; revisit when the watchdog is fleet-wide); trimming the
schools/echarts precache exceptions (separate, already-noted follow-up in vite.config.js:67-69);
any SW architecture change (nothing here requires one).

## 6. What gets deleted / simplified

- The four duplicated `isStandalone` implementations → one module (net −3 copies).
- `InstallGuide`'s Chrome-assumption branches and the desktop infinite-dots dead end → matrix copy.
- `invalidateStaleCaches`' position-key wiping (App.vue:125-131) — deletes a guest-progress bug.
- The 7-day position expiry (LearningPlayer.vue:2726-2730) — deletes a guest-progress bug.
- The naive `isChrome`/`isSafari` UA checks in InstallGuide → module.
- Manifest debt: missing `id`, dark-theme `theme_color` — fixed in passing (Stage 3).
- Conceptually: three ad-hoc answers to "where is the learner" collapse into one ruling that
  the bundle-cutover already assumes — this design *removes* a future migration step.

---
*Author: Fable (design pass, 2026-07-09). Verified against dev@eed2dabb. No code shipped.*
