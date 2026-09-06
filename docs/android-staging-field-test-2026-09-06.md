# Android field-test build on STAGING — swept, built, proved

*2026-09-06, job #689. Everything below was measured today against live
`https://staging.saysomethingin.app`, not read out of a doc.*

## The headline

**Staging needed no work.** Every API route the app calls already answers a
cross-origin preflight correctly on staging today — `api/_utils/cors.ts` is on
`origin/staging` and deployed. **No promotion was made and none was needed.**

**An APK pointed at staging is built and alive.** 23,318,343 bytes, sha256
`ea6f7ccf447e3ebc18c129fdcae330ce445efc6513a919e4a67e52da5be2a0fd`, build
stamp `local-9d581f4`. Its own bundled assets boot to a ready player against
staging — not the blank spin the hand-built `local-5e99196` gave.

**Nobody can download it.** `popty.app/builds` is not a route; it is the Popty
SPA's catch-all, and it returns the same 669-byte HTML shell for every path
including `.apk` filenames. There is no public distribution surface for an
Android build on this estate. That, not CORS, is what blocks field testing.

---

## Step 1 — What staging actually answers (read-only)

Preflight: `OPTIONS`, `Origin: https://localhost` (the Capacitor Android
origin), `Access-Control-Request-Headers: authorization,content-type`.

| route | method | status | allow-origin | allow-methods | allow-headers | max-age | vary | allow-credentials |
|---|---|---|---|---|---|---|---|---|
| `/api/courses/available` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/courses/:code/bundle` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/courses/:code/cycles` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/courses/:code/infplay-cycles` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/courses/:code/sectors` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/courses/:code/round-map` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/entitlement/user` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/entitlement/offline-lease` | POST | 204 | `https://localhost` | GET, POST, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/audio/:id` | GET | 204 | `*` | GET, OPTIONS | Content-Type | 86400 | — | **none** |
| `/api/audio/batch-urls` | POST | 204 | `*` | POST, OPTIONS | Content-Type, Authorization | — | — | **none** |
| `/api/audio/from-cycles` | POST | 204 | `*` | GET, OPTIONS | Content-Type | 86400 | — | **none** |
| `/api/player-events` | POST | 204 | `https://localhost` | POST, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/me/profile` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/me/standing` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/me/legos-learnt` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/me/phrases-spoken` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/me/engaged-time` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/me/teaching-context` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/subscription` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/auth/send-code` | POST | 204 | `https://localhost` | POST, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/auth/possession-redeem` | POST | 204 | `https://localhost` | POST, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/code/validate` | POST | 204 | `https://localhost` | POST, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/code/redeem` | POST | 204 | `https://localhost` | POST, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/try-link/validate` | POST | 204 | `https://localhost` | POST, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/welcome/played` | POST | 204 | `https://localhost` | POST, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/sw-config` | GET | 204 | `https://localhost` | GET, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |
| `/api/account/reset-progress` | POST | 204 | `https://localhost` | POST, OPTIONS | Content-Type, Authorization | 86400 | Origin | **none** |

**Negative control** — same probes with `Origin: https://evil.example`:

| route | status | CORS headers |
|---|---|---|
| `/api/entitlement/user` | 403 | none (only `Vary: Origin`) |
| `/api/courses/available` | 403 | none |
| `/api/courses/:code/bundle` | 403 | none |
| `/api/player-events` | 403 | none |
| `/api/audio/:id` | 204 | `*` — deliberate, credential-free audio proxy per `vercel.json` |

Strangers get nothing. The allowlist echoes only the matched origin, and
`Access-Control-Allow-Credentials` is absent everywhere — the intended posture.

`api/_utils/cors.ts` is present on `origin/staging` (blob `f8ff7212`) and on
`origin/main`. `git cherry origin/staging origin/dev` shows one commit on dev
not in staging, and it is an e2e test file.

### Step 2 — promotion
**Not needed. Nothing was merged to `staging`.**

---

## Step 3 — The APK

