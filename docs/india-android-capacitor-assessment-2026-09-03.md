# India Android wrapper — what it actually takes

*Costed assessment, 3 September 2026. Scope only — nothing here was built, installed or scaffolded. Read against `origin/dev` at `39e91995`.*

**A "worker-day" below means one focused engineer-or-agent day.** All numbers are in those units.

---

## The verdict, first

**Yes, this is a well-trodden path, and the app is unusually well-suited to it.** The learner player is already a fully offline-capable PWA with its own IndexedDB audio store, its own download manager, its own entitlement leases and its own lock-screen media session. Capacitor's job is to put a WebView around it and hand it three native things it cannot get from the browser: **Play Billing, real background audio, and app-private storage.** All three are places where native is genuinely *better* than what you have today — which is the direction you expected.

**The headline numbers, at moderate confidence:**

| | Worker-days | Plan on | Confidence |
|---|---|---|---|
| **Get it into the store** — feature-complete wrapper, live as a new version of the listing | **26–41** | **30** | Medium |
| **Make it good** — the polish that makes it a very good native app | **+13–22** | **+17** | Low-to-medium |

A **worker-day** is one focused engineer-or-agent day. These are build days and exclude Play review latency, which is calendar time on top. The item-by-item build-up is in Section 5.

Two of those days buy back most of the uncertainty: **one throwaway build on one mid-range Indian handset would settle four or five of the medium-likelihood breakpoints at once.** If you want a firmer number before committing, that is the cheapest way to get it.

**The one thing most likely to bite** is not background audio and not the service worker. It is this: **the app makes 399 hard-coded requests to relative `/api/…` paths across 125 files** (verified: `git grep "'/api/" origin/dev -- packages/player-vue/src`). Inside a WebView serving bundled files from a local origin, every one of those resolves to the WebView's own origin and returns nothing. The good news is that the fix is small and does not fork the codebase — but if it is missed, the app boots to a blank screen and nothing works at all. It is the difference between a two-day problem and a two-week mystery.

**The thing that could make the whole plan moot** is the Play upload signing key. See Section 3 — it is an explicit gap and it needs one look in the Play Console.

---

## This has been scoped once before — and the old app is Flutter

**Correction to my own starting assumptions, and it matters.** A multi-agent feasibility pass already exists: `archive/docs-retired-2026-08-24/native-migration-feasibility.md` and its companion `native-migration-flutter-checklist.md`, dated 3–4 June 2026. They were missed by the initial estate search because the whole docs tree was retired into `archive/` on 2026-08-24. They are on `origin/dev` and they are good.

**Three facts from them that change this document:**

1. **The live listing is a Flutter app**, not a native-Android-SDK one — and it does *strictly less* than the PWA. Your own ground-truth correction is recorded in that doc: no listening exercises, no pods, no offline, no fast course loading, and built on the pre-rendered "compile-the-whole-course, sync-by-audio-duration" architecture SSi already abandoned. **So feature-parity risk is roughly zero.** The wrapper is an upgrade on every product axis, not a port with something to lose.
2. **Reusing the same bundle ID preserves the paid-install funnel**, which is a commercial reason to care about the signing key beyond "can we update the listing at all."
3. **A Phase-0 checklist already exists for exactly the questions I could not answer** — bundle IDs, signing certs, account ownership, whether RevenueCat is *already* integrated in Flutter, the existing product IDs, and whether Flutter authenticates against the same Supabase identity. It is still entirely unchecked. Its own header says it right: *"Do this read FIRST — ahead of the audio spike — because the answers resize the whole project."*

**The two passes agree, which is worth something.** That study, working independently three months ago, reached the same conclusions this one did from the code: gate the service worker off on native, RevenueCat over a provider-agnostic entitlement model, numeric OTP means no deep-link work for auth, bundled assets under the same bundle ID, and a native "session-hold" plugin rather than moving playback into native code. Its estimate was **6–10 weeks wall-clock**; mine is **~30 worker-days of build**. Those are the same answer stated two ways — theirs includes store review, soak and phased rollout, which is calendar time on top of build days.

**Four things it flags that I did not, and you should carry:**

- **The install-attribution SDK.** If the Flutter app embeds an MMP (AppsFlyer, Adjust, Branch, or AdServices), dropping it in the wrap makes your £1–2 paid-install funnel go blind. Confirm and port it *before* cutting over ad spend. Not in my estimate; add **1–2 days** if one exists.
- **Supabase anonymous sign-in** as the proper replacement for the `localStorage` guest hack. That is a better answer than the one I gave for buy-first-then-alias: it gives the purchase a server-persisted identity to attach to from first launch, rather than relying on RevenueCat's anonymous id alone. It is a deliberate behaviour and RLS change, so it is Tom's call, but it is the cleaner spine.
- **Keep Flutter shippable to the same listing for a full month post-rollout** as the real fallback. Android's staged rollout can be halted; that is the insurance policy.
- **Pin Play Billing v8+**, and be aware that not uploading the store purchase key to RevenueCat silently fails to record transactions — RevenueCat's own documented number-one cause of existing payers appearing un-entitled.

**Nothing in that study contradicts anything in this one.** Read them together: it has the phasing and the commercial framing, this one has the current code, the countable breakpoints and the day costs.

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

### 1.2 The microphone

**What the app does today.** `packages/player-vue/src/components/PronunciationOverlay.vue` (`initializeAudio`, lines ~303–320) opens the mic with:

```js
navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
})
```

