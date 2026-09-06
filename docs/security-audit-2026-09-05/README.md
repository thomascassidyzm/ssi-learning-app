# Security & vulnerability audit — 2026-09-05

The **eighth** security audit of this repo in four weeks. Branch `cs/551-reset-eve-security-tests`,
cut from `origin/main` at `92954eb2`, coordinated across five areas in isolated worktrees.

**Rules this audit ran under:** findings and tests only. No production behaviour was changed, no fix
was applied, nothing was promoted, no money moved, no email or OTP was sent, no TTS was generated,
nothing was deleted, no live-DB write was made.

**Outward contact, declared in full** (three items, all read-only, none of which changed any state):
- one `pnpm audit` query to the npm advisory registry (Area X);
- two anon-key HTTPS probes against production Supabase to establish whether `staff_access_codes`
  exists live, both refused with `401 permission denied` before touching a row (Area A, SEC0905-A-03);
- one cross-repo read of the sibling dashboard's editing surface (Area D, SEC0905-D-02).

---

## 0. Why an eighth audit, and what chose the partition

Seven audits in four weeks means the honest first question is whether there was anything left to find.
There was. Between the 2026-09-01 audit's base `8755d4c8` and this audit's base:

```
345 files changed, +28,198 / −2,487   under api/ + supabase/ + packages/player-vue/src
```

That delta is the entire subject, and it is not more of the same. It contains **two whole
security-relevant subsystems no audit has ever seen**, which chose two of the five areas by themselves:

| Area | Subject | Job |
|---|---|---|
| **A** | The new passwordless sign-in / access-code auth flow — `auth/send-code.ts`, `auth/access-code-redeem.ts`, `_utils/accessCode.ts`, `_utils/signInCodeEmail.ts`, `school/staff-signin-link.ts`, a rewritten `possession-redeem.ts` | #552 |
| **B** | The new cross-origin layer — `_utils/cors.ts`, now wired into 32 handlers, changing the browser-read policy of nearly the whole API at once | #553 |
| **C** | New and rewritten data / money-adjacent endpoints — `me/threads.ts`, `courses/[code]/sectors.ts`, `_utils/rebateRegion.ts`, a rewritten `audio/batch-urls.ts` | #554 |
| **D** | The client delta and four new migrations, one of which ships `.UNAPPLIED` | #555 |
| **X** | Coordinator: audit machinery, prior-finding residuals, and the dependency supply chain — which no prior audit had ever covered | this session |

Anything unchanged since `8755d4c8` was deliberately not re-swept; seven audits already have it, and an
eighth copy is worth nothing. Where an area rediscovered a known finding it says so in one line and
cites the original ID.

---

## 1. What needs a decision

**One item.** Everything else is a fix somebody can schedule.

### SEC0905-A-02 — account pre-hijacking via shell adoption · **CRITICAL** · CONFIRMED

`api/auth/possession-redeem.ts` states its own rail in its header: *"an email that already has an
account is NEVER minted a session here — that would be account takeover."* It then carves out an
exception for an **empty shell** — never signed in, never confirmed, no role — reasoning that a shell
is "the residue of an OTP that was requested and never arrived", so there is nothing there to take.

**An attacker can manufacture that shell on demand, for any email.** The chain, verified at each link:

1. `auth/send-code.ts:20-21` states that it **creates the account**, matching `signInWithOtp`'s default
   `shouldCreateUser: true`. One call against `victim@school.uk` yields an unconfirmed, never-signed-in
   auth user. Supabase's own public `signInWithOtp` does the same thing.
2. `possession-redeem.ts:147-148` adopts exactly that state — `!last_sign_in_at &&
   !email_confirmed_at`, plus no role/invite on `learners` — and mints a **real session** by verifying
   an admin-generated magiclink server-side. Nobody is emailed.
3. The only other gate is a valid, non-exhausted invite code of type teacher / school_admin /
   school_admin_join / govt_admin / **student**. A shared class join code clears it.

The adoption check never asks **who created the shell, or when**. It cannot distinguish our own
undelivered OTP from one an attacker requested sixty seconds ago.

*Failure scenario.* Attacker holds any shared student join code and knows an invited teacher's email.
They call `send-code` for that address, then `possession-redeem`, and receive a live access token and
refresh token for it. They then complete `/api/code/redeem` themselves, so the invited teacher's
identity becomes an attacker-controlled staff account before the teacher ever signs in.

