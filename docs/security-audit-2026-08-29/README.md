# Security & vulnerability audit — 2026-08-29

Run as reset-eve spare-capacity work on branch `security/audit-2026-08-29`, cut from `dev` at `6c2b867a`.

**Rules this audit ran under:** findings and tests only. No production behaviour was changed, no fix was
applied, nothing was promoted, no money moved, no email or OTP was sent, no TTS was generated, nothing
was deleted. Production contact is itemised in §6.

---

## 0. Why a sixth audit, and what it was pointed at

This is the **sixth** security audit of this repo in eighteen days.

| Audit | Where it lives | State on `dev` today |
|---|---|---|
| 2026-08-11 | 6 area reports, ~1,100 tests | branch `sec/audit-2026-08-11`, **still unmerged**, now ~370 commits behind |
| 2026-08-18 | `docs/security/api-audit-2026-08-18.md`, 5 deliberately-red specs | on `dev`; **run by nothing** |
| 2026-08-22 | `docs/security-audit-2026-08-22/` (SEC22-01…05) | merged |
| 2026-08-25 | `docs/security-audit-2026-08-25/` (4 areas + coordinator) | merged |
| 2026-08-25 **remediation** | `security/remediation-2026-08-25` — the only *fixes* anyone wrote | **still unmerged** |
| 2026-08-29 | this | branch |

Re-running any of their partitions would have produced a sixth copy of the same findings, so the first
thing this audit did was measure the delta and let that choose the partition.

**The API surface has not changed at all since 2026-08-25.** `git diff` over `api/`, `vercel.json` and
`supabase/` between the 08-25 merge-base and today's `dev` is **empty**. The 311-file, +2,969-line delta
is entirely i18n locales, ~250 third-party country-flag SVGs, and web-font loading — client assets. So
"audit the delta" was a small job, and it went to Area C/D as one item rather than being the audit.

That left the real question, which is not *what else is wrong* but **why nothing that five audits found
has been fixed**. Four areas, chosen against what the previous five could not or did not do:

| Area | Question | Worker |
|---|---|---|
| **A** | PostgREST **filter-string injection** — never swept by anyone, and the estate's one live critical is an instance of it | #132 |
| **B** | The **privileged-gate re-sweep** the 08-25 audit listed as *unclaimed* in its own gaps | #133 |
| **C** | **Webhooks, cron, supply chain** — the money path's signature layer, never audited as its own subject | #134 |
| **D** | The **client**, second pass — sinks, tokens, and the browser-direct read surface | #135 |
| **X** | Coordinator: is the security machinery **enforced**, and is the schema record still true? | this session |

---

## 1. The finding this audit exists to deliver

Every audit since 2026-08-11 has written its findings as tests, on one convention:

> a characterization test asserts today's insecure behaviour and passes today; when someone fixes the
> finding it goes **red on purpose** — that is the signal the finding is closed.

That convention has exactly one load-bearing assumption: **something runs the tests.**

### SEC29-X-01 — nothing has run them for fifteen days · **HIGH (enforcement)** · live-verified

GitHub Actions on this repository has not executed a job since **2026-08-14**, and the last **green**
run was **2026-08-11**. Read from the live API on 2026-08-29:

```
2026-08-14  failure  dev     ← last run of any kind
2026-08-14  failure  main
2026-08-13  failure  main  ×2
2026-08-12  failure  dev   ×3
2026-08-11  failure  dev   ×5, claude/lock-learner-identity-columns ×1
2026-08-11  success  dev    ← last green
```

Every one of those thirteen failures carries the same annotation, and it is not a test failure:

> **The job was not started because recent account payments have failed or your spending limit needs
> to be increased.** Please check the 'Billing & plans' section in your settings

Both workflows are still `active`. They are simply never started. Since the last run:

| | commits with no gate executed |
|---|---|
| `dev` | **225** |
| `main` (production) | **198** |

So `pnpm test:api` — the merge gate the whole tripwire convention rests on, and which today carries
**23 security-test files and 1,499 assertions** — has not run in CI once in the eighteen days during
which five security audits were written into it. Neither has `lint`, `typecheck`, `typecheck:api`, or
`player-vue test`. And `auto-merge-claude.yml` is dead by the same cause, so `claude/**` branches no
longer auto-merge to `dev` either.

