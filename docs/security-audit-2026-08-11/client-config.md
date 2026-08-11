# Security audit 2026-08-11 — Area 5: Client-side, secrets & config

**Slug:** `client-config` · **Branch:** `sec/audit-2026-08-11` · **Date:** 2026-08-11

**Scope:** `packages/player-vue/src/**`, `packages/core/src/**`, `packages/player-vue/index.html`,
`vercel.json`, `packages/player-vue/vite.config.js`, `api/sw-config.ts` + the Workbox setup,
committed env files, and the repo's git history.

**Method:** static reading of the checked-out source, plus `git log`/`git show` over history and
`pnpm audit --prod`. No live traffic was sent to staging or production; no exploit was executed
against a running system. No production file was modified — this branch adds a findings doc and
five test files only.

---

## Headline

**No critical finding.** The two things that would have been critical are both clean:

1. **No server secret is reachable from the client bundle.** Every `import.meta.env.VITE_*` value is
   publishable by design (Supabase URL + anon key, public S3 audio config, feature flags, Paddle
   *client* token and price ids). No service-role key, AWS secret, Paddle API key or Resend key is
   referenced from client source.
2. **The spoofable client-side admin gate is correctly backed by the server.** All 19 `api/admin/*`
   endpoints independently re-derive the caller's role from their JWT. Forging the localStorage role
   yields admin *chrome* and no data.

The most valuable finding is the plainest: **`vercel.json` sets no security headers at all**
(CLIENT-CONFIG-01). That is the missing defence-in-depth layer under everything else in this report.

### Findings by severity

| ID | Severity | Finding |
|---|---|---|
| CLIENT-CONFIG-01 | **medium** | No security response headers in `vercel.json` — no CSP, X-Frame-Options, HSTS, Referrer-Policy, nosniff. Schools/admin dashboards are clickjackable. |
| CLIENT-CONFIG-02 | **medium** | `.env.prod` / `.env.vercel` are permanently recoverable from git history. Contents audited: one expired OIDC token + publishable keys; **no** service-role/AWS secret. |
| CLIENT-CONFIG-03 | **low** | The eruda debug console is reachable **in production** via `?debug`, contradicting its own "NEVER production" comment; both halves of the gate are loose substring matches. |
| CLIENT-CONFIG-04 | **low** | The `/admin` router guard trusts a localStorage-cached role, trivially forged. Non-critical **only** because all 19 admin endpoints enforce server-side — that pairing is now regression-locked. |
| CLIENT-CONFIG-05 | **low** | Production build ships public source maps (`sourcemap: true`). |
| CLIENT-CONFIG-06 | **low** | `echarts@5.6.0` carries a moderate XSS advisory and *is* shipped to browsers. The 4 "high" advisories are build-time only and not client-reachable. |
| CLIENT-CONFIG-07 | **info** | `/api/audio/*` sends `Access-Control-Allow-Origin: *`. Assessed as safe-by-design (credential-free); documented so it stays that way. |
| CLIENT-CONFIG-08 | **info** | An auth refresh token is parked in CacheStorage for up to 30 days by the Safari→PWA hand-off. Mitigated (same-origin, consume-once, cleared on sign-out); the window is longer than the job needs. |

---

## CLIENT-CONFIG-01 — No security response headers (medium)

**Where:** `vercel.json:17-28` (the entire `headers` block).

**Evidence.** The whole configured header surface is two rules, neither of them a security header:

```json
"headers": [
  { "source": "/api/audio/(.*)", "headers": [ { "key": "Access-Control-Allow-Origin", "value": "*" } ] },
  { "source": "/version.json",   "headers": [ { "key": "Cache-Control", "value": "no-store" } ] }
]
```

Absent: `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`,
`Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`.

**What an attacker does / what they get.**

