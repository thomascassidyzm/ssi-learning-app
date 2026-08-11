# Security & vulnerability audit — 2026-08-11

Run as reset-eve spare-capacity work on branch `sec/audit-2026-08-11`.

**Rules this audit ran under:** findings and tests only. No production behaviour was changed,
no fix was applied, nothing was promoted, no live exploit traffic was sent, and nothing on the
money path was touched. Every claim here comes from reading code in this repo.

## Verdict — the whole audit in one screen

Six areas, 5 workers plus the coordinator, ~1,100 test cases added, **0 production files changed**.

**One critical, found twice independently.** The Paddle webhook validates *what was paid* with real
rigour and never asks *who it is for*. `customData.school_id` is composed in browser JavaScript
(`useSchoolCheckout.ts:86-89`) and lands in a service-role `UPDATE … WHERE id = $that`
(`paddle-webhook.ts:486-493`) over `platform_status`, `teacher_seats` and `provider_customer_id` —
the last of which mints the school's billing portal (`school/portal.ts:53-63`). Anyone who knows a
school's UUID — every teacher and pupil in it — buys one legitimate £15 seat naming the victim,
then cancels it. **£15 to switch a paying school dark.** Areas 2 and 4 reached this independently
from different directions; every link was then re-verified by the coordinator.

**The pattern worth more than any single finding.** Three of the most serious items are the *same*
failure: a deliberate hardening pass that migrated the helpers and missed one caller.

| The pass | What it fixed | What it missed |
|---|---|---|
| `c2f04665` (2026-08-06) path→`parent_id` subtree resolvers | `groupSubtree`, `schoolScope`, `groupRollups`, `rate-compare`, and `invites.test.ts` | **`invites.ts` itself** — the handler, while its test was updated (TENANCY-01, critical) |
| Code-entropy hardening to `crypto.randomInt` | the app-side minter, with a comment explaining why | **`generate_join_code()`** in the DB, minting the same class of credential with `random()` (ADMIN-ENT-02, high) |
| Paddle `customData` distrust | the *tier* — a £5 price cannot buy a £15 plan | **the target tenant** — never checked at all (ADMIN-ENT-01, critical) |

The security *thinking* in this codebase is good and often excellent — the fail-closed/fail-loud
split in `verifyAdmin`, the race-free single-statement redemption RPC, `access/claim.ts` deriving
identity from the verified token "NEVER from the body". What leaks is **completeness of sweeps**.
The cheapest durable win is not any one fix; it is making a hardening pass enumerate its callers.

**The systemic absence:** there is **no rate limiting anywhere in `api/**`** beyond two hand-rolled
throttles (`code/validate.ts`, `possession-redeem.ts`). The same missing primitive resurfaces as
five different-looking findings — unmetered code redemption, an unthrottled join-code oracle, an
OTP relay, an anonymous bulk-audio endpoint, and an MX-lookup amplifier.

**What is genuinely solid**, verified rather than assumed: no server secret reaches the client
bundle; no SSRF, no raw SQL concatenation, no prototype pollution, no ReDoS, no path traversal
reaching an S3 key; all 19 admin endpoints re-derive role server-side; no read/write authz
asymmetry in 44 tenancy handlers; both webhook verifiers check signatures over the raw body.

### Top of the queue

| # | ID | Sev | Where | Costs an attacker |
|---|---|---|---|---|
| 1 | ADMIN-ENT-01 / TENANCY-03 | **critical** | `paddle-webhook.ts:467,486` | £15 |
| 2 | TENANCY-01 | **critical** | `groups/[id]/invites.ts:132` | an org name |
| 3 | AUTH-CORE-02 | high *(needs live DB check)* | `schema.sql:16570` + `access/grant-emails.ts` | nothing |
| 4 | INPUT-01 | high *(needs live env check)* | `audio/batch-urls.ts` | nothing |
| 5 | AUTH-CORE-01 | high | `code/redeem.ts` — no throttle on the granting sibling | patience |
| 6 | ADMIN-ENT-02 | high | `generate_join_code()` uses `random()` | statistics |

### Two live checks that change severities, neither of which this audit could make

1. **`vercel env ls production | grep ENTITLEMENT_ENFORCE`** — decides whether INPUT-01 is live or
   already mitigated. Fail-open is the documented *default* (`audioAccess.ts:403-407`).
2. **`SELECT grantee, privilege_type FROM information_schema.column_privileges WHERE
   table_name='learners' AND column_name='verified_emails';`** — decides whether AUTH-CORE-02 is
   real. It rests on `supabase/schema.sql`, which CLAUDE.md records as having been stale before.
   The same doubt applies to ADMIN-ENT-04's column-grant control, which is what actually blocks
   self-escalation to `ssi_admin` (RLS alone would allow it).

A third check was open and **has since been settled**: `curl -sI https://saysomethingin.app` returns
only `strict-transport-security`. No CSP, no `X-Frame-Options`, no `Referrer-Policy`, no
`X-Content-Type-Options` — confirmed against production, not just against the committed
`vercel.json`. CLIENT-01 stands as written; the schools and admin dashboards are clickjackable.

## Contents