**This is a security finding, not an ops one.** Nothing about the individual findings below changes,
but the *mechanism by which any of them would ever be noticed as fixed or regressed* is switched off.
A tripwire nobody reads is not a tripwire. It also explains, without any further theory needed, the
pattern that puzzled the 2026-08-25 audit: findings do not get closed here because nothing tells
anyone when one is closed.

**Two things soften it and should be said.** The gates are green when run by hand — this audit ran
the full API suite on today's `dev` and got **129 files, 1,447 passing, 1 skipped**, with the only
failure being this audit's own new files tripping the pinned-roster test (expected; the pin has been
grown). And the failure mode is *conservative*: nothing merges automatically, so the risk is drift and
blindness rather than an unreviewed auto-merge.

**Not fixed here.** Restoring CI is a billing action on Tom's GitHub account, outward-facing and
squarely outside this run's rules. **The one thing that needs a human:** GitHub → Billing & plans.

### SEC29-X-01b — the security-audit suite was never on a gate even when CI ran

`pnpm run test:security-audit` (`vitest.security-audit.config.ts`, glob `api/**/*.security-audit.ts`)
is referenced by **no workflow**. Its five specs encode 2026-08-18's findings 3, 4 and 5. Run by hand
today, **all five still fail** — i.e. all three findings are still live, eleven days on:

```
× Finding 3: updateLegoProgress cannot repoint a row at another learner
× Finding 4: setLivePosition cannot inject a disjunct into the ratchet filter
× Finding 4 (variant): setMode ratchet takes a lego id verbatim
× Finding 5: keeps one machine in one bucket regardless of the X-Forwarded-For it sends
× Finding 5: does not let x-real-ip pick the bucket either
```

Area A independently rediscovered Finding 4 from the code side without knowing a spec existed for it
— which is the cost of an unrun test stated as cleanly as it can be stated.

### SEC29-X-02 — the committed schema dump has diverged from production · **MEDIUM**

The 2026-08-25 remediation pass applied `20260825_sec25_d02_practice_minutes_gate.sql` to the **live
database** under the canary runbook (12 assertions, 12 green, COMMITTED; transcript in that branch's
`remediation-notes.md`). It closed a real hole — an `anon` caller could read platform-wide practice
minutes with no argument and no login.

**The migration, the refreshed dump and the canary script are all stranded on the unmerged branch
`security/remediation-2026-08-25`.** So `supabase/schema.sql` on `dev` today still records

```sql
GRANT ALL ON FUNCTION public.admin_practice_minutes(p_learner_ids uuid[]) TO anon;
```

for a grant production no longer has. Every audit's DB-posture finding is read off that dump — the
2026-08-25 audit said so in its own gaps section — which makes a silent divergence a correctness
problem for the audit *method*, not a tidiness note. Here it errs safe. The next one need not.

### SEC29-X-03 — TENANCY-01 is still live, day 18 · **CRITICAL (unchanged)**

Re-verified line by line on today's `dev`. `api/groups/[id]/invites.ts:132` still resolves an org's
invite subtree by path string, `descendantIds` still appears nowhere in the file, and its sibling
`api/groups/[id]/rate-compare.ts` — which the `c2f04665` hardening pass *did* reach — still shows the
`descendantIds` import that is the known fix. Nothing has changed since 2026-08-11 except the number
of days. Area A adds the mechanism detail that changes the fix shape: see SEC29-A-04.

**Mechanically confirmed for the whole 2026-08-25 set:** all 37 characterization tests in
`api/_security/reconcile-2026-08-25-*.security.test.ts` still pass, with 29 `it.todo` fixes unwritten.
**Not one 2026-08-25 finding has been closed in the four days since.**

### SEC29-X-04 — the silent anon-key fallback is five sites, not the two filed · **LOW**

SEC25-X-02 named `courses/[code]/round-map.ts` and `_utils/audioAccess.ts`. The census is
`round-map`, `cycles`, `bundle`, `infplay-cycles` — **every endpoint that serves the paid course
product** — plus `audioAccess`, the client behind both audio endpoints. A missing or mistyped
`SUPABASE_SERVICE_ROLE_KEY` does not fail any of them; it silently swaps the identity the query runs
as. The fail-closed convention it diverges from has a quorum (`groups/tree.ts`, `access/claim.ts`, and
twenty-odd others return `500 Server misconfigured`).

