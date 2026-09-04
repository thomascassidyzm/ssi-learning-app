# Android Capacitor wrapper — first build, and the cross-origin seam exercised

**2026-09-04. Debug only. Nothing signed for release, nothing uploaded, nothing deployed, nothing merged.**

---

## Verdict

The wrapper path holds. The SSi learner PWA runs inside a Capacitor Android shell
targeting SDK 36, a 22 MB debug APK exists on watson-1, and the cross-origin seam
that landed on `dev` yesterday now has a real authenticated request through it —
a genuine `Origin: https://localhost` on the wire, a real Supabase bearer token,
a 200 back with the origin echoed, and a control that fails exactly where it
should.

One honest gap: **this box cannot run an Android emulator.** It has no hardware
virtualisation. The evidence below is therefore split into the part that ran on
the real deployment (all of it) and the part that ran in the Android WebView's
own engine rather than the Android WebView binary itself. That distinction is
stated everywhere it matters.

---

## 1. The ground

**Greenfield here.** Before anything was touched: no `android/` directory, no
`capacitor.config.*`, and `grep -rli capacitor` across the repo returned only
documentation. The assessment doc says so of itself — "Scope only — nothing here
was built, installed or scaffolded." Confirmed.

**`com.automagic.a3f` — the live listing's source is NOT on this box.** Searches
run, all empty:

| Search | Result |
|---|---|
| `find ~ -name pubspec.yaml` (depth 6, excl. node_modules) | nothing |
| `find ~ -iname '*automagic*'` (depth 5) | nothing |
| `find ~ -name AndroidManifest.xml` (depth 7) | nothing |
| `which flutter dart` | neither installed |
| `estate-search "com.automagic.a3f"` | only prose — `command-surface/rbf/mission.md`, a doctrine head, and job/turn records from the last two days. No code. |

So the live Flutter app is a black box from here. That is consistent with what
`docs/native-migration-feasibility.md` already established: it is a Flutter app
that does strictly less than the PWA, so there is no feature-parity risk either
way.

**The baseline — and the brief's figure is stale.** The brief said `dev` carries
4 pre-existing test failures and 2 `bundle.ts` typecheck errors. It does not.
A clean worktree of `origin/dev` (`41b3a7ba`, whose message is literally
"nightly dev goes green") is green on all four gates:

```
pnpm --filter player-vue typecheck   → clean, no output
pnpm run typecheck:api               → clean, no output
pnpm --filter player-vue test        → 297 files passed | 1 skipped
                                        3008 tests passed | 3 skipped | 3 todo
pnpm run test:api                    → 152 files passed | 3 skipped
                                        1719 tests passed | 11 skipped | 11 todo
```

The 2 `bundle.ts` typecheck errors are real, but they live in **uncommitted
working-tree modifications in the main checkout**, not on `dev`.

After the wrapper landed, the same gates: **3008 passed, typecheck clean, lint 0
errors.** The one-door test (`platformDoors.test.ts`) is inside that suite and
passes — no second platform door was opened.

---

## 2. What was built

| | |
|---|---|
| Branch | `android/capacitor-wrapper` (off `origin/dev`, pushed) |
| APK | `/home/tomcassidy/ssi-worktrees/android-capacitor/packages/player-vue/android/app/build/outputs/apk/debug/app-debug.apk` |
| Size | 22 MB (23,288,367 bytes) |
| Application id | **`com.saysomethingin.devwrap`** — a deliberately local dev id |
| targetSdk / compileSdk | **36** (Imdad: live app is on 35, 36 required for upcoming Play releases) |
| minSdk | 24 — Capacitor's default, left alone, nothing fought it |
| Signing | Gradle's own debug keystore. No release signing. |

Read back off the APK itself with `aapt2 dump badging`:

```
package: name='com.saysomethingin.devwrap' versionCode='1' versionName='1.0'
         compileSdkVersion='36' compileSdkVersionCodename='16'
minSdkVersion:'24'
targetSdkVersion:'36'
uses-permission: name='android.permission.INTERNET'
```

**Toolchain**, installed into `$HOME` without sudo (none of it existed — `which
java javac gradle adb sdkmanager` returned nothing, `$ANDROID_HOME` was empty,
there was no `/usr/lib/jvm`):

- Temurin JDK 21.0.12.1 → `~/tools/jdk21`
- Android cmdline-tools, `platform-tools`, `platforms;android-36`,
  `build-tools;36.0.0` → `~/Android/sdk`

Gradle is pinned to `org.gradle.workers.max=2` with the daemon off, because this
box is also rendering voice. Build took 68 seconds.

---

## 3. How the seam is wired — no second door

`main.js` on `dev` already calls `installApiOriginRewrite()` as the first thing
it does. The wrapper's whole contribution is to make that call have something to
do: `scripts/injectPlatform.mjs` stamps one line into the **built** `index.html`,
ahead of the module script —

```html
<script>window.__SSI_PLATFORM__={shell:'webview',apiOrigin:"https://ssi-learning-app-git-dev-zenjin.vercel.app"};</script>
```

