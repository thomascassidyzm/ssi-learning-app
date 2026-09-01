# Security Audit 2026-09-01 — Area B: the brand-new surface

Scope: `api/me/standing.ts`, `api/admin/test-doors.ts`, `api/_utils/schoolSeats.ts`,
`api/_utils/glossSegments.ts`, and the changed onboarding funnel
(`api/invite/create.ts`, `api/try-link/create.ts`, `api/try-link/validate.ts`,
`api/onboarding/profile.ts`, `api/onboarding/provision.ts`). None of this had been
audited before today. Method: read every target file in full, diffed the funnel
files against the pre-delta base (`6c2b867a`) to separate genuinely new code from
already-remediated code, traced client call sites for `test-doors.ts` and
`glossSegments.ts`, and wrote behavioural + source-reading tests for everything
below. Full API suite green throughout (141 files / 1574 passing after adding 45
new tests across 5 files).

## Findings

### SEC0901-B-01 — `invite/create.ts`: `grants_class_id` trust is inconsistent across `code_type` (low)
**File:** `api/invite/create.ts:284`
**Severity:** low (not a privilege-escalation path for an ordinary user)

`grants_class_id` is validated against the caller's own permission on the class
**only** inside the `teacher` and `student` branches (lines 174–223). For every
other `code_type` that reaches the insert (`ssi_admin`, `god`, `govt_admin`,
`tester`, `school_admin`), the line
```
if (grants_class_id !== undefined) insertData.grants_class_id = grants_class_id
```
takes the client value unconditionally — the same shape of bug ADMIN-ENT-09
(2026-08-25, documented in the surrounding comment) fixed for `grants_group_id`,
left open here for `grants_class_id`.

**The attack:** none of those code_types are reachable by an unprivileged caller —
minting `ssi_admin`/`god`/`tester` requires an existing `ssi_admin`; minting
`govt_admin` requires an existing `ssi_admin` or a leader acting within their own
subtree (`isWithinLeaderSubtree`, verified server-checked); minting `school_admin`
requires a `govt_admin` row or `ssi_admin`. So exploiting this requires already
holding one of those roles. What it buys an already-privileged caller: attaching an
arbitrary `grants_class_id` to (e.g.) a `tester` or `school_admin` code, which —
per the ADMIN-ENT-09 comment's own account of the READ side
(`api/code/validate.ts`) — could surface class-identifying information through the
validate response for a code type where that was never intended. Not traced further
into `api/code/validate.ts` in this pass (see Gaps).

**Reachability in production:** requires an already-compromised or malicious
privileged account — this is privilege *misuse*, not privilege *escalation*.

**Test:** `api/_security/sec0901-b-onboarding.security.test.ts` — SEC0901-B-05,
a CHARACTERIZATION test that pins the current (inconsistent) behaviour and is
designed to go red the day someone adds an explicit per-`code_type` check for
`grants_class_id`, matching `grants_group_id`'s treatment.