Tests: `api/_security/sec29-x-enforcement.security.test.ts` — 9 passing, 4 `todo`.

---

## 2. Area A — PostgREST filter-string injection · [`area-a-filter-injection.md`](./area-a-filter-injection.md)

Never swept by any prior audit, and the estate's one live critical is an instance of the class.
`.or()`, `.filter()`, `.match()`, `.like()` and a string-built `.in()` all hand the receiving side a
**filter DSL to re-parse**, so a comma, dot, paren or `%` in an interpolated value can restructure the
predicate. `.eq()` and array-form `.in()` are safe by construction.

**The headline is a correction to the 2026-08-25 audit's own words.** It said `invites.ts` "was the
caller that `c2f04665` missed". It was **four**:

| ID | Site | Sev | Effect on a slug collision |
|---|---|---|---|
| TENANCY-01 | `api/groups/[id]/invites.ts:132` | critical | another tenant's invite codes + rotate → account takeover *(already filed)* |
| **SEC29-A-02** | `_utils/orgPlatform.countSubtreeMembers` | medium | a leader's own billing dashboard counts another tenant's people |
| **SEC29-A-06** | `api/school/rate-compare.ts` `subtreeClassIdsForGroupPath` (4 call sites) | medium | another tenant's classes pooled into comparison averages |
| **SEC29-A-03** | `_utils/demoSchoolGraph.resolveGroupSubtreeIds` | low/med | an admin's demo expire/purge sweep reaches a same-slugged sibling org |

All four are the same one-line fix already applied elsewhere: walk `parent_id` via
`groupSubtree.descendantIds`, never match `groups.path`.

**SEC29-A-04 changes the fix shape and is worth reading before anyone patches TENANCY-01.** The
`compute_group_path()` trigger slugifies to `[a-z0-9-]` plus `/`, so **no filter metacharacter can
ever reach `groups.path`** — TENANCY-01 is a *slug-collision* bug, not an escaping bug. Escaping the
interpolation would leave the vulnerability completely intact.

**Controls that hold, and are now locked:** zero dynamic `.rpc()` names, zero dynamic `.order()`
columns, zero request-built `.select()` lists, and every `.in()` on an id batch passes a real array.

**Also from A, and it belongs with SEC29-X-01b:** `api/school/class-progress.ts` builds its
progress-ratchet `.or()` from `req.body.args` cast `any[]` with no runtime validation — a comma
dissolves the forward-only ratchet. That is 2026-08-18's Finding 4, still live, and its
characterization file is named `.security-audit.ts`, so `vitest.api.config.ts`'s
`include: ['api/**/*.test.ts']` has never collected it. Renaming that one file to
`.security.test.ts` puts it on the gate.

## 3. Area B — the privileged-gate re-sweep · [`area-b-privileged-gates.md`](./area-b-privileged-gates.md)

This runs the sweep the 2026-08-25 audit listed as *unclaimed* in its own gaps. **36 privileged
endpoints**, each scored on: which guard, is the guard's result actually checked, is it uniform across
methods, does it fail closed with no service key, is it paired with `rejectIfViewAs`, does it leak
error detail.

**The headline is a clean bill, and it deserves saying plainly after five audits of bad news.** All
five hunted failure shapes came back negative:

1. No handler gates one method and leaves a weaker one open. Where methods differ, the asymmetry is
   documented and always *stricter* on the write.
2. One fail-open-on-error, bounded and deliberate (SEC29-B-01, low).
3. **`verifyAdmin` returns `{error, status, userId}` on a 403 — it carries a userId on the reject
   path, which invites `if (result.userId)` as an admin test. All 26 call sites discriminate on
   `'error' in result`.** The single site that reads `.userId` off a rejected result does so inside
   the correct branch, on purpose, and is documented. This was the shape most likely to be a silent
   critical; it is not there, and it is now locked by test.
4. All three known `ssi_admin` support bypasses are paired with `rejectIfViewAs`. No unpaired ones
   elsewhere.
5. No admin identity taken from a body field, query param or header — every privileged write stamps
   its actor from the verified token.

Two low residues: **SEC29-B-01** (`admin/create-signin-link.ts`'s per-admin throttle fails open on a
DB error — behind an already-verified admin, so it costs an attacker an admin account first) and
**SEC29-B-02** (four more handlers echoing raw DB error text: `admin/users.ts`,
`admin/update-user-role.ts`, `entitlement/grant.ts`, `groups/index.ts` — the SEC22-03 family, now on
its fourth sighting, which is the tell that nothing mechanical carries this convention).