then builds an `AnalyserNode` (`waitForSilence`, line ~380) and does **energy-threshold voice-activity detection entirely in the browser** — `silenceThresholdDb: -45`, resolving when it hears 1s of silence after speech, capped at 8s. There is an `AudioRecorder` on the same `AudioContext`. Nothing here is a cloud speech API. On failure it sets `error.value = 'Microphone access is required for pronunciation practice'` and returns false — a clean, already-handled denial path.

Note that this overlay **plays audio and listens at the same time** on the same `AudioContext`, which is why `echoCancellation` is on: the mic would otherwise hear the app's own prompt.

**What Capacitor gives you.** `getUserMedia` works in an Android WebView, but **only if the host app both declares `RECORD_AUDIO` in the manifest, holds the runtime permission, and grants the WebView's `PermissionRequest`.** Capacitor's `BridgeWebChromeClient` handles the third for you; the first two you configure. In practice this is a known, documented path — call it **1 day**, not more, plus a half-day for the permission-priming UI (Android will show the system prompt on first use; the app should explain itself first, because a hard denial is sticky).

*Platform assertion, high confidence:* Android's `AcousticEchoCanceler` is applied at the audio-source level and is a device-quality lottery on cheap handsets. Echo cancellation in a WebView on a ₹8,000 Android phone is materially worse than on an iPhone, and the VAD threshold is a fixed `-45 dB`. **Budget 1–2 days of real-device tuning in the "make it good" column**, and expect that the threshold may need to become device- or calibration-aware. This is a place where India-first raises the risk, because the device mix is wider and cheaper than the current user base.

**Play data safety:** a microphone declaration is required in the store listing. Because the audio never leaves the device, the declaration is the easy kind ("collected: no"), but it must be filled in accurately or the release is rejected. Half a day, mostly form-filling.

### 1.3 Wake lock and the screen

`LearningPlayer.vue` lines 7076–7107 acquires a `navigator.wakeLock.request('screen')` while audio plays, releases it when it stops, and re-acquires on `visibilitychange`, because *"browser releases it on tab switch"*. `ListeningOverlay.vue` (lines 1719–1735) does the same.

The Screen Wake Lock API is supported in modern Android WebViews, so this may simply keep working — but the reliable native answer is `@capacitor-community/keep-awake`, or Android's `FLAG_KEEP_SCREEN_ON` in the activity. Half a day, and a place where native is *more* reliable than the web.

### 1.4 The hardware back button

Android's back button inside a `createWebHistory` SPA is a classic wrapper defect, and this router has **91 route definitions** (`packages/player-vue/src/router/index.ts`). Worse than the route count: the player's overlays — pronunciation practice, listening, settings sheets — are component state rather than routes, so back does nothing for them by default and instead unwinds the route stack underneath, or exits the app.

The fix is `@capacitor/app`'s `backButton` listener with an explicit priority chain: dismiss the topmost overlay if one is open; otherwise `router.back()` if there is history; otherwise a confirm-to-exit — and **never** exit mid-lesson without asking. **2–3 days**, because the work is not the listener, it is enumerating every overlay and modal state in a 16,000-line player component and deciding what back means for each.

### 1.5 Deep links

Routes that must resolve into the app rather than the browser include `/with/:code` (invite codes), the redeem path, and any email OTP return. Android App Links means hosting `/.well-known/assetlinks.json` on `saysomethingin.app` with the app's signing certificate fingerprint and adding intent filters — standard, well-documented, **1–2 days** including the Vercel-side file and testing that a link tapped in Gmail lands correctly.

**The one that needs care is email OTP sign-in.** Sign-in today is Supabase email OTP. If it is a numeric code the user types, nothing breaks. If it is a magic link, the link must either open the app via App Links or complete in the browser and hand the session back — and a session established in Chrome does not exist in the app's WebView. Verify which shape it is before costing; if it is magic-link-only, add **1–2 days** and treat it as a breakpoint.

### 1.6 PWA affordances that stop making sense

`packages/player-vue/src/App.vue` lines 85–115 implement the `?reset=1` recovery path: delete every IndexedDB database, unregister every service worker, clear every cache, reload. That is Tom's support tool for a wedged install. In a wrapper there is no URL bar to type `?reset=1` into. **It needs a native equivalent** — a "reset this app" control in settings, which is trivial to add but easy to forget, and support will feel its absence immediately. Half a day.

Similarly the PWA install prompt, `PwaUpdatePrompt.vue`'s update banner, and any "add to home screen" copy all become nonsense inside an installed app and need hiding behind the native check. Half a day.

### 1.7 The API origin — the biggest single breakage, and its small fix

**Verified count:** `399` occurrences of a relative `/api/…` string across `125` files in `packages/player-vue/src`, of which `157` are direct `fetch()` call sites. Examples: `PronunciationOverlay.vue`'s `getAudioUrl` returns `` `/api/audio/${audioId}?courseId=…` ``; `config/audioConfig.ts` sets `proxyEndpoint: '/api/audio'`; `useCourseBundle.ts` and `useInstantPlayback.ts` default `apiBase = '/api/courses'`.

On the web these resolve against `saysomethingin.app`, where `vercel.json` routes `/api/(.*)` to the serverless functions. Inside a Capacitor WebView serving bundled assets from a local origin, they resolve against that local origin and return nothing. **The app would boot to a blank or broken screen and every single feature would fail.**