### SEC0901-B-02 — `api/_utils/schoolSeats.ts`: seat cap is read-then-decide, no serialization (low, PLAUSIBLE not proven)
**File:** `api/_utils/schoolSeats.ts:48-81`, called from `api/code/redeem.ts:748`
**Severity:** low — this is revenue protection, explicitly not an access-control
boundary (the file's own docstring says so), and the file's own docstring already
disclaims it is best-effort.

`isSchoolSeatCapReached` reads `countSchoolTeachers` and compares against
`teacher_seats` with no advisory lock, `SELECT ... FOR UPDATE`, or unique DB
constraint backing the comparison. Two teacher-code redemptions arriving at the
exact seat boundary within the same read window could both observe `used < seats`
and both proceed to insert, over-provisioning the school by one or more seats.

**Reachability:** plausible but **not verified live or under load** in this pass —
proving it needs a concurrency harness against `api/code/redeem.ts`'s actual insert
timing, which is out of scope for a unit-level test of this pure function. Marked
UNVERIFIED. Given the docstring already states this is revenue protection and not
an access boundary, and the practical race window is narrow (two redemptions
landing within the same read-to-write gap, at the exact moment a school is at N-1
of N seats), the realistic worst case is a school getting one extra teacher seat
briefly for free — not a data or authorization breach.

**Test:** `api/_utils/schoolSeats.security.test.ts` documents this as a known,
unproven limitation in its header rather than asserting a false positive.

### SEC0901-B-03 — `try-link/create.ts`: unredacted error messages in the admin-facing response (info)
**File:** `api/try-link/create.ts:97`, `:105`
**Severity:** info

`insertError?.message` and `error?.message` are still returned verbatim in the
JSON body on failure, the exact pattern AUTH-CORE-10 (2026-08-25) redacted in the
sibling `try-link/validate.ts` for its **anonymous** caller. `try-link/create.ts`
is admin-gated (`verifyAdmin`-equivalent check: `platform_role === 'ssi_admin' ||
educational_role === 'god'`), so the audience for this leak is already a platform
admin, not an anonymous caller — hence info, not a real finding. Noted for
consistency; not fixed (out of scope — findings-and-tests only).

## Detailed area-by-area verdicts

### 1. `api/me/standing.ts` — the percentile/cohort endpoint
**Verdict: holds.** Auth (`verifyAuthToken`) runs before any DB access, on every
path including the "no course" short-circuit. The `course` query param reaches
Supabase only as a bound `.eq('course_id', course)` filter value (confirmed by a
test that captures the actual call and asserts a SQL-metacharacter string reaches
it untouched) — there is no string-concatenation injection surface, and PostgREST
itself is not vulnerable to filter-string "injection" in the classic sense used
here (that class of bug, when it exists in this codebase, is about accidentally
matching unintended ROWS via a crafted filter VALUE, not about executing arbitrary
SQL; not applicable here since the filter is a single equality on an opaque
string).

A caller **cannot** use an arbitrary `course` param to probe a cohort they have no
entitlement to: the response only ever reflects the caller's **own** row in that
course's `course_enrollments`. A caller who has never enrolled in a given course
gets exactly the same `{standing: null, reason: 'no-position'}` whether the course
code is real-but-unstarted or entirely fictional — no oracle for course existence.

The k-anonymity gate (`MIN_COHORT = 20`) and the eligibility filters
(`is_demo`/`is_internal`/`is_class_entity`/`platform_role in (tester, ssi_admin)`)
are applied to the **same array** that produces both `cohortSize` (the count) and
the `aheadOfPct` arithmetic (the distribution) — there is no separate-count vs
separate-distribution path to drift apart, confirmed by test.

**Differencing-attack analysis:** the caller cannot choose an arbitrary peer subset
— the "quarter" cohort is derived from the caller's own `enrolled_at`, not from a
request parameter, so there is no lever to slice the cohort into different windows
on demand. The only way to move which cohort you're compared against is to
genuinely progress through the course (`highest_completed_lego_id` is a monotonic
high-water mark written by real play), which makes a binary-search-style
differencing attack against a single peer theoretically possible (advance your own
seed and watch `aheadOfPct` cross a threshold) but practically slow (requires real
course progress) and coarse (`MIN_COHORT=20` means each step moves the percentage
by ~5%, and a real course has hundreds of legos, so isolating one specific peer's
exact position this way is a very expensive attack for a very low-value payoff —
a single number 0-100 with no identity attached). Rated informational, not written
up as a numbered finding — no concrete reachable exploit constructed.

**Response leakage:** confirmed by test — the payload never contains a peer list,
another learner's id, or raw positions; only the aggregate (`aheadOfPct`,
`cohortSize`, `cohortKind`, `cohortQuarter`, `medianSeed`, own `seed`).

**Rate limiting:** **none** on this endpoint. Given the analysis above (no
caller-controlled cohort slicing, own-row-only output, coarse k=20 granularity),
the absence of a rate limit is low-risk rather than a live oracle — but it is
worth naming: nothing stops a caller from polling this endpoint continuously as
their own or others' `highest_completed_lego_id` values change over time,
building a fine-grained time series of the aggregate. Given the aggregate reveals
nothing about any individual peer beyond a 5%-granular percentage, this is not
rated as a finding, but flagged as worth a rate limit if the endpoint's cohort
logic ever grows a caller-influenced dimension.

### 2. `api/admin/test-doors.ts` + the client test-door surface
**Verdict: holds**, including the specific claim in its own docstring.

- The `'error' in auth` discriminated union is read correctly: `verifyAdmin`
returns `{userId}` on success or `{error, status, userId?}` on failure, and the
handler checks `if ('error' in auth)` before ever reading `auth.userId` — pinned
by the pre-existing `api/admin/test-doors.test.ts` and re-confirmed here.
- The 500 case (verification itself failed) is **not** collapsed into "not
allowed": both carry `allowed: false` in the body, but the **status codes**
differ (403 vs 500), which is what the client (`useTestDoorPermission.ts`)
actually branches on — confirmed by reading its source: `if (res.status === 401
|| res.status === 403) { revoke }`, with a comment explicitly stating a 5xx must
leave the grant untouched.
- `Cache-Control: no-store` is set unconditionally at the top of the handler,
before the auth check runs, so it is present on every response path including
401/403/500 — confirmed by the pre-existing test suite and re-read here.
- The method check (`GET` only, 405 otherwise) runs first, before the cache
header and before auth.