## 4. Area C — the money path's front door · [`area-c-webhooks-cron-supplychain.md`](./area-c-webhooks-cron-supplychain.md)

SEC22-05 audited the Paddle webhook's tenant-binding ladder — everything that happens *after* the
event is trusted. Nobody had audited **why it is trusted**.

### SEC29-C-01 — the Paddle webhook never checks that its signing secret is set · **MEDIUM** · new

```ts
export const webhookSecret = (process.env.PADDLE_WEBHOOK_SECRET || '').trim()
```

No caller checks `if (!webhookSecret)`. Node's `crypto.createHmac('sha256', '')` computes an HMAC with
an empty key without complaint — it does not throw and does not refuse. So if that variable is ever
unset or empty in a deployed environment, `unmarshal(rawBody, '', signature)` accepts **any** request
whose `Paddle-Signature` is `ts=<t>;h1=<HMAC-SHA256(\`${t}:${body}\`, '')>` — a value anyone can
compute, because the secret is then a public constant. Verified against the real
`@paddle/paddle-node-sdk`, not a mock: with `secret=''` a hand-crafted signature is accepted and the
attacker's event is returned; with a real secret the same forgery is rejected.

**What it would cost.** SEC22-05's binding ladder still decides *which* tenant a platform-kind event
can write to, so this is not an unbounded write. But for `learner_premium` and `student_via_teacher`
a forged event mints a paid entitlement with no money moved, and a forged `transaction.paid` accrues
fabricated teacher commission.

**Why medium, stated honestly:** exploitability is entirely conditional on the variable actually being
unset in a deployed environment, and this audit had no way to check (no Vercel login, no live env
read — see §5). It is a **missing fail-safe**, not a confirmed live hole. It is also exactly the bug
this repo has already found and fixed twice: `api/cron/teacher-payouts.ts` carries a comment saying
*"Previously an unset CRON_SECRET skipped the check entirely… leaving the endpoint open"*, and
`try-link/validate.ts` got the same guard for `ENTITLEMENT_TOKEN_SECRET`. **Wise's verifier fails
closed on a missing key. Paddle's is the one that never got the guard.**

**Everything else in area C holds**, and the list is worth having on the record: Paddle's ordering is
right (`bodyParser: false`, raw body via the stream, verify → idempotency insert → business logic);
Wise's RSA verification fails closed on both a missing header and a missing key; both cron endpoints
refuse in production without `CRON_SECRET` and reject a wrong bearer; `vercel.json`'s two cron entries
match their two handlers exactly, no orphan on either side; all **267** new flag SVGs are free of
`<script>`, `onload=`, `onerror=`, `<foreignObject>` and external `href`; and `loadWebFonts.ts` is
**not** a second SEC25-B-01 — fonts were self-hosted by ruling A-265 on 2026-08-26.

**Supply chain:** 83 `pnpm audit` advisories, **1 critical + 54 high — and zero of them reachable from
a live request.** Every HIGH/CRITICAL chain roots in `@vercel/node`'s build-time bundler, `vitest`/
`vite`, `eslint`, `vite-plugin-pwa` or `@vue/test-utils`; `sharp` (4 CVEs) is a devDependency whose
only import in the repo is one local Playwright probe. The finding worth acting on is the other one:
`auto-merge-claude.yml` holds **workflow-level `contents: write`** and pushes to `dev`, while running
`pnpm/action-setup@v4` and `actions/setup-node@v4` on **floating major tags** — mutable by their
maintainers, inside a job holding a write-scoped token. `verify.yml` runs the same actions with
`contents: read` and is low risk. No `pull_request_target` or `workflow_run` anywhere.

Two dead CSP allowances to prune next time `vercel.json` is touched: `fonts.googleapis.com` and
`fonts.gstatic.com` are still allowlisted and nothing fetches from either any more.

## 5. Area D — the client, second pass · [`area-d-client.md`](./area-d-client.md)

The least-audited surface, given a full sweep rather than a diff review.

### SEC29-D-01 — `admin_practice_minutes_by_course` has no internal role gate · **MEDIUM (residual)**

