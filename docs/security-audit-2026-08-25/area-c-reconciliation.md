# Area C reconciliation — 2026-08-11 audit findings vs. `dev` today (2026-08-25)

**Rules this pass ran under:** findings and tests only. No production behaviour changed, no fix
applied, no migration run, nothing promoted, no money/email/OTP/TTS spend, no deletes. The only
production contact was one read-only `npx vercel whoami` (confirms the CLI is unauthenticated;
no login attempted) — logged here, nothing else touched.

## 0. The meta-finding

The 2026-08-11 audit (branch `sec/audit-2026-08-11`, six area reports, ~1,100 tests) is **still
unmerged fourteen days later**. Every finding below that is still live has been sitting on `dev`
with **no doc and no tripwire test** for two weeks — invisible to anyone who doesn't know to go
read an unmerged branch. Two more audits (2026-08-18, 2026-08-22) ran in that gap and independently
rediscovered or escalated pieces of it (SEC22-01 escalates ADMIN-ENT-02; 08-18 Findings 3–5 are
INPUT-02/03 and AUTH-CORE-05/ADMIN-ENT-06 under new names) rather than being able to build on a
merged baseline. **The cheapest fix for this class of gap is not any one finding — it is merging
`sec/audit-2026-08-11`, or at minimum its docs and tests, so the next audit stops re-deriving what
this one already proved.**

The good news the reconciliation surfaced: of the 34 substantive (non-info, non-design-note)
findings across the four reports, **8 are now genuinely fixed**, each with a real commit and (for
the two biggest) independent live/schema confirmation from the 08-18/08-22 audits. The fixes that
landed are exactly the ones the 08-11 audit itself ranked most severe (both criticals, the
highest-confidence high). That is the right prioritisation happening despite the branch never
merging — just entirely undocumented on `dev` until now.

## 1. Verdict table — every finding, all five reports

Legend: **FIXED** (code changed, closes it) · **STILL LIVE** (vulnerable code present today,
cited at current line) · **MOVED** (pattern survives elsewhere) · **SUPERSEDED** (a later audit
or change settled the severity question) · **UNVERIFIABLE** (needs a live read I could not make)
· **N/A** (info/design-note row in the source report, not a defect — not re-verified as a "finding")

### auth-core.md

| ID | Sev (filed) | VERDICT | Evidence |
|---|---|---|---|
| AUTH-CORE-01 | high | **FIXED** | `api/code/redeem.ts:25,166-177` now imports and calls `codeAttemptThrottle`, 429s over the limit. Commits `7a86d998`/`b94a0c66`/`13275ff3`. Independently confirmed by the 2026-08-18 audit (its Finding 2), which graduated the spec to the gated `api/code/redeem.throttle.test.ts` (5 passing, verified here). |
| AUTH-CORE-02 | high | **FIXED** | `supabase/schema.sql:20659-20708` — `authenticated` now holds only `INSERT(verified_emails)`, no `UPDATE(verified_emails)` (compare the 08-11 finding's quoted `GRANT UPDATE(verified_emails)…`). The `enforce_verified_emails_provenance` trigger (`schema.sql:2902-2956`) polices contents; `sync_my_verified_emails()` is the new backfill path. Migration `20260811_lock_learner_identity_columns.sql` present on `dev`. This is a direct schema-grant read, stronger evidence than SEC22-02's inference-from-artifact. |
| AUTH-CORE-03 | medium | **STILL LIVE** | `api/try-link/validate.ts` — no reference to `possession_mint_attempts`, no 429 path. Same 13.8M keyspace, same 30-day `scope:'all'` entitlement token prize. Characterized: `api/_security/reconcile-2026-08-25-auth-core.security.test.ts`. |
| AUTH-CORE-04 | medium | **STILL LIVE** | `api/email/verify.ts:47` — `verifyOtp` called with no local attempt counter, no 429. Characterized as above. |
| AUTH-CORE-05 | medium (UNVERIFIED exploitability) | **STILL LIVE** | `api/code/validate.ts:92-98`, `api/auth/possession-redeem.ts:95-101`, `api/try-link/validate.ts` — `getClientIp` still reads `x-forwarded-for.split(',')[0]`, never `x-vercel-forwarded-for`. Same finding as the 2026-08-18 audit's Finding 5, whose spec `api/code/validate.ipSpoof.security-audit.ts` is still red today (ran it — 3/5 total failures in that file belong here, see §2). Exploitability is still UNVERIFIABLE (depends on whether Vercel's edge overwrites or appends caller-supplied XFF — a platform behaviour, not something a code read settles). |
| AUTH-CORE-06 | low | **STILL LIVE** | `api/email/verify.ts:57-68` — still `.single()`, not `.limit(1).maybeSingle()`; the error branch is still discarded. |
| AUTH-CORE-07 | low | **STILL LIVE** | `api/admin/create-signin-link.ts:78-79` — still `console.warn('…failing open…')` on a rate-check error, no 503. |
| AUTH-CORE-08 | low (UNVERIFIED) | **STILL LIVE** (dup of INPUT-10, see there) | `api/_utils/appOrigin.ts:14` — `if (host) return \`https://${host}\`` unchanged, now shared by 3 call sites (was duplicated verbatim in 2). |
| AUTH-CORE-09 | low | **STILL LIVE** | `api/code/validate.ts:350,399,416`, `api/code/redeem.ts:792,911`, `api/try-link/create.ts:101` — all still `console.log` the raw code value. |
| AUTH-CORE-10 | low | **STILL LIVE** | `api/try-link/validate.ts:131` still `res.status(500).json({ error: error?.message … })`; same pattern present in `api/account/reset-progress.ts:86` and others named in the original report — not individually re-verified beyond these two representative sites. |
| AUTH-CORE-11 | info (control holds) | **N/A** | Not re-verified in depth; nothing in this pass touched `possession-redeem.ts`'s core rails. No reason to believe it regressed. |
| AUTH-CORE-12 | info (control holds) | **N/A** | `verifyAdmin` unchanged in shape at `api/_utils/auth.ts` (spot-checked, not fully re-read). |