The fix is small and does not fork anything:
1. **One boot-time `fetch` shim, native only** — installed behind `Capacitor.isNativePlatform()`, rewriting any request beginning `/api/` to `https://saysomethingin.app/api/…`. One file, ~30 lines, zero effect on the web build. This covers all 157 fetch call sites at once.
2. **The media path separately.** A `fetch` shim does *not* catch `audio.src = '/api/audio/…'` — media loading does not go through `fetch`. But that path is centralised in `config/audioConfig.ts` (`proxyEndpoint`) and `cache/resolvePlaybackUrl.ts`, so it is a small number of edits, not 399.
3. **CORS.** `vercel.json` already sets `Access-Control-Allow-Origin: *` on `/api/audio/(.*)` — but *only* on that path. Every other endpoint would need to accept the WebView's origin. That is a real change to the API surface and it must be done as an allowlist, not `*`, because these endpoints carry auth. **Budget 1–2 days**, and treat it as a security review item rather than a config tweak.
4. **The Supabase session.** Supabase JS stores its session in `localStorage`, not cookies, so a change of origin does not lose it — but it does mean the session in the wrapper is a *different* session from the one in the phone's browser. That is correct behaviour, just worth knowing before someone reports it as a bug.
5. **CSP.** `vercel.json`'s `Content-Security-Policy-Report-Only` header applies to documents Vercel serves. A bundled WebView serves its own document and gets no such header, so the policy simply does not apply natively. That is not a break, but it is a silent loss of a defence-in-depth layer, and the report-only policy's `connect-src 'self'` would be wrong for the wrapper anyway.

**Estimate for the whole origin problem: 2–4 days**, at medium-high confidence, most of it in the CORS allowlist and in testing that nothing was missed. The risk is not difficulty, it is completeness: one missed path is one broken feature.

### 1.8 The microphone, part two — there are *two* mic consumers, not one

Correcting an easy assumption: pronunciation practice is not the only thing that opens the mic.

**`packages/core/src/audio/VoiceActivityDetector.ts`**, wired into `LearningPlayer.vue`, is the personalised-pacing VAD. It is **opt-in and off by default** (`adaptationConsent` from `localStorage`, defaults false), but once a learner consents it **runs for the whole session, with the mic open the entire time cycle audio is playing**. Same `getUserMedia` constraints; an `AnalyserNode` chain deliberately not connected to the speakers; feeds `SpeechTimingAnalyzer`. No raw audio is uploaded — only timing numbers.

That matters for Android in two ways:

1. **Android shows a persistent microphone indicator** whenever an app holds the mic. A learner who consented to adaptive pacing will see a green mic dot on their status bar for the whole lesson. In a browser tab that reads as normal; in an installed app it reads as "this app is listening to me," and in India, for a paid consumer app, that is a review-and-uninstall risk. This is a **product decision, not a bug** — but it should be a deliberate one, and the honest options are: gate the VAD to only the PAUSE phase (the detector already has a `startMonitoring()` shape that supports this), or make the indicator explicable in the consent copy.
2. **Echo cancellation quality.** Pronunciation practice deliberately sequences play-then-record to avoid capturing its own output; the VAD does not, and relies purely on the browser's `echoCancellation: true`. Android's AEC on budget handsets is a lottery, and India-first means a wider, cheaper device mix than the current base. **1–2 days of real-device tuning** in the polish column, plus the possibility that the fixed `-45 dB` threshold has to become adaptive.

Two pieces of good news. There is **no `AudioWorklet` anywhere** in the player, so there is no worklet-module-origin problem inside the WebView. And `ListeningOverlay.vue` does not touch the mic at all.

### 1.9 Offline storage — where native is genuinely better

**What the app does today.** `packages/player-vue/src/cache/AudioCache.ts` is a tier-aware IndexedDB store (`ssi-audio-cache-v2`, one `audio` object store) split by a `lifecycle` column into a **persistent** namespace (the full-course download, LRU-evicted only under pressure) and an **ephemeral** one (~3 LEGOs ahead, released on round completion). `quotaPressure()` reads `navigator.storage.estimate()` and is a soft signal the downloader is meant to back off from.

`cache/resolvePlaybackUrl.ts` answers the "lock-screen-safe URL" question: cached mp3 bytes are **decoded and re-encoded to a WAV blob URL**, because WebKit's `<audio>` plays WAV blob URLs but not mp3 ones under lock. It falls back to the network proxy URL on any miss or 5-second decode timeout. That is another iOS-shaped workaround the native build very likely does not need — and it costs a decode per clip, so switching it off on Android is a small performance win as well as a simplification.

`playback/bulkAudioDownload.ts` resolves batches of up to 500 ids to presigned S3 URLs via `POST /api/audio/batch-urls`, fetches direct at concurrency 24 idle / 6 mid-session, falls back to the per-file proxy, and retries stragglers three times with growing backoff.

**The storage headline.** CLAUDE.md's measured figure (2026-09-01) is that a full `spa_for_eng` download at its configured voice is **≈1.86 GB, about 1.9× over Safari's ~1 GB PWA cap — it does not fit today.**

Natively there are two regimes, and the distinction is the whole answer:

- **Leave it on WebView IndexedDB.** Android's Chromium WebView uses the same quota manager as Chrome, which historically grants an origin a generous share of free disk — categorically more headroom than Safari's flat ceiling, but **not guaranteed and still subject to eviction under device storage pressure**. *(Platform assertion, medium confidence. No number in this codebase establishes it. This wants a half-day on-device measurement, and that measurement is genuinely valuable.)*
- **Move the persistent tier to `@capacitor/filesystem`, `Directory.Data`.** App-private files are bounded by actual free device storage, not a browser quota, and are not subject to the WebView's eviction regime. *(Platform assertion, high confidence.)*

**Plain answer: yes, the full course fits natively — if you move the persistent tier to the filesystem.** On WebView IndexedDB it probably fits and probably survives, but "probably" is not a promise you want to make to a paying learner in India whose phone is often near-full.

