# India Android wrapper — what it actually takes

*Costed assessment, 3 September 2026. Scope only — nothing here was built, installed or scaffolded. Read against `origin/dev` at `39e91995`.*

**A "worker-day" below means one focused engineer-or-agent day.** All numbers are in those units.

---

## The verdict, first

**Yes, this is a well-trodden path, and the app is unusually well-suited to it.** The learner player is already a fully offline-capable PWA with its own IndexedDB audio store, its own download manager, its own entitlement leases and its own lock-screen media session. Capacitor's job is to put a WebView around it and hand it three native things it cannot get from the browser: **Play Billing, real background audio, and app-private storage.** All three are places where native is genuinely *better* than what you have today — which is the direction you expected.

**The headline numbers, at moderate confidence:**

| | Worker-days | Confidence |
|---|---|---|
| **Get it into the store** — feature-complete wrapper, live as a new version of the listing | **18–28** | Medium |
| **Make it good** — the polish that makes it a very good native app | **+12–20** | Low-to-medium |

*(These are the whole-job figures; the section-by-section build-up is at the end, and it will move once the four unknowns below are settled.)*

**The one thing most likely to bite** is not background audio and not the service worker. It is this: **the app makes 399 hard-coded requests to relative `/api/…` paths across 125 files** (verified: `git grep "'/api/" origin/dev -- packages/player-vue/src`). Inside a WebView serving bundled files from a local origin, every one of those resolves to the WebView's own origin and returns nothing. The good news is that the fix is small and does not fork the codebase — but if it is missed, the app boots to a blank screen and nothing works at all. It is the difference between a two-day problem and a two-week mystery.

**The thing that could make the whole plan moot** is the Play upload signing key. See Section 3 — it is an explicit gap and it needs one look in the Play Console.

---

## What is genuinely new versus what is already solved

Before the detail, the shape of it:

**Already solved, and Capacitor inherits it for free** — the 4-phase learning cycle, the audio cache, the offline download bundle, the graceful-degradation ladder, spaced repetition, the schools surface, 91 routes of UI, 21 interface languages. None of this is rewritten. The wrapper runs the same build the web runs.

**Genuinely new work** — Play Billing plus RevenueCat, the anonymous-purchase-then-sign-in identity merge, an Android foreground media service, push (which does not exist in the app at all today), the API base-URL fix, hardware back button, deep links, and the Play listing/store-compliance work.

**Made simpler by going native** — a large amount of the service-worker lifecycle machinery, and the iOS-shaped background-audio workarounds, become dead weight rather than load-bearing. That is a rare thing in a port and it is worth saying plainly.

---

## The one architectural fork you have to pick first

Everything else costs differently depending on this, so it comes before the inventory.

A Capacitor Android app can get its web assets one of two ways:

**(A) Bundle the built app inside the APK.** The WebView serves `index.html` and the JS chunks from local storage. This is the normal Capacitor shape.
- Works fully offline from a cold start, including first launch.
- Every code change ships through a Play review (typically hours, occasionally days).
- The 399 relative `/api/` paths break and must be fixed.

**(B) Point the WebView at the live site** (`server.url: "https://saysomethingin.app"`).
- Zero code changes. Every relative path just works. You keep instant deploys — a Vercel push reaches Android users the same minute it reaches web users.
- A cold first launch with no network shows nothing. The service worker still precaches after the first successful load, so it is only the very first run that is exposed, but that is the run that matters for a new install in India on a poor connection.
- Google's minimum-functionality and repackaging policies look hard at apps that are only a WebView pointed at a website. With native Play Billing, a foreground audio service, mic permissions and push, this is not a bare WebView — but it is a policy risk that needs a considered listing rather than a casual one.

**Recommendation: (A), bundled, plus a live-update channel.** Bundle the assets so a cold offline first launch works, and add one of the Capacitor live-update plugins (`@capawesome/capacitor-live-update`, or Capgo) so JS/CSS fixes can still ship in minutes without a Play review. Google explicitly permits updating interpreted web content this way; what it forbids is shipping new *native* code that way. This gives you the offline floor of (A) and most of the deploy speed of (B).

**This is a place where native is worse than the web, and it deserves saying plainly:** today, a fix reaches every learner on the next navigation, because navigations are `NetworkFirst` (`packages/player-vue/vite.config.js`, the navigation runtimeCaching route). On Android with a bundled build and no live-update channel, a fix reaches learners when Google finishes reviewing it. The live-update channel is what buys that back, and it is why I am counting it in the "get it into the store" number rather than the polish number.

Also worse natively, and smaller: the remote kill switch. `packages/player-vue/src/composables/useServiceWorkerSafety.ts` fetches `/api/sw-config` and, if `killSwitch` is set, unregisters every service worker and reloads to serve fresh content. Inside a bundled wrapper there is no service worker holding stale code, so the kill switch loses its meaning — the live-update channel becomes the thing that plays that role, and it needs an equivalent "roll back now" control.