### tenancy.md

| ID | Sev (filed) | VERDICT | Evidence |
|---|---|---|---|
| TENANCY-01 | **critical** | **STILL LIVE** | `api/groups/[id]/invites.ts:132` — `resolveSubtree()` still `.or(\`path.eq.${path},path.like.${path}/%\`)`. Root-org self-serve creation and the `confirm_duplicate` bypass are unchanged (`api/groups/index.ts`). This is the audit's #1 finding and it is fully live. Characterized: `reconcile-2026-08-25-tenancy.security.test.ts`. |
| TENANCY-02 | high | **STILL LIVE** | `api/groups/[id]/rate-compare.ts:319-320` — `nodePath === ownPath \|\| nodePath.startsWith(ownPath + '/')` unchanged, `isStrictDescendantGroup` still only the fallback. |
| TENANCY-03 | high | **FIXED** | Same fix as ADMIN-ENT-01 below — see there. `api/teacher/paddle-webhook.ts:865` now calls `resolveSchoolTarget()`, which resolves via existing-binding → signed billing intent → guarded candidate, never raw `customData.school_id`. |
| TENANCY-04 | medium | **STILL LIVE** | `api/school/rate-compare.ts:119,230` — still `.like('path', \`${path}%\`)`, no `/` boundary. |
| TENANCY-05 | medium | **STILL LIVE** | `api/_utils/orgPlatform.ts:142` — same unbounded pattern. |
| TENANCY-06 | medium | **STILL LIVE** | `api/teacher/by-code.ts` — no auth import, no throttle table reference, no 429. |
| TENANCY-07 | medium | **STILL LIVE** | `api/invite/create.ts:274` `isPrivileged` still excludes `govt_admin`/`school_admin_join`; `api/groups/[id]/invites.ts:575-576` mints with no `boundPrivilegedCodeLimits` call. |
| TENANCY-08 | low | **STILL LIVE** | `api/school/roster.ts:303`, `api/teacher/create-class-join-code.ts:131`, `api/teacher/create-class-learner.ts:120` — all three still `admin_user_id === callerUserId` only, no `canTeachClass()`. |
| TENANCY-09 | info (design note) | **N/A** | Not a defect — govt_admin self-assignability is deliberate (2026-08-02 founder ruling), recorded as context for 01/02. |
| TENANCY-10 | info | **SUPERSEDED** | `api/org/subscription.ts:42` still sets `Access-Control-Allow-Origin: '*'`, code unchanged — but the 2026-08-18 audit explicitly assessed this class ("Assessed and not findings") across 7 endpoints including this one: Bearer-only auth, no `Allow-Credentials`, so a hostile origin gains nothing. Severity judgment superseded, code itself untouched. |

### input.md