**This is real work, not a free win.** `AudioCache.ts` is built entirely around `idb`. The non-forking shape is a storage-backend interface behind the existing `PersistentNamespace`/`EphemeralNamespace` facades — which already exist as a clean seam in `AudioCache.types.ts` — with the IndexedDB implementation left exactly as-is for web and a Filesystem implementation selected at construction via `Capacitor.isNativePlatform()`. **3–5 worker-days**, medium confidence, and the upper end is because no test file for `AudioCache.ts` surfaced.

**One real regression to fix.** Bulk-download progress is in-memory only: the pending/failed straggler state lives in a closure and the status refs are module-level Vue state that resets on remount. Already-written IndexedDB rows survive (the persistent id set is rebuilt from a cursor walk on init), so nothing is re-downloaded — but the *run* has to be restarted. Android kills backgrounded processes far more eagerly than a desktop tab, so **this will be noticeably worse natively unless the run state is persisted**. Simple fix, **1 day**.

### 1.10 The service worker — mostly becomes dead weight, and that is good news

`vite.config.js` uses Workbox `generateSW`. Reading the config and its comment history, the service worker does exactly three things for a learner:

1. Precaches the app shell (JS/CSS/HTML/SVG/woff2), deliberately excluding audio, eruda, admin chunks, echarts and the extended font subsets.
2. `NetworkFirst` on navigations with a 3-second timeout and a `precacheFallback` to `index.html`, so a fresh deploy propagates and a cold offline start still reaches the player.
3. `CacheFirst` on the self-hosted `/fonts/` subsets.

**Audio is deliberately not SW-cached at all** — the config's own comment records that the SW intercepting `/api/audio` with CacheFirst was the source of a long-running iOS Range-request bug class, and that reliable offline is the IndexedDB path instead.

Inside a bundled Capacitor app the shell is already in the APK, so (1) and (2) are redundant, and (3) is nearly so. `registerType: 'prompt'`, `skipWaiting: false`, `clientsClaim: false`, `cleanupOutdatedCaches`, `inlineWorkboxRuntime`, `directoryIndex: null`, `navigateFallback: null` — every one of those settings is scar tissue from a specific incident (2026-07-31 and 2026-08-07 are both named in the comments), and none of it is load-bearing once the shell ships inside the app.

**Recommendation: skip service-worker registration entirely on native.** Half a day, gated on `Capacitor.isNativePlatform()`, web untouched. That deletes a whole class of lifecycle risk rather than porting it — a genuine simplification. The consequence to handle is that `PwaUpdatePrompt.vue` and the remote kill switch lose their meaning natively and need the live-update channel to take over.

### 1.11 Push — does not exist today

**Confirmed absent:** zero occurrences of `PushManager`, `new Notification(`, `showNotification` or `navigator.storage.persist` anywhere in `packages/player-vue/src` or `api/`.

So push is **new work, not a port**: `@capacitor/push-notifications` (or Firebase Messaging), an FCM project, Android 13+ `POST_NOTIFICATIONS` runtime permission, and a server-side send path that does not exist in `api/` today. **3–5 worker-days** for a minimum viable version, low confidence because the backend side is entirely greenfield.

It is also exactly the "more control once installed" win Tom expects — a daily practice nudge is not available to the PWA on iOS at all and is unreliable on Android web. Whether it is in the first release or the second is a product call; it is not required to ship.

---

## Section 2 — the breakpoints, ranked by how likely they are to bite

