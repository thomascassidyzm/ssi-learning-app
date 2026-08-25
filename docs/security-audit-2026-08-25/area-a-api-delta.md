# Security audit 2026-08-25 — Area A: the API delta since the 08-22 audit

Scope: everything under `api/` and `supabase/migrations/` that changed on `dev` between
`df609ad45ef1b96f0dad7a2444f8d20f89de3728` (the 2026-08-22 audit's merge-base) and this branch's
base commit. Full file list:

```
A  api/_utils/actAsGuard.advisory.security.test.ts        (pre-existing, 08-18 audit content)
A  api/_utils/codeAttemptThrottle.ts
M  api/_utils/demoNodeRefresh.ts (+.test.ts)
M  api/_utils/groupTreeAuth.ts
A  api/_utils/vadProsody.ts
A  api/_utils/vadVisibility.ts (+.test.ts, +.live.test.ts)
A  api/admin/create-govt-admin.codeEntropy.test.ts        (pre-existing, 08-18 audit content)
M  api/admin/create-govt-admin.ts
D  api/admin/onboarding-messages.ts (+.test.ts)
M  api/admin/vad-prosody.ts (+.security.test.ts)
M  api/code/redeem.ts (+.test.ts, +.throttle.test.ts)
A  api/code/validate.ipSpoof.security-audit.ts             (pre-existing, 08-18 audit content)
M  api/courses/[code]/bundle.ts (+.podVisibility.test.ts)
M  api/me/engaged-time.ts (+.test.ts)
A  api/me/legos-learnt.ts (+.test.ts)
A  api/me/phrases-spoken.ts (+.test.ts)
A  api/org/vad.ts
A  api/school/class-progress.untrustedArgs.security-audit.ts  (pre-existing, 08-18 audit content)
A  supabase/migrations/20260819_phrases_spoken_ledger.sql
```

Three files above (`actAsGuard.advisory.security.test.ts`, `create-govt-admin.codeEntropy.test.ts`,
`validate.ipSpoof.security-audit.ts`, `class-progress.untrustedArgs.security-audit.ts`) are content
from the **2026-08-18 audit** (`docs/security/api-audit-2026-08-18.md`, Findings 1–6) that landed on
`dev` after `df609ad4` was cut — they are not new work from this window and are read here only for
cross-reference, not re-filed.

The real new surface this window: the VAD hierarchy-visibility door (`api/org/vad.ts` +
`api/_utils/vadVisibility.ts` + `api/_utils/vadProsody.ts`), two new self-scoped `/api/me/*` reads,
a shared code-attempt throttle module, the `create-govt-admin` CSPRNG fix, a pod-visibility gate on
the offline course bundle, and a one-column ledger migration.

---

## Findings

### SEC25-A-01 — the new shared throttle repeats the known client-controlled bucket key (Low / confirmation)

**File:** `api/_utils/codeAttemptThrottle.ts:57-63` (`getClientIp`), consumed by
`api/code/redeem.ts:166-189` for `REDEEM_PER_IP_LIMIT` (120/15min).

**What it is:** `codeAttemptThrottle.ts` is a new module, factored out this window to give
`api/code/redeem.ts` the per-IP throttle it lacked (SEC-AUDIT-2026-08-18 Finding 2, now fixed). Its
`getClientIp()` is a byte-for-byte copy of the function already flagged as Finding 5 in the 08-18
audit (`api/code/validate.ts`, `api/auth/possession-redeem.ts`): it trusts the leftmost
`X-Forwarded-For` entry, or `X-Real-IP`, both of which the calling client sets — with no fallback to
a platform-attested source (`x-vercel-forwarded-for` on Vercel, `socket.remoteAddress`).

**The comparison the digest asked for:** this module had the exact opportunity to fix Finding 5 while
introducing the new shared throttle — it didn't, on purpose. Its own file header says so verbatim:
*"migrating them onto this module is the natural moment to fix Finding 5 ... Deliberately not done
here — this branch fixes Findings 1 and 2 only, and Finding 5 stays red on purpose."* `redeem.throttle.test.ts`
carries the same acknowledgement. So: **confirmed repeat, not a fix**, and the authors already know
it — this is not a new discovery, it's the requested verification that the new code didn't
accidentally regress further or accidentally fix it either.

**The attack, restated for the new target:** `api/code/redeem.ts` is a *higher*-value target than
`validate.ts` for this gap, because a hit here doesn't just report a code — it redeems it
(`platform_role='ssi_admin'/'tester'`, `educational_role='teacher'/'school_admin'`, or a new
`govt_admins` row). An attacker with one throwaway mailbox (self-service OTP signup is open) sends
each guess with a different declared `X-Forwarded-For`, and `REDEEM_PER_IP_LIMIT` never engages
because every guess lands in a fresh `ip_hash` bucket — regardless of whether the edge in front of
Vercel actually lets a client-set `X-Forwarded-For` through unmodified (see the "gaps" section below;
that half is a deployment fact this pass could not check).

**Test:** `api/_utils/codeAttemptThrottle.security.test.ts` (new, passes) — asserts the bucket key is
derived solely from the two client-set headers and ignores a platform-attested value on the same
request.

**Suggested fix (not applied):** the fix already scoped in the 08-18 audit's own remediation list —
extract one `getClientIp` that prefers `x-vercel-forwarded-for` / `req.socket.remoteAddress` over the
client-set headers, and point all now-four call sites (`validate.ts`, `possession-redeem.ts`,
`try-link/validate.ts`, and this module) at it. `codeAttemptThrottle.ts` being new and already shared
by one caller makes it the natural landing spot — the other three collapse onto it as a second step.

---

## Controls that hold

**`api/org/vad.ts` + `api/_utils/vadVisibility.ts` (the new VAD hierarchy door) — authz is sound.**
This is the largest new surface this window (413-line `vadVisibility.ts`, serving per-learner speech
telemetry) and it holds up under adversarial reading:
- Every scope (`groupId`/`classId`/`learnerId`) is resolved to a **real** row first, then checked
  against the caller's own resolved scope — `caller.isAdmin || caller.scope.classIds.includes(...) ||
  classIsUnderLeader(...)` for classes, `isWithinLeaderSubtree(svc, caller.ownGroupId, nodeId)` for
  nodes, `canSeeLearnerVad` (admin, self, or in `caller.scope.learnerIds`) for a single learner.
  `isWithinLeaderSubtree` explicitly returns `false` on a `null` `ownGroupId` (`orgLeader.ts:19`), so
  a teacher or student — who never gets a leader group — cannot reach node-level scope at all, matching
  the design comment.
- `resolveVadCaller` never distinguishes "unauthenticated" (401, written itself) from "authenticated
  but out of scope" (403, deferred to the scope resolver) — a student calling with no leader group is
  a legitimate caller with an empty leader scope, not a rejected one, and that's tested.
- The identity trap is handled correctly and documented in three places (file headers on `vad.ts`,
  `vadVisibility.ts`, `vadProsody.ts`): `learner_id`/`player_events.user_id` are `learners.id`
  throughout; auth uids never appear in the payload.
- `groupTreeAuth.ts`'s change is a pure refactor (`leaderGroupIdFor` extracted from
  `resolveGroupTreeCaller` so `vadVisibility.ts` can reuse the identical leader-resolution rule instead
  of hand-rolling a second copy) — confirmed byte-identical logic by diff, not just by claim.
- `fetchProsodyAggs` (`vadProsody.ts`) treats `null` learner-id list as "no filter" and an **empty
  array** as "nobody", never conflating the two — the one place a scope bug would be catastrophic
  (an empty authorized set silently reading as "everyone").
- Existing test coverage (`vadVisibility.test.ts`, 20 cases) already exercises exactly the adversarial
  cases that matter: sideways reads (sibling school, sibling class, classmate), upward reads (school
  leader → programme), a node-bridged-only school (`node_group_id` with no `group_id`, the 11/24 live
  case), and cross-org isolation between two unrelated `govt_admin` subtrees (`g-prog` vs `g-other`).
  This pass did not find a gap in that coverage worth adding to.
- `GET /api/admin/vad-prosody` correctly reuses the same predicate via `resolveVadCaller` +
  `fetchProsodyAggs` rather than forking a second implementation — the diff shows the old inline
  read+fold deleted wholesale and replaced by the shared module, `ssi_admin` behaviour unchanged
  (`scopeIds = null` only for `caller.isAdmin`).

**`api/me/legos-learnt.ts`, `api/me/phrases-spoken.ts`, `api/me/engaged-time.ts` — correctly self-scoped.**
All three resolve `learners.id` from the verified `auth.uid()` and take no learner/course id from the
request at all — there is no parameter to IDOR. `legos-learnt.ts`'s `.or()` filter interpolates
`cursor.seed`/`cursor.index`, but both are `parseInt()`-extracted from `/^S(\d{4})L(\d+)/` against a
value that itself came from the caller's **own** `course_enrollments` row (server-read, not
request body) — not attacker-reachable, unlike the `.or()` injection pattern in Finding 4
(`class-progress.ts`), which takes its interpolated value from the request body directly.

**`api/admin/create-govt-admin.ts` — Finding 1 fix verified.** The private `Math.random()`-based
`generateInviteCode()` is gone; code minting now goes through the shared `generateCode()`
(`api/_utils/codeGen.ts`), which uses `crypto.randomInt` — a real CSPRNG, uniform over the alphabet,
not the truncated-`Math.random().toString(36)` pattern. The uniqueness retry loop (10 attempts,
`SELECT ... WHERE code = candidate`) mirrors `api/invite/create.ts`; a `verifyAdmin` gate still sits
above it, unchanged by this diff.

**`supabase/migrations/20260819_phrases_spoken_ledger.sql` — clean.** New column only (no new table);
inherits the existing table's own-row RLS and table-level grants (verified by reading the migration's
own claim against the fact that no new policy/grant statement was needed for a column addition). The
new RPC `bump_phrases_spoken` is `SECURITY INVOKER` (the default, explicit in the comment), re-checks
`learners.user_id = auth.uid()::text` for the target `p_learner_id` inside the function body before
writing (so RLS is not the only thing standing between a caller and someone else's row), is revoked
from `PUBLIC` and `anon` by name (correctly anticipating this project's `ALTER DEFAULT PRIVILEGES`
auto-grant to `anon`, per the migration's own comment and consistent with the RLS doctrine in
`CLAUDE.md`), and ends with `NOTIFY pgrst, 'reload schema'`.

**`api/courses/[code]/bundle.ts` pod-visibility gate — not an authz control, but sound as a content
filter.** Adds `visibility='live'` + `pod_type='core'` + `slug IN ('pod-1','pod-0')` to the pods this
route (service-role, RLS-bypassing) hands to any authenticated learner. This closes a content-leak
(mid-recording pod content reaching learners via the offline bundle specifically, since it's the one
reader that bypasses the RLS policy landed 2026-08-23 in the dashboard repo) rather than a
tenant/authz boundary — no learner-scoping question applies to it. Reasoning and the empirical
67/68/69-pod cross-check are documented in-file and pinned by `bundle.podVisibility.test.ts`.

**`api/code/redeem.ts`'s new throttle fails closed.** A DB error during the throttle check
(`isIpOverLimit`/`logAttempt`) returns `500` before any code lookup runs, rather than allowing the
request through — the opposite of the `audio/batch-urls.ts` fail-open pattern already flagged as
INPUT-01 in a prior audit. Verified by reading the `try`/`catch` directly (`redeem.ts:166-189`); not
independently re-tested since `redeem.throttle.test.ts` already asserts the 429 path and this pass
found no reason to doubt the `catch` block's plain `return` after `res.status(500)`.

**`api/_utils/groupTreeAuth.ts`'s rewrite is behaviour-preserving.** Diffed line-by-line against the
pre-change version: `leaderGroupIdFor` is the govt_admin/school_admin resolution logic moved verbatim
out of `resolveGroupTreeCaller`, with no logic change — confirmed, not assumed.

---

## Gaps — what this pass could not check

- **No live DB or HTTP contact was made.** Every claim above is from static reading of the code,
  migration SQL, and the existing mocked-Supabase test suite (`npx vitest run -c vitest.api.config.ts`,
  120 files / 1340 tests, all green; `api/_utils/vadVisibility.live.test.ts`'s 5 live-DB cases are
  skipped by design in this environment). In particular:
  - Whether Vercel's edge actually strips or overwrites a client-set `X-Forwarded-For` before
    `codeAttemptThrottle.ts`/`validate.ts`/`possession-redeem.ts` see it (SEC25-A-01's real-world
    exploitability) was **not verified against the live deployment** — same caveat the 08-18 audit
    already logged for Finding 5, still open.
  - The migration's claim that no new grant/policy is needed (existing table-level grants + own-row
    RLS cover the new `phrases_spoken` column) was checked by reading the migration and the RLS
    doctrine in `CLAUDE.md`, not by querying `pg_policies`/`pg_class.relrowsecurity` on the live DB.
  - `learner_lego_metrics`/`player_events` RLS posture for the identity trap was taken from the
    file-header claims (themselves citing a 2026-06-12/08-12 live verification) and from
    `vadVisibility.live.test.ts`'s existence, not re-verified live in this pass.
- **`api/_utils/demoNodeRefresh.ts`'s new `learner_speaking_opportunities` write path** was read for
  correctness (derives its rollup from the same session rows it already writes, so the two can't
  diverge) but its caller's own admin/demo-scope gate was **not re-audited** here — that gate is
  unchanged by this delta and was in scope for an earlier audit pass, not this one.
  `demoNodeRefresh.test.ts` (12 cases) passes.
  This util also can only ever be invoked by whatever guards its caller, which this delta doesn't touch.
- **Resource-exhaustion, not authz:** `api/org/vad.ts`'s `metricsForLearnerIds` chunks `learnerIds`
  into batches of 150 (`schoolScope.ts:chunk`) but issues each batch's `learner_lego_metrics` query
  with no `.range()` — `MAX_METRIC_ROWS` (60,000) is only checked *between* batches, so a single large
  batch could in principle return well over the intended cap in one response. This is bounded by the
  caller's *own* legitimate scope (a govt_admin over a very large subtree could shape an
  unintentionally huge response to themselves), not an IDOR — flagged as an efficiency/DoS-adjacent
  observation, not filed as a numbered finding, and no test was written for it (simulating a
  meaningfully large mocked dataset didn't seem like it would add signal over stating the fact).
  `fetchProsodyAggs` does not have this gap — it paginates with `PAGE`/`.range()` inside each batch.
- **`api/admin/onboarding-messages.ts` was deleted** in this window (with its test). Not investigated
  further — a deletion shrinks the attack surface rather than growing it, and confirming *why* it was
  removed is a product question, not a security one, so it's out of this pass's scope.
- **Two of the "controls that hold" claims above (create-govt-admin's `verifyAdmin` gate,
  redeem.ts's fail-closed catch) were verified by direct code reading only, not by writing new tests**
  — existing coverage (`create-govt-admin.codeEntropy.test.ts`, `redeem.throttle.test.ts`) already
  exercises the paths that would catch a regression, and duplicating that coverage under a new
  filename didn't seem like it would add signal.

---

## Verification run

```
npx vitest run -c vitest.api.config.ts     # 120 passed | 1 skipped (121 files), 1340 passed | 5 skipped | 8 todo
npx tsc -p tsconfig.api.json --noEmit      # 0 errors under api/**; 2 pre-existing errors under
                                            # packages/player-vue/src/types/courseBundle.ts, both
                                            # "Cannot find module '@ssi/core'" — this worktree has no
                                            # installed node_modules / built @ssi/core (pnpm build
                                            # fails with `tsup: not found`, pre-existing environment
                                            # state, unrelated to any file in this delta)
```
