# Security response headers — shipped 2026-08-11

Closes **CLIENT-CONFIG-01** from the 2026-08-11 security audit
(`docs/security-audit-2026-08-11/client-config.md`): production served *only* HSTS — no CSP, no
`X-Frame-Options`, no `Referrer-Policy` — so `/schools` and `/admin` could be framed by any origin
and clickjacked.

Verified before the change, against live production:

```
$ curl -sI https://saysomethingin.app
strict-transport-security: max-age=63072000      ← the only security header
```

Everything below lands in `vercel.json`'s `headers` block. The app is a Vite static build plus
serverless functions under `api/` — Vercel's `headers` config is the only place headers are set for
both, so that is where it goes.

---

## What ships enforced (all routes, `source: "/(.*)"`)

| Header | Value | Why |
|---|---|---|
| `X-Frame-Options` | `DENY` | The clickjacking fix. Nothing legitimately frames the app: no `<iframe>` of our own pages in `src/`, and the marketing site does not embed it. |
| `Content-Security-Policy` | `frame-ancestors 'none'` | The modern equivalent, for browsers that ignore XFO. **Frame-ancestors only** — see the report-only section. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Stops `/schools/classes/<uuid>` and `/admin/users/<learnerId>/progress` leaking in `Referer`. |
| `X-Content-Type-Options` | `nosniff` | Standard. |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | Was already set without `includeSubDomains`. **No `preload`** — preload-list submission is a one-way door and is Tom's call, not a side effect of a headers pass. |
| `Permissions-Policy` | `camera=(), geolocation=(), microphone=(self)` | `microphone=(self)` because `PronunciationOverlay.vue` calls `getUserMedia`. `payment` is deliberately **unlisted** so Paddle's checkout iframe keeps the browser default — listing it wrong would break real card payments. |

One narrower rule: `/_schools-mockups/(.*)` gets `SAMEORIGIN` / `frame-ancestors 'self'`, because the
internal design mockups under `public/_schools-mockups/flows/` iframe their sibling pages. Cross-origin
framing is still blocked there.

## What ships report-only, and why

The full `Content-Security-Policy` ships as **`Content-Security-Policy-Report-Only`**. Report-only
cannot block anything, so it cannot break audio, auth or checkout — it only tells a browser console
what *would* have been blocked.

This is the honest call rather than a guess: the origin inventory below was taken from the built
bundle and `index.html`, but two paths could not be exercised end-to-end before shipping — **Paddle
checkout** (needs a real card session) and **presigned-S3 offline audio download** (needs real
credentials in a deployed environment). A CSP that blocked audio for real learners would be worse
than the missing header, which is exactly the trade the audit warned about.

### The policy

```
default-src 'self';
base-uri 'self';
object-src 'none';
form-action 'self';
frame-ancestors 'none';
script-src 'self' 'sha256-V4lEMYh/40zbF4mHgsj5X757gDDWRWAbeLAzK/neODo=' https://*.paddle.com;
style-src  'self' 'unsafe-inline' https://fonts.googleapis.com https://*.paddle.com;
font-src   'self' data: https://fonts.gstatic.com;
img-src    'self' data: blob: https://*.paddle.com;
media-src  'self' data: blob: https://*.s3.eu-west-1.amazonaws.com https://*.s3.amazonaws.com;
connect-src 'self' https://swfvymspfxmnfhevgdkg.supabase.co wss://swfvymspfxmnfhevgdkg.supabase.co
            https://*.s3.eu-west-1.amazonaws.com https://*.s3.amazonaws.com
            https://fonts.googleapis.com https://fonts.gstatic.com https://*.paddle.com;
frame-src  'self' https://*.paddle.com;
worker-src 'self' blob:;
manifest-src 'self'
```

### Origin inventory (how each directive was derived)

| Origin | Used by | Directive |
|---|---|---|
| `fonts.googleapis.com` / `fonts.gstatic.com` | Arsenal + Open Sans for the schools dashboard, linked from `index.html` | `style-src`, `font-src`, `connect-src` |
| `*.paddle.com` | `@paddle/paddle-js` loads `https://cdn.paddle.com`; checkout renders in a `buy.paddle.com` iframe | `script-src`, `frame-src`, `connect-src`, `img-src`, `style-src` |
| `swfvymspfxmnfhevgdkg.supabase.co` (+ `wss:`) | Auth and all data reads | `connect-src` |
| `*.s3.*.amazonaws.com` | Presigned URLs from `api/audio/batch-urls.ts` for bulk offline download (the per-file `/api/audio/:id` proxy is same-origin) | `media-src`, `connect-src` |
| `blob:` / `data:` | `AudioCache` blob URLs, `silentWav.ts` data URIs, the service worker | `media-src`, `img-src`, `worker-src` |

`script-src` carries **no `'unsafe-inline'` and no `'unsafe-eval'`** — the one inline script
(`index.html`'s boot watchdog, which must keep running for the offline boot-heal path) is allowed by
SHA-256 hash. The hash is byte-identical in source and in the Vite build output (verified: Vite does
not rewrite the inline block). `securityHeaders.security.test.ts` recomputes it in CI, so editing the
watchdog fails the suite rather than silently going stale.

`style-src` keeps `'unsafe-inline'`: Vue writes inline `style` attributes throughout, and the critical
boot CSS is an inline `<style>`. Removing it is a separate piece of work, not a headers pass.

## What was verified

- **Live production before**: `curl -sI` — only HSTS present (above).
- **Local, under the real policy**: production build served by a static server that replays
  `vercel.json`'s headers, driven in headless Chromium. Result: app boots (`__SSI_BOOTED` true),
  723 font faces load, **zero CSP violations, zero failed requests** on `/` and `/schools`. This
  proves the shell, the hashed inline watchdog, the module graph and Google Fonts all pass.
- **Not verified before shipping**: Paddle checkout, presigned-S3 offline download, and the
  signed-in schools/admin surfaces — a local build has no Supabase/Paddle env. This is why the full
  policy is report-only.

## Promoting report-only → enforced (the follow-up)

1. Soak on `dev`, then `staging`, exercising: a signed-in learner session with audio, an offline bulk
   download, Paddle checkout, and the schools + admin dashboards.
2. Collect violations from the browser console (`Content-Security-Policy-Report-Only` messages).
   If field data is wanted instead of manual passes, add a `report-uri` endpoint at that point —
   deliberately not added now, since every violation would be a paid function invocation.
3. When clean, rename the header key to `Content-Security-Policy` (merging the `frame-ancestors`
   directive already there) and flip the `it.todo` in `securityHeaders.security.test.ts`.

Do not promote while the script hash test is failing — a stale hash under an enforced policy
white-screens the app.
