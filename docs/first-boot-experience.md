# First-boot experience — parked think-piece (2026-07-02)

> Status: PARKED, not scoped. Written after the 07-02 perf promote, when a fresh-browser
> signed-in boot measured ~6s on cold prod functions and Tom asked for a considered design.
> Facts below were verified against the code on the promote day — re-verify on pickup.

## The actual problem, sized

Three distinct slow-boot cases, in order of frequency × pain:

1. **Returning learner, new device / cleared browser, COMPLETED course** — the INF-PLAY
   deterministic resume awaits its full-course build before ready (~3–6s; by design, for
   stable resume). Since 07-02 this is paid ONCE per course per device (script cache
   hydrates every later open in <1s). So: a real but *once-ever* dead window.
2. **First-ever visitor on a slow connection** — bootstrap is ~1s on good networks
   (measured 0.6–1.1s guest), but 3G/hotel wifi stretches it.
3. **Cold serverless** (first hit after idle) — adds 1–2s to whoever draws the short straw.

A brand-new user on a decent connection is ALREADY fast. Don't redesign for the fast case.

## What already exists (don't rebuild)

- **Default course is already Chinese**: `App.vue` `PREFERRED_DEFAULT = 'zho_for_eng'` —
  a fresh/anon visitor lands on Chinese for English speakers. The business decision Tom
  reached for is already encoded; it just needs *blessing*, not building.
- **A first-timer cinematic already runs**: `MINIMUM_ANIMATION_MS = 2800` for first-ever
  visitors (300ms for returners) — there is already ~3s of deliberate splash to hang
  messages on.
- **First-cycle audio precache already exists**: `prewarmInstantCaches` fetches the
  round-map + first cycles + the first cycle's 3 clips (used on course *switch*; check
  whether the first-boot default-course path also gets it — if not, wiring it there is
  the cheapest instant-first-play win).
- **Welcome audio is course-specific** (`getWelcomeAudio` per course); instructions +
  encouragements ("Aran's coaching") come from shared audio copied per-course at import.

## Direction (when picked up)

1. **Staged loading narrative, event-keyed not timer-keyed.** Extend the existing splash
   with a message sequence driven by real progress: "Welcome to SSi!" (shell up) →
   "Fetching your course…" (bootstrap in flight) → "Setting up your session…" (INF-PLAY
   build / cache write, the long pole in case 1) → ready. Only stages that are actually
   slow get shown — a 1s boot should stay a 1s boot. The 6s new-device case gets honest
   company instead of a frozen screen.
2. **Instant first sound.** Two options, prefer (a):
   a. SW/runtime precache of the first zho round's clips at install/first idle
      (~100–250KB, always-current UUIDs from the API). Extends what prewarm already does.
   b. Bundling clips into the build — REJECTED unless (a) fails: couples content to
      deploys; audio regen changes UUIDs and the bundle goes stale.
3. **Generic "Welcome to SSi!" clip** — the welcome being course-specific is only a
   problem for the seconds before the course is known/loaded. A tiny app-level welcome
   clip (shared-audio style, precached with the shell) could open EVERY first boot
   instantly, with the course-specific welcome following as today. Needs Aran to record
   ~one line. Decide whether voice-before-course-chosen is on-method.
4. **Tips / explore surface** — deliberately later ("like the install prompt"): a
   deferred, dismissible surface appearing after the learner has some sessions, not at
   first boot. Separate item; don't bundle into this one.
5. **(Adjacent, optional)** The once-per-device INF-PLAY build could ALSO go
   bootstrap-first like the main loop (play starts on /infplay-cycles while the build
   lands in background) — that would shrink case 1 from ~6s to ~1s and reduce the need
   for stage-3 messaging. Weigh against the stable-resume design intent before doing it.

## Order of operations if built

Cheapest-first: (2a) wire prewarm into first boot → (1) staged messages → (3) generic
welcome clip (needs recording) → (5) infplay bootstrap-first → (4) tips surface.