**The docstring's claim — "the effects behind this gate change nothing on the
server and write nothing about anybody's progress"** — spot-checked against 8 of
the 14 doors (source-read, not just grep, for each):
- `?wedge=1` (`utils/wedgeCheat.ts`) — pure Cache Storage (client-side) selection
  logic; no `fetch`, no Supabase call anywhere in the file.
- `?standing=NN` (`components/me/StandingPanel.vue`) — the sample branch returns
  synthetic data before any network call; confirmed no `fetch`/`supabase` inside
  `sampleFromQuery()`.
- the insight `?demo` door (`insight/data/demo.ts`) — synthetic client-side
  dashboard data; no write calls in the file.
- `?preview=N` and `?qa_mode=true` (`components/LearningPlayer.vue`) — read a URL
  param into a local ref/computed used for playback indexing and a UI flag; no
  write calls in the read/compute path.
- `?fullscript=walk|bundle` (`components/LearningPlayer.vue`) — an in-memory A/B
  lever for which script-generation path to use; no server write.
- `?fc=1` (`composables/useMetaCommentary.ts`) — forces a client-side UI trigger;
  documented as a dev cheat in a code comment, no write traced.
- the practising-mode door specifically (`useTestDoorPermission.ts`, the endpoint
  this gate was purpose-built for, per `docs/practising-mode-2026-08-31/in-app-door.md`)
  — per that doc's own account, it takes content *away* (fails the next-round
  fetch) rather than writing anything; the app's own existing failure-handling
  notices and reacts. No `.insert`/`.update`/`.upsert` in the composable itself.

**Not independently re-verified in this pass** (documented, not re-traced):
`l1`, `pod`, `podview`, `l1test` (doc states 3 of these are limited to
non-production hostnames with existing in-app buttons), `stream`, `debug` (doc
states this "runs before the app exists" — no role to check at the moment it
fires, consistent with the two genuinely-cannot-move doors named in the doc), and
the deep-link parser (`lego`, `round`, `cycle`, `cycleText` — documented as
"wired to nothing but its own tests", i.e. not live). Given the two doors the
brief called out by name (`?fc=1`, `?stream`) — `fc` was checked; `stream` was
not independently traced beyond the doc's own account (it selects a cache/audio
codepath, not a write path, per the "Cache / audio path" family grouping in
`docs/practising-mode-2026-08-31/in-app-door.md`). **UNVERIFIED for `stream`,
`l1test`, `debug`** at the source-reading depth applied to the other 8 — no
counter-evidence found, but not independently confirmed either. See Gaps.

**One structural point worth naming, not a vulnerability:** the doc
(`docs/practising-mode-2026-08-31/in-app-door.md`) is explicit that as of
2026-08-31 only the practising-mode door has actually been *moved* behind this
server gate as an in-app control — the other ten reachable-on-production doors
are still raw, ungated query strings. That is a known, stated, in-progress
migration (the doc says "twelve of fourteen are reachable [to move]... not
built"), not a contradiction of the docstring's narrower claim (which is about
what the gated *effects* do, not about how many doors are gated yet).

### 3. `api/_utils/schoolSeats.ts` — seat counting
**Verdict: holds**, with the one plausible-but-unproven race noted as
SEC0901-B-02 above.

- `schoolId` is never taken from a request body at the one production call site
  (`api/code/redeem.ts:748`) — it is resolved from `inviteRow.grants_school_id`
  (itself DB-read from the trusted `invite_codes` row by the redeemed code) or,
  failing that, from a `classes.school_id` lookup keyed on
  `inviteRow.grants_class_id` — both server-resolved values, confirmed by reading
  the surrounding code.
- The cap only applies when `provider_subscription_id` is set AND
  `platform_status` is `active`/`past_due` — the ubiquitous `teacher_seats
  DEFAULT 1` on every school row cannot lock out a second teacher on a free/trial
  school, confirmed by test.
- Fails open (returns `full: false`) on any DB error, missing row, or thrown
  exception — confirmed by test — consistent with the docstring's explicit
  "revenue protection, not an access-control boundary" framing.
