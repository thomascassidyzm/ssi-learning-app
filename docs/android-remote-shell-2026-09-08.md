# The Android shell stops bundling and becomes a window onto the deployment

2026-09-08 · branch `cs/401-android-shell-webview-onto-the-d` · not merged, not deployed

Tom's ruling, closing the conversation that produced it: "Ok. Can we build this then. This means
the app doesn't lie to them about 'tap to update' in settings." This is the build.

---

## What it was, reproduced before anything changed

I took the most recent staged artefact, `ssi-devwrap-7daba4d-staging-debug.apk` from job #689, and
read its bytes rather than any document:

- **823 files under `assets/public/`** — the whole web app, frozen into the APK.
- `assets/capacitor.config.json` carried **no `server` block at all**, so the WebView served those
  frozen files from `https://localhost`.
- `assets/public/index.html` carried the stamp `window.__SSI_PLATFORM__={shell:'webview',apiOrigin:"https://staging.saysomethingin.app"}` —
  the API went to staging, the code did not come from anywhere.

That is job #525's finding, still true on this tree. It is why "Tap to update" could not fetch new
web code: the app's own `/version.json` was the copy it shipped with, so it asked itself and agreed
with itself forever.

## What it is now

`packages/player-vue/capacitor.config.ts` carries a `server.url`, and the APK carries no web app.
The new artefact's `assets/public/` holds **three files** — `index.html`, `cordova.js`,
`cordova_plugins.js` — where the old one held 823. The APK went from **23.3 MB to 4.1 MB**.

**Which deployment the shell looks at** is the `SHELL_DEFAULT_ORIGIN` constant at the top of that
file, and as of Tom's ruling on 2026-09-10 it is **staging**:

```ts
const SHELL_DEFAULT_ORIGIN = 'https://staging.saysomethingin.app'
const SHELL_ORIGIN = (process.env.SSI_SHELL_ORIGIN || SHELL_DEFAULT_ORIGIN).replace(/\/+$/, '')
```

**Production has to be asked for, out loud, every time.** Tom's reasoning: production is for live
learners, and the only honest reason to test there is to fix a problem that is already live on it —
never to compare builds or platforms. So an APK that lands on production because somebody forgot to
set a variable is always wrong, and the default has to fail towards staging. Between 2026-09-08 and
2026-09-10 it defaulted the other way, which is how a Colombo tester could have been handed a
production build that nobody chose.

```bash
scripts/build-android-apk.sh                                   # staging
scripts/build-android-apk.sh https://saysomethingin.app        # production, deliberately
SSI_SHELL_ORIGIN=https://saysomethingin.app scripts/build-android-apk.sh   # same
```

`scripts/build-android-apk.sh` keeps no default of its own — it reads `SHELL_DEFAULT_ORIGIN` out of
`capacitor.config.ts` and stops if it cannot, because a second copy of the answer could only ever
drift and print a lie. It prints the origin twice, each time saying whether it was chosen or fell
back, and `src/platform/shellOrigin.test.ts` pins all of it.

**A tester can check it without a developer.** The quiet line under the build card in Settings is
`window.location.host` — the host the app is genuinely running on, which in this shell IS the
deployment. `staging.saysomethingin.app` there means staging, whatever anyone said when they handed
the APK over.

### What had to move with it

**The service worker, which is the part that would have bitten.** `shouldRunServiceWorker()` in
`src/platform/capabilities.ts` returned false inside a WebView, with a long comment arguing that a
Workbox precache under a native shell "would serve its own stale app shell". That was right while
the shell owned the code. It is exactly backwards now: the shell the service worker precaches IS
the deployment's shell, and it is the only thing that lets a learner open the app and play with no
network. The gate is now true everywhere and its comment says why, in place of the old argument.
Left unchanged, this change would have traded a lying update button for a broken plane journey.

**The staleness line goes silent.** `shouldDescribeStaleness()` returned true in a WebView because
a bundled APK is structurally incapable of noticing it is behind, and the cure was a visible
sentence naming the only real remedy: install a newer app. A window onto the deployment has neither
half of that — the code running is the live code, and where a newer build is waiting the update
banner already owns it and a reload genuinely resolves it. So the answer is now false everywhere.
`buildStaleness.ts` keeps its three rules, which are scars worth having, and its header now records
the 2026-09-04 ruling as SUPERSEDED rather than deleting the reasoning.

**The install banner does not move.** `shouldOfferAppInstall()` stays NO in the shell. The learner
has already installed the app.

**How the app knows it is in the shell.** The bundled build stamped `window.__SSI_PLATFORM__` into
the index.html it shipped. There is no index.html of ours to stamp any more, so the shell appends
`SSiShell/android` to the user agent — `appendUserAgent` in the Capacitor config — and
`capabilities.ts` reads it there, inside the one door. Proved end to end below.