Post-build injection rather than a `VITE_` build variable, deliberately: the
wrapper then wraps the *same artefact the web serves*, so there is no second
build to keep in step and the web bundle stays byte-identical to today's. No file
under `src/` learns what shell it is in — `capabilities.ts` reads the global and
everything else asks `capabilities.ts`.

**Deployment: `dev`.** Not a preference — a requirement. `api/_utils/cors.ts`
exists on `origin/dev` and does **not** exist on `origin/staging` or
`origin/main`. Only `dev` can answer a WebView at all today.

---

## 4. The evidence

### 4a. Server half — real deployment, real token, real headers

A real Supabase user was created via the admin API, signed in for a genuine
access token, used, and then **deleted** (`delete_status=200`).

```
GET /api/me/profile   Origin: https://localhost   Authorization: Bearer <real jwt>
→ HTTP/2 200
  access-control-allow-origin: https://localhost
  access-control-allow-headers: Content-Type, Authorization
  vary: Origin
  {"courseCode":null,"adherence":{"goesThisWeek":247,...
```

The negatives, which matter more:

```
GET  same path, Origin: https://evil.example  → 200 with NO access-control-* at all
                                                 (browser cannot read it)
OPTIONS same path, Origin: https://evil.example → 403
```

Closed allowlist, matched origin echoed, strangers told nothing. As designed.

### 4b. Client half — page origin `https://localhost`, the real built app

No emulator was possible (§5), so the Capacitor Android runtime was reproduced
exactly in Chromium — the same engine the Android System WebView is: page origin
`https://localhost`, and every `https://localhost/*` request served from the
**built Android assets** (`android/app/src/main/assets/public`), which is
precisely what Capacitor's `shouldInterceptRequest` does. Everything else went to
the real network.

The app booted, read the injected config, and wrapped fetch:

```json
{ "origin": "https://localhost",
  "injected": { "shell": "webview", "apiOrigin": "https://ssi-learning-app-git-dev-zenjin.vercel.app" },
  "fetchWrapped": true }
```

Then a literal app-relative path — written exactly as the 402 call sites in this
codebase write it, knowing nothing about any API origin:

```json
{ "requestedPath": "/api/me/profile",
  "finalUrl":      "https://ssi-learning-app-git-dev-zenjin.vercel.app/api/me/profile",
  "status": 200,
  "bodyHead": "{\"courseCode\":null,\"adherence\":{\"goesThisWeek\":247,..." }
```

The body was **readable in the page**, which is the actual proof: a
CORS-rejected response is not readable at all. (`access-control-allow-origin`
reads as `null` from JavaScript because it is not a CORS-safelisted response
header — the readability is the signal, not the header value.)

And the app did it on its own, unprompted, during boot — these are its own
requests, all cross-origin, all successful:

```
/api/sw-config
/api/courses/zho_for_eng/bundle
/api/audio/02f6c89d-…  /api/audio/b24a2f99-…  /api/audio/1267dabc-…  (+ more)
```

It rendered and was playable. Screenshot: `docs/android-webview-origin-probe.png`.

### 4c. The control — the same test against a deployment without the CORS layer

Identical page origin, identical token, identical path:

```json
{ "dev (has cors.ts)":     { "status": 200, "readable": "{\"courseCode\":null,\"adherence\":…" },
  "staging (no cors.ts)":  { "blocked": "TypeError: Failed to fetch" } }
```

That is the finding. The seam is doing the work — not the probe.

Both probes are committed: `packages/player-vue/e2e/_android-webview-probe.mjs`
and `e2e/_android-cors-control.mjs`.

---

## 5. What I could not do, precisely

**No Android emulator on this box, proved rather than assumed:**

```
ls /dev/kvm                          → No such file or directory
grep -c -E "vmx|svm" /proc/cpuinfo   → 0
emulator -accel-check                → "KVM requires a CPU that supports vmx or svm"
adb devices -l                       → List of devices attached   (empty)
```

The emulator package was installed to get that answer from the tool itself. An
x86_64 Android 36 image will not boot without KVM, and no physical device is
attached.

**So what remains unexercised** is exactly one thing: the Android System WebView
*binary*, and Capacitor's own `WebViewLocalServer` asset interception, running on
a device. Everything on either side of it — the injection point, the fetch
rewrite, the origin on the wire, the server's CORS decision, the app booting and
pulling its content and audio cross-origin — ran for real. The next hour of this
work is `adb install` onto any physical Android phone; the APK is ready for it.

---

## 6. For Tom — the open question, not resolved here

**Does the real build ship as `com.automagic.a3f`, or as a new package?**

Taking `com.automagic.a3f` updates the app under every existing user of the live
listing. Shipping a new package leaves them on the old Flutter app and starts the
new listing's install base at zero. It is irreversible either way and it is your
call, so nothing here presumes it: the APK is
**`com.saysomethingin.devwrap`**, an obviously-local dev id that cannot collide
with anything and is not usable for release.

Two smaller things worth knowing:

- **Only `dev` can serve a WebView today.** `api/_utils/cors.ts` is not on
  `staging` or `main`. Whenever a wrapper build needs to point at either, that
  code has to ride the promotion train first.
- **`WEBVIEW_ALLOWED_ORIGINS`** is unset on dev, so the default allowlist
  (`https://localhost`, `capacitor://localhost`) is live and correct for Android.