| # | Breakpoint | Likelihood | Basis | Fix | Days |
|---|---|---|---|---|---|
| 1 | **Relative `/api/…` paths resolve to the WebView's own origin.** 399 literals, 125 files, 157 fetch call sites, zero absolute-URL call sites, and no API-base env var exists. The app does not boot. | **Certain** — this is how relative resolution works | Verified from code | Native-only `fetch` shim + `audioConfig` base + CORS allowlist on every endpoint the app calls | 2–4 |
| 2 | **Play policy vs the Paddle checkout embedded in the consumer app.** `useCheckout.ts` opens a Paddle **inline** checkout (an in-app iframe, not an external browser) and is imported by `CourseSelector.vue`, `LearningPlayer.vue`, `SettingsScreen.vue` and `PlayerContainer.vue`. Shipped unmodified, the Android app sells digital content with a non-Play payment rail from four everyday screens. | **High** — this is the shape Play's Payments policy exists to catch | Verified from code; policy substance is a platform assertion | Runtime branch in `useCheckout.ts`: on Android, Play Billing via RevenueCat; web path untouched | 1–2 |
| 3 | **Background / lock-screen audio.** The entire current mechanism is browser workarounds for a suspended page. A bare Capacitor WebView is *at least* as suspendable as a Chrome tab. | **High** | Verified from code (the workaround stack); platform assertion on the WebView | Custom Android foreground-service plugin holding a `MediaSession`, plus gating the browser workarounds off natively | 4–7 |
| 4 | **Hardware back button.** The pronunciation and listening overlays are `v-if` component state, not routes, so a naive `backButton` → `router.back()` skips straight past an open overlay or exits the app mid-lesson. 91 routes, no existing popstate handling. | **High** | Verified from code | `@capacitor/app` `backButton` listener with an explicit priority chain over every overlay and modal | 1–3 |
| 5 | **"Install the app" nudges firing inside the installed app.** `utils/installPlatform.ts` has no native branch and 25 files consume install/standalone detection — `InstallBanner`, `InstallGuide` (a whole `/install` route), `PwaUpdatePrompt`, `SettingsScreen`, `ModeTray`, `AppEscape`. | **High** | Verified from code | One native branch in `detectFromBrowser()` returning a `'native'` surface every consumer treats as "never show install UI" | 1 |
| 6 | **Shared invite links open the browser, not the app.** `/redeem/:code`, `/try/:code`, `/group/:code`, `/board/:code`, `/with/:code` are the links schools distribute. Without App Links, a recipient with the app installed still lands in Chrome. | **High** for the "more control natively" goal | Verified from code (the routes); platform assertion (App Links) | `assetlinks.json` on the domain + `autoVerify` intent filters + `appUrlOpen` → router | 2–3 |
| 7 | **Bulk-download progress lost when Android kills the backgrounded app.** Downloaded files survive; the run does not. | **Medium-high** on Android's lifecycle | Verified from code | Persist the run's id list; resume on relaunch | 1 |
| 8 | **Storage eviction of downloaded audio**, if the persistent tier stays on WebView IndexedDB. | **Medium**, unquantified | Platform assertion | Move the persistent tier to `@capacitor/filesystem` | 3–5 |
| 9 | **Mic permanently denied.** Android makes "don't ask again" sticky; today's handling is a plain inline sentence with no route to Settings. In a browser the user can just retry; in an app they cannot. | **Medium** | Verified from code (today's copy); platform assertion (Android behaviour) | Detect the permanently-denied case and offer "Open Settings" | 1–1.5 |
| 10 | **The service worker inside a WebView.** | **Low** as a *failure* — high as *dead weight* | Platform assertion | Skip registration natively | 0.5 |
| 11 | **`navigator.wakeLock` may not exist in the WebView**, in which case the existing guard silently no-ops and screens sleep mid-lesson. | **Medium** | Verified from code (the guard); platform assertion (WebView support) | `@capacitor-community/keep-awake` behind a native check | 1 |
| 12 | **Echo cancellation on budget Indian handsets**, with the VAD mic open through playback. | **Medium**, only if adaptive pacing is on | Platform assertion | Real-device tuning; possibly gate VAD to the PAUSE phase | 0–2 |
| 13 | **Deploy speed.** Bundled builds ship through Play review instead of a Vercel push. | **Certain** | Platform assertion | Live-update channel for web assets | 1–2 |
| 14 | **`MediaRecorder` codec support** (`audio/webm;codecs=opus`) may resolve differently in the WebView. | **Low** | Platform assertion | Verify on a real device; the fallback chain already exists | 0.5 |
| 15 | **Bluetooth / headset route changes** — no `devicechange` handler anywhere. | **Low** | Verified from code (the absence) | Probably nothing; the OS and `mediaSession` handle it | 0 unless proven |

**Two of Tom's own candidates come out differently from expected, and both are worth knowing:**

- **"The service worker inside a WebView"** is not the risk. It will very likely run. It is simply *pointless* once the shell is in the APK — so the right move is deletion, not debugging.
- **"Anything the PWA does that a WebView does not"** turned out to be dominated by one boring, countable thing: relative URLs. Not an exotic API gap.

---

## Section 3 — the Play listing path

### 3.1 The signing key — an explicit gap, and it is the one that could make everything moot

**I searched Tom's whole estate and found nothing.** Specifically, and stated so absence counts as evidence:

- No `*.jks`, `*.keystore`, `*.p12` or `*.pfx` file anywhere under `/home/tomcassidy` (excluding caches and `node_modules`), to a depth of six directories.
- No `android/` directory, no `AndroidManifest.xml`, no `build.gradle`, no `.aab`, no `.apk`, no `capacitor.config.*`.
- No `Fastfile`, no `Appfile`, no Google Play service-account credentials, nothing referencing `androidpublisher`.
- `estate-search "play store android app signing keystore"` returns **no matches anywhere** across code, docs, the command-surface database and memory. `estate-search "play console"` and `"androidpublisher"` return only this job's own workers.

**The old app is a Flutter app, and its source is not on this box at all.** The June feasibility study named above flagged this exact question as unresolved — *"Signing certs + provisioning profiles, and which Apple Developer + Play Console accounts own them"* is still an unticked box on `archive/docs-retired-2026-08-24/native-migration-flutter-checklist.md`. Three months on, nobody has answered it. The other traces of the old app are references from the other side — `ssi-learning-app/CLAUDE.md` notes that the dashboard "still generates `course_manifest.json` for legacy native app," and the dashboard's `LEARNING_APP_DATA_FLOW.md` says the manifest compiler exists only for it. Its build system, its signing setup and its Play Console configuration live somewhere else.

**So this cannot be settled from here, and I am not going to guess at it.** The listing demonstrably exists — you have the screenshot — so the question is purely about update rights.

**What Tom needs to check, and it is one screen:** **Play Console → your app → Setup → App signing.**

- If it says **Play App Signing is enrolled**, you are fine. Google holds the app signing key. You only need an *upload* key, and if the upload key is lost Google support can reset it. **The listing is updatable.**
- If it says **not enrolled**, then the original release key is the only key Play will accept, and if it is not recoverable from whoever built the old app, **the listing can never be updated.** In that case the India plan needs a brand-new listing under a new package name, existing installs never auto-update, and every existing Play subscriber is stranded on the old app.

Two adjacent facts worth grabbing on the same visit, because they cost nothing extra and they matter for Section 4: **the package name** (`applicationId`) of the live listing, and **the list of existing subscription product IDs**.

*Given how much hangs on this, it is worth asking whoever built the old app directly, in parallel, rather than only reading the console.*

### 3.2 Target SDK and the update requirements