**Calibration, stated so this is not over- or under-read.** Live accounts are *genuinely* refused —
`last_sign_in_at` and `email_confirmed_at` are both checked, and that rail holds. This is account
**pre-hijacking (CWE-1188)**, not takeover of an active user. The severity comes from *who* is
exposed: the set of "invited but not yet signed in" is precisely the school-onboarding funnel.

*Fix direction (not applied):* refuse adoption of any shell the server did not create as part of this
same invite flow — bind adoption to a shell carrying the possession-flow marker, or to one created
within the same redemption. Any change here touches a live auth path and is the owner's call.

---

## 2. Everything else, by severity

| ID | Sev | Verdict | Finding |
|---|---|---|---|
| **A-02** | **CRITICAL** | CONFIRMED | Account pre-hijacking via manufacturable shell adoption (above) |
| **A-01** | HIGH | CONFIRMED | `staff-signin-link.ts` checks the caller via `schools.admin_user_id` but the target's second-school containment via `user_tags` only — the two spellings of school-adminship the repo's own `schoolStaff.ts` documents a shipped incident about (Chepstow, 2026-08-06) |
| **B-02** | HIGH | CONFIRMED (exploitability unproven) | `appOrigin.ts`'s host predicate accepts a self-service Vercel team slug; it feeds `redirectTo` on minted magic links (`create-signin-link.ts:113`) and invite URLs **emailed to real people** (`groups/[id]/invites.ts:219`) |
| **X-03** | HIGH | CONFIRMED | **Residual, day 4.** SEC0901-A-01 unfixed and byte-identical: group subtree membership decided by string prefix on a mutable slug path, from three call sites that resolve staff auth uids |
| **B-01** | MEDIUM | CONFIRMED | Same predicate in the new `cors.ts` — a "closed" allowlist a stranger can join by registering a team slug ending `-zenjin` |
| **C-01** | MEDIUM | CONFIRMED | `courses/[code]/sectors.ts` has no entitlement gate; ships anchor lego `known_text`/`target_text` past the seed-19 preview cap to anonymous callers |
| **D-01** | MEDIUM | CONFIRMED | `content_edit_events` ships `FOR SELECT TO authenticated USING (true)` — no row scoping, on a DB shared with Popty. Any signed-in learner can read the internal editorial audit log |
| **D-02** | MEDIUM | CONFIRMED | The "an edit must carry an identity" constraint is parked under a `.UNAPPLIED` filename and unenforced; residual applies to service-role writers that skip the HTTP surface |
| **A-03** | MEDIUM | CONFIRMED | `staff_access_codes` — the table both new auth endpoints rest on — has **no migration anywhere in the repo** and is absent from `schema.sql`. Exists live with correct grants; invisible to every schema-reading audit |
| **X-01** | MEDIUM | CONFIRMED | **Residual, day 4.** The nightly gate still has no `core-test` line: `@ssi/core`'s 751 tests, including `pricing/access` and `pricing/trial`, run under no gate |
| **X-02** | MEDIUM | CONFIRMED | `pnpm test:security-audit` is on no gate; two specs never run. The other 39 **are** gated — the tests-as-findings convention is sound with this one hole |
| **C-02** | LOW | CONFIRMED | `me/threads.ts` returns raw `error.message`; the SEC0901-C-03 shape recurring in a new file (also present in `sectors.ts`) |
| **X-07** | LOW | CONFIRMED | The two audio endpoints bypass the new CORS layer with `ACAO: *` (defensible), `vercel.json` doubles the header, and `batch-urls` mints 500 presigns per call with **no rate limit of any kind** |
| **X-05** | LOW | CONFIRMED | Six echarts tooltip formatters emit unescaped HTML into an `innerHTML` sink; safe only because no user-controlled name reaches them **yet** |
| **D-03** | LOW | CONFIRMED | `content_edit_identity` migration never calls `NOTIFY pgrst` — against CLAUDE.md's own RLS rule 6; the sibling migration in the same window does it correctly |
| **C-07** | LOW | PLAUSIBLE | Paddle adjustment-path region check may resolve "not excluded" instead of failing closed when `transactionId` is absent; ledger correctness, not caller-controlled |

### Confirmed SECURE — the regression guards

These matter as much as the findings: they are now pinned as tests, so they cannot silently regress.

