# Area C — webhooks, cron, and the software supply chain (2026-08-29)

Sixth security audit of this repo in 18 days. No prior audit had examined webhook signature
verification, cron auth, or the dependency/CI supply chain as its own subject — the 2026-08-22
audit's SEC22-05 looked at the Paddle webhook's tenant-binding ladder (the part *after* the event is
trusted), not the signature layer beneath it. This report covers that layer plus cron auth plus
supply chain.

**Bottom line up front — the money path:** Wise's webhook fails closed correctly. Paddle's does not:
`api/_utils/paddle.ts` never checks that `PADDLE_WEBHOOK_SECRET` is actually set, and Node's HMAC
implementation happily signs with an empty-string key, so if that env var is ever unset/empty in a
deployed environment, **anyone can forge a valid Paddle webhook** — no secret knowledge required, just
`HMAC-SHA256('${ts}:${body}', '')`, which is a public constant. This is characterized against the
real `@paddle/paddle-node-sdk`, not a mock (SEC29-C-01, medium — see caveats below). Both cron
endpoints fail closed correctly and match `vercel.json`. Supply chain: all 55 HIGH/CRITICAL `pnpm
audit` advisories trace to build-time/test-only dependency chains, none reachable from `api/**` or
the shipped client bundle; the one CI workflow with write access to `dev` runs on floating (non-SHA)
action tags.

## C1 — webhook signature verification

### Paddle (`api/teacher/paddle-webhook.ts` + `api/_utils/paddle.ts`)

**Ordering is right.** `config.api.bodyParser = false` is set, the raw body is read via
`req.on('data'/'end')` (not `req.body`), and `paddle.webhooks.unmarshal(rawBody, webhookSecret,
signature)` runs before any DB call. The idempotency insert (`processed_webhook_events`, unique on
`(provider, event_id)`) happens immediately after, before any business-logic write, so exact-replay
of an already-processed delivery is a no-op. Ordering is not the problem.

**SEC29-C-01 (medium) — no presence check on `PADDLE_WEBHOOK_SECRET`.**
`api/_utils/paddle.ts`:
```ts
export const webhookSecret = (process.env.PADDLE_WEBHOOK_SECRET || '').trim()
```
No caller checks `if (!webhookSecret)` anywhere. Compare `api/_utils/wise.ts`'s
`verifyWiseWebhook`, which explicitly returns `false` when `WISE_WEBHOOK_PUBLIC_KEY` is unset — or
`api/cron/teacher-payouts.ts`, which was *explicitly hardened* against this exact class of bug
("Previously an unset CRON_SECRET skipped the check entirely… leaving the endpoint open" — its own
comment). Paddle-webhook.ts never received the equivalent guard.

The Paddle signature scheme is `HMAC-SHA256("${ts}:${body}", secret)`, verified in the SDK's
`WebhooksValidator.isValidSignature`. Node's `crypto.createHmac('sha256', '')` computes an HMAC with
an empty key without error — it does not throw or refuse. So if `PADDLE_WEBHOOK_SECRET` is ever
unset or empty at runtime, `paddle.webhooks.unmarshal(rawBody, '', signature)` will accept **any**
request whose `Paddle-Signature` header is `ts=<t>;h1=<HMAC-SHA256(\`${t}:${rawBody}\`, '')>` — a
value anyone can compute, because the "secret" is a public constant (the empty string).

Verified directly against the real SDK (`api/_security/sec29-c-webhooks-cron.security.test.ts`,
`SEC29-C-01` describe block) — with `secret=''`, a hand-crafted signature is accepted and the parsed,
attacker-controlled event is returned; with a real (non-empty, unknown-to-attacker) secret, the same
forged-with-empty-key signature is correctly rejected.

**Cost to an attacker if this fires:** total forgery of Paddle webhook events — `subscription.*`,
`transaction.paid` — with attacker-chosen `customData`. Downstream, SEC22-05's tenant-binding ladder
(`billingIntent.ts`/`billingBinding.ts`) still resolves *which* school/org/learner a platform-kind
event can write to, so this is not automatically an unbounded write; but for the non-platform kinds
(`learner_premium`, `student_via_teacher`) a forged event can mint a paid-for entitlement with no
money having moved, and for `transaction.paid` it can accrue fabricated teacher commission.

