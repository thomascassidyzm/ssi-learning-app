# Security audit 2026-09-05 — Area C: new/rewritten data & money-adjacent endpoints

Branch `cs/554-sec-c-new-endpoints`, worktree-isolated. Findings and tests only — no
production behaviour changed. Delta established against `8755d4c8` (the 2026-09-01
audit's base) vs `origin/main`:

```
git diff 8755d4c8 origin/main -- <area files>
git log --oneline 8755d4c8..origin/main -- <area files>
```

This is the **eighth** security audit of this repo. Prior findings referenced here are
not refiled — see `docs/security-audit-2026-09-01/README.md` for the running ledger
(SEC0901-*, AUTH-CORE-*, INPUT-*).

**Notable prior work already landed in this delta, before I started:** commit
`e334c217` ("batch-urls gates on real entitlement, not just a valid login
(SEC0901-D-01)") and `f1772cca` ("no tutor rebate on India sales") are both already on
`origin/main`. So two of my six subject files (`batch-urls.ts`, `rebateRegion.ts` +
its `paddle-webhook.ts` wiring) arrived at this audit **already fixed / already new
and correct**. I verified both from source rather than taking the commit message on
trust — see §3 and §4.

---

## 1. `api/me/threads.ts` (NEW, 277 lines)

**Purpose:** per-learner scheduling state for "sector threads" (course walks alongside
the core course). Service-role table (`enrollment_threads`), browser never touches it
directly — this endpoint is the only door.

### SEC0905-C-02 — raw DB error detail returned to the caller · **LOW** · CONFIRMED

**File/line:** `api/me/threads.ts:121,156,178,199,221,275` — every failure path does
`res.status(500).json({ error: error.message })` (or `error?.message` in the
catch-all), passing the literal PostgREST/Postgres error string straight to the
response body. Same shape as SEC0901-C-03 (`groups/{table,tree,[id]/home}`), but this
is a brand-new file that repeats the pattern rather than one of the three already
pinned there.

**Failure scenario:** an authenticated learner whose request happens to trip a DB
constraint or transient PostgREST error (e.g. a malformed `course_sectors` row, a
connection blip) receives the raw error text in the response body. Low severity
because the caller is already the authenticated learner reading/writing their own
row — no cross-tenant detail is exposed — but it is still infra/schema detail an
attacker probing for schema shape shouldn't get for free, and it is inconsistent with
`player-events.ts`'s posture two files over (`console.warn` server-side, generic
`'insert failed'` to the caller).

**Fix I would apply:** log `error` server-side (already done via `console.error`) and
return a generic `{ error: 'Read failed' }` / `{ error: 'Write failed' }`, mirroring
`player-events.ts`'s pattern.

**Test:** `sec0905-c-new-data-endpoints.security.test.ts`, describe block
"SEC0905-C-02".

### SEC0905-C-03 — identity resolution — CONFIRMED SECURE

**File/line:** `api/me/threads.ts:249-266` (bearer verified, `learnerId` resolved via
`resolveLearnerId(supabase, authResult.userId)`), then every query in `handleGet`
(:92-126) and `handlePost` (:128-230) is scoped through `learnerId` →
`findEnrollmentId` → `enrollment_threads.eq('enrollment_id', enrollmentId)`. No
`req.query`/`req.body` field is ever used as a learner, enrolment, or thread id — the
only client-controlled strings that reach a query are `course` and `sectorCourseCode`,
both compared via `.eq()` against rows already scoped to the caller's own
`enrollmentId`, and `sectorCourseCode` is additionally checked against the
`course_sectors` registry before a thread can be minted for it (:145-162) — a client
cannot mint a thread for an unregistered segment. **No IDOR**: changing `course` in
the query string only ever changes *which of the caller's own enrolments* is read;
there is no parameter that names another learner. No PostgREST `.or()`/`.filter()`
string-building anywhere in the file — every filter is a parameterised `.eq()`, so
`postgrestFilter.ts` has nothing to do here (it exists for string-interpolated
filters, which this file has none of).

**Test:** `sec0905-c-new-data-endpoints.security.test.ts`, describe block
"SEC0905-C-03".

---

## 2. `api/courses/[code]/sectors.ts` (NEW, 157 lines)

**Purpose:** public registry lookup — "which sector courses exist for this base
course, and when does each open" (an "anchor" lego rendered in both languages, no
numbers, no "seed"/"lego" words, per the position-is-content law).