**The API seam simplifies itself.** With the WebView on the deployment's origin, every `/api/...`
path is same-origin again, `apiOrigin` is the empty string, and `apiBase.ts`'s rewrite installs
nothing — the seam's own documented "unchanged web behaviour" case. The CORS allowlisting of
`https://localhost` stays deployed and simply stops being load-bearing for this shell; iOS or a
future bundled build may still want it.

**The DEV chip fixes itself.** `usePreviewTriggers.ts` classifies the environment from
`window.location.hostname`, which inside the bundled WebView was always `localhost`, so a staging
build wore a DEV chip. The hostname is real now. The screenshot from the live run shows **STAGING**.

**The build string tells the truth without being told to.** There is one build identity worth
showing and it is the deployment's: the shell carries no web code, so the sha and time on the
Settings build row are the sha and time of the code actually running. The second line under it
reads `window.location.host`, which is now the deployment. The APK's own version is deliberately
NOT shown — it would name the window rather than what is through it, which is the class of lie this
whole change removes.

## The old-origin state detector

Everything the old install saved was keyed to `https://localhost`: position, sign-in, downloaded
audio, offline lease. The new origin cannot see any of it. Only dev installs exist, so losing it is
acceptable — losing it silently is not, and it is the kind of failure that looks like progress.

**Detect, do not migrate.** Migrating localStorage and an IndexedDB audio cache across origins
inside a WebView, for one emulator and a handful of dev installs, fails better × simpler × cheaper
badly. The audio is re-downloadable and the sign-in is one email away; the position is the part
that matters and it comes back from the account.

`src/platform/shellOriginState.ts` asks one question — does this origin hold any app state at all,
meaning any `ssi-`/`ssi_` key or a Supabase auth token — and the Settings build card says so in one
line when the answer is no:

> Nothing is saved on this device yet. If you used an earlier version of this app, your place and
> your downloads stayed with it. Sign in and your progress comes back from your account.

No marker is written and nothing has to be cleared: the line disappears the moment anything is
saved. A store that will not answer is treated as unknown and stays silent, the same rule
`buildStaleness` obeys.

## Verification

### The gap, named first

**No on-device or emulator evidence was produced on this box.** watson-1 has no `/dev/kvm`, zero
`vmx`/`svm` flags in `/proc/cpuinfo`, and `emulator -list-avds` returns nothing — there is no AVD
defined. I checked all four myself rather than taking job #689's word for it. An Android emulator
cannot boot here, so **nothing below is a claim about a handset**. Tom's walk-through for closing
that gap is at the end.

### Offline play, against LIVE staging, with the network genuinely cut

`e2e/_401-remote-shell-offline.mjs`, headless Chromium carrying `SSiShell/android` in its user
agent, against `https://staging.saysomethingin.app`. The mechanism for cutting the network was
Playwright's `context.setOffline(true)`, which is Chromium's CDP
`Network.emulateNetworkConditions(offline: true)` — a network-layer disconnection, not a
request-routing shim. It was confirmed dead in-page before anything else was asserted: a `fetch` of
`/version.json` rejected.

The order matters and is the point: the app **played online for 90 seconds first**, warming both
caches, and only then went offline. An open-then-immediately-offline test proves the shell boots
and nothing at all about play.

```
PASS — app booted online
PASS — the page sees the shell user-agent marker
PASS — lesson started online
PASS — service worker registered on the deployment :: ["https://staging.saysomethingin.app/sw.js"]
PASS — shell precached by the service worker :: 520 cached responses
PASS — audio genuinely played online :: 28 playing events
PASS — audio landed in IndexedDB :: 144 clips
PASS — the network really is cut :: dead
PASS — COLD BOOT WITH NO NETWORK — the precache served the shell
PASS — AUDIO PLAYED WITH THE NETWORK DOWN :: 3 playing events after the cut
```

Two things about that evidence. The offline boot was a **cold navigation** — a full reload with the
network already down — so the shell came from the precache and not from a page that happened to
still be in memory. And "played" means the **`playing` event** on the audio element, which fires
only when sound genuinely starts; a `play()` call proves nothing, because the player calls it on
clips that then fail and logs itself as running silent. The audio comes from IndexedDB
`ssi-audio-cache-v2`, not from the service worker, which has not served audio since 2026-05-24.

**One honesty note on that run.** Staging is deployed from the `staging` branch and therefore runs
the PRE-change code, which ignores the user-agent marker and classifies itself as the web. So the
live run proves the deployment's own offline capability — the thing the shell inherits — rather
than my flipped gate. To prove the gate itself I built this branch and ran the same probe against
it at `http://127.0.0.1:4401`, where the app **did** take the WebView branch, and every line above
passed identically: 520 cached responses, 144 clips, cold boot offline, 3 playing events with the
network down.

### The shell marker actually flips the seam

`e2e/_401-ua-detect-probe.mjs` reads `app_shell` out of the telemetry body the app sends, which
comes straight from `platform().shell`, on this branch's build:

```json
{ "shell": ["webview"], "plain browser": ["web"] }
```

Same bundle, same origin, nothing injected — only the user agent differs.

### Tap to update genuinely fetches new web code — the half I can prove

`e2e/_401-update-mechanism.mjs`, against this branch's build. It changes the SERVED code under a
controlled page — a marker in index.html, a new revision in the precache manifest, a new build id
in version.json — and then:

```
PASS — the service worker is controlling the page
PASS — the running code has no marker in it yet
PASS — a NEW service worker installed and is WAITING
PASS — it did NOT take over the live page by itself
PASS — after applying, the page IS the new code
PASS — and the build id it reports is the new one :: {"buildNumber":"deadbee",...}
```

Under the old bundled APK not one of those steps could happen: there was no new code for any worker
to find. The waiting-rather-than-seizing line is Tom's rule that an update never applies itself
under a live page, still intact — `registerType: 'prompt'`, `skipWaiting` and `clientsClaim` false
were not touched.

**The other half is Tom's.** Deploying a visible change to staging is a promotion and not this
job's to make, so the real end-to-end proof is the walk-through below.

### Tests

One test that fails before and passes after, watched doing both. In
`src/platform/capabilities.test.ts` the service-worker case now asserts `true` inside the shell; on
the pre-change module it fails with "expected false to be true", and four tests fail in total
across the flipped gates and the new user-agent detection. On the post-change module all 13 pass.

Beyond that, only the suites covering the files actually touched: `src/platform`, `src/security`,
`SettingsScreen.stalenessLine.test.ts`, `useAppStaleness.test.ts` — 21 files, 183 passing, no
failures. Plus `pnpm --filter player-vue typecheck` clean and `lint` at 0 errors. No estate-wide
suite was run.

Two test files were flipped deliberately and say so in their own headers:
`useAppStaleness.test.ts`, which used to prove the shell fires when behind and now proves it never
speaks, and the two capabilities cases above.

## The artefact

```
ssi-devwrap-b2e5a0c2-remote-staging-debug.apk
4,117,986 bytes   sha256 4677722fc5a812aa307501e779768b506df4592d1569284be98596ee5b93389c
server.url        https://staging.saysomethingin.app
appendUserAgent   SSiShell/android
assets/public     index.html, cordova.js, cordova_plugins.js
staging serves    {"buildNumber":"2080893","buildTime":"2026-09-08T10:05:10.439Z","buildBranch":"staging"}
```

Staged on the tailnet-only server at
`https://watson-1.tail4968cb.ts.net:8449/ssi-devwrap-b2e5a0c2-remote-staging-debug.apk`, verified
serving 200 with `content-type: application/vnd.android.package-archive`. The server itself was
down when I got here — it had been started by hand and did not survive — so it now runs as a user
systemd unit, `cs-long-apkserve`, which will. No Funnel, nothing public.

## For Tom — closing the emulator gap

1. On the emulator, open `https://watson-1.tail4968cb.ts.net:8449/` and download
   **ssi-devwrap-b2e5a0c2-remote-staging-debug.apk**. Install it over the old dev wrap.
2. Open the app. It should look exactly as staging does in a browser, with the yellow **STAGING**
   chip, not DEV.
3. Go to **Settings** and look at the build row. It should read `2080893` or whatever staging has
   been promoted to since — **the deployment's build, not the APK's**. If it reads a `local-…` id,
   the app is not loading from staging and something in this change is wrong.
4. Under it you should see one line: "Nothing is saved on this device yet…". That is the
   old-origin detector telling you your previous install's position and downloads did not come
   across. Sign in; it should go away once anything is saved.
5. **The offline test.** Play for a few minutes with the network on. Then turn the emulator's
   network off — the phone's own airplane-mode toggle in the pull-down, or the extended controls
   panel under Cellular, both work. Force-quit the app and open it again. It should boot and it
   should play. That is the service-worker precache serving the shell and IndexedDB serving the
   audio. If it boots to a blank page or plays nothing, tell me — that is the failure mode this
   change most needed to avoid.
6. **The update test.** Deploy any visible change to staging, then tap the build row in Settings.
   It should fetch the new code and come back on it. On the old APK that button could never do
   anything, which is the whole reason for this job.

## What is still open

- **The Capacitor bridge on a remote origin is unverified here.** The SystemBars plugin supplies
  the bottom-chrome inset, and I cannot boot an emulator to watch it arrive. Capacitor injects its
  bridge into remote pages — that is how live reload works with plugins — and the Settings screen
  already prints the measured insets on its build card for exactly this kind of question, so step 3
  above is where it gets answered. If those numbers read zero, the bridge is not reaching the
  deployment's page and the bottom controls will sit inside the navigation bar.
- **The package id stays `com.saysomethingin.devwrap`.** Taking the live listing id is Tom's
  irreversible call and was out of scope.
- **Production is one line and is not made here.**