- **Clickjacking (the concrete one).** With no `X-Frame-Options` and no CSP `frame-ancestors`,
  `saysomethingin.app` can be framed by any origin. An attacker frames `/schools/classes/:id` or an
  admin surface invisibly over their own page and harvests clicks from a signed-in teacher or
  admin — destructive roster actions are one click each.
- **No XSS containment.** The app has three `v-html` sinks and an admin surface. All three escape
  correctly today (verified below), but CSP is the layer that decides whether a *future* escaping
  slip is "blocked script" or "admin session stolen". There is currently no such layer.
- **Referrer leakage.** With no `Referrer-Policy`, the full URL — including
  `/schools/classes/<uuid>` and `/admin/users/<learnerId>/progress` — is sent in the `Referer`
  header to any third-party origin the page reaches.

**Confidence:** high for the missing configuration (it is simply read from the file). The
clickjacking impact is **UNVERIFIED** against the live site — Vercel could in principle add headers
at the platform level, which I could not check without live access. See GAPS.

**Recommended fix (not applied).** Add a `headers` rule for the app's HTML routes:
`X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, and a
`Content-Security-Policy`. **CSP needs care here:** `packages/player-vue/index.html:128` contains an
inline boot-watchdog `<script>` that must keep running, so the policy needs a hash or nonce for it —
a bare `script-src 'self'` would break the offline boot-heal path. Start in
`Content-Security-Policy-Report-Only` and promote once clean.

**Tests:** `securityHeaders.security.test.ts` — characterization (each missing header asserted
absent) + six `it.todo`s naming the target state.

---

## CLIENT-CONFIG-02 — Env files recoverable from git history (medium)

**Where:** commit `13bfdc1d` ("Add .trim() to AWS env vars to prevent newline issues", 2026-01-27
01:02:08 +0000) added `.env.prod` and `.env.vercel`; `218f34cc` ("Remove accidentally committed env
files", 01:03:13) removed them — **65 seconds later**.

**Evidence.** The blobs are still readable at that commit:

```
$ git show 13bfdc1d:.env.vercel
VERCEL_OIDC_TOKEN=eyJhb...   (1085 chars)
```

I enumerated the keys in both files with values redacted. `.env.prod` held `VERCEL_OIDC_TOKEN`,
`VITE_CLERK_PUBLISHABLE_KEY` (`pk_test_…`), `VITE_SUPABASE_ANON_KEY` (`sb_pu…`), the public S3
audio base/bucket/region, and Vercel build metadata.

**What an attacker gets — assessed honestly, it is small:**

- The **only true credential** is `VERCEL_OIDC_TOKEN`. Decoding its claims:
  `iss=https://oidc.vercel.com/zenjin`, `sub=owner:zenjin:project:ssi-learning-app:environment:development`,
  `exp=1769518464` → **2026-01-27 12:54:24Z**. It expired ~6.5 months before this audit and is
  useless now.
- The Clerk publishable key and Supabase anon key are **designed to be public** — they ship in the
  client bundle anyway.
- **No** `SUPABASE_SERVICE_ROLE_KEY`, **no** `AKIA…` AWS access key id, **no** AWS secret, Paddle
  API key or Resend key was ever committed. I checked for each explicitly.

So the live risk is negligible; the finding is a **process** failure worth fixing, not an active
compromise. Severity medium rather than low because a secret in history is permanent, and the next
accident may not be as harmless.

**Confidence:** high. Verified by reading the blobs directly and decoding the token's `exp`.

**Recommended fix (not applied).** Purge both paths from history (`git filter-repo --path .env.prod
--path .env.vercel --invert-paths`), coordinated with everyone holding a clone, and confirm
`.gitignore` covers `.env*` (it does). Rotating the OIDC token is unnecessary — it is long expired —
but rotating is the correct reflex for anything else that ever lands this way.

**Tests:** `clientSecrets.security.test.ts` — asserts no `.env` is tracked now, characterizes the
history leak as still-present, and asserts the leaked blobs contain no service-role/AWS secret.

---