**Why "medium" not "critical":** exploitability is entirely conditional on `PADDLE_WEBHOOK_SECRET`
actually being unset/empty in a *deployed* environment. I have no DB/env access in this worktree
(read-only audit, no live queries permitted) and found no evidence either way that it currently is —
this is a missing fail-safe, not a confirmed live hole. It is exactly the shape of bug this repo has
already found and fixed twice elsewhere (`CRON_SECRET`, `ENTITLEMENT_TOKEN_SECRET` in
`try-link/validate.ts`), which is why I'm confident it's worth fixing the same way here, not why I'm
confident it's currently exploitable.

**SEC29-C-02 (info, not ours to fix)** — the SDK's own comparison, `computedHash === headers.h1` in
`webhooks-validator.js`, is a plain string equality, not `crypto.timingSafeEqual`. Third-party
vendored code (`@paddle/paddle-node-sdk@3.8.0`); noted, not characterized with a test (that would
only be testing the vendored SDK, not this repo's code).

**Replay window:** the SDK enforces `now ≤ ts + 5s` (`MAX_VALID_TIME_DIFFERENCE = 5`) with no lower
bound — a signature timestamped arbitrarily far in the *future* is not rejected on that basis alone,
but forging one still requires the real secret, so this is inert as long as SEC29-C-01 doesn't fire.
Combined with the app's own `processed_webhook_events` idempotency insert (keyed on `event_id`,
inserted before any side effect), replay of a genuine captured delivery is a no-op regardless.

### Wise (`api/teacher/wise-webhook.ts` + `api/_utils/wise.ts`)

**Holds.** `verifyWiseWebhook` fails closed on both a missing signature header and a missing
`WISE_WEBHOOK_PUBLIC_KEY` (returns `false`, does not attempt verification with a degraded check).
Verification runs before the raw body is even JSON-parsed. RSA-SHA256 signature verify (`createVerify`
+ `.verify()`) is not the shared-secret-guessing class of bug HMAC-with-empty-key is — there is no
"empty public key" that verifies everything. Locked in the test file (positive control: a genuine
RSA signature verifies; negative controls: missing key, missing header, and a forged signature
against a real key all fail).

**One residue, low severity:** no timestamp/nonce anti-replay at all (Wise doesn't sign a timestamp
in this scheme, only the raw body). A captured legitimate delivery could in principle be replayed
indefinitely. Impact is bounded to near-nothing by the handler's own logic: every status transition
is idempotent-or-monotonic (`PAID_STATES` only promotes rows still `pending_payout`; `CHARGEBACK_STATES`
only demotes `pending_payout`/`paid`; `TRANSIENT_FAILURE_STATES` only resets `pending_payout`), and the
`processed_webhook_events` dedup on `(transferId, state, occurred_at)` blocks the exact same delivery
being reprocessed after first success anyway. Not characterized with a test — there is no observable
insecure *behaviour* to pin (the guards that make it safe are the same idempotency guards already
locked by reading the code above); flagging as a documentation-only residue.

## C2 — cron endpoints

Both `vercel.json` cron entries (`/api/cron/teacher-payouts`, `/api/cron/expire-demo-schools`) have a
matching handler file, and both handler files are the only two under `api/cron/`. No orphan on either
side.

**Both fail closed correctly**, and both carry the identical, explicitly-documented pattern:
```ts
const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
if (isProd && !cronSecret) { /* refuse with 500 */ }
if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
  if (isProd) { /* refuse with 401 */ }
  /* non-prod: warn and allow */
}
```
This is the same `IS_PROD` idiom used in `api/try-link/validate.ts` and `api/_utils/audioAccess.ts`
(4 call sites total, consistent) — Vercel serverless functions run with `NODE_ENV=production` in
every *deployed* environment (dev/staging/prod all deploy via Vercel), so the non-prod bypass branch
is reachable only in genuinely-local dev (`pnpm dev` / `vercel dev` without `NODE_ENV` set), not on
any deployed preview/dev/staging/prod URL. Locked with 4 tests: both handlers refuse (500) with
`CRON_SECRET` unset in production, and both reject (401) a wrong bearer token in production.

