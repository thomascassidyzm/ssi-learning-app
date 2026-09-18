# The Android update channel — what it is, and why it is not a live-update plugin

**18 September 2026, job #214. Read against `origin/dev`. The code changes described here are on
`cs/214-ssi-app` and are not merged.**

---

## The finding first, because it changes the job

The brief asked for a live-update channel of the `@capawesome/capacitor-live-update` kind: ship a
zip of the built web assets, download it to installed phones, boot it in preference to the bundle
inside the APK, fall back to that bundle if it fails, and hold a server-side rollback switch.

**That brief describes an APK that does not exist any more.** It was written against the wrapper as
Tom ruled it on 4 September — bundle the web app, serve it from `https://localhost` — and against
the 3 September assessment, which recommended a plugin on exactly that basis. **Tom overturned the
4 September ruling on 8 September**, and that reversal is not a proposal: it is on `dev`, on
`staging` and on `main`, and the reasoning is written into the files it changed.

The two commits are `a607ee6e` *"the shell stops bundling and becomes a webview onto the
deployment"* and `0ed4a7ec`; `b7c9a9ec` on 10 September set the default origin back to staging. The
surviving comment in `capacitor.config.ts` states the reason in Tom's own terms: a bundled APK's
"Tap to update" can never fetch new web code, so **the button lied**, and needing a network to
fetch an update is a property of updating rather than a cost of loading remotely.

So the shell carries no web code at all. `server.url` points at a deployment, `webDir` is a
one-page holding notice, and the service worker — switched back ON inside the WebView by the same
ruling — precaches the deployment's own shell.

**Against that shell, three of the brief's five requirements were already true before this job
started**, and a live-update plugin would take them backwards:

| Requirement | Status before this job |
|---|---|
| 1. A Vercel deploy reaches an installed app on next launch, or on the Settings tap | **Already true.** The WebView loads the deployment. There is nothing to ship to the phone. |
| 2. A built-in bundle is the offline floor | **Was not true, and could not be.** There is no built-in bundle. The floor is the service-worker precache — which covers every launch after the first. |
| 3. A server-side rollback switch | **Already true, in a stronger form.** Reverting the Vercel deployment reverts every installed phone on its next launch. `/api/sw-config`'s kill switch reaches the wrapper too, because the WebView is on the deployment's own origin. |
| 4. The build declares web-only vs native | **Not true. The real gap.** |
| 5. Settings' "Tap to update" works on Android | **Already true.** It updates the service worker, drops the navigation caches and reloads — a real navigation to the live deployment. What it could not do was say what happened. |

**A live-update plugin scores badly on all three legs of better × simpler × cheaper here.** Better:
it delivers the same web code the WebView already loads, one step later and one failure mode wider.
Simpler: it adds a plugin, a bundle-zip build artefact, a manifest, a second updater racing the
service worker, and a second answer to "which code is running". Cheaper: it adds a per-ship
artefact and a permanent maintenance surface. The only thing it buys that today's posture lacks is
a boot floor for a phone that has *never* reached the network — and that is bought below for one
config line.

**So what this job built is the gap, not the plugin.**

---

## What landed

### 1. The native contract — the build now declares which kind of change it is

Two integers, one either side of the seam:

- **`SHELL_NATIVE_LEVEL`** in `packages/player-vue/capacitor.config.ts` — what the native shell HAS.
  **It is the only line in the repo that says "this change needs a Play Store release."** Bump it in
  the change that adds a plugin, a permission, a manifest entry or a WebView setting.
- **`WEB_REQUIRES_NATIVE_LEVEL`** in `packages/player-vue/src/platform/nativeContract.ts` — what the
  running web code NEEDS. It is `0` today and should stay `0` until a web change genuinely depends
  on a native one.

A web-only change touches neither, which is the common case and stays free.

The shell declares its level in the user agent — `SSiShell/android/1` — and `capabilities.ts`, the
one platform door, parses it into `platform().nativeLevel`. An APK built before this existed says
plain `SSiShell/android` and reads as **level 0**, which is the truth about it rather than a
fallback.