## CLIENT-CONFIG-03 — Debug console reachable in production (low)

**Where:** `packages/player-vue/src/main.js:29-32`.

**Evidence.** The comment above the gate states the intent plainly:

```js
// Debug tooling — preview deploys (*.vercel.app) or ?debug only, NEVER
// production. eruda is an on-screen console/network inspector ...
const DEBUG_TOOLS =
  typeof location !== 'undefined' &&
  (location.hostname.includes('vercel.app') || location.search.includes('debug'))
```

There is no production carve-out. `https://saysomethingin.app/?debug=1` satisfies the second
disjunct, so eruda — a full on-screen console **and network inspector** — initialises on production.
The code and its own comment disagree.

Both halves are also loose substring matches: `?nodebug=1`, `?x=debugging` and
`?utm_source=debug-newsletter` all enable it, and a lookalike host containing the literal
`vercel.app` would satisfy the hostname half.

**What an attacker does / what they get.** This is **not** a direct data-theft vector: the console
only ever shows the victim their *own* session, and the attacker cannot read it remotely. The real
risk is social-engineering assistance — "open this link and tell me what the red line says" against
a teacher or admin — plus a shoulder-surfing surface on a shared classroom device, since the network
inspector renders `Authorization: Bearer …` headers on screen. Rated **low** for that reason.

**Confidence:** high for the gate's behaviour (pure logic, mirrored in the test). The operational
impact is a judgement call, not a proof.

**Recommended fix (not applied).** Gate on an exact production check (`import.meta.env.PROD` or an
exact hostname comparison) and match the parameter exactly with
`new URLSearchParams(location.search).has('debug')`.

**Tests:** `clientSurface.security.test.ts` — characterizes production-plus-`?debug` as enabled and
each loose match, with an `it.todo` for the exact-match fix.

---

## CLIENT-CONFIG-04 — Client-side admin gate is spoofable; server backing holds (low)

**Where:** `packages/player-vue/src/router/index.ts:903-910`; `composables/useUserRole.ts:10,123-140`.

**Evidence.** The guard:

```js
router.beforeEach((to, _from, next) => {
  const requiresAdmin = to.path.startsWith('/admin') || to.path.startsWith('/methodology')
  if (!requiresAdmin) return next()
  const { canAccessAdmin, isInitialized, restoreFromCache } = useUserRole()
  restoreFromCache()
  if (isInitialized.value && !canAccessAdmin.value) return next('/')
  next()
})
```

`restoreFromCache()` reads `localStorage.getItem('ssi-user-role')` and adopts `platformRole`
verbatim. `canAccessAdmin` is `computed(() => isSsiAdmin.value)`.

**What an attacker does.** In their own browser console:

```js
localStorage.setItem('ssi-user-role', '{"platformRole":"ssi_admin","educationalRole":null}')
```

then navigate to `/admin`. The guard passes. I proved this in a test that drives the real
composable — it is not theoretical.

**What they get: nothing of value.** Every `/admin` view's data comes from `/api/admin/*`, and I
checked all 19 endpoints individually. Each enforces admin **server-side**, from the caller's JWT:

| Enforcement | Endpoints |
|---|---|
| `verifyAdmin()` (`api/_utils/auth.ts:88`) | `attention`, `board-metrics`, `board-snapshot`, `create-govt-admin`, `create-school`, `create-signin-link`, `create-staff`, `demo-leaf`, `demo-schools`, `onboarding-messages`, `set-trial`, `update-school`, `update-user-role`, `users`, `view-as` |
| `verifyAuthToken()` + inline `platform_role !== 'ssi_admin'` → 403 | `codes`, `grant-entitlement`, `invites`, `revoke-entitlement` |

`verifyAdmin` reads `learners.platform_role` keyed on the verified `auth.uid()`, and never consults
`req.body`/`req.query`. So the forged role renders admin chrome over empty, 403-ing panels.