**Minor, low severity** — the comparison `authHeader !== \`Bearer ${cronSecret}\`` is a plain string
compare, not `crypto.timingSafeEqual`. Same class of defect as SEC29-C-02, in first-party code this
time. Practical exploitability of an HTTP-network timing side-channel against a cron bearer token is
very low (network jitter dwarfs any measurable difference over a handful of comparison bytes), and
what an attacker gets even in the best case is the ability to *trigger* these two jobs — see impact
below. Noted, not characterized with a test (no observable-today insecure behavior to pin; the risk
is theoretical).

**What each job does if an attacker somehow triggers it without the secret** (defense-in-depth,
given both fail closed): `expire-demo-schools` only acts on `demo_orgs` rows already past
`expires_at` — an attacker gains nothing by triggering it early, since the query itself excludes
anything not-yet-due. `teacher-payouts` moves real money via Wise (batch-group creation + transfers)
for every teacher whose released balance already clears the £100 threshold — a forced early run
would pay teachers earlier than the 1st-of-month schedule, not pay anyone who isn't already owed, and
per its own doc comment already requires a human to fund the batch in the Wise dashboard before
anything actually dispatches. Neither is a "free money" or "arbitrary write" surface even without the
auth gate; the gate is still correctly enforced regardless.

## C3 — supply chain

### GitHub Actions: permissions and floating tags

| Workflow | Trigger | `permissions:` | Secrets/tokens used | Action pinning |
|---|---|---|---|---|
| `auto-merge-claude.yml` | `push` to `claude/**` | **`contents: write`** (workflow-level) | `${{ secrets.GITHUB_TOKEN }}` (explicit, in `merge-to-dev` job) — used to `git push origin dev` | `actions/checkout@v4.2.2` (pinned patch tag), `pnpm/action-setup@v4` (floating major), `actions/setup-node@v4` (floating major) |
| `verify.yml` | `push` to `dev`/`staging`/`main`, `pull_request` (incl. from forks) | **`contents: read`** | none explicit (default `GITHUB_TOKEN`, read-only by the `permissions:` block) | same three actions, same pinning |