```
scripts/build-android-apk.sh https://staging.saysomethingin.app
BUILD SUCCESSFUL in 21s — 93 actionable tasks: 93 executed

path      : packages/player-vue/android/app/build/outputs/apk/debug/app-debug.apk
bytes     : 23318343
sha256    : ea6f7ccf447e3ebc18c129fdcae330ce445efc6513a919e4a67e52da5be2a0fd
stamp     : {"buildNumber":"local-9d581f4","buildTime":"2026-09-06T10:42:35.365Z",
             "buildBranch":"cs/689-android-field-test-apk-on-stagin"}
apiOrigin : https://staging.saysomethingin.app
```

Artefact opened and read, because a build that succeeds and is dead is the
failure this step exists to prevent:

- `assets/public/index.html` carries
  `window.__SSI_PLATFORM__={shell:'webview',apiOrigin:"https://staging.saysomethingin.app"}`
- the JS bundle carries the real Supabase URL `https://swfvymspfxmnfhevgdkg.supabase.co`
  and the real publishable anon key — **not empty**, which is what killed `local-5e99196`
- `appId` left alone at `com.saysomethingin.devwrap` ("SSi (dev wrap)"), per the
  standing note that taking `com.automagic.a3f` is Tom's irreversible call
- debug build, unsigned for release, nothing uploaded to a store

---

## Step 4 — Proof, and the gap

### THE GAP, NAMED FIRST
**No emulator and no real-device evidence was produced.** watson-1 has no
`/dev/kvm` and zero `vmx`/`svm` flags — I checked, it is not hearsay. An
Android emulator cannot boot on this box. Everything below is headless
Chromium holding the WebView's own origin. **It is not a phone.** Only Tom or
a field tester with the handset can close that gap.

### The artefact's own bundle, booted at `https://localhost`

Serving the APK's extracted `assets/public/` at the WebView origin —
exactly what Capacitor's `shouldInterceptRequest` does — and letting the app
boot on its own:

```json
{
  "seam": { "origin": "https://localhost",
            "injected": { "shell": "webview",
                          "apiOrigin": "https://staging.saysomethingin.app" },
            "fetchWrapped": true },
  "result": { "requestedPath": "/api/me/profile",
              "finalUrl": "https://staging.saysomethingin.app/api/me/profile",
              "status": 200 },
  "apiCallsSeenOnBoot": [
    "https://staging.saysomethingin.app/api/sw-config",
    "https://staging.saysomethingin.app/api/courses/zho_for_eng/bundle",
    "https://staging.saysomethingin.app/api/audio/02f6c89d-…",
    "…8 more audio clips…"
  ]
}
```

A literal app-relative `/api/me/profile` — the way all 402 call sites in the
app write it — left the page as an absolute staging URL and came back 200. The
app rendered its player screen ready to play, course picked, transport live.
Not a spinner.

### The four things Tom asked to see, exercised as the WebView