*Platform assertion, and this is a fast-moving number — re-check it before planning around it.* As of **September 2026**, Google's rolling policy requires new apps and updates to target an API level within one year of the latest Android release; in practice that has meant **API 35 (Android 15) since 31 August 2025**, with the API 36 requirement arriving on the same annual cadance around **31 August 2026** — i.e. it is either already in force or imminent as of this document's date. A current Capacitor release targets a current SDK by default, so this is not work; it is a box to tick and a date to verify. Also required for an update in 2026: a Data Safety declaration (microphone, and account/identity data), a privacy policy URL (`saysomethingin.app/privacy` exists — `vercel.json` rewrites it), and, for a paid consumer app in India, correct tax and pricing configuration.

**Budget 2–3 days** for the whole store-compliance pass — listing copy, screenshots, data safety, content rating, India pricing — and treat it as calendar time as much as work time, because the first review of a substantially changed app is slower.

### 3.3 What happens to existing installs when they auto-update

This is the part worth being blunt about. **The old app's data is not the new app's data.** The new app is a WebView rendering a Vue SPA; the old app was a native player. On auto-update:

- **Progress**: gone from the device, and it does not matter, *if* the old app synced progress to a server account the new app can read. If the old app's progress lived only on the device, or lived in a backend the new app does not talk to, **learners lose their place**. This is unknown from here and it belongs on the same list as the signing key — it needs someone who knows the old app.
- **Cached audio**: gone. The new app re-downloads. On an Indian mobile data plan that is a real, visible cost to the user on first launch after the update. **Say so in the release notes and prompt them to download on Wi-Fi.**
- **Sign-in state**: gone. Every existing user is signed out and must sign in again via email OTP. If the old app used Google/Facebook sign-in, they may not know which email they used — which is exactly the support pain Tom named. **This is the single biggest support-load event in the whole plan**, and it is worth staging: a release-notes message, an in-app explainer on first launch, and a support macro ready.
- **Local settings and preferences**: gone.

**Recommendation:** treat the first Android release as a *migration*, not just a version bump. Budget **1–2 days** for a first-launch "welcome back" path that explains the change, asks for sign-in, and offers a Wi-Fi download — and get whoever knows the old app to tell you what its account model was before you write that copy.

### 3.4 Existing Play Billing subscribers

*Platform assertion, high confidence on the mechanics.* A Play subscription is tied to the (Google account, package name, product id) tuple, not to a build. So:

- **If the package name is preserved**, existing subscribers keep an active subscription in Play's ledger through the update, and Play keeps billing them.
- **But the new app will only honour it if the product IDs are recognised.** If the new RevenueCat/Play configuration uses new SKUs and does not map the old ones, the customer keeps paying and gets nothing. That is the worst possible outcome and it is entirely preventable — it just requires the old product ID list before cutover.
- **If the package name changes** (which is forced if the signing key is unrecoverable), existing subscriptions do not follow at all. They would have to be cancelled and the customers re-acquired, or honoured manually by granting entitlement against their email.

On Watson's framing that Tom did not dispute — *"migrate the deliberate, refuse the accidental"* — the operational shape here is: **honour every subscription that is currently active and being billed** (that is deliberate money, and refusing it means a chargeback and a one-star review), and **do not resurrect lapsed, cancelled or trial-only states**. Concretely that means mapping the old SKUs into the new offering rather than starting clean, and it means an admin path to grant entitlement by email for anyone the automatic mapping misses.

---

## Section 4 — billing and identity

*The decision is Tom's and is not re-opened here. Play Billing with UPI inside it for consumers; RevenueCat over the top for cross-platform entitlement; Paddle stays for B2B; buy first then alias instantly; email is the account. This section costs it and says where it goes wrong.*

### 4.1 The good news, and it is the cost-determining fact

**Entitlement has exactly one decision function, and it is already provider-agnostic.**

`checkCourseAccess()` in `packages/core/src/pricing/access.ts` is a pure function taking `(course, subscription, entitlements, platformRole)` and returning access, preview, and upgrade state. It is called from exactly two places: the server seam `resolveServerCourseAccess()` in `api/_utils/courseAccess.ts` (used by `api/courses/[code]/bundle.ts`, `cycles.ts` and `infplay-cycles.ts`, which slice the response rather than 401), and the client seam in `useEntitlement.ts` and the two course-picker components.

The `subscriptions` table **already has a `provider` column**, and `resolveEffectiveSubscription()` in `api/_utils/familyAccess.ts` does not filter on it — it just reads the learner's row.

**So adding Play as a second source of money is a one-table, one-webhook change.** RevenueCat's webhook writes a row into `subscriptions` with `provider='play'`; `resolveEffectiveSubscription` picks it up unchanged; `checkCourseAccess` needs no modification at all; the client needs no modification at all. That is about as cheap as this integration gets, and it is a direct consequence of the codebase already having a single seam rather than scattered checks. **This is the reason the billing estimate below is 6–8 days and not 20.**

### 4.2 Buy first, then alias — what it actually costs here

**Anonymous identity today is shallow, and that turns out to help.** `useAuth.ts`'s `getOrCreateGuestId()` mints a `guest-<uuid>` in `localStorage` and **never writes it to Supabase** — the code says so explicitly, noting a `guest-<uuid>` cannot be stored in the uuid `sessions.learner_id` column. `migrateGuestProgress()` consequently does nothing but clear local flags. There is no server-side anonymous state to merge, which means there is no existing merge machinery to fight with.

The alias is therefore almost entirely RevenueCat's own job: `Purchases.logIn(<supabase user id>)` at the moment of sign-in. And there is already a clean hook point with exactly the right shape — `useAuth.ts`'s `SIGNED_IN` listener already fires `useAccessClaim().claimAccess()`, a "claim your grant on sign-in" pattern. The Play alias slots in beside it.