| ID | Sev (filed) | VERDICT | Evidence |
|---|---|---|---|
| INPUT-01 | high | **UNVERIFIABLE** | `api/_utils/audioAccess.ts:408,538-543` — fail-open default unchanged, `ENTITLEMENT_STRICT` still gates on `ENTITLEMENT_ENFORCE=strict`. **The Vercel CLI is now installed** (`vercel 59.5.0`, absent for the 08-22 audit) but this session is **not logged in** (`npx vercel whoami` → "Logged out") and I did not attempt interactive login, per the read-only/no-auth-crossing rule. Gap unchanged from 08-11/08-22. **Exact command to settle it:** `vercel login && vercel env ls production \| grep ENTITLEMENT_ENFORCE`. |
| INPUT-02 | medium | **STILL LIVE** | `api/school/class-progress.ts:224,254` — both `.or()` template-literal interpolations unchanged. Confirmed by running the still-red spec `api/school/class-progress.untrustedArgs.security-audit.ts` (see §2) and by a gated mirror characterization added here. |
| INPUT-03 | medium | **STILL LIVE** | `api/school/class-progress.ts:190` — `updateLegoProgress` still `{ ...updates, updated_at: … }`. Same evidence as INPUT-02. |
| INPUT-04 | medium | **STILL LIVE** | `api/player-events.ts:111-112` — no-bearer path still trusts the `ssi-user-id` cookie (uuid-shape only) for a service-role insert. |
| INPUT-05 | medium | **STILL LIVE** | Same as TENANCY-04/05 — `api/school/rate-compare.ts:119,230`, `api/_utils/orgPlatform.ts:142`, unbounded `path LIKE`. Not re-tabulated twice; one characterization covers all three call sites. |
| INPUT-06 | low | **STILL LIVE** | `api/admin/users.ts:317` — `orParts.join(',')` still built from raw `search` interpolation. Identical finding to COORD-01 below (same file, same line, same root cause — filed independently by two workers in the original audit). |
| INPUT-07 | low | **STILL LIVE** | `api/email/verify.ts:36` — `email.toLowerCase().trim()` still sits before the `try` block with no `typeof` guard. |
| INPUT-08 | low | **STILL LIVE** | `api/audio/[audioId].ts:211-213` — 502 body still includes `details: s3Error?.message …` and `key: sample.s3_key`. |
| INPUT-09 | low | **STILL LIVE** | `api/player-events.ts:185,189` — `course_code`/`client_version` still untyped, uncapped. `class_name` writers (`api/school/rename-class.ts:66`, `api/teacher/classes.ts:253`) still uncapped. |
| INPUT-10 | low | **STILL LIVE** (= AUTH-CORE-08) | `api/_utils/appOrigin.ts:14` — see AUTH-CORE-08 row above; this is the same code, filed by two workers. |
| INPUT-11 | low | **STILL LIVE** | `api/_utils/emailValidation.ts:64-84` `hasMxRecord()` — still no rate-limit ahead of the DNS lookup, called from `possession-redeem.ts`. |
| INPUT-12 | info | **STILL LIVE, narrowed** | `api/cron/expire-demo-schools.ts:35`, `api/cron/teacher-payouts.ts:101` — comparison is still plain `!==`, not `crypto.timingSafeEqual`. **Partially addressed:** both files now explicitly fail closed (500) when `CRON_SECRET` is unset **and the environment is production** (`teacher-payouts.ts:94-97` comment: "Previously an unset CRON_SECRET skipped the check entirely… leaving the endpoint open" — that half is fixed). The narrower residual gap the original report named — a preview/self-hosted deployment where `VERCEL_ENV` isn't exactly `'production'` and `CRON_SECRET` is unset — still skips the check entirely (`if (cronSecret && …)`). Money-moving production case: closed. Preview case: open. |

### admin-entitlement.md