**This is the correct architecture** — a UI hint backed by real server enforcement. It is reported
at **low** rather than dismissed for two reasons: the guard reads as authoritative to a future
maintainer, and the whole assessment rests on that 19/19 coverage staying at 19/19. A new admin
endpoint shipped without a check would silently make the spoofable client gate the *only* gate.

**Confidence:** high. Both halves read directly from source and locked by tests.

**Recommended fix (not applied).** Keep the server enforcement as the control. Optionally re-validate
the cached role against the live session before rendering admin chrome, and add a comment at the
guard stating it is a rendering hint, not authorisation.

**Tests:** `clientAuthzPairing.security.test.ts` — characterizes the localStorage bypass, and adds
the **regression lock**: a per-endpoint `it.each` asserting every `api/admin/*.ts` carries a
server-side admin check, with a failure message pointing at `verifyAdmin`.

---

## CLIENT-CONFIG-05 — Production source maps published (low)

**Where:** `packages/player-vue/vite.config.js` → `build: { sourcemap: true }`.

**What they get.** Full original TypeScript/Vue source for the production bundle, including the
extensive comments describing gating, auth and lifecycle logic. No secrets are exposed (verified
separately), so this is reconnaissance value only — it hands an attacker the map rather than a key.

**Recommended fix (not applied).** `sourcemap: 'hidden'` — maps still built for error reporting, but
not referenced by a `//# sourceMappingURL` comment and not discoverable from the bundle.

**Tests:** `securityHeaders.security.test.ts` — characterization + `it.todo`.

---

## CLIENT-CONFIG-06 — Dependency risk (low; one client-reachable moderate)

`npm audit --omit=dev` fails in this repo (`ENOLOCK` — it is a pnpm workspace with no
`package-lock.json`). I did **not** create one, because that would write into a shared working tree.
Ran `pnpm audit --prod` instead, via the corepack shim at
`~/.cache/node/corepack/v1/pnpm/10.33.0/bin/pnpm.cjs` (pnpm is off-PATH).

**Result: 4 high, 3 moderate, 0 critical** across production dependencies.

Reachability matters more than the counts:

| Package | Severity | Advisory | Client-reachable? |
|---|---|---|---|
| `echarts@5.6.0` | moderate | [GHSA-fgmj-fm8m-jvvx](https://github.com/advisories/GHSA-fgmj-fm8m-jvvx) — XSS | **YES** — lazily imported by `insight/widgets/*.vue` |
| `postcss@8.5.6` ×2 | high | [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) — path traversal via `sourceMappingURL` | No — reached only via `vue > @vue/compiler-sfc`, a **build-time** path |
| `nanoid@<3.3.17` ×2 | high | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) — infinite loop | No — same `@vue/compiler-sfc` build-time path |
| `postcss@8.5.6` | moderate | [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) — XSS via unescaped `</style>` | No — build-time |

**So all four "high" advisories are build-time only** and do not ship to browsers. The one that
reaches a learner or teacher is the moderate echarts XSS, and exploiting it requires
attacker-controlled chart data reaching an insight/admin board — plausible in principle (chart labels
derive from course/class data) but not demonstrated here, so **UNVERIFIED**.

**Recommended fix (not applied).** Upgrade `echarts` to `>=6.1.0` — a major bump, so it needs a
visual pass over the insight boards. The postcss/nanoid chain resolves whenever `vue` next moves;
no urgency given it never reaches a browser. Per the brief, **no fix was run.**

---

## CLIENT-CONFIG-07 — Wildcard CORS on the audio proxy (info, assessed safe)

`vercel.json:20-22` sets `Access-Control-Allow-Origin: *` for `/api/audio/(.*)`, and
`api/audio/[audioId].ts:153-155` sets the same plus `Allow-Methods: GET, OPTIONS` and
`Allow-Headers: Content-Type`.