### SEC0905-C-01 — no entitlement gate at all; ships real past-preview lego content to anonymous callers · **MEDIUM** · CONFIRMED

**File/line:** `api/courses/[code]/sectors.ts` (whole file) — no `verifyAuthToken`, no
`resolveServerCourseAccess`, no `pricing_tier`/`is_community` check anywhere. Compare
with its siblings under the same directory: `bundle.ts:652` and `cycles.ts:468` both
call `resolveServerCourseAccess` and slice content to `previewMaxSeed` (19, Yellow
Belt — `api/_utils/audioAccess.ts:422`) for anyone who isn't entitled.
`sectors.ts:142-148` builds `SectorOption[]` — including `anchor: { legoId, known,
target }`, i.e. the **actual known-language and target-language sentence text** of a
real `course_legos` row — for **every** registered sector of **any** course, live or
(with `?include=draft`) draft, regardless of the caller's auth state or the course's
`pricing_tier`.

**This is exactly the pattern the audit brief asked to look for**: a new course
endpoint that skips the gate its siblings apply.

**Concrete failure scenario:** an anonymous, unauthenticated caller —

```
GET /api/courses/spa_for_eng/sectors
```

— receives, for any registered sector, that sector's anchor lego's `known_text` and
`target_text` verbatim, with no Authorization header, no cookie, no entitlement token
of any kind. I confirmed with a source-level test (mirroring the existing
`sectors.test.ts` fixture) that an anchor at `core_anchor_lego_id: 'S0042L03'` — seed
42, more than double `PREMIUM_PREVIEW_MAX_SEED` (19) — resolves and ships in full to a
request carrying zero credentials. `sectors.test.ts:117-125`'s own existing test
("resolves the anchor to its own content in both languages") already demonstrates
this without an auth mock anywhere in the file — it just wasn't read as a security
question before now.

**Blast radius, honestly stated:** bounded per request — one sentence pair per
*registered* sector, not the whole course, and no audio. But it is real content from a
real (potentially premium) course seed past the free-preview boundary, it costs the
caller nothing to enumerate (public, no rate limit visible in this file), and every
sibling endpoint in the same directory treats exactly this class of data (a lego's
known/target text past seed 19) as gated. Whether this is an intentional "show one
sentence as a marketing teaser" product decision or an oversight is not something the
code states either way — the file's own docstring only argues for *why the endpoint is
public* (registry metadata, "same shape of route as `available.ts`"), and
`available.ts` never actually returns lego content, only catalogue metadata
(`course_code`, `pricing_tier`, `display_name`, …) — so the precedent it cites doesn't
actually cover what it does.

**Secondary, lower-severity observation:** `?include=draft` (no auth check of any
kind) is documented as "for QA only" but is not gated to any caller — any anonymous
request can pass it and see the existence, slug, and roles of unreleased/draft sector
courses (their anchor generally resolves to `null` since draft segments have no
content of their own, but the *base*-course anchor still resolves if
`core_anchor_lego_id` happens to point at real content, same leak as above). Not
filed as a separate ID — it is the same missing gate, just a second symptom of it.

**Fix I would apply:** gate the same way `bundle.ts` does — resolve
`resolveServerCourseAccess` for the base course and, when the caller cannot access the
full course, either omit `anchor` for previewOnly callers when the anchor's seed
exceeds `previewMaxSeed`, or (if showing one teaser sentence per sector is actually
the intended product behaviour) say so explicitly in the file header the way
`bundle.ts:389-390` explains its `head=1` no-entitlement decision, so the exemption is
legible on the next audit rather than looking like a skipped gate. This is a product
call, not just a code fix, so I would raise it as a question rather than assume the
answer.

**Test:** `sec0905-c-new-data-endpoints.security.test.ts`, describe block
"SEC0905-C-01" — one source-level assertion (no gate imported/called, unlike
`bundle.ts`) and one executable characterization proving the anchor content is
returned to a zero-credential request.

---

## 3. `api/audio/batch-urls.ts` (+98, rewritten) — SEC0901-D-01 delta only