When the web requires more than the installed shell has, Settings says so in the build card's quiet
description slot: *"This version of the app needs an update from the Play Store. Everything else
keeps working until you get it."* It is a description, not a gate — nothing refuses a tap and
nothing interrupts play. **This is the staleness line the 8 September ruling retired, reborn with a
condition that can actually be true.** `shouldDescribeStaleness()` stays `false`: that line was
about a bundled APK being behind on *web* code, which cannot happen now.

`nativeContract.test.ts` fails if the shell ever declares less than the web requires, so the two
halves cannot drift.

### 2. A boot floor for the phone that has never been online

`server.errorPath` now points at an `error.html` written into the APK by
`scripts/build-android-apk.sh`. Capacitor loads it when `server.url` cannot be reached. Before, that
case fell through to the WebView's own error page — "webpage not available", about an address the
learner never typed. Now it is a page we wrote: what happened, a **Try again** button, and an
`online` listener that takes the first chance it gets without being asked.

This is deliberately the whole of the built-in floor. Once the app has opened once, the service
worker holds the shell and the audio plays from IndexedDB, so the only hole left is the cold one.

### 3. "Tap to update" now reports the outcome

The tap already did the right thing on Android. It now reads the deployment's own `/version.json`
and reports which of the two things happened — *"You already have the latest version"* or *"A newer
version is ready"* — before the reload. Silent when unsure: no network, no answer, no claim.

---

## How to ship

**A web-only change — the common case.** Merge to `dev`, promote as usual. It reaches every
installed Android app on its next launch, and immediately if the learner taps the build card in
Settings. Nothing to build, nothing to upload, no review. Declare nothing.

**A native change.** Anything touching `android/`, `capacitor.config.ts`, a Capacitor plugin, a
permission or a manifest entry:

1. Make the change.
2. **Bump `SHELL_NATIVE_LEVEL`** in `capacitor.config.ts`. That bump IS the declaration.
3. `scripts/build-android-apk.sh [origin]` — staging by default; production must be asked for out loud.
4. Release the APK through the Play Store.
5. **Only once it is live in the store**, raise `WEB_REQUIRES_NATIVE_LEVEL` in the web change that
   starts depending on it. That raise is what tells everyone still on an older APK to update, so
   doing it early tells them to fetch something that is not there yet.

**Rolling back.**

- *Web code, all phones:* revert the deployment on Vercel. Every installed app takes the reverted
  code on its next launch, because the app IS a window onto that deployment. This is the wrapper's
  rollback control and it needs no plugin, no pin and no per-device switch.
- *A poisoned precache:* set `SW_KILL_SWITCH=true` on the deployment. `/api/sw-config` is polled on
  load and reaches the WebView the same as the web, because the WebView is on the deployment's own
  origin. Clients unregister the service worker, clear caches and reload once per session.
- *Native code:* the Play Store, and nothing else. Halt the rollout or roll back the release there.
  This is the boundary `SHELL_NATIVE_LEVEL` exists to make visible before a change ships, rather
  than after.

---

## What is proven, and what is not

**Proven here.** The native-contract parse and both halves of the seam, red before the change and
green after (`src/platform/nativeContract.test.ts`, 8 tests; 3 of them fail against the pre-change
`capabilities.ts`). The store-update sentence (`SettingsScreen.storeUpdateLine.test.ts`). The
platform suite, 19 files, 147 tests, green. The i18n parity and bare-English gates, green with the
new key enrolled in `pending-translation.json`.

**NOT proven, and it is the honest gap: none of this has run on an Android device.** watson-1 has
no hardware virtualisation — `/dev/kvm` does not exist — so no emulator can run here, which is the
same gap the 4 September wrapper write-up recorded. No physical device is attached. So the four
behaviours the brief asked to see demonstrated — a fresh deploy picked up on next check, the
Settings tap picking it up on demand, the rollback switch reverting it, and a corrupt or
unreachable bundle falling back — have **not** been observed on Android. What *can* be checked on
this box is whether the config compiles into the APK, and that is recorded in the job's report.

**Also not done:** nothing was promoted past `dev`, no Play Console was opened, and no APK was
distributed.