A `SECURITY DEFINER` RPC granted to `authenticated` — every signed-in learner — whose body performs
**no caller check at all**. Every sibling in the `analytics_*` family opens with
`IF NOT is_god_user() THEN RAISE EXCEPTION`; area D checked all twelve of them against `schema.sql`
and every one gates. This function was written and re-shipped three times (2026-06-19, 2026-07-17 ×2)
without ever picking one up. That comparison is the new evidence, and it is the strongest argument
for the fix: this is not a design choice, it is one function that fell out of a family.

**This finding must be read together with SEC29-X-02, and the interaction is instructive.** Area D
read the migrations as committed on `dev`, where there is no gate at all — and so first reported the
no-argument, platform-wide call as live. **It is not: the 2026-08-25 remediation closed exactly that
path in production**, canary-verified, and the reason area D could not see that is that the migration
is stranded on an unmerged branch. **This audit is the first instance of the hazard SEC29-X-02
predicts, and it caught itself.**

**What genuinely remains live**, and is the finding as it stands: the `authenticated` grant, the
absent internal gate for any *non-null* argument, and therefore the ability of any signed-in account
to read a specific learner's per-course practice minutes given that learner's UUID. The 2026-08-25
remediation notes name this residual themselves — *"a signed-in user can still call `_by_course` with
a learner UUID they already know"* — and area D adds the sibling-gate comparison and the four browser
call sites that make the fix shape concrete.

### SEC29-D-02 — sign-out leaves paid audio playable in IndexedDB · **LOW** · new

`useAuth.signOut()` clears auth storage, the role cache and the subscription/entitlement caches, but
never touches `ssi-audio-cache-v2`. `resolveCachedPlaybackUrl` → `AudioCache.getWavBlobUrl` serves
bytes keyed only by content id, with no entitlement re-check. So a paying learner's downloaded
premium clips stay playable, from cache, to whoever uses that browser profile next. A paywall/
content leak on a shared device — not an account or credential compromise.

### SEC29-D-03 — the RLS-tightening precondition has not moved · **the number to carry**

CLAUDE.md's condition #2 for tightening org-table RLS is "client org-table reads repointed to server
endpoints on the `resolveVisibleScope` pattern". Measured exhaustively for the first time:

| `schools` | `classes` | `groups` | `govt_admins` | `invite_codes` | `entitlement_grants` | `user_tags` | **total** |
|---|---|---|---|---|---|---|---|
| 12 | 13 | 5 | 1 | 0 | 2 | 6 | **39** |