---

## Section 1 — the device-capability inventory

### 1.1 Audio playback, and background / lock-screen playback

**What the app does today.** The learning cycle is a state machine in `packages/player-vue/src/playback/SimplePlayer.ts` (2,113 lines). It drives a **single reused `HTMLAudioElement`** created once in the constructor (line 468), and advances phase on the element's `ended` event.

The whole of the file's background-playback design is a stack of *browser* workarounds, and reading it is the single most useful thing in this assessment:

- **Silent WAV clips.** `packages/player-vue/src/playback/silentWav.ts` synthesises genuinely-silent real-PCM WAV files as `data:` URIs. During the PAUSE phase — the several seconds where the learner speaks and no audio plays — the engine plays one of these on the same element, because *"iOS Safari freezes JS timers on a backgrounded or screen-locked tab, so ANY playback gap driven by a bare setTimeout dies under lock"* (`silentWav.ts` header; `SimplePlayer.ts` lines 271–300). The pause is made into "a phase with audio" so it can advance on a media event instead of a timer.
- **A session-wide keepalive `AudioContext`** with a silent oscillator, in `packages/player-vue/src/composables/useAudioSessionKeepalive.ts`, because *"iOS Safari drops the audio session (and revokes the play() unlock) when no audio is sounding for a few seconds."* Its own header records that the previous looping-silent-`<audio>` implementation had to be **disabled on 2026-05-23** because it fought the main element for the single audio-session slot and oscillated.
- **Media Session position pings.** `SimplePlayer.updateMediaPositionState()` (line ~616) refreshes `navigator.mediaSession`'s position on every `timeupdate`, described in the code as *"so Android Chrome sees an active, advancing media session and is less likely to suspend the backgrounded/locked tab (the cause of 'finishes the phrase then stops' online). Heuristic background-survival aid. Tom 2026-05-31."*
- **A `visibilitychange` catch-up**, an interruption detector for outside agents grabbing audio focus (`onElementPause`, line ~540), a stall watchdog, and a phase-start watchdog.

That is a great deal of engineering spent defending against the browser suspending the page. **A Capacitor app with a foreground service does not have that problem.** An Android foreground service with a `MediaSession` and an ongoing notification is the OS-sanctioned way to keep audio running with the screen locked; the WebView is not throttled while its process holds one.

**What Capacitor gives you.** Not this, out of the box. Bare Capacitor is a WebView, and a WebView in a backgrounded Android app is subject to the same throttling Chrome applies — arguably worse, because Android will happily freeze a background process that is not holding a foreground service. You need either:
- a media plugin that owns playback natively — `@capacitor-community/native-audio` is the usual name, but it plays *bundled* short sounds and is a poor fit for a 200-cycle streamed lesson; or
- **a small custom native foreground-service plugin** that starts a `MediaSessionService` and keeps the process alive while the WebView continues to drive the `<audio>` element.

The second is the right shape here, and it is the single biggest genuinely-native piece of work in the whole job. It is not exotic — it is a well-known Android pattern — but it is real Kotlin, and it must interact correctly with the existing `mediaSession` action handlers in `LearningPlayer.vue` (lines 7112–7163: play, pause, nexttrack, previoustrack, all already wired) so lock-screen and Bluetooth controls keep working.

**Estimate: 3–5 days** for the foreground service plugin and wiring, at medium confidence. **Plus 1–2 days** to decide what to do with the browser workarounds, which brings us to the next point.

**A finding that saves money: most of the workaround stack can go quiet on native — but do not delete it.** The silent-WAV pause bridge, the keepalive `AudioContext` and the mediaSession position pings all exist to fight iOS Safari and background Chrome. Under a foreground service they are unnecessary. **But the web build still needs every one of them**, so they must not be removed — they should be made conditional on a runtime "am I native?" check (`Capacitor.isNativePlatform()`), with the web path untouched. That is exactly the non-forking pattern the constraint demands. Budget **1–2 days** to gate them and, importantly, to *test that gating*, because the silent-clip bridge is load-bearing for phase advance: if you switch it off natively without replacing the advance mechanism, the pause phase never ends.

**Risk worth naming:** `LearningPlayer.vue` creates **seven** separate `Audio` elements (`git grep -c "new Audio(" `), and `ListeningOverlay.vue`, `PronunciationOverlay.vue`, `useBrandWelcome.ts` and `CourseExplorer.vue` create their own. Android's media notification shows *one* session. Getting welcome audio, pod laps, commentary and cycle audio to hand the one native session between them cleanly is fiddly, and it is exactly the kind of thing that works in testing and fails when a call arrives. The keepalive composable already documents a 2-second release debounce built to survive precisely this handoff.