There is also strong precedent for grant-attaches-to-email: `RedeemCode.vue` plus `api/entitlement/create.ts` / `grant.ts`, with `claim_learner`, `relink_user_tags` and multi-email linking in `ensureLearnerExists`. That path is mature and hardened. The new work is a second attachment path of the same shape, not an invention.

**One genuine inversion to build.** Today's Paddle flow is *identify-first-then-buy*: `useCheckout.ts` passes `customer: { email }` from the Supabase session into the checkout. Tom's ruling is the opposite order. That is not a hazard the code already handles; it is new code. It is small, but it is real, and it is why the purchase-flow line below is 1.5–2 days rather than half a day.

### 4.3 Email is the account — this codebase is already there

Searched for `signInWithOAuth` and for `provider: 'google' | 'apple' | 'facebook'` across the whole player: **zero results.** `SignInModal.vue` implements exactly two paths, both email: Supabase `signInWithOtp` and `signInWithPassword`. And every `verifyOtp` call site uses `type: 'email'` with a **typed six-digit code** — there is no magic link anywhere, which also means the OTP flow needs no App Link work to function inside the wrapper.

So the "which account did I use" pain Tom describes is **inherited from the old native app, not from this codebase**. This rebuild starts from a clean single-identity baseline. That is a tailwind, and it is worth saying out loud: the migration is an opportunity to end that support load rather than carry it forward — provided §3.3's re-sign-in event is handled with care, because it is the moment every one of those confused users appears at once.

The multi-email machinery (`verified_emails`, `find_learner_by_email`, `ensureLearnerExists`) already treats "one person, several emails" as first class, which is precisely the shield Apple's Hide My Email will need when iOS arrives. No work needed today; just do not design it away.

### 4.4 Hazards

- **The Paddle checkout inside the Android app.** Breakpoint #2 above, and it is the one policy risk that is verified from code rather than asserted: `useCheckout.ts` mounts a Paddle **inline** iframe checkout, and four everyday consumer surfaces import it. The fix is a runtime branch inside `useCheckout.ts` — `Capacitor.getPlatform() === 'android'` takes the Play path, everything else is untouched. The existing `pollUntilActive()` "just bought, waiting for the webhook" UX in `useSubscription.ts` can be reused as-is for the Play path.
- **Two live subscriptions on one account.** `resolveEffectiveSubscription()` reads the learner's row with no `provider` filter and no tie-break, because until now only one provider existed. A learner who subscribes on the web via Paddle *and* on Android via Play would produce two rows and undefined behaviour. **This needs a product ruling from Tom, not an engineering guess:** can one account hold both, and if so which wins? The cheapest implementation is to refuse the second purchase at the point of sale with a clear message. Half a day to a day once the ruling exists.
- **A purchase token is not a person.** Nothing in this codebase currently assumes an email arrives with a purchase, so there is nothing to unwind — but the webhook handler must be idempotent on RevenueCat's event id and must not clobber a live entitlement. There is house style for exactly that discipline already: `billingBinding.ts`'s `wouldStealLiveBinding()`. Reuse it.
- **Restore purchases.** No such concept exists today — Paddle subscriptions are always tied to an identified checkout. The user who buys, never signs in, and reinstalls is recoverable only through this. It is one SDK call plus a small UI. Half a day, and it is **not optional** — it is a Play requirement in spirit and a support necessity in practice.
- **A pre-existing hole this work will surface.** The audio gate `api/_utils/audioAccess.ts` runs in fail-open mode: `ENTITLEMENT_ENFORCE=strict` is off by default, and the code's own comment says it must stay off until the client attaches entitlement tokens — but the only token mint site today is `api/try-link/validate.ts`, the demo/sales flow, not the subscription path. **Today, a signed-in non-subscriber who obtains a premium audio id past seed 19 is served it.** That is not caused by Capacitor and it is not a reason to delay the wrapper — but shipping a paid Android app is the natural moment to close it, and it is 2–3 days of work that belongs in the polish column.
- **Does `/schools` ship inside the Android app?** The consumer `useCheckout.ts` and the B2B `useSchoolCheckout.ts` / `useOrgCheckout.ts` are genuinely separate code, so B2B does not need the Android branch — *unless* school admins reach the schools dashboard through the wrapped app, in which case those two composables would also be selling through a non-Play rail inside an Android app. **This needs one word from Tom: does the Android build include `/schools`, or hide it?** Hiding it is cheaper, cleaner for Play review, and consistent with "the web app is not being replaced."

---

## Section 5 — the estimate

A **worker-day** is one focused engineer-or-agent day. These are build days; they do not include Play review latency, which is calendar time on top.

### Get it into the store — feature-complete, live as a new version of the listing

| Item | Days | Solved problem, or genuinely uncertain? |
|---|---|---|
| Capacitor project scaffold, Android build pipeline, CI, signing config | 2–3 | Solved plumbing |
| API origin: native fetch shim, audio base URL, CORS allowlist across every endpoint | 2–4 | Solved in shape, uncertain in completeness |
| Background audio: Android foreground-service plugin + gating the browser workarounds off natively | 4–7 | **Genuinely uncertain** — the biggest native piece |
| Play Billing + RevenueCat: SDK, webhook into `subscriptions`, `logIn()` alias, Android branch in `useCheckout.ts`, restore-purchases, provider reconciliation | 6–8 | Mostly solved, thanks to the single entitlement seam |
| Hardware back button across every overlay and modal state | 1–3 | Solved in shape, tedious in practice |
| Suppress PWA install / update affordances natively (25 consuming files) | 1 | Solved |
| Skip service-worker registration natively | 0.5 | Solved — a deletion |
| Wake lock: verify, fall back to `keep-awake` | 1 | Solved |
| Mic: manifest permission, permission-priming UI, first real-device pass | 1–1.5 | Solved |
| Persist bulk-download run state across app kill | 1 | Solved |
| Live-update channel for web assets (buys back deploy speed) | 1–2 | Solved, well-trodden |
| Native "reset this app" replacing `?reset=1`, plus a recovery smoke test | 1 | Solved |
| First-launch migration path for existing users (re-sign-in, Wi-Fi download prompt) | 1–2 | Solved in shape; **depends on facts about the old app nobody here has** |
| Store compliance: listing, screenshots, data safety, content rating, India pricing and tax | 2–3 | Solved, but calendar-heavy |
| Real-device QA across the Android and WebView version spread India actually runs | 2–3 | **Genuinely uncertain** — this is where surprises land |
| **Total** | **26–41** | |

