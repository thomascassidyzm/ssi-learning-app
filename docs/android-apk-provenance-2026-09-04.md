# The Android app serves frozen assets. "Tap to update" cannot ever work on it.

*2026-09-04, job #525. Verified by opening the APK the emulator is running, not by reading a doc.*

## The finding

**The Capacitor wrapper bundles the web app INTO the APK.** It is not a browser
pointed at a deployment. Verified three ways, from the actual bytes of the APK Tom
installed from popty.app/builds:

- `assets/capacitor.config.json` inside the APK has `webDir: "dist"` and **no
  `server.url`, no `server.hostname`** — Capacitor's bundled-assets configuration.
- The APK carries **821 files under `assets/public/`** — the entire built PWA:
  `index.html`, every JS chunk, every CSS file, even its own `sw.js`.
- The build string Tom can see on his Settings row, `dev-mtmmp3ke`, is **baked into
  the JavaScript bytes** inside the APK. It appears as a literal in five chunks,
  including `SettingsScreen-DfxFGz_Z.js`. It is not fetched from anywhere.

The WebView loads all of that from its own origin, `https://localhost`. The only
thing that leaves the device is `/api/...` traffic, sent to an origin stamped into
`index.html` at build time:

```
window.__SSI_PLATFORM__ = { shell:'webview', apiOrigin:"https://ssi-learning-app-git-dev-zenjin.vercel.app" }
```

## What follows, and it is uncomfortable

**"Tap to update" on that app can never fetch new web code.** The button asks the
service worker to look for a newer app shell — on `https://localhost`, which is the
frozen `assets/public/` directory inside the installed APK. There is nothing newer
there and there never will be. Clearing the emulator's storage will not help.
Reinstalling the same APK will not help. Only installing a *new APK* changes the
web code.

**And so: every "verified on the Android emulator" claim made on this estate to date
was a claim about a snapshot, not about `dev`.** Whatever tree the installed APK was
cut from is what was tested — regardless of what had landed on `dev` since. The one
published APK (`android-ccbbe2f7`) was cut from commit `ccbbe2f7` at 07:26 this
morning, which predates the belt-strip glyph, the never-refuse navigation and the
two-strike network gate entirely. Tom looking for tonight's work on that emulator was
looking at a build from before any of it existed, and no amount of tapping was going
to change that.

The `dev-mtmmp3ke` string decodes to **2026-09-04T07:24:36Z** (base-36 of the epoch
millis), 90 seconds before that APK's recorded build time — so the device is running
the published build and nothing else is in play.

## Why the build string said nothing useful

`vite.config.js` derived the build id from `VERCEL_GIT_COMMIT_SHA`, then `GIT_COMMIT`,
then a **base-36 clock reading**. A Vercel deploy gets a sha; a build run anywhere
else — the Android wrapper's, a laptop's — got the clock. So the one screen that is
supposed to answer "which code am I holding?" answered with a timestamp naming no
commit at all.

## What changed (branch `cs/525-android-apk-provenance-bundled-o`)

1. **The build carries its commit.** `git rev-parse --short HEAD` now sits ahead of
   the timestamp in the fallback chain. A locally-built bundle carries a real sha; the
   timestamp survives only for a tree with no git available.
2. **The build says where it is pointing.** A quiet second line under the Settings
   build row shows the API host — read from `window.__SSI_PLATFORM__.apiOrigin` in a
   WebView, and from the page's own host on the web, where that is the truthful
   answer. On a bundled shell, "which deployment is this talking to?" is the question
   the build id cannot answer, and until now nothing on screen did.

Both live in `packages/player-vue`, so web, Android and iOS inherit them from one place.