- **SEC0901-D-01 is CLOSED** — `batch-urls.ts` now gates on real DB-resolved `resolveServerCourseAccess` and fails closed (C-04).
- **SEC0901-D-02 is CLOSED** — the shared-device paid-bundle leak is fixed on **both** the network and offline-cache paths, wiring confirmed at every real call site (D, Part 2).
- **No IDOR in `me/threads.ts`**, the largest new read surface — all scope from the verified bearer (C-03).
- **`rebateRegion.ts` is not caller-steerable** — region comes from the signed Paddle payload, never a header (C-05).
- **Access-code entropy is sound** — 39.26 bits, CSPRNG, ~1-in-28M blind guess over a code's full life, atomic single-use, injection-safe email template (A-04…07).
- **No endpoint trusts a cookie as identity**, anywhere — the argument the whole CORS posture rests on (B-04).
- **The client delta is clean** across all five priority classes — no new XSS sinks, no URL/postMessage-driven routing or authz (D, Part 2).
- **No secrets in tracked source** — every hit is a test placeholder (X-06).

### The dependency supply chain, audited for the first time (X-04)

88 advisories over 876 dependencies: **1 critical, 59 high, 24 moderate, 4 low.** The number is
misleading and the shape is the finding:

**Zero reach a learner's browser.** Every advisory resolves through `vite-plugin-pwa`, `vitest`,
`typescript-eslint`, `@vercel/node`, `vue-tsc` or `@vue/compiler-sfc` — build and test toolchain. Even
the paths that *look* like runtime (`vue`, `vue-router`, `@vueuse/core`) go via the SFC compiler.

The single shipped-runtime advisory is **echarts 5.6.0, CVE-2026-45249** (XSS, CVSS 6.1) — and it is
**not reachable**: it requires a `lines` series, and the app has none. A test now pins that
precondition and goes red the day someone adds one.

**59 high is not 59 production vulnerabilities. It is 0.** Recommendation: bump `echarts` to `^6.1.0`
when convenient; treat the rest as housekeeping cadence, not an incident.

---

## 3. The tests

**247 specs, all green, all in gated configs** (`pnpm test:api` and `pnpm --filter player-vue test`,
both on the nightly gate — verified in X-02, not assumed).

```
api/_security/sec0905-a-authflow.security.test.ts
api/_security/sec0905-b-cors-headers.security.test.ts
api/_security/sec0905-c-new-data-endpoints.security.test.ts
api/_security/sec0905-d-01-content-edit-identity-migrations.security.test.ts
api/_security/sec0905-x-coordinator.security.test.ts
api/_security/sec0905-x-audio-cors-and-volume.security.test.ts
packages/player-vue/src/security/sec0905-d-clientDelta.security.test.ts
packages/player-vue/src/security/echartsTooltipHtmlSink.security.test.ts
```

Every spec is a **characterisation test**: green today, written to go **red when the situation it pins
changes** — when a finding is fixed, or when a precondition that currently makes something safe stops
holding. That is deliberate. A permanently-red suite stops being a gate; a green suite that flips on
change is a finding that keeps working after everyone has forgotten the report.

## 4. Explicit gaps

Reported rather than papered over:

- **`pnpm run typecheck:api` was not run to completion in any area.** These worktrees symlink
  `node_modules` to the shared checkout, where `packages/core/dist` is unbuilt, so the check reports
  two pre-existing errors in `api/courses/[code]/bundle.ts` for symbols that **do** exist in core's
  source (`glossSegments`, `courseBundle.ts:118`). Every area declined to run `pnpm install`, which
  prompted to rewrite the shared tree under other live sessions. Each area typechecked its own new
  file in isolation instead. **The full gated check should be run once before any merge.**
- **Live-DB application state of the four migrations was not verified** (D). No live-DB read was made
  beyond the two refused anon probes in A.
- **B-02's exploitability is unproven.** The registrable-slug half is established from Vercel's docs;
  whether Vercel will route an attacker-chosen `Host` to this deployment was not tested, because doing
  so is outward-facing. The code pattern is wrong regardless; "exploitable today" is not established.

---

## 5. Area reports

| Area | Report | Branch |
|---|---|---|
| A — auth flow | [`area-a-authflow.md`](./area-a-authflow.md) | `cs/552-sec-a-authflow` |
| B — CORS & headers | [`area-b-cors-headers.md`](./area-b-cors-headers.md) | `cs/553-sec-b-cors-headers` |
| C — new endpoints | [`area-c-new-money-endpoints.md`](./area-c-new-money-endpoints.md) | `cs/554-sec-c-new-endpoints` |
| D — client & DB | [`area-d-client-and-db.md`](./area-d-client-and-db.md) | `cs/555-sec-d-client-db` |
| X — coordinator | [`area-x-coordinator.md`](./area-x-coordinator.md) | this branch |

All four area branches are merged into `cs/551-reset-eve-security-tests`, which carries the whole audit.