**Read first, as instructed:** `api/audio/batchUrlsBulk.security.test.ts`,
`api/audio/batchUrlsEntitlementVsAuth.security.test.ts`, and the 2026-09-01 report's
§4 verdict (HIGH, LIVE at that time: "gates on authentication, not entitlement").

### SEC0905-C-04 — SEC0901-D-01 is CLOSED · **SECURE** · CONFIRMED

**File/line:** `api/audio/batch-urls.ts:150-178` (`callerIsEntitledTo`),
`:211` (call site). The gate for a `gated` (premium, past-preview, no entitlement
token) audio id is now `resolveServerCourseAccess(req, supabase, course).canAccess` —
the exact same DB-backed resolver `bundle.ts`, `cycles.ts` and `infplay-cycles.ts`
use, reading real `subscriptions`/`user_entitlements`/cascade rows keyed off the
verified bearer's `learners.id` (`api/_utils/courseAccess.ts:44-124`), not a login
check. Verified point-by-point:

- **Per-course, not per-request:** `loadCourseRows()`/`callerIsEntitledTo()` are
  memoised per distinct `course_code` in the batch (`:126-178`), so a 500-id batch for
  one course costs one `courses` read + one `resolveServerCourseAccess` call, not 500
  — no amplification from the entitlement check itself.
- **Fails CLOSED on a lookup error**, not open: `:168-174` catches any thrown error
  from the `resolveServerCourseAccess` call and resolves the promise to `false`
  (denied), logging the failure server-side. A DB blip degrades to "denied, fall back
  to the per-clip proxy" rather than "granted."
- **A missing `courses` row is treated as premium**, not inferred as free
  (`:160-165`) — deliberately closing the fail-open direction ("we couldn't find the
  course row" must never become "assume it's free," per the file's own comment).
- **Bounded batch and TTL, unchanged by this rewrite:** `MAX_IDS_PER_REQUEST = 500`
  (`:73`, enforced `:105-108`), `TTL_SECONDS = 300` (`:74`, used at the one
  `getSignedUrl` call site `:217`). No unbounded amplification: request size is capped,
  and the presign TTL is a fixed 5 minutes regardless of anything caller-supplied.

**Answering the audit's Q3 directly:** yes, entitlement is now enforced per course
(effectively per audio id, since every id's `course_code` is looked up from its own
DB row, never trusted from the request); no, there is no way to get presigned URLs for
a course not owned — a free/never-paid account is denied exactly as before the fix
closed it, and it is denied on the SAME real subscription data `bundle.ts` would use
to decide whether to hand over the full course; batch size and TTL are both fixed
constants, not caller-influenced.

**Verdict: HELD, and D-01 should be marked CLOSED** in any running ledger of the
2026-09-01 findings.

**Test:** `sec0905-c-new-data-endpoints.security.test.ts`, describe block
"SEC0905-C-04" (3 assertions: gate source, fail-closed catch, bounded constants).

---

## 4. `api/_utils/rebateRegion.ts` (NEW, 111 lines) + `api/teacher/paddle-webhook.ts` (+44) — delta only

**Read first, as instructed:** the four existing `paddle-*.security.test.ts` specs
(webhook signature verification etc. — deliberately not re-swept per the README).

### SEC0905-C-05 — region is server-resolved from Paddle, not caller-controlled · **SECURE** · CONFIRMED

**File/line:** `api/_utils/rebateRegion.ts:60-76` (`resolveTransactionCountry`). The
billing country comes from, in order: (1) an inline `address.countryCode` already
present on the **webhook's own transaction payload** (Paddle-authored, arrives after
webhook-signature verification which is out of this audit's scope by the README), or
(2) a server-side `paddle.addresses.get(customerId, addressId)` call keyed off ids
that are themselves part of the signed webhook payload. **Nothing in this file reads
`req.headers`** (no `Accept-Language`, no `X-Vercel-IP-Country`, no anything) and
nothing reads a request body field a browser composes — the file's own docstring is
explicit that `customData` (which the browser *does* compose, per the pre-existing
TRUST BOUNDARY note at the top of `paddle-webhook.ts`) is deliberately excluded as a
signal, for exactly the reason a prior finding (ADMIN-ENT-01/TENANCY-03) already
exists for: a browser-composed field must never resolve a money-affecting target.
**Answering Q4 directly: no, a caller cannot pick their own region here.** The India
exclusion itself is a hardcoded constant (`RULED_EXCLUDED_COUNTRIES = ['IN']`,
`:24`), not solely env-driven, so it cannot be silently disabled by an unset/emptied
env var — only *additional* regions are configurable.