This is **fine as configured** and is recorded so it stays that way. The endpoint is credential-free:
no `Access-Control-Allow-Credentials`, and `Allow-Headers` deliberately excludes `Authorization`, so
a wildcard grants a cross-origin script nothing a plain `<audio src>` could not already fetch.
Entitlement is enforced separately via a stateless HMAC token (`resolveAudioEntitlement`, line 95).

**The thing to protect:** if `Access-Control-Allow-Credentials: true` is ever added here, `*` becomes
a genuine cross-origin data leak. A test asserts that header stays absent.

---

## CLIENT-CONFIG-08 — Refresh token in CacheStorage for 30 days (info)

**Where:** `packages/player-vue/src/utils/authHandoff.ts`.

iOS isolates localStorage between Safari and an installed PWA, so the app bridges a session across
that boundary through CacheStorage (which iOS *does* share). It writes
`{ access_token, refresh_token, ts }` to cache `ssi-auth-handoff` and accepts it for
`MAX_AGE_MS = 30 days`.

**Assessment: acceptable, with one number worth tightening.** The mitigations are real and I verified
each: CacheStorage is same-origin (no worse than the localStorage Supabase already uses); the read
deletes the entry *before* validating it, so consume-once holds even on a failed restore; and
`writeAuthHandoff(null)` clears the bridge on sign-out. The residual concern is only that a refresh
token sits for 30 days in a non-obvious place, on a device that may be shared — while the job it
does (surviving an Add-to-Home-Screen) takes minutes.

**Recommended fix (not applied).** Cut `MAX_AGE_MS` to hours.

---

## Controls verified as HOLDING

These were hunted for and found sound. Each is locked by a passing test so a regression is loud.

- **All three `v-html` sinks escape before they decorate.** `WalkCard.vue:68`,
  `HowThisWorks.vue:84`, `AdminOnboardingView.vue:271` each run
  `.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')` *first*, then insert their own
  `<strong>`/`<p>`/`<li>` tags. Six XSS payloads were driven through the real `WalkCard` component
  and through a mirror of `renderPreview`, asserting on **parsed DOM** — no live element, no `on*`
  attribute, no `javascript:` URL survives. `AdminOnboardingView` is the one that matters most, since
  its input round-trips through the database rather than being compiled repo data.
  Ordering is itself asserted, because escape-after-decorate would silently break the control.
- **No other HTML sink exists** — zero `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`
  in client source, and zero `eval`/`new Function`.
- **Open redirect is guarded.** `InstallGuide.vue:22-26` accepts `?return` only when it starts with
  a single `/`, rejecting `//evil.com`, absolute URLs and `javascript:`. The other candidate —
  `router.onError` → `window.location.assign(to.fullPath)` (`router/index.ts:880`) — is safe because
  `to` is a *resolved* route and the catch-all `/:pathMatch(.*)*` redirects unmatched paths to `/`,
  so `fullPath` can never carry an attacker's host.
- **Tokens never reach a URL, a log or an analytics payload.** No `?token=` construction anywhere; no
  `console.*` call takes an `access_token`/`refresh_token`; API calls use `Authorization: Bearer`.
- **No `postMessage` origin-check bug, because there is no handler.** The single `onmessage` in
  `generateLearningScript.ts:342` is a `MessageChannel` used to yield to the event loop — not a
  cross-origin surface. No `window`/`document` `'message'` listener exists.
- **The service worker never caches authenticated responses.** `runtimeCaching` covers exactly two
  patterns — navigations (NetworkFirst) and Google Fonts. No `/api/*` route is cached, so per-user
  JSON cannot be replayed to a different signed-in user on a shared device. Audio is deliberately
  excluded from both the SW and the precache.
- **`api/sw-config.ts`** is a read-only GET returning three env-derived booleans/strings. No user
  input reaches it; nothing to inject.
- **No external CDN `<script>`** is loaded anywhere in `index.html` or client source, which is what
  makes a strict CSP cheap to adopt (CLIENT-CONFIG-01).