**Plan on 30 worker-days, at medium confidence.** The spread is honest: it is driven by the foreground-service work, by real-device QA on a device mix nobody here has tested, and by how complete the API-origin sweep turns out to be.

### Make it good

| Item | Days |
|---|---|
| Move the persistent audio tier to `@capacitor/filesystem` — the "full course actually fits" win | 3–5 |
| Push notifications: FCM project, plugin, permission, server send path | 3–5 |
| Android App Links so invite and redeem links open the app | 2–3 |
| Close the fail-open audio gate: build the missing subscriber token-mint path | 2–3 |
| Mic permanently-denied handling with an Open Settings route | 1–1.5 |
| VAD / echo-cancellation tuning on budget Indian hardware | 0–2 |
| Mid-purchase network-loss UX, family plan × Play, codec and headset verification passes | 2–3 |
| **Total** | **13–22** |

**Plan on 17 worker-days, at low-to-medium confidence** — lower because several of these items are contingent on what real devices show and on product decisions not yet made.

### Conditional on the signing key

- **If Play App Signing is enrolled (or the key is recoverable):** the numbers above stand. You version up the existing listing, keep the package name, keep existing subscribers, and inherit whatever install base the old app has.
- **If the key is gone and App Signing was never enrolled:** the listing cannot be updated, so this becomes a **new listing under a new package name**. Engineering-wise that is only about **+3–5 days** (new listing setup, plus a manual path to honour stranded subscribers by email). Commercially it is much more expensive than that sounds: existing installs never auto-update, existing Play subscribers must be individually rescued, the old listing's reviews and ranking do not carry over, and you start from zero on discoverability in the exact market you are trying to enter. **The engineering answer barely changes; the business answer changes a lot. Check the console before committing to a date.**

### Assumptions I made where the conversation left a gap — overturn any of these

1. **Capacitor, not a TWA / Bubblewrap.** Tom named Capacitor, and a TWA cannot host native plugins for Play Billing or a foreground audio service.
2. **Android only.** iOS is acknowledged as pending and harder. The only place an Android decision forecloses an iOS option is identity — and the existing multi-email model already survives Apple's Hide My Email, so nothing here needs changing for it.
3. **A "worker-day" is one focused engineer-or-agent day**, not an elapsed calendar day.
4. **India-first means the listing ships to India first and widens later**, not an India-only build.
5. **Assets bundled in the APK plus a live-update channel**, rather than a WebView pointed at the live site. This is the one architectural assumption with real consequences; §"the one architectural fork" makes the case, and it is reversible early and expensive to reverse late.
6. **`/schools` is hidden in the Android build.** Cheaper, cleaner for Play review, consistent with "the web app is not being replaced." One word from Tom either way.

---

## What needs Tom

Four things, each answerable in a sentence or a single look:

1. **Play Console → Setup → App signing** — is Play App Signing enrolled? While you are there, grab the package name and the list of existing subscription product IDs. *This is the only item that can invalidate the plan.*
2. **Run the existing Phase-0 checklist against the Flutter repo.** It is already written — `archive/docs-retired-2026-08-24/native-migration-flutter-checklist.md` — it is an afternoon's work for whoever has repo access, and it answers the account model, the sign-in providers, the product IDs, whether RevenueCat is already integrated (which would shrink the billing lump substantially), and whether an attribution SDK is embedded. Its own advice is to do this *before* anything else, and that advice is right.
3. **Can one account hold both a Paddle web subscription and a Play Android subscription?** If not — and "not" is the simpler answer — the second purchase gets refused at the point of sale with a clear message.
4. **Does the Android build include `/schools`, or hide it?** Recommendation: hide it.

## Explicit gaps — things I could not settle from here

- **The signing key and the whole Play Console state.** Nothing about the Flutter app exists anywhere on this machine — no project, no keystore, no credentials, no notes. This is reported as a gap, not papered over.
- **The real Android WebView IndexedDB quota.** No number in this codebase establishes it; it needs a scripted download-to-quota probe on a real device. It is the load-bearing unknown behind "does the full course fit without moving to the filesystem."
- **No real Android device or emulator was used anywhere in this assessment**, by design — it is a read-only scoping job. Every platform claim is labelled as such. A single throwaway build on one mid-range Indian handset would settle four or five of the medium-likelihood breakpoints at once, and it is the cheapest next step available.
- **CORS posture of most `/api/*` endpoints** — only the audio proxy and `sw-config` were read. The rest need checking before the origin fix is costed precisely.
- **Whether any FCM or push send path exists elsewhere in the estate** (the dashboard repo, a cron) — not searched. The push estimate assumes none.
- **Play's exact 2026 target-SDK deadline** is asserted from platform knowledge and is a fast-moving number. Verify it in the console rather than trusting this document.

---

*Assessment only. No Android project was scaffolded, no dependency installed, no config modified, no test suite run. Written against `origin/dev` at `39e91995`.*
