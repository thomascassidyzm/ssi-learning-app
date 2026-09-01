# Area A — did the remediation actually land, and does it hold?

Tests: `api/_security/sec0901-a-remediation-verification.security.test.ts` (24 tests, 21 passing + 3 `it.todo`).
Method: read every file named in the brief against `origin/dev`, trace each interpolated value back to its
source, and census every remaining site in the same class rather than trusting the four named examples to be
exhaustive. Source-text assertions only (house convention for this repo's security tests) — no network, no
live DB.

## Verdict table

| ID | Class | Prior audit | Verdict on today's `dev` | Pinned by |
|---|---|---|---|---|
| TENANCY-01 — `groups/[id]/invites.ts` | subtree via `groups.path` | 08-25 | **CLOSED** | `reconcile-2026-08-25-tenancy.security.test.ts`, SEC0901-A-02 |
| TENANCY-05/INPUT-05 — `orgPlatform.countSubtreeMembers` | subtree via `groups.path` | 08-25 | **CLOSED** | `reconcile-2026-08-25-tenancy.security.test.ts`, SEC0901-A-02 |
| TENANCY-04/INPUT-05 — `school/rate-compare.ts` (4 call sites) | subtree via `groups.path` | 08-25 | **CLOSED** | `reconcile-2026-08-25-tenancy.security.test.ts`, SEC0901-A-02 |
| **SEC0901-A-01** — `_utils/demoSchoolGraph.resolveGroupSubtreeIds` | subtree via `groups.path` | 08-29 named it, 08-25 remediation never touched it | **STILL LIVE** — HIGH | SEC0901-A-01 (characterization) |
| SEC25-A-01 — `codeAttemptThrottle.getClientIp` (validate/redeem/possession-redeem/try-link/by-code) | spoofable throttle key | 08-18 F5 / 08-25 A-01 | **CLOSED** | `codeAttemptThrottle.security.test.ts`, SEC0901-A-04 |
| **SEC0901-A-04b** — `_utils/mintRateLimit.ts` | spoofable throttle key, same bug, sibling file | not previously named | **STILL LIVE (backstop only)** — MEDIUM | SEC0901-A-04b (characterization) |
| INPUT-12 — `cronAuth.ts` | timing/fail-open | 08-25 | **CLOSED** | `cronAuth.test.ts`, SEC0901-A-03 |
| SEC25-X-03 — `redeem.ts` ssi_admin/god weak-format grant | privilege-from-guess | 08-25 | **CLOSED** | `redeemPrivilegeReach.security.test.ts`, SEC0901-A-07 |
| INPUT-02/06 — `postgrestFilter.ts` adoption | filter-string injection | 08-25 | **CLOSED at every real call site** (census below) | SEC0901-A-05 |
| SEC29-X-04 — anon-key fallback (round-map/cycles/bundle/infplay-cycles/audioAccess) | fail-open on missing service key | 08-29 | **PARTIALLY CLOSED — 5 → 3** | SEC0901-A-06 |

---

## 1. TENANCY-01 class: the group-subtree census

The 08-29 audit named four sites. Re-checking each against today's `dev`:

1. **`api/groups/[id]/invites.ts`** — `resolveSubtree()` now calls `fetchSubtree(supabase, groupId)`
   (`_utils/groupSubtree.ts`, a `parent_id` BFS/DFS walk). No `.path` comparison remains in the file's
   subtree logic. **CLOSED.** The three `.or()` calls the function still builds
   (`schools.or(group_id.in.(...))`, the ledger's `orClauses`, the plain-GET's
   `grants_group_id.eq.${groupId},grants_school_id.eq.${ownSchoolId}`) all interpolate either the
   already UUID-regex-validated `:id` path param (line 108: `if (!UUID_REGEX.test(groupId))`) or ids
   pulled straight back out of the DB by the same walk — none of them are attacker-shaped strings, so the
   interpolation is structurally safe even without running through `postgrestFilter.ts`.

2. **`_utils/orgPlatform.ts` `countSubtreeMembers`** — now `descendantIds((forest ?? []) as
   ParentLinked[], groupId)`. **CLOSED.**

3. **`api/school/rate-compare.ts` `subtreeClassIdsForGroup`** — the one function all four call sites
   (lines 132, 224, 280, 302) funnel through now uses `descendantIds(forest ?? (await
   loadGroupForest(svc)), groupId)`. **CLOSED**, at all four sites, by construction — there is only one
   function to fix.

4. **`_utils/demoSchoolGraph.ts` `resolveGroupSubtreeIds`** — **NOT touched by the 08-25 remediation.**
   Still:
   ```ts
   return (rows || [])
     .filter((r) => r.path === rootPath || (typeof r.path === 'string' && r.path.startsWith(`${rootPath}/`)))
     .map((r) => r.id as string)
   ```
   This is exactly the pattern TENANCY-01's own fix comment in `invites.ts` describes as the live hole:
   `compute_group_path()` slugifies the name and nothing makes a slug unique, and root-org creation is
   self-serve (any signed-in user, `confirm_duplicate: true` bypasses the warning — confirmed unchanged,
   see `reconcile-2026-08-25-tenancy.security.test.ts`'s own assertion on `groups/index.ts`).

   **This is SEC0901-A-01, and it is the headline finding of this area.**

### SEC0901-A-01 — demoSchoolGraph.resolveGroupSubtreeIds resolves subtree by slug path — HIGH

**File:line:** `api/_utils/demoSchoolGraph.ts:30`

**Reachability chain (traced, not assumed):**
- `resolveGroupSubtreeIds` → `discoverDemoOrgGraph` (same file) → the sole graph resolver imported by:
  - `api/admin/demo-schools.ts` (`action=expire`, line 170; `action=extend`'s un-ban, line 237) —
    **bans every `staffAuthUid`** the graph resolves, via `supabase.auth.admin.updateUserById(uid, {
    ban_duration: BAN_DURATION })`.
  - `_utils/demoSchoolTeardown.ts` `purgeDemoOrg` (line 57) — **hard-deletes** every row the graph
    resolves: `seed_progress`, `lego_progress`, `sessions`, `course_enrollments`, `class_sessions`,
    `user_tags`, `invite_codes`, `classes`, `learners`, `schools`, `govt_admins`, `groups`, then
    `supabase.auth.admin.deleteUser(uid)` for every staff account — a genuinely irreversible action gated
    only on `demo_orgs.status === 'expired'`.

**The attack:** a signed-in, unprivileged user self-serve-creates a root org (`groups/index.ts`, open to
any signed-in user) whose name slugifies to the same `path` as an existing demo org's root — trivial,
since `compute_group_path()` is a pure slugify with no uniqueness constraint and the collision doesn't even
require an exact name (a shared prefix collides via the `startsWith(rootPath + '/')` branch too). The
attacker does nothing further. The next time an `ssi_admin` runs *routine* demo-org cleanup — `expire` on
the unrelated demo org, which is an ordinary maintenance action that looks correct on its face — the
attacker's real org's staff get banned, and if that admin later runs `purge`, the attacker's org's groups,
schools, classes, learners and auth accounts are hard-deleted. Neither the admin's action nor the
attacker's naming choice looks wrong in isolation; the damage is entirely in the collision.

**Why it's HIGH not CRITICAL:** it requires an admin's routine, unrelated action to trigger, so it is not
directly self-triggerable by the attacker, and demo-org purge is not a frequent operation. It is not LOW
or MEDIUM because the outcome (irreversible hard-delete of arbitrary tenant data + auth-account deletion)
is worse than every other finding in this report, and the precondition (creating a same-slug root org) is
trivial and requires no special access.

**Test:** `SEC0901-A-01` in `sec0901-a-remediation-verification.security.test.ts` — characterization,
pins the still-live `.path` comparison and the unmodified consumers; `it.todo` names the fix
(`descendantIds()` over a `parent_id` forest, same as the three sibling fixes).

---

## 2. `postgrestFilter.ts` — the sanitiser and its adoption census

### Reading the sanitiser itself

`quoteFilterValue()` double-quotes a value (PostgREST's own escape), backslash-escaping `\` and `"` first.
`safeIdToken()` strips everything outside `[A-Za-z0-9_:-]` and truncates to 64 chars. `safeInteger()`
coerces to a finite integer or a caller-given fallback.

Attacked directly:
- **`,` `.` `(` `)`** — `quoteFilterValue` neutralises all four by quoting (PostgREST reads inside a
  quoted value as literal). `safeIdToken` strips all four outright. Both hold.
- **`%` `*`** — deliberately **not** touched by `quoteFilterValue` (`'%ana%'` is the worked example in its
  own test) — these are `ilike`/`like` pattern wildcards, not DSL punctuation, and letting a caller's `%`
  through only widens their own search pattern, not anyone else's query. Not a vulnerability; working as
  designed.
- **`\` and `"`** — explicitly escaped by `quoteFilterValue` (`a"b\c` → `"a\"b\\c"`, asserted in
  `postgrestFilter.test.ts`).
- **unicode** — `safeIdToken`'s charset is ASCII-only, so a unicode id gets stripped to whatever ASCII
  survives; not a vuln (fails safe — the resulting token just won't match anything), but worth flagging as
  a **functional** trap if a future course/school ever uses non-ASCII ids in the columns this guards
  (course/lego ids are ASCII by convention today — `S0001L01`-shaped). `quoteFilterValue` has no charset
  restriction and passes unicode through quoted, which is correct for its use (search terms).
- **empty string** — `quoteFilterValue('')` → `'""'`, a well-formed empty quoted value; `safeIdToken('')`→
  `''`; neither throws. Not tested for explicitly by their own suite but the logic is total over `String()`
  coercion, confirmed by reading (no unguarded property access).
- **very long strings** — `safeIdToken` truncates to 64 (tested: `'x'.repeat(200)` → length 64).
  `quoteFilterValue` has **no length cap** — a caller who feeds it an unbounded string produces an
  unbounded PostgREST URL, which is a request-size/URL-length concern (potential 414 or upstream
  rejection), not an injection one. The one caller (`admin/users.ts`, an admin-only search box) already
  bounds its input elsewhere in practice (a human typing a name); low-severity, informational only.

### Adoption census — every real `.or()`/`.filter()`/`.ilike()`/`.like()`/`.match()` call in `api/`

The great majority of the `.filter(` hits in `api/` are `Array.prototype.filter` on already-fetched rows —
not the DSL — and are irrelevant to this class. Filtering those out, the real PostgREST-query-builder call
sites that interpolate **request-derived** data are:

| Call site | Interpolated value | Guarded how | Verdict |
|---|---|---|---|
| `api/courses/[code]/cycles.ts:607` `.or(pairFilter)` | `seedNumber`/`legoIndex` | **not** via `postgrestFilter.ts`, but both are `parseInt()` output of an anchored `/^S(\d{4})L(\d{2})$/` regex capture — cannot contain DSL punctuation by construction | SAFE (structurally constrained) |
| `api/me/legos-learnt.ts:101` `.or(...)` | `cursor.seed`/`cursor.index` | same pattern — `parseLegoCursor`'s anchored `/^S(\d{4})L(\d+)/` on `last_completed_lego_id` | SAFE (structurally constrained) |
| `api/groups/[id]/invites.ts:154,324,434` `.or(...)` | group/school/class ids | not via the helper, but every id is either the UUID-regex-validated `:id` path param or an id read back from the DB via `fetchSubtree` | SAFE (structurally constrained) |
| `api/school/class-progress.ts:251,272,285` `.or(...)` | `safeRound`, `safeLegoId` | **`safeInteger`/`safeIdToken` from `postgrestFilter.ts`** | SAFE (helper) |
| `api/admin/users.ts:326` `.or(orParts.join(','))` | `search` (admin free-text) | **`quoteFilterValue` from `postgrestFilter.ts`** | SAFE (helper) |
| `api/admin/users.ts:302` `.ilike('email', ...)` | `search` | bound parameter (`.ilike()`'s own arg, not string-built) | SAFE (bound, helper unneeded) |
| `api/admin/create-govt-admin.ts:85` `.ilike('name', group.name)` | `group.name` (from an `.eq('id', groupId).single()` lookup) | bound parameter | SAFE (bound, helper unneeded) |
| `api/_utils/schoolPlatformTrial.ts:196` `.like('platform_status', 'trial%')` | literal constant, no request input | n/a | SAFE (no user input) |

**No call site was found that interpolates unconstrained request-derived text into `.or()`/`.filter()`
without either the helper or a structural (regex/UUID/bound-param) constraint.** The class is closed at
every real call site as of today's `dev`. Pinned: `SEC0901-A-05`.

---

## 3. `cronAuth.ts`

Constant-time compare via `node:crypto`'s `timingSafeEqual`, with a length-check short-circuit that still
burns a `timingSafeEqual` call on the mismatch path so the two paths cost the same. Fails closed
(`500 CRON_SECRET not configured`) on every environment with `VERCEL_ENV` or `NODE_ENV=production` set;
only a bare local run with no secret configured is let through, and that path is logged with a `warning`,
never silent. Attacked: header-casing is a non-issue (Node lowercases incoming header names); a
duplicate/array-shaped header is not a realistic concern here because Vercel's own edge sets this specific
header once. No bypass found via an alternate header — the function reads exactly one header
(`Authorization`) and does not consult `x-forwarded-*` at all.

Adoption: `vercel.json`'s two registered crons (`teacher-payouts`, `expire-demo-schools`) both call
`checkCronAuth` before any other work; no other route in `api/cron/` (there are only these two) or
elsewhere reads `CRON_SECRET`. **CLOSED, held.** Pinned: `SEC0901-A-03`.

---

## 4. `codeAttemptThrottle.ts` and the throttle-evasion class

`getClientIp` now reads `x-vercel-forwarded-for` (platform-set, overwritten not appended by the Vercel
edge — a caller cannot pre-seed it) then `req.socket.remoteAddress`, and deliberately never falls back to
`x-forwarded-for`/`x-real-ip`. Attacked: header casing (non-issue, Node lowercases), a malformed/absent
`req.headers` (guarded — `req?.headers ?? {}`), the `'unknown'` shared-bucket case (deliberately a single
strict bucket, not an exemption — read and confirmed correct). **Adoption:** `code/validate.ts`,
`code/redeem.ts`, `auth/possession-redeem.ts`, `try-link/validate.ts`, `teacher/by-code.ts` — all five
import `isIpOverLimit`/`getClientIp`/`hashIp`/`logAttempt` from the shared module and call `isIpOverLimit`
**before** any DB lookup that would make the request itself an oracle. No sixth code-guessing endpoint was
found: a scan of every file touching `invite_codes`/`possession_mint_attempts` turned up only mint-time
uniqueness checks against server-generated candidates (never attacker-supplied lookups) elsewhere. **This
class is CLOSED.** Pinned: `SEC0901-A-04`.

### SEC0901-A-04b — `_utils/mintRateLimit.ts` still hand-rolls the pre-fix bucket key — MEDIUM

**File:line:** `api/_utils/mintRateLimit.ts:82-88`

This module (join-code MINT throttling for `classes`/`schools` inserts, not the redemption/validation
oracles item 4 of the brief named) was not touched by the 08-25 pass and still reads
`x-forwarded-for`/`x-real-ip` first — the exact pattern SEC25-A-01 fixed in `codeAttemptThrottle.ts`, in a
sibling file that does not import the hardened version.

**Why MEDIUM, not HIGH:** both callers (`api/teacher/classes.ts`, `api/onboarding/provision.ts`) require
auth (`verifyAuthToken`) before calling `enforceMintRateLimit`, and the function checks the **per-user**
limit (`MINT_PER_USER_LIMIT = 20/15min`, keyed on the verified auth uid — unspoofable) before the per-IP
one. The module's own header calls per-user "the one that does the real work" and per-IP "the backstop
for an attacker cycling freshly minted accounts." Spoofing this header cannot raise the ceiling on one
account past 20/15min; it only defeats the 100/15min per-IP backstop meant to slow a multi-account farm
sharing one real IP address — real but bounded impact.

**Test:** `SEC0901-A-04b`, characterization + confirms both callers gate on auth first.

---

## 5. `code/validate.ts`, `code/redeem.ts`, `auth/possession-redeem.ts` — diff review against `6c2b867a`

- **`validate.ts`**: the throttle window widened from `PER_IP_LIMIT` (10/15min) to `REDEEM_PER_IP_LIMIT`
  (120/15min), matching `redeem.ts`/`try-link/validate.ts` — documented as a real production incident
  (a class of pupils locking out at the eleventh child on 2026-08-31) rather than a silent loosening; the
  new limit is still argued, in the same file's comments, to leave enumeration "useless as a quiet
  sweep" against the 13.8M keyspace. Codes are now redacted in logs via `redactCode()` (sha256-truncated).
  No enumeration-oracle regression found: the three-way status differentiation (`Code expired` / `Code
  fully used` / `Invalid code`) is **pre-existing** (confirmed identical at `6c2b867a`), not introduced by
  this rewrite — out of scope as "reintroduced."
- **`redeem.ts`**: adds the SEC25-X-03 `ssi_admin`/`god` weak-format refusal (see below) and a new teacher
  seat-cap check (`ADMIN-ENT-05`, `isSchoolSeatCapReached`) that fails open on a read error — consistent
  with the rest of the codebase's fail-open-on-infra-blip convention for non-security checks, and not
  security-relevant to this area's brief. Logs redacted via `redactCode()`.
- **`possession-redeem.ts`**: a clean dedup — deletes byte-identical inline copies of `hashIp`/
  `getClientIp`/`logAttempt`/the IP-count query and replaces them with imports from
  `codeAttemptThrottle.ts`. No behavioural change beyond inheriting the hardened bucket key. One
  substantive addition: `hasMxRecord(normalizedEmail, undefined, ipHash)` now buckets outbound MX lookups
  on the same platform-attested `ipHash` (INPUT-11) rather than being unbounded.

**Privilege reach (SEC25-X-03), re-verified:**
```ts
if (codeType === 'ssi_admin' || codeType === 'god') {
  if (!isStrongCodeFormat(String(inviteRow.code || ''))) {
    // same body an unknown code gets — no oracle
    res.status(200).json({ success: false, error: 'Invalid code' })
    return
  }
}
```
`isStrongCodeFormat` is shape-based (`!/^[A-Z]{3}-[0-9]{3}$/`) — an ABC-123-shaped `ssi_admin`/`god` code
cannot redeem, full stop, regardless of which minter produced it (the fix explicitly covers pre-existing
weak codes, not just new ones). `generateCodeForType()` mints 128-bit codes for the six
`PRIVILEGED_CODE_TYPES` (`ssi_admin`, `god`, `govt_admin`, `school_admin`, `school_admin_join`, `teacher`)
going forward. **Noted, not a finding:** the redeem-time refusal is deliberately scoped to only
`ssi_admin`/`god` — `govt_admin`/`school_admin`/`teacher` still redeem an ABC-123-shaped code if one
exists live, an accepted tradeoff the code's own comment argues explicitly (re-minting the top tier is a
two-minute job for a handful of staff; the lower tiers are held by live schools mid-term and refusing
their working codes would lock out real users). This is a **known, reasoned, and still-open** residual by
design, not a regression — flagged here so it isn't lost, not filed as a new finding. **CLOSED as scoped.**

---

## 6. SEC29-X-04 re-census — anon-key fallback on missing `SUPABASE_SERVICE_ROLE_KEY`

| File | 08-29 state | Today | Verdict |
|---|---|---|---|
| `api/courses/[code]/round-map.ts` | falls back to anon | **fails closed** (`if (!supabaseServiceKey)` → 500) | **CLOSED** |
| `api/_utils/audioAccess.ts` | falls back to anon | **fails closed** (`throw new Error('Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY')`) | **CLOSED** |
| `api/courses/[code]/cycles.ts` | falls back to anon | unchanged: `supabaseServiceKey \|\| (VITE_SUPABASE_ANON_KEY \|\| SUPABASE_ANON_KEY).trim()` | **STILL LIVE** |
| `api/courses/[code]/bundle.ts` | falls back to anon | unchanged, same pattern | **STILL LIVE** |
| `api/courses/[code]/infplay-cycles.ts` | falls back to anon | unchanged, same pattern | **STILL LIVE** |

A repo-wide grep for the `supabaseServiceKey || ... ANON_KEY` shape found **no site outside these three** —
no new instance. **5 → 3, real but partial progress, not closed.** Impact is unchanged from 08-29's framing:
a missing/mistyped env var on a deployed instance silently re-identifies every request on these three routes
as anon (RLS-bounded) rather than refusing to serve — availability/data-exposure risk conditioned on
misconfiguration, not a remotely-triggerable attack. Pinned: `SEC0901-A-06`.

---

## What held (not just what didn't)

- The `parent_id`-walk fix pattern (`descendantIds`/`fetchSubtree`) is applied correctly and completely at
  three of its four named sites, with no shortcuts or partial branches.
- `postgrestFilter.ts` is a well-designed, narrowly-scoped helper and its two real adopters use it
  correctly; every non-adopting call site turned out to be either bound-parameter or structurally
  constrained by an anchoring regex or a UUID check upstream of the string build — a genuinely closed
  class, not a lucky one.
- `cronAuth.ts` is a correct constant-time, fail-closed implementation, adopted at both real call sites.
- The code-guessing throttle (`codeAttemptThrottle.ts`) is adopted at all five real oracles and the bucket
  key is now platform-attested; no sixth unthrottled oracle was found.
- SEC25-X-03's privilege-reach fix is real, unconditional for the top tier, and does not leak a
  distinguishing response.

## Gaps — what I did not cover and why

- **DB-level verification** was not performed (read-only DB probes were in scope but judged unnecessary —
  every finding here traces from source to a provable code path without needing live data; the brief's
  own rules also discourage DB writes, and none of these findings need one).
- **`admin/users.ts`'s free-text `.or()` construction beyond the single `display_name` clause** — I read
  and pinned the one interpolation; I did not exhaustively re-derive every `orParts` branch the file can
  build, since all of them route through the same `quoteFilterValue` call. Marked UNVERIFIED-at-branch-
  level, though the mechanism (one shared quoting call) makes a branch-specific bypass unlikely.
- **Timing side-channel measurement was not run empirically** (no live server to benchmark against) —
  `cronAuth`'s constant-time claim is verified by *reading* that `timingSafeEqual` is used correctly on
  equal-length buffers on both paths, not by measuring actual response latency. Call this UNVERIFIED
  empirically, VERIFIED by code inspection.
- **`api/admin/codes.ts` and other admin-authenticated code lookups** were scanned for enumeration shape
  but not deeply audited — they require `verifyAuthToken`/admin auth first, which is outside this area's
  named throttle-evasion class; flagged as out-of-scope rather than cleared.
- I did not chase the pinned security-test-roster file to a final state — it is being edited concurrently
  by sibling Area workers in this shared worktree; I grew it to include this area's own new file(s) and
  the siblings' files visible on disk at commit time, per the shared instructions, but a later sibling
  commit may require one more growth pass by whoever commits last.