Signed in as the tester account (`thomas.cassidy+bumface@gmail.com`, a real
Supabase session minted service-side, never the founder's account), all calls
`credentials: 'omit'` from origin `https://localhost`:

| what | evidence |
|---|---|
| **sign-in** | `GET /api/me/profile` → **200**, real adherence/mirror payload for that learner |
| **course download** | `GET /api/courses/ces_for_eng/bundle` → **200**, **641 legos / 298 seeds** — the full bundle, not the preview |
| **audio playback** | `GET /api/audio/ad884fc5-…` → **200**, `audio/mpeg`, **16,992 bytes** of real audio |
| **telemetry** | `POST /api/player-events` → **200 `{"inserted":1}`** |

On `spa_for_eng` the same bundle call returned **200 with `previewOnly: true`**
(57 legos / 19 seeds) — that is the entitlement gate doing its job for an
unentitled tester, not an origin failure. Proving the *full* download therefore
used a free course. The entitlement question belongs to #676/#685 and was not
touched.

---

## Step 5 — Telemetry rows, read back out of the live DB

```json
[
  { "occurred_at": "2026-09-06T10:45:39.500+00:00",
    "event_type": "job689_staging_probe", "env": "staging",
    "course_code": "ces_for_eng", "device_type": "desktop",
    "session_id": "b3b53b26-6a23-4d4c-9afe-24f1f5b28077",
    "user_id": "0a6e8149-7c9c-4b3f-9668-fb647b658dc4",
    "client_version": "job689-webview-probe" },
  { "occurred_at": "2026-09-06T10:45:14.687+00:00",
    "event_type": "job689_staging_probe", "env": "staging",
    "course_code": "cym_for_eng", "…": "…" },
  { "occurred_at": "2026-09-06T10:44:07.745+00:00",
    "event_type": "job689_staging_probe", "env": "staging",
    "course_code": "spa_for_eng", "…": "…" }
]
```

Rows land with **`env: "staging"`**, derived server-side from the Host header.
`user_id` holds the learner pk (`0a6e8149-…`), not the auth uid
(`a6259c40-…`) — the identity rule holds.

### One real finding for the field test
**`player_events.app_shell` does not exist in the live database.** The column
is `supabase/migrations/20260904_player_events_app_shell.sql.UNAPPLIED`, and
the route silently retries the insert without it. So telemetry from field
testers on the APK will be **indistinguishable from web telemetry** — you will
not be able to slice "what did the Android testers do". `device_type` is a
user-agent sniff, not the shell. If the field test's purpose is to learn about
the Android build, this migration wants applying first. One column, additive.

### One cosmetic finding
The in-app badge reads **DEV** on the staging APK. `usePreviewTriggers.ts`
classifies by `window.location.hostname`, which inside a WebView is always
`localhost` — so it can never say STAGING there, whatever origin the build
points at. Testers will see a DEV chip and a dev reset button while talking to
staging. Not fixed here (out of the origin-layer scope); the fix is to classify
by `apiOrigin` when the shell is `webview`.

---

## Step 6 — What a field tester needs to install this today

### The contradiction, resolved
`https://popty.app/builds` returns **HTTP 200, `text/html`, 669 bytes** — the
Popty SPA shell. So does `popty.app/builds/ssi-devwrap-7ccf1288-debug.apk`,
and so does `popty.app/builds/android-ccbbe2f7.apk`, byte-for-byte the same
shell. There is **no `builds` route and no APK handler anywhere in the Popty
codebase**. An Android phone pointed at any of those URLs downloads an HTML
file.

The 2026-09-05 landing doc is right. The 2026-09-04 provenance doc's technical
findings about APK contents all stand — only its passing description of
"the APK Tom installed from popty.app/builds" describes a route that does not
serve APKs today.

### What actually exists
`~/apk-serve/serve.mjs`: a 40-line static server on `127.0.0.1:8449`, exposed
by `tailscale serve` at `https://watson-1.tail4968cb.ts.net:8449` — **tailnet
only**. It was **not running** when I looked. I restarted it and staged
today's build there as `ssi-staging-9d581f4-debug.apk` (verified: 200,
`application/vnd.android.package-archive`, 23,318,343 bytes). So the APK is now
reachable by any device on Tom's tailnet, and by nobody else. I did **not**
turn Tailscale Funnel on for it — exposing a port to the public internet is an
outward-facing act and is Tom's call.

### The walk-through, honestly
A field tester today would have to: join Tom's tailnet (install Tailscale, be
invited, sign in) → open a `.ts.net:8449` URL → tap the APK → accept Chrome's
"this type of file can harm your device" → enable "install unknown apps" for
Chrome in Android settings → install → open. That is six steps and one of them
is *being added to a private VPN*.

### The verdict
**Not workable for ten or twenty testers.** It is workable for Tom and for one
or two people he can walk through Tailscale personally. Everything technical
is ready — the APK is alive and pointed at staging — and the only thing between
here and a field test is a place to put a file.

What would be needed, cheapest first:
1. **A public link.** `tailscale funnel` on port 8449 turns the server that
   already exists into a public HTTPS URL. Minutes of work, one command,
   Tom's decision because it opens a port to the internet.
2. **Firebase App Distribution.** The normal answer for exactly this: testers
   get an email, tap, install, and every later build reaches them the same way.
   Half a day, and it also solves "how do they get build 2".
3. **A real route on popty.app.** Weeks of nothing; the file just needs hosting.

**Recommendation, one word to answer: turn Funnel on for the APK server?**
That gets a link into Kai's and Deborah's hands this afternoon; Firebase can
follow if the field test outgrows it.