**The one that matters is `auto-merge-claude.yml`.** It runs on push to `claude/**` (not
`pull_request_target`, so no untrusted-fork-code-with-secrets pattern — only branches pushed directly
to this repo by someone with write access), but it holds `contents: write` and its `merge-to-dev` job
uses that to merge and push straight to `dev`, which auto-deploys. `pnpm/action-setup@v4` and
`actions/setup-node@v4` are floating major-version tags — mutable by their respective maintainers at
any time, and both run *inside* the same job that later gets `contents: write` for the push step (the
`verify` job's steps run before `merge-to-dev`, in a separate job with its own token scope, but
`auto-merge-claude.yml`'s workflow-level `permissions: contents: write` applies to every job in the
file including `verify`, since there's no per-job override). A compromised release of either action
could exfiltrate the `GITHUB_TOKEN` or inject a build step; combined with the write-scoped token this
is the workflow where pinning to a SHA is worth doing. `actions/checkout@v4.2.2` is already pinned to
a specific patch version (not a SHA, but GitHub's own first-party action — much lower supply-chain
risk than a third-party maintainer's floating tag).

`verify.yml` runs the identical unpinned actions but with `contents: read` and no explicit secrets —
even a fully compromised action here can't push code or read anything beyond what any public clone
already has. Low risk despite the same floating tags.

No `pull_request_target` or `workflow_run` trigger exists anywhere in `.github/workflows/` — the
classic fork-PR-with-secrets pattern isn't present at all.

### Dependency advisories (`pnpm audit --json`, read-only — no install performed)

83 total advisories: 1 critical, 54 high, 24 moderate, 4 low. **Every single HIGH/CRITICAL advisory's
dependency path roots in a build-time or test-only tool** — none reachable from `api/**` request
handlers or `packages/player-vue/src/**` runtime code:

| Root dependency chain | Advisory count (H/C) | Reachable from request path? |
|---|---|---|
| `@vercel/node` → `@vercel/nft` → `@mapbox/node-pre-gyp` → `tar` | 6 (incl. the 1 critical) | No — Vercel's own build-time bundler, never present at runtime |
| `@vercel/node` → `@vercel/nft`/`@vercel/static-config` → `ts-morph`/`glob`/`minimatch`/`picomatch`/`brace-expansion`/`fast-uri` | ~20 | No — same, build-time only |
| `@vercel/node` → `undici` | 3 | No — build-time |
| `vitest`/`vite`/`@vitest/mocker` → `rollup`/`postcss`/`vite` (dev-server bugs)/`nanoid` | ~9 | No — test runner only, never bundled or deployed |
| `packages/player-vue` devDependency `vite-plugin-pwa` → `workbox-build` → `lodash`/`serialize-javascript`/`fast-uri`/`@babel/plugin-transform-modules-systemjs` | ~6 | No — PWA-manifest build plugin, build-time only |
| `packages/player-vue` devDependency `@vue/test-utils` → `js-beautify` → `js-cookie`/`editorconfig`/`glob`/`minimatch`/`brace-expansion` | ~6 | No — test-only dependency chain |
| `eslint`/`typescript-eslint` → `js-yaml`/`brace-expansion`/`minimatch` | ~5 | No — lint tooling only |
| **`sharp@0.34.5`** (CVE-2026-33327/33328/35590/35591, libvips) | 1 | **No** — confirmed a `devDependency` in `packages/player-vue/package.json`; the only import anywhere in the repo is `e2e/lie-fi-thirdparty-boot-probe.mjs` (a local Playwright screenshot-processing probe), grepped across `api/**` and `packages/player-vue/src/**` with zero hits |

None of these packages ship in the Vercel serverless function bundle or the client's built JS —
`@vercel/node` is the tool Vercel itself uses to *produce* the bundle, `vite`/`vitest`/`eslint` never
run in production, and `sharp` has no runtime import path. **Zero of the 55 HIGH/CRITICAL advisories
are reachable from a live request.** The 24 moderate + 4 low advisories were not individually
triaged (out of the brief's HIGH/CRITICAL scope) but sit in the same dependency chains based on a
spot check of the full list.

### Client asset delta since 2026-08-25 (flags + fonts)

**Flag SVGs** (`packages/player-vue/src/assets/flags/countries/`, 267 files, `LICENSE.md` present):
grepped every file for `<script`, `onload=`, `onerror=`, `<foreignObject`, and external
`href`/`xlink:href` — zero hits. Clean.

**`loadWebFonts.ts`**: this is *not* a second instance of SEC25-B-01. The file's own header documents
that Tom's 2026-08-26 ruling A-265 moved fonts from Google (`fonts.googleapis.com`/`fonts.gstatic.com`)
to fully self-hosted (`/fonts/fonts.css`, same-origin, vendored by `scripts/vendor-fonts.mjs`) —
`WEBFONT_HREFS` is just `['/fonts/fonts.css']`. Confirmed no reference to `fonts.googleapis.com` or
`fonts.gstatic.com` remains in `index.html` or `style.css`.

**Residue (low, informational):** `vercel.json`'s CSP-Report-Only policy still allowlists
`https://fonts.googleapis.com` (style-src, connect-src) and `https://fonts.gstatic.com`
(font-src, connect-src) — dead allowances now that nothing in the app fetches from either host. Not a
vulnerability (the policy is strictly narrower without them, never wider), but worth pruning next
time this file is touched: an unused third-party allowance in a CSP is attack surface with zero
offsetting benefit.

## Explicit gaps

- **SEC29-C-01's real-world exposure is unverified.** I have no access to live Vercel env vars or the
  DB in this worktree (rules of this audit forbid live queries/`vercel login`), so I cannot confirm
  whether `PADDLE_WEBHOOK_SECRET` is actually set in any deployed environment today. The finding is a
  missing fail-safe, verified against the real SDK; it is not a confirmed live incident.
- **Wise webhook replay** (no timestamp/nonce) is assessed as low-impact from reading the handler's
  own idempotency/monotonic-transition logic, not from a live replay test (none permitted).
- **24 moderate + 4 low `pnpm audit` advisories** were not individually triaged for reachability —
  out of the brief's HIGH/CRITICAL scope, and a spot check suggests they sit in the same build/test-only
  chains as the HIGH/CRITICAL set, but that is an inference, not a per-advisory check.
- **`actions/checkout@v4.2.2`** is pinned to a version tag, not a commit SHA — lower risk than the
  floating `@v4` tags on the other two actions (first-party GitHub action, specific version), but not
  the strongest possible pin. Not characterized as a separate finding; folded into the workflow table.