**Wiring into the money path**, verified in `paddle-webhook.ts`
(`handleTransactionPaidEvent`, the diff's first hunk): `rebateRegionDecision(data)` is
called with the webhook's own event `data` before any commission is accrued, and an
excluded region short-circuits with no write. Symmetric handling exists in
`handleAdjustmentEvent` for refunds/adjustments (see next finding for a residual gap
in that mirror).

**Test:** `sec0905-c-new-data-endpoints.security.test.ts`, describe block
"SEC0905-C-05".

### SEC0905-C-07 — adjustment-path region check can silently resolve "not excluded" instead of failing closed · **LOW** · PLAUSIBLE

**File/line:** `api/teacher/paddle-webhook.ts:2028` —
`const adjustedTxn = data.transactionId ? await paddle.transactions.get(data.transactionId) : null`,
followed by `rebateRegionDecision(adjustedTxn)`.

**The gap:** the surrounding comment (`:2021-2024`) states the intended contract
plainly — *"Money-safe under uncertainty: if we cannot establish the region, do not
move rebate money either way. Throw so Paddle retries."* But when `data.transactionId`
is falsy, `adjustedTxn` is `null` **without throwing**, and
`rebateRegionDecision(null)` → `resolveTransactionCountry(null)` also returns `null`
**without throwing** (optional-chaining through a `null` argument short-circuits to
"no inline address, no addressId/customerId, return null" — `rebateRegion.ts:61-75`
only throws when the `paddle.addresses.get(...)` *call itself* rejects, not when the
inputs needed to make that call are simply absent). The result is
`{ excluded: false, country: null, reason: 'region unknown' }` — silently treated as
**not excluded**, so the adjustment proceeds through the normal (non-excluded) path
rather than hitting the documented `catch` / re-throw.

**Why this is PLAUSIBLE rather than CONFIRMED-exploitable:** this is not a
caller-controlled lever — no attacker chooses whether a Paddle `adjustment.*` webhook
payload carries a `transactionId`; this is a question about whether Paddle's own
payload shape ever omits it for a real adjustment event (I could not verify against
live Paddle payload samples from inside this audit's read-only/no-outward-contact
rules). If it does, the practical effect is a ledger-consistency bug — a
region-unknown adjustment on what might be an India sale is not reversed/skipped the
way the design intends — rather than an attacker gaining anything, which is why I
rate it LOW rather than MEDIUM despite it being a genuine gap against the file's own
stated invariant.

**Fix I would apply:** treat `!data.transactionId` the same as a failed lookup —
throw explicitly rather than passing `null` through to `rebateRegionDecision`, so the
existing `catch` block's retry-on-uncertainty behaviour actually fires.

**Test:** `sec0905-c-new-data-endpoints.security.test.ts`, describe block
"SEC0905-C-07" (characterization of the code path, not a live-payload reproduction).

---

## 5. `api/player-events.ts` (+35) — delta only

**Read first, as instructed:** `api/playerEventsAttribution.security.test.ts`
(SEC0901-C-02, "CONFIRMED SECURE" on the pre-existing cookie-based play-as-class
exception).

### SEC0905-C-06 — new `acting_learner_id` body channel rides the same authz gate as the cookie · **SECURE** · CONFIRMED

**File/line:** `api/player-events.ts:105-137` (`resolveIdentity`). The change adds a
second channel for the play-as-class claim — `req.body.acting_learner_id` — for the
stated reason that a cross-origin native-shell WebView cannot carry the `ssi-user-id`
cookie at all. I verified this is not a new attack surface, it is the existing
SEC0901-C-02-verified control extended to a second transport:

- **Unreachable without a verified bearer.** `resolveIdentity` returns `null`
  immediately if there is no `Authorization: Bearer` header (:109-110) or the token
  doesn't verify (:112-113) — the body/cookie claim is read only after that (:124-129).
  A guest (no token) cannot use this channel at all; their telemetry stays
  unattributed exactly as before.
- **Identical authorisation, either transport.** Whichever channel supplies
  `claimedId` (body wins if present, cookie otherwise — :126-129), it is passed
  through the exact same `isAuthorisedClassLearner(supabase, result.userId,
  claimedId)` (:135, unchanged function body :140-158) before being trusted. Body and
  cookie are symmetric claims, not two different trust levels.
- **`isAuthorisedClassLearner` cannot be used for individual-learner IDOR**: it only
  matches when `classLearnerId` equals an actual `classes.class_learner_id` (the
  shared class pseudo-identity), never an arbitrary individual learner's own id
  (`:146-150`), and then requires that class to be inside the caller's own
  `resolveVisibleScope(...).classIds` (`:152-153`). A plain `student` role's scope is
  hard-coded empty (`schoolScope.ts:296-300` — "a student has no scope"), so an
  ordinary learner presenting someone else's `acting_learner_id` in the body gets
  `authorisedClass = false` and falls back to their own verified identity. Only
  teacher/school_admin/govt_admin roles can ever satisfy the check, and only for
  classes actually within their own visible scope.

**Answering Q5/Q6 directly for this file:** no new IDOR, and the CORS header addition
(`Content-Type, Authorization`) in the same diff is documented and matches the
pre-existing posture on `/api/entitlement/offline-lease` and `/api/audio/batch-urls`
— it is a credential-free, wildcard-origin endpoint by design (no
`Access-Control-Allow-Credentials`, no cookie trusted as identity), so widening the
allowed *request* header list doesn't change what a cross-origin caller can read.

**Test:** `sec0905-c-new-data-endpoints.security.test.ts`, describe block
"SEC0905-C-06".

---

## 6. Small-diff files — CORS line only, verified and out of scope

For each of the following, `git diff 8755d4c8 origin/main` is exactly an added
`import { applyCors } from '../.../_utils/cors'` + one `if (applyCors(req, res, {
methods: '...' })) return` guard at the top of the handler (plus, for two files, a
`docs/` → `archive/docs-retired-2026-08-24/` path fix inside a comment — no code
change). I read `api/_utils/cors.ts` in full to confirm this shared helper carries no
new authorization surface: it never sets `Access-Control-Allow-Credentials`, only
echoes an `Origin` it matched against a closed allowlist (native-shell origins +
this project's own Vercel preview aliases), sets no headers and returns `false` for
same-origin or absent-`Origin` requests (byte-identical existing behaviour), and is
purely a **browser-read** policy — every one of these endpoints' actual
`verifyAuthToken`/scope checks runs exactly as before, unmodified, after the CORS
guard. Confirmed clean, no test added (nothing changed to characterize beyond what
`cors.ts`'s own existing coverage already pins):

- `api/courses/[code]/bundle.ts` (+16 total — the CORS line **and** one unrelated,
  already-landed content-safety fix: `.is('required_role', null)` on the
  `listening_pods` query, excluding role-restricted pod content from the
  service-role-read offline bundle. Read and confirmed correct — not this audit's
  finding to claim, it's already-shipped defence for a different gap
  (`database/changes/20260903_restricted_content_by_role.sql` in the dashboard repo),
  noted here only because it was in the diff I was told to check.)
- `api/entitlement/user.ts`, `api/school/class-progress.ts`,
  `api/groups/[id]/home.ts`, `api/groups/[id]/rate-compare.ts`,
  `api/teacher/by-code.ts`, `api/teacher/classes.ts`, `api/teacher/class-teachers.ts`,
  `api/teacher/me.ts`, `api/access/claim.ts`, `api/account/delete.ts`,
  `api/account/reset-progress.ts`, `api/me/engaged-time.ts`, `api/me/legos-learnt.ts`,
  `api/me/phrases-spoken.ts`, `api/me/profile.ts`, `api/me/standing.ts`,
  `api/me/subscription.ts`, `api/me/teaching-context.ts`.

  Four of these files (`teacher/by-code.ts`, `teacher/classes.ts`,
  `teacher/class-teachers.ts`, `teacher/me.ts`, `school/class-progress.ts`,
  `groups/[id]/home.ts`, `groups/[id]/rate-compare.ts`) have **only** the comment path
  rename — no CORS line at all, no code change of any kind.

No finding filed for any file in this section.

---

## 7. Gaps — explicit

- **SEC0905-C-07** could not be confirmed against a real Paddle `adjustment.*`
  payload — I have no live/sandboxed Paddle account access in this audit's rules, and
  reasoned from the code + the SDK type usage elsewhere in the same file. Filed as
  PLAUSIBLE, not CONFIRMED, for that reason.
- **SEC0905-C-01's severity judgement** (MEDIUM vs. "working as intended marketing
  teaser") is genuinely a product question the code does not answer either way — I
  could not resolve from the repository alone whether a one-sentence teaser per
  sector is deliberate. Flagged explicitly as a decision for Tom rather than assumed.
- I did not audit `api/courses/[code]/sectors.test.ts` / `threads.test.ts`'s
  correctness beyond reading them for coverage gaps (confirmed: neither tests
  entitlement/error-leakage, which is exactly what this report adds).
- No live-DB probing, no timing measurement, no outward network contact of any kind
  was made — everything above is static source analysis plus in-process vitest runs
  against mocked Supabase clients (the same pattern the existing `sectors.test.ts`
  and `threads.test.ts` already use).
- **`pnpm run typecheck:api` could not be run to completion in this worktree.** This
  worktree's root `node_modules` is a symlink to the shared checkout's
  (`/home/tomcassidy/SSi/ssi-learning-app/node_modules`), which is itself an
  incomplete install (missing `tsup`, no `packages/core/dist`) — a pre-existing
  environment gap, not something introduced by this audit's changes. Per this
  account's own recorded incident (`worktree-setup-symlinked-node-modules-lie`,
  2026-09-04 variant), running `pnpm install` against a root `node_modules` symlinked
  into the shared checkout risks rewriting the tree out from under other live
  sessions, so I did not run it. Since the only change to `api/**` in this delta is
  the new test file (no production handler touched), I instead typechecked that file
  in isolation (`tsc --noEmit` against it directly, no errors) as a substitute
  verification. The full gated `pnpm run typecheck:api` should still be run once,
  from an environment with a real install, before this branch merges.

---

## 8. Summary table

| ID | Severity | Verdict | File | One-line |
|---|---|---|---|---|
| SEC0905-C-01 | MEDIUM | CONFIRMED | `courses/[code]/sectors.ts` | No entitlement gate at all — ships a real past-preview (seed 42 > cap 19) lego's known+target text to anonymous callers, unlike every sibling course endpoint |
| SEC0905-C-02 | LOW | CONFIRMED | `me/threads.ts` | Every error path returns raw `error.message` (PostgREST/Postgres detail) — SEC0901-C-03 shape, new file |
| SEC0905-C-03 | — | SECURE | `me/threads.ts` | All scope derived from verified bearer → `learners.id`; no caller-supplied learner/enrolment id anywhere; no IDOR |
| SEC0905-C-04 | — | SECURE | `audio/batch-urls.ts` | SEC0901-D-01 CLOSED: gated ids now checked against real DB-resolved `resolveServerCourseAccess`, fails closed on error, batch/TTL still bounded |
| SEC0905-C-05 | — | SECURE | `_utils/rebateRegion.ts` | Region resolved server-side from the signed Paddle payload/API, never from a request header or browser-composed field — not caller-steerable |
| SEC0905-C-06 | — | SECURE | `player-events.ts` | New `acting_learner_id` body channel authorised through the identical, previously-verified `isAuthorisedClassLearner` gate as the cookie path; unreachable without a verified bearer; no individual-learner IDOR |
| SEC0905-C-07 | LOW | PLAUSIBLE | `teacher/paddle-webhook.ts` | Adjustment-path region check can silently resolve "not excluded" (rather than the documented fail-closed throw) when the payload lacks `transactionId` — not caller-controlled, a ledger-correctness question |
| — | — | clean | 18 files, CORS-line-only or comment-only | Verified diff is exactly `applyCors` wiring (or a doc-path comment fix); no new authz surface; not respent effort |

Tests: `api/_security/sec0905-c-new-data-endpoints.security.test.ts` — 13 passing
(4 characterization/source assertions for the two real findings, 1 characterization
for the plausible finding, 8 secure-assertions for the confirmed-clean surfaces).

---

## Landing line

Branch: `cs/554-sec-c-new-endpoints`. **Not merged** — this branch has not been merged
into `dev`, `staging`, or `main`. **Not deployed** — nowhere; no deploy was triggered
and none of this work has run outside this worktree and its local vitest process.