---

## GAPS — what I could not check

Reported explicitly rather than papered over.

1. **No live HTTP access.** Every header finding (CLIENT-CONFIG-01) is from `vercel.json` as
   committed. I did not curl staging or production, so I cannot rule out headers injected at the
   Vercel platform level or by a proxy. **Verifying CLIENT-CONFIG-01 needs one
   `curl -I https://saysomethingin.app` — worth doing before acting on it.**
2. **The echarts XSS is not proven reachable.** I confirmed echarts ships to browsers as a lazy
   chunk, but did not trace a specific attacker-controlled string into a vulnerable chart option.
   Marked UNVERIFIED.
3. **No DB access.** I could not confirm what `onboarding_messages.body` actually contains in
   production, nor exercise the `AdminOnboardingView` preview against real stored rows. The escaping
   analysis is static and holds regardless of content.
4. **`npm audit --omit=dev` could not run** (`ENOLOCK`, pnpm workspace). I used `pnpm audit --prod`
   and did not generate a lockfile, since that would write into a working tree shared with other
   audit workers. The advisory data is pnpm's, from the same registry source.
5. **Git-history secret scan was targeted, not exhaustive.** I enumerated every file ever *added*
   matching env/key/pem patterns (which found CLIENT-CONFIG-02) and inspected those blobs. I did not
   stream all ~4,655 commits' blob contents through a full entropy scan, so a high-entropy secret
   committed under an innocuous filename would not have been caught. A dedicated tool
   (`gitleaks detect --no-git=false`, or `trufflehog git file://.`) is the right follow-up.
6. **Bundle inspection was source-level, not artefact-level.** I did not run a production build and
   grep `dist/` for inlined values. The `VITE_*` analysis is sound in principle — Vite inlines only
   `VITE_`-prefixed vars — but building and grepping the artefact would be strictly stronger.
7. **Areas 1-4 overlap.** `api/**` belongs to other workers. I read `api/admin/*` and
   `api/_utils/auth.ts` only far enough to establish the client↔server pairing for
   CLIENT-CONFIG-04, and `api/audio/[audioId].ts` for the CORS assessment. Deeper API findings are
   theirs, not mine.

---

## Tests added

All five files live under `packages/player-vue/src/security/` per this area's brief (client-side
code rides player-vue's own vitest config, `environment: 'happy-dom'`).

| File | Tests | Covers |
|---|---|---|
| `xssVHtml.security.test.ts` | 19 | All three `v-html` sinks; sink inventory lock; no innerHTML/eval |
| `securityHeaders.security.test.ts` | 9 + 7 todo | CLIENT-CONFIG-01, -05, -07 |
| `clientSecrets.security.test.ts` | 7 + 1 todo | CLIENT-CONFIG-02; no server secret in VITE_ env |
| `clientAuthzPairing.security.test.ts` | 23 + 1 todo | CLIENT-CONFIG-04 + the 19-endpoint regression lock |
| `clientSurface.security.test.ts` | 27 + 2 todo | CLIENT-CONFIG-03, -08; redirect/token/postMessage/SW controls |
| **Total** | **85 passing, 11 todo** | |

Every characterization test asserting a *vulnerable* current behaviour carries a
`// SECURITY FINDING <ID>:` comment stating what should happen instead, plus an `it.todo` naming the
fix — so findings are executable documentation without red CI.

**Verify:**

```bash
npx vitest run --dir packages/player-vue/src/security   # from repo root
```

### Gate status at commit

| Gate | Result |
|---|---|
| `npx vitest run -c vitest.api.config.ts` | **green** — 117 files, 1307 passed, 37 todo |
| `npx tsc -p tsconfig.api.json --noEmit` | **clean** |
| `npx vitest run` (full player-vue suite) | **green** — 213 files, 2047 passed, 11 todo |
| `npx eslint src/security` | **clean** |

No production file was modified by this audit.