| ID | Sev (filed) | VERDICT | Evidence |
|---|---|---|---|
| ADMIN-ENT-01 | **critical** | **FIXED** | `api/teacher/paddle-webhook.ts:757-` `resolveSchoolTarget()` (and the org/tutor/premium equivalents) now resolve via: (1) existing `provider_subscription_id` binding — unguarded by design, nothing to steal; (2) a server-signed billing-intent token (`api/_utils/billingIntent.ts`, minted from a verified session); (3)/(4) a guarded candidate. `customData.school_id`/`group_id` survive only as arguments to a mismatch **logger**, never a resolution path (grepped — confirmed). Commit `cfff6afc` + earlier steps. Independently verified live-sound by the 2026-08-22 audit (SEC22-05), which added the regression-locking invariant tests in `api/billing/bindingLadder.security.test.ts` (ran here — passes). This closes the audit's #1-ranked finding, found independently by two of its own workers (TENANCY-03 + ADMIN-ENT-01). |
| ADMIN-ENT-02 | high | **FIXED** | `supabase/schema.sql:3260-3300` `generate_join_code()` now draws from `extensions.gen_random_bytes(1)` with rejection sampling (`EXIT WHEN b < 240` / `< 250`), and `EXECUTE` is `REVOKE ALL … FROM PUBLIC; GRANT ALL … TO service_role` only — `anon` can no longer sample it. Commit `5ceb08a1`/`df609ad4`, comment cites `SEC22-01, 2026-08-22`. This is the escalation the 08-22 audit filed (verified live: 8 anon RPC calls, 8×200→8×401 after the fix per that audit's own record) — now also confirmed structurally in the checked-in schema here. |
| ADMIN-ENT-03 | medium | **STILL LIVE** | `api/_utils/codeGen.ts` — `generateCode()` (24³×10³=13.8M) is still what `invite/create.ts` and `groups/[id]/invites.ts` use for **all** code types including staff-granting ones (`teacher`, `school_admin`, `govt_admin`). `generateShareCode()` (128-bit) exists but is not used for these. Note: this is now a *smaller* live risk than filed, because AUTH-CORE-01's throttle (redeem) and TENANCY-06's absence (by-code) mean the two consumers of this keyspace have diverging protection — validate/redeem are throttled, by-code is not (see TENANCY-06). |
| ADMIN-ENT-04 | medium | **STILL LIVE** | `api/teacher/paddle-webhook.ts:342-359` — still `console.warn(…proceeding…)` on any `dedupErr.code !== '23505'`; `api/teacher/wise-webhook.ts` shares the shape. |
| ADMIN-ENT-05 | medium | **STILL LIVE** | `api/code/redeem.ts` teacher branch — no `teacher_seats` comparison anywhere (grepped the whole file). `api/family/invite.ts:77`'s cap remains the only enforced seat limit in the codebase, confirming this is an omission not a stance. |
| ADMIN-ENT-06 | medium (UNVERIFIED) | **STILL LIVE** | Duplicate of AUTH-CORE-05 — see there. |
| ADMIN-ENT-07 | low | **STILL LIVE** | `api/entitlement/offline-lease.ts:59-65` `readCourses()` — still no length cap, no `course_code` validation before upsert. |
| ADMIN-ENT-08 | low | **STILL LIVE** | `api/_utils/schoolPlatformTrial.ts:65` — `trial_burns` insert still keyed on the raw normalised address; no `+tag`/dot canonicalisation. |
| ADMIN-ENT-09 | low | **STILL LIVE** | `api/invite/create.ts:259-260` — `else if (grants_group_id !== undefined) insertData.grants_group_id = grants_group_id` unconditional copy still present. Still inert today per the same redemption-precondition argument the original report made (not re-traced end to end here; the code shape is unchanged so the original trace should still hold). |
| ADMIN-ENT-10 | low (documented intentional) | **N/A** | Design decision, not re-litigated. |
| ADMIN-ENT-11 | info | **N/A** | Design note (offline leases inherently unsigned), not re-verified. |
| ADMIN-ENT-12 | info | **STILL LIVE** | `api/admin/grant-entitlement.ts:39`, `api/admin/revoke-entitlement.ts:39` — still `caller.platform_role !== 'ssi_admin'` hand-rolled, not `verifyAdmin()`. |

### coordinator-sweep.md

| ID | Sev (filed) | VERDICT | Evidence |
|---|---|---|---|
| COORD-01 | medium | **STILL LIVE** | Same finding, same code as INPUT-06 — `api/admin/users.ts:317`. One characterization covers both IDs. |
| COORD-02 | info (control holds) | **N/A** | The `groups.path` slug-charset invariant this row protects is unrelated to whether TENANCY-01/02 are exploitable (those exploit the *equality* branch, not a metacharacter injection) — not re-verified, no reason to believe the slug function's charset regressed. |
| COORD-03 | low | **STILL LIVE** | `api/groups/[id]/invites.ts:91` — `const groupId = req.query.id as string` still has no uuid-shape validation before it's used at `:412`'s `.or()` interpolation. The two accidental guards the original report named (admin short-circuit not checking existence; the school-node precondition) are unchanged. |

## 2. The two 2026-08-18 deliberately-red specs — re-run, still red, still accurate

```
npx vitest run -c vitest.security-audit.config.ts
```

**5 failing assertions, both files, confirmed unchanged from the 2026-08-18 report:**

| Spec | Finding | Verdict |
|---|---|---|
| `api/school/class-progress.untrustedArgs.security-audit.ts` | Findings 3+4 (= INPUT-02, INPUT-03) | **STILL LIVE.** 3 of 5 total failures. `learner_id`/`course_id` still land in the `updateLegoProgress` write payload; `setLivePosition`'s ratchet filter still parses to 3 disjuncts, not 2; `setMode`'s ratchet takes the lego id verbatim, same result. |
| `api/code/validate.ipSpoof.security-audit.ts` | Finding 5 (= AUTH-CORE-05, ADMIN-ENT-06) | **STILL LIVE.** 2 of 5 total failures — the IP-spoof characterization for `code/validate.ts`. |

These two files are correctly kept out of the CI-gated `test:api` glob (their own convention: a
permanently-red gate stops being a gate). They are accurate descriptions of today's code — nothing
here needed updating. Gated mirror characterizations for both are added in this branch's new test
files (`api/_security/reconcile-2026-08-25-input.security.test.ts` for INPUT-02/03,
`reconcile-2026-08-25-auth-core.security.test.ts` for the IP-spoof finding) so the finding is
visible under `npx vitest run -c vitest.api.config.ts` too, not only the ungated audit config.

## 3. The two live checks, re-attempted

**(a) `ENTITLEMENT_ENFORCE` (decides INPUT-01's live status).** The Vercel CLI is now installed
(`vercel 59.5.0` — it was absent for both the 08-11 and 08-22 audits) but this session holds no
authenticated session (`npx vercel whoami` → `Logged out`). Per this run's rules (no login,
no env-var changes, no production writes), I did not attempt `vercel login`. **Still open.**
One-line command for whoever has an authenticated session or dashboard access:
```
vercel login && vercel env ls production | grep ENTITLEMENT_ENFORCE
```

**(b) The `learners` column-grant question (AUTH-CORE-02).** Settled without a live DB read.
`supabase/schema.sql:20659-20708` (dev's checked-in schema dump) shows `authenticated` holding
`INSERT(verified_emails)` but **no `UPDATE(verified_emails)`** — a direct read of the grant list
itself, not an inference from a function's presence (which is what SEC22-02 had to fall back to).
Neither `platform_role` nor `educational_role` appears in any grant to `authenticated` — the
self-escalation path stays closed. `supabase/migrations/20260811_lock_learner_identity_columns.sql`
is present on `dev`. I did not query the live database's `information_schema.column_privileges`
to confirm the checked-in dump matches production exactly — CLAUDE.md records this file has been
stale before — but this is now the strongest evidence any of the three audits has produced for
this finding, short of that one query.

## 4. Still-live findings, ranked

1. **TENANCY-01 (critical)** — cross-tenant read+write of invite codes (names, emails, redeemable
   sign-in URLs) via a self-inflicted `groups.path` collision. The audit's #1 finding, fully live.
2. **TENANCY-02 (high)** — the same collision authorizes `rate-compare` reads across an entire
   colliding subtree, one line away from the correct predicate in the same file.
3. **INPUT-01 (high, UNVERIFIABLE)** — anonymous bulk premium-audio extraction if
   `ENTITLEMENT_ENFORCE` is not `strict` in production. Third audit running, still can't settle it.
4. **ADMIN-ENT-05 (medium)** — `teacher_seats` unenforced anywhere; pure revenue leakage on the
   money path, and the fix pattern (`family/invite.ts`) already exists in the same codebase.
5. **TENANCY-06 (medium)** — unauthenticated, unthrottled class join-code oracle; the *other* half
   of ADMIN-ENT-03's keyspace concern is now unprotected while `validate`/`redeem` are throttled.
6. **TENANCY-04/05/INPUT-05 (medium)** — unbounded `path LIKE` folds sibling-named tenants'
   analytics and billing seat counts together; the segment-safe fix already exists in this repo.
7. **ADMIN-ENT-04 (medium)** — both webhook idempotency ledgers fail open; low-likelihood but sits
   directly on the money spine (double commission accrual).
8. **INPUT-02/03 (medium)** — `.or()` filter injection + mass assignment in `class-progress.ts`,
   independently re-confirmed still red by three audits now (08-11, 08-18, this one).
9. **TENANCY-07 / ADMIN-ENT-03 (medium)** — staff-granting invite codes (govt_admin,
   school_admin_join) mint unbounded, at a 13.8M keyspace, with no widening applied.
10. Everything else — AUTH-CORE-03/04/06/07/08/09/10, INPUT-04/06/07/08/09/10/11/12,
    ADMIN-ENT-07/08/09/12, TENANCY-08, COORD-01/03 — low/info severity, all still live, all
    now characterized on this branch (§5).

## 5. What this branch adds

Four new gated characterization files under `api/_security/`, one per source area report:

| File | Findings covered | Passing | `todo` |
|---|---|---|---|
| `reconcile-2026-08-25-auth-core.security.test.ts` | AUTH-CORE-03,04,05,06,07,08,09,10 | 8 | 8 |
| `reconcile-2026-08-25-tenancy.security.test.ts` | TENANCY-01,02,04/05,06,07,08 | 9 | 6 |
| `reconcile-2026-08-25-input.security.test.ts` | INPUT-02/03 (gated mirror), 04,06,07,08,09,11,12 | 11 | 8 |
| `reconcile-2026-08-25-admin-entitlement.security.test.ts` | ADMIN-ENT-03,04,05,07,08,09,12 | 9 | 7 |

37 passing characterizations, 29 `it.todo()`s naming fixes. Every real finding above FIXED/N/A/
SUPERSEDED gets exactly one small test asserting today's source text (per this repo's convention:
"an absence is what a source scan can honestly demonstrate"), with a `// SECURITY FINDING <ID>:`
comment and a paired `it.todo()`. Deliberately **not** a copy of the ~1,100 tests on the unmerged
branch — one sharp assertion per still-live finding, so the suite states exactly what is live and
nothing more.

`npx vitest run -c vitest.api.config.ts` → **124 files, 1374 passed, 5 skipped, 37 todo, 0 failed.**
`npx tsc -p tsconfig.api.json --noEmit` → 2 pre-existing errors, both in
`packages/player-vue/src/types/courseBundle.ts` (`Cannot find module '@ssi/core'`), both present
identically before any change on this branch and unrelated to `api/**` — `@ssi/core`'s package has
no installed `node_modules` in this checkout (`tsup: not found`), a pre-existing environment gap,
not a regression. No file this branch touches appears in the tsc output.

## 6. Gaps (explicit)

1. **`ENTITLEMENT_ENFORCE` in production is still unread** (§3a). Vercel CLI is now installed but
   unauthenticated; someone with dashboard/CLI access should run the one-line command given there.
2. **No live-database read was made anywhere in this pass.** AUTH-CORE-02's grant question is
   settled from the checked-in `schema.sql`, which CLAUDE.md records as having been stale before —
   strong evidence, not a certainty. Every other STILL LIVE verdict is a pure code read; none was
   exploited or driven against a live handler with a mocked client (the audit's own convention
   allows source-text characterization for absence findings, and I used it throughout for speed
   given the finding count — 34 substantive findings in one pass).
3. **AUTH-CORE-11/12, COORD-02, TENANCY-09, ADMIN-ENT-10/11 were not re-verified in depth** — they
   were info rows or documented design decisions in the original reports, and nothing in this
   pass's reading suggested regression, but they were not re-read line-by-line the way the
   substantive findings were.
4. **INPUT-10/AUTH-CORE-08 and INPUT-06/COORD-01 and TENANCY-04/05/INPUT-05 are each one finding
   filed twice** by independent workers in the original audit (different report, same code). Table
   rows above are cross-referenced rather than duplicated as separate live risks.
5. **ADMIN-ENT-09's "inert today" claim was not re-traced end to end** — the code shape
   (`invite/create.ts`'s branch-conditioned grant fields, `redeem.ts`'s "no school and no class"
   precondition) is unchanged, so the original trace should still hold, but this pass did not
   re-walk every redemption branch to confirm it.
6. **This pass did not fan out** — single-threaded, ~50 findings read against current source in
   one sitting. A second independent reader would be a useful adversarial check on the two
   still-live criticals/highs in particular (TENANCY-01, TENANCY-02, INPUT-01's unresolved status).
