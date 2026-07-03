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

## Welcome audio — RETHOUGHT to a global intro (Tom, 2026-07-03)

(Supersedes an earlier per-known-language-masters idea from the same day — that just
relocated the production problem: someone still records/renders a welcome per known
language forever. Also: the "8 distinct scripts" datapoint was wrong — the text column
holds placeholders ("welcome" x80); real scripts are per-course and localized.)

Direction: **the welcome-as-60s-lecture should not exist.** Its job is already owned by
Aran's coaching story (meta-commentary "instructions") — localized per known language,
once-per-learner, cross-device-synced since 2026-07-02, and delivered in situ through the
first rounds. The first-boot intro becomes:

1. A few seconds of GLOBAL brand moment — sound + visual identity, no language.
2. ONE localized on-screen text line (existing i18n layer): "You'll hear a phrase you
   know — say it out loud in <target> before the speakers do."
3. Straight into round 1. The method demonstrates itself; the story coaches from inside.

Wins: nothing to record per lang-pair ever; new course builds drop the welcome render;
method edits happen once (the story), not across 95 clips; time-to-first-speak improves
(no lecture wall). The loading-mask need shrinks to the brand moment + staged text.

Pre-delete checks (pickup gate):
- Story coverage: do the coaching story's early beats say everything the welcome said?
  If not, add a beat to the STORY (existing system), don't resurrect the welcome.
- Story localization: confirm instruction clips exist for every known language in the
  catalogue (they must for eng_for_X to function — verify actual coverage).
- `welcome_played_at` / 'ssi-welcome-heard' plumbing retires with the lecture; keep the
  brand-moment-seen flag local-only (it is not progress).