Plus 15 direct `learners` reads. Two of the `entitlement_grants` reads are **dead code**
(`useCourseAccess.ts` has no live call site and its successor's header calls it "the SUPERSEDED
per-course-grant model") — deleting that file is a free reduction to 37.

These reads compute `allowedSchoolIds`/`allowedClassIds` from `useUserRole.ts`, which the file's own
comment describes as a cache — *"DB is source of truth, localStorage is a fast cache"* — i.e. it is
**spoofable client-side by construction**. That is fine *only if* the six tables' RLS predicates
genuinely enforce the caller's hierarchy rather than own-row. CLAUDE.md records them as RLS-on with
real policies (verified live 2026-08-06); **verifying the predicates needs a live DB read this audit
did not have.** Area D calls that the single biggest open question it raises, and this report agrees.

**Controls that hold, now locked by test:** only two `v-html` sinks in the entire client, both
escaping `& < >` before a bounded `**bold**` rewrite and both sourced from compiled repo-authored
`pack.json` — never a DB row, never a route param. **Zero** `innerHTML`, `document.write`, `eval`,
`new Function`, string-`setTimeout`, dynamic `<script>` injection, or `message` listeners anywhere.
All 12 `window.location`/`window.open` sites take a literal, a same-origin URL mutation, or a value
from this app's own API; both `window.open`s pass `noopener,noreferrer`. All 22 `VITE_*` vars are
legitimately public (Supabase anon key, Paddle client token and price ids, a public CDN bucket, two
feature flags), and the only `service_role`/`RESEND_API_KEY` mentions in client source are comments
explaining why a path must stay server-side. The service worker's `runtimeCaching` covers navigations
and `/fonts/*` only — **no `/api/*` pattern**, so no per-user response can be replayed cross-user
from the shared CacheStorage.

---

## 6. Findings — ranked

| # | ID | Sev | Status | Where | Costs an attacker |
|---|---|---|---|---|---|
| 1 | **SEC29-X-01** | **high** *(enforcement)* | **new, live-verified** | GitHub Actions — no job executed since 2026-08-14 | nothing; it is the loss of the mechanism that would notice everything below |
| 2 | TENANCY-01 | **critical** | still live, **day 18** | `api/groups/[id]/invites.ts:132` | a signed-in account and a duplicate org name → another tenant's personal invite links → named-account takeover |
| 3 | **SEC29-C-01** | medium | **new** | `api/_utils/paddle.ts` — no `PADDLE_WEBHOOK_SECRET` presence check | *if the var is unset in a deployed env:* nothing at all — the signing key is then the empty string |
| 4 | **SEC29-A-02 / A-06** | medium | **new** | `_utils/orgPlatform.ts`, `api/school/rate-compare.ts` | the same slug collision as #2 → cross-tenant headcounts and pooled comparison averages |
| 5 | **SEC29-X-02** | medium | **new** | `supabase/schema.sql` on `dev` vs production | nothing; it makes every future audit's DB reading unreliable — and misled this one (§5) |
| 6 | SEC29-D-01 | medium *(residual)* | still live | `admin_practice_minutes_by_course` — `authenticated` grant, no internal gate | one free account and a learner UUID |
| 7 | SEC25-X-03 / AUTH-CORE-01 | high | still live | `api/code/redeem.ts` + `_utils/codeAttemptThrottle.ts` | patience, unmetered, against the `ssi_admin` grant path |
| 8 | **SEC29-A-03** | low/med | **new** | `_utils/demoSchoolGraph.ts` | admin-only; collateral damage in demo expire/purge sweeps |
| 9 | **SEC29-X-01b** | medium *(enforcement)* | **new** | `test:security-audit` on no gate; its 5 specs all still fail | 2026-08-18 findings 3/4/5 live, 11 days, unwatched |
| 10 | **SEC29-X-04** | low | **new** *(widens SEC25-X-02)* | 5 sites incl. all four paid-course endpoints | a missing env var silently swaps the query identity |
| 11 | **SEC29-D-02** | low | **new** | `useAuth.signOut()` + `AudioCache` | shared device; paid audio survives sign-out |
| 12 | **SEC29-B-01 / B-02** | low | **new** | `admin/create-signin-link.ts`; 4 handlers echoing DB error text | an admin account first |
| 13 | supply chain | low | **new** | `auto-merge-claude.yml`: `contents: write` + floating action tags | compromising a third-party action release |
| — | TENANCY-02/04/05/06/07, AUTH-CORE-03/04, SEC25-D-01/03, SEC22-03, SEC25-X-01/02, SEC25-B-01 | var. | **all still live** | see `area-c-reconciliation.md` (2026-08-25) | — |

**Mechanically established, and it is the shape of the whole problem: not one 2026-08-25 finding has
been closed.** All 37 reconciliation characterizations still pass; 29 `it.todo` fixes remain unwritten.

## 7. What HOLDS — the other half of the audit

Five audits of bad news makes it easy to lose the shape of what is actually well built. On today's
`dev`, verified by test:

- **Every privileged gate in the 36-endpoint sweep binds.** No method asymmetry, no `verifyAdmin`
  403-shape misread across 26 call sites, every `ssi_admin` support bypass paired with
  `rejectIfViewAs`, no admin identity taken from client input.
- **No PostgREST metacharacter injection is reachable anywhere**, no dynamic RPC name, no dynamic
  `order()` column, no request-built `select()` list.
- **Wise's webhook fails closed**; Paddle's ordering, raw-body handling and idempotency insert are
  right; both cron endpoints refuse in production without their secret.
- **The client has two `v-html` sinks, both safe, and no other HTML/script sink at all.** No secret
  in the bundle. The service worker never caches `/api/*`.
- **Zero of 55 HIGH/CRITICAL dependency advisories is reachable from a live request.**
- The API suite runs **1,474 passing / 53 todo** across 133 files, and `typecheck:api` is clean.

## 8. Gaps — explicit

- **`ENTITLEMENT_ENFORCE` is unsettled for the fourth audit running.** `vercel` CLI is installed
  (59.10.0) and this session is **logged out**; no login was attempted — crossing an auth boundary is
  outside these rules. **One command settles it:** `vercel env ls production | grep ENTITLEMENT_ENFORCE`.
- **SEC29-C-01's real-world exposure is unverified** for the same reason: whether
  `PADDLE_WEBHOOK_SECRET` is actually set in a deployed environment could not be checked. The finding
  is a missing fail-safe, verified against the real SDK — not a confirmed live hole.
- **No live database read and no live HTTP probe.** Every schema claim rests on `supabase/schema.sql`,
  which SEC29-X-02 now proves is stale. The RLS predicates behind area D's 39 browser reads are the
  single biggest question this audit raises and cannot close.
- **The dashboard/Popty repo was not audited** (SEC25-D-03's other side; already handed over with
  call-site evidence by the 08-25 remediation).
- **`.security-audit.ts` specs' subjects were not independently re-derived** beyond confirming all
  five still fail and that area A rediscovered Finding 4 from the code side.
- **24 moderate + 4 low dependency advisories** were not individually triaged for reachability.
- **SEC29-A-06 is verified by code reading, not by a hermetic handler test** — its handler's upstream
  dependencies made a faithful test mostly plumbing; the identical bug shape is test-characterized in
  `orgPlatform.ts` and `demoSchoolGraph.ts`.

## 9. Production contact

**One request, read-only, unauthenticated:** `npx vercel whoami`, which returned "Logged out".
Plus **read-only GitHub API reads** via `gh run list` / `gh run view` / `gh workflow list` — the CI
evidence for SEC29-X-01. Nothing else. No database query, no HTTP request to the app, no write, no
mint, no email, no OTP, no spend, no deploy, no promotion.

## 10. Files

| File | Contents |
|---|---|
| `README.md` (this file) | Synthesis, coordinator findings, ranked table, gaps |
| `area-a-filter-injection.md` | The interpolation census and the four path-collision callers |
| `area-b-privileged-gates.md` | The 36-endpoint gate sweep table |
| `area-c-webhooks-cron-supplychain.md` | Webhook signature layer, cron auth, CI + dependency supply chain |
| `area-d-client.md` | Sink table, storage/`VITE_*` inventory, the 39 browser org-reads, SW/cache |
| `api/_security/sec29-x-enforcement.security.test.ts` | 9 passing, 4 todo |
| `api/_security/sec29-a-filter-injection.security.test.ts` | 7 passing, 2 todo |
| `api/_security/sec29-b-privileged-gates.security.test.ts` | 39 passing, 2 todo |
| `api/_security/sec29-c-webhooks-cron.security.test.ts` | 12 passing, 1 todo |
| `packages/player-vue/src/__security__/sec29-d-client.security.test.ts` | 26 passing, 2 todo |

**Test convention** (inherited unchanged from 2026-08-11/18/22/25): a control that holds is an
ordinary passing test; a real vulnerability is a **characterization** test that asserts today's
insecure behaviour, carries a `// SECURITY FINDING <ID>:` comment and a paired `it.todo()` naming the
secure behaviour, and goes **red on purpose** when someone fixes it.

---

## 11. The two things that need a human

Everything above is a finding or a test. These are not.

**1. Restore GitHub Actions billing.** This is the whole audit in one line. Five audits have written
tripwires into a gate that has not fired since 2026-08-14, and 225 commits have landed on `dev` and
198 on `main` with no lint, no typecheck and no test run. Until this is fixed, every finding in every
one of these reports is a document rather than a control, and no fix anyone applies will ever announce
itself. GitHub → Billing & plans.

**2. Merge the security branches, oldest first.** The 2026-08-25 audit recommended this and said
plainly that its own output would decay the same way if it were not done. It was right, and the decay
is now measurable in three places: 29 of the 2026-08-11 audit's 33 tripwire tests are still stranded
on a branch ~370 commits behind; the 2026-08-25 **remediation** — the only *fixes* anyone has written
— is unmerged, so a hole closed in production is still recorded as open in the repo; and this audit's
area D was misled by exactly that divergence before the coordinator caught it.

The order that unwinds it cheapest: `security/remediation-2026-08-25` first (it is small, it is
already live in the database, and merging it stops the schema dump lying), then this branch, then a
decision on what is still salvageable from `sec/audit-2026-08-11`.

Both are outward-facing or promotion-shaped, and therefore Tom's — which is why they are here rather
than done.