| File | Area | Owner |
|---|---|---|
| `README.md` (this file) | Cross-cutting map: every handler, its auth posture, its DB privilege | coordinator |
| `coordinator-sweep.md` | PostgREST `.or()` filter injection across all of `api/**` | coordinator |
| `auth-core.md` | Auth & identity core — JWT verification, impersonation, signin links, OTP, codes | worker #138 |
| `tenancy.md` | Multi-tenant authz / IDOR — schools, orgs, groups, govt, family, board | worker #139 |
| `input.md` | Input handling & injection — traversal, SSRF, mass assignment, email, cron, CORS | worker #140 |
| `admin-entitlement.md` | Admin surfaces, entitlements, webhooks, invite/join codes, trials | worker #141 |
| `client-config.md` | Client-side XSS, secrets, headers, service worker, dependencies | worker #142 |

Tests accompanying the findings live next to the code they describe, as
`api/**/*.security.test.ts` (and `packages/player-vue/src/security/*.security.test.ts` for the
client area). They ride the existing suites, so a regression re-opens the finding automatically.

**Test convention.** A finding never leaves a red suite. Controls that hold are locked with an
ordinary passing test. Real vulnerabilities are recorded as a *characterization* test that
asserts today's insecure behaviour and passes, carrying a `// SECURITY FINDING <ID>:` comment
and a paired `it.todo()` naming the secure behaviour. So the fix, when someone makes it, turns
the characterization test red on purpose — that is the signal the finding is closed.

---

## The map: 105 handlers, and what stands between them and the database

Generated by walking every `export default` handler under `api/` (excluding `_utils`,
`_security` and tests) and recording which auth helper it references.

| | count |
|---|---|
| HTTP handlers under `api/` | **105** |
| …that construct a client with `SUPABASE_SERVICE_ROLE_KEY` | **102** |
| …that reference no auth helper at all | **17** |

### The 102 — service-role is the default, so authz is entirely the handler's job

Nearly every endpoint in this codebase talks to Supabase as the service role, which **bypasses
RLS completely**. That is consistent with the architecture CLAUDE.md declares deliberately —
"RLS answers exactly one question, *is this my row?*… ALL hierarchy/cross-user authz lives in
server-mediated endpoints with tests" — and it is a defensible choice. But it means the
row-level safety net is *off* for 97% of the API surface: a missing scope check in a handler is
not a degraded check, it is no check. Every finding in `tenancy.md` should be read with that
multiplier applied.

### The 17 with no auth helper — and whether that is correct

Auditing this list was the first thing the sweep did, because "no auth" is only a finding when
it is not intentional. Each is gated by something other than a bearer token, or by nothing:

| Handler | Gate that is actually there | Coordinator's first read |
|---|---|---|
| `api/audio/[audioId].ts` | none (audio proxy) | public by design; see `input.md` for path-traversal on the id |
| `api/audio/batch-urls.ts` | `isValidAudioId` filter on ids | public by design; id validation present |
| `api/sw-config.ts` | none | static config, no data |
| `api/courses/available.ts` | none | public catalogue |
| `api/courses/[code]/bundle.ts` `cycles.ts` `infplay-cycles.ts` `round-map.ts` | none | course content, public by design — but they hold the *whole course*, which is the paid product; entitlement checking is worth confirming against the business model |
| `api/cron/expire-demo-schools.ts` | `CRON_SECRET` | correct shape; #140 confirms the comparison |
| `api/cron/teacher-payouts.ts` | `CRON_SECRET` | correct shape, and it moves money — #141 |
| `api/try-link/validate.ts` | `CRON_SECRET` + link token | mixed gate, worth a read |
| `api/teacher/paddle-webhook.ts` | Paddle signature over the **raw** body (`:274`) | right pattern — raw body preserved, 401 on failure |
| `api/teacher/wise-webhook.ts` | RSA+SHA256 signature over the raw body (`:97`) | right pattern |
| `api/auth/possession-redeem.ts` | possession token | token strength/replay is #138's core question |
| `api/access/claim.ts` | derives identity from `supabase.auth.getUser(token)` at `:54`, not from the body | correct — the helper is inlined rather than absent, which is why the grep missed it |
| `api/board/snapshot/[code].ts` | a share `code` from the URL only | capability-URL by design; entropy and enumeration are the question |
| `api/teacher/by-code.ts` | a `code` from the URL only | same question |

Two conclusions worth carrying into the area reports:

1. **`api/access/claim.ts` is a false positive of this grep, and a good sign** — it verifies the
   token inline and explicitly derives the email from the verified token "NEVER from the body".
   That is the pattern the rest of the surface should be measured against.
2. **The two `by-code` capability endpoints are the real residue.** `board/snapshot/[code]` and
   `teacher/by-code` are unauthenticated service-role reads whose only protection is that the
   code is unguessable. That reduces to code entropy and rate limiting, which is why both are
   called out to #138 (entropy) and #141 (join/invite codes) rather than left here.

## Gaps (explicit)

- The map is built by **static grep for helper names**, so it undercounts inlined checks — as
  `access/claim.ts` proves. It is a starting map, not a verdict; the area reports supersede it
  wherever they disagree.
- **No live database, no live traffic, no staging or production request was made.** Nothing here
  is confirmed against a running system.
- Handler count covers `api/` only. Vercel rewrites and middleware, if any route around these
  files, were not audited.