- No caller-controlled way to over- or under-count: `countSchoolTeachers`
  unions `admin_user_id` + active `SCHOOL:` user_tags + class teacher rows, none
  of which are request-supplied.

### 4. `api/_utils/glossSegments.ts` — text processing on course content
**Verdict: holds.**

- **ReDoS:** the only regex in the file is `/\s+/`, used once via `.split()` on
  `target_text` and once (in the caller's word-count derivation) equivalently.
  This is a single-character-class quantifier with no nesting, no alternation,
  and no backreferences — the structural precondition for catastrophic
  backtracking (ambiguous nested/overlapping quantifiers) is absent. Proven, not
  just reasoned about: a 200,000-character pathological whitespace-heavy input
  and a 50,000-token input both complete in single-digit milliseconds (bounded at
  500ms in the test, actual runtime far lower) — see
  `api/_utils/glossSegments.security.test.ts`.
- **Unbounded input:** the function is O(n) in the number of stored segments and
  the target-text word count, with no recursion and no unbounded accumulation
  beyond building the output array — no amplification vector found.
- **XSS sink:** `authoredGlossSegments` performs no sanitization (by design — it
  is a structural validator, not a sanitizer) and a malicious `known` string
  authored into `known_gloss_segments` **would** flow through unmodified,
  confirmed by test. The question is entirely about the client render path:
  traced `packages/player-vue/src/utils/authoredGlossSegments.ts` →
  `tilesFromGlossSegments` → `components/LearningPlayer.vue`'s tile rendering,
  and grepped the whole `player-vue/src` tree for `v-html` — the only hits are
  in `components/admin/HowThisWorks.vue`, `components/admin/WalkCard.vue`, and
  two existing security test files, none of which are in the gloss-tile render
  path. Vue's default `{{ }}` interpolation (used for tile text) auto-escapes,
  so this is not currently an XSS sink. This content is course-authoring data
  (from Popty, not learner input), so the practical threat model is a
  compromised or malicious course-authoring account, not an anonymous end user —
  worth naming since the trust boundary sits further upstream than this file.

### 5. The onboarding funnel
**Verdict: holds**, and is more heavily remediated than "new" — the diff against
the pre-delta base (`6c2b867a`) shows these five files carry mostly *fixes*
(AUTH-CORE-03 IP throttling, AUTH-CORE-10 error redaction, ADMIN-ENT-09 grant
trust boundary, a benign `name_confirmed` UX field), not new unaudited logic.

- **`api/try-link/validate.ts`** is the only genuinely unauthenticated endpoint
  of the five (`Public (no auth)` per its own header comment, confirmed — no
  `verifyAuthToken` call anywhere in the file). It is per-IP rate-limited
  (`REDEEM_PER_IP_LIMIT = 120/15min`, the shared `codeAttemptThrottle` bucket,
  keyed on the platform-attested `x-vercel-forwarded-for` / socket address, not
  a caller-forgeable header) **before** the code lookup runs, logs every attempt
  including refusals, redacts DB error detail from its anonymous-facing 500, and
  mints only a time-boxed (30-day) HMAC-signed entitlement token — fails closed
  in production if the signing secret is absent. All confirmed by test.
  Token entropy: try-link codes are minted by `generateCode()` — `crypto.randomInt`
  over a 24-consonant/10-digit alphabet, ~23.7 bits (13.8M keyspace) — the same
  keyspace `codeAttemptThrottle.ts`'s own comment reasons about, and the 120/15min
  cap is sized (per that comment) to make the endpoint "useless as a quiet
  oracle" against that keyspace, not to eliminate the theoretical possibility.
- **`api/try-link/create.ts`** requires `verifyAuthToken` AND an
  `ssi_admin`/`god` role before minting — an unauthenticated caller cannot reach
  the insert. See SEC0901-B-03 for the minor unredacted-error-message note.
- **`api/invite/create.ts`** requires `verifyAuthToken` before any `code_type`
  branch executes (confirmed by index-position test: the auth check appears
  before the first branch in source order). Every role-elevating grant field is
  either server-derived (`school_admin`'s `grants_group_id`, `teacher`'s
  class-scoped `grants_school_id`) or server-validated against the caller's own
  row (`govt_admin`'s subtree check via `isWithinLeaderSubtree`) — except
  `grants_class_id` for non-teacher/student code types, see SEC0901-B-01.
  Privileged code types are force-bounded to expire and use-cap
  (`boundPrivilegedCodeLimits`), preventing an `SSI-GOD-2026`-style unlimited
  bearer token.
- **`api/onboarding/profile.ts`** requires `verifyAuthToken`; every write is
  scoped to the caller's own `learners`/`teachers`/`schools` row
  (`.eq('user_id', auth.userId)` / `.eq('admin_user_id', auth.userId)`) — no
  mass-assignment of role/entitlement/org-id fields (the only writable fields are
  `display_name` and `institution`, both length-capped, both cosmetic).
- **`api/onboarding/provision.ts`** requires `verifyAuthToken`; `course_code` and
  `track` are validated server-side against the live `courses` table
  (`new_app_status in (live, beta)`) before any grant is made — the client's
  choice of price/trial length is never trusted, it is derived server-side from
  the course's own commercial classification. Mint-rate-limited
  (`enforceMintRateLimit`). The diff against base is limited to a
  `name_confirmed` UX field with no security bearing.

## What held (summary)

- Every write path across all five areas requires either verified auth or (for
  the one anonymous endpoint) a per-IP throttle plus a time-boxed, HMAC-signed,
  fail-closed token.
- `api/me/standing.ts`'s k-anonymity floor and eligibility filters govern both
  the count and the distribution from a single filtered array — no drift
  possible between them.
- No SQL/filter-string injection surface found anywhere in this area — all
  user-supplied values reach Supabase as bound parameters.
- `api/admin/test-doors.ts`'s discriminated-union auth result is read correctly
  on every path, including the 500-vs-403 distinction the client actually relies
  on, and the no-store header is unconditional.
- `api/_utils/schoolSeats.ts` fails open and only bites genuinely seat-billed
  schools, never the universal `DEFAULT 1`.
- `api/_utils/glossSegments.ts` has no ReDoS surface (proven under load) and its
  output is not currently an XSS sink at its one client render path.
- `api/invite/create.ts`'s `grants_group_id` trust boundary (the ADMIN-ENT-09
  fix) is intact for every code_type that uses it.

## Gaps — what I did not cover, and why

- **`api/code/validate.ts`'s READ side of the `grants_class_id` question**
  (SEC0901-B-01): I did not trace whether an already-privileged caller minting a
  `tester`/`ssi_admin`/`school_admin` code with an attacker-chosen
  `grants_class_id` can actually extract class-identifying information through
  `api/code/validate.ts`, the way the ADMIN-ENT-09 comment describes for
  `grants_group_id`. Would need reading `api/code/validate.ts` in full, out of
  budget for this pass. The finding is filed as low-severity specifically
  because it requires an already-privileged caller either way.
- **The seat-cap race (SEC0901-B-02)** is reasoned from the code's structure
  (read-then-decide, no lock), not proven with a concurrency harness or a live
  DB probe. Would need a test that fires two overlapping `redeem.ts` requests
  against a school at exactly N-1/N seats and asserts on the resulting count.
- **Doors `stream`, `l1test`, `debug`, and the three hostname-limited doors
  (`l1`/`pod`/`podview`)** were not independently source-read to the same depth
  as the other 8 doors verified against the "writes nothing server-side" claim
  — I relied on `docs/practising-mode-2026-08-31/in-app-door.md`'s own account
  for these (three limited to non-prod hosts with existing buttons; `debug` runs
  pre-boot with no role to check). No counter-evidence found, but not
  independently confirmed at the source level. That doc is itself dated
  2026-08-31 and describes itself as verified live on staging, which I did not
  re-verify.
- **Live/staging verification**: nothing in this report was checked against a
  running deployment — everything is static source reading and mocked/unit
  tests, per the audit's read-only-DB, no-live-calls constraint.
- **`api/code/redeem.ts` and `api/code/validate.ts` in full** were read only for
  the specific call sites this brief's five targets touch (`isSchoolSeatCapReached`
  call site, the `grants_class_id`/`grants_group_id` question) — a full audit of
  those two files was out of scope for Area B and may already be covered by a
  prior audit's partition (TENANCY-01/ADMIN-ENT-05/09 references throughout this
  report all originate there).

## Commits

- `test(security): SEC0901-B — standing.ts privacy/inference coverage`
- `test(security): SEC0901-B — test-doors.ts guard + client-side write-claim verification`
- `test(security): SEC0901-B — schoolSeats.ts seat-cap coverage`
- `test(security): SEC0901-B — glossSegments.ts ReDoS proof + XSS-sink trace`
- `test(security): SEC0901-B — onboarding funnel auth/throttle/trust-boundary coverage`

(SHAs filled in after commit, below.)
