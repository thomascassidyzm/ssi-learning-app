# Security audit 2026-08-11 — Area 3: Input handling & injection

**Scope:** input validation across all of `api/**` — PostgREST filter injection, raw SQL/RPC,
path traversal, SSRF, mass assignment, type/shape validation, prototype pollution, ReDoS,
email header/template injection, unbounded pagination, cron reachability, CORS/origin handling.

**Method:** static read of all 262 files under `api/`, plus executable characterization tests that
drive the real handlers with recording mocks. No live traffic was sent to staging or production, and
no production behaviour was changed — findings and tests only.

**Tests added:** 8 files, 120 cases (100 passing, 20 `it.todo` naming the fix).
Suite green: 116 files / 1298 passing / 33 todo. `tsc -p tsconfig.api.json --noEmit` clean.

---

## Priority summary

| ID | Sev | One line |
|---|---|---|
| INPUT-01 | **high** | `/api/audio/batch-urls` needs no auth and, with the default fail-open entitlement posture, hands an anonymous caller 500 presigned direct-S3 URLs for premium content per request |
| INPUT-02 | **medium** | PostgREST `.or()` filter injection in `api/school/class-progress.ts` — untyped client positional args interpolated into a service-role UPDATE's WHERE clause |
| INPUT-03 | **medium** | Mass assignment in `class-progress.ts` `updateLegoProgress` — `{...updates}` lets a caller rewrite `learner_id` and any other column |
| INPUT-04 | **medium** | `/api/player-events` attributes unauthenticated events to any learner uuid supplied in the `ssi-user-id` cookie, via a service-role insert |
| INPUT-05 | **medium** | Unanchored `path LIKE '<path>%'` subtree matching pulls a sibling tenant's org into cohort/entitlement resolution |
| INPUT-06 | low | `.or()` filter injection via the admin user-search param (admin-authenticated, same-table only) |
| INPUT-07 | low | `api/email/verify.ts` throws an unhandled `TypeError` on a non-string `email` — guaranteed 500 from a shaped body |
| INPUT-08 | low | The audio proxy's 502 body leaks the internal S3 key and the raw AWS error text to an anonymous caller |
| INPUT-09 | low | Unbounded/untyped string writes: `player_events.course_code`/`client_version`, `classes.class_name` |
| INPUT-10 | low | The `Host` header is reflected verbatim into `getAppOrigin()` → `https://${host}`, used to build join links and `redirectTo` |
| INPUT-11 | low | Unauthenticated input drives an outbound DNS MX lookup (`hasMxRecord`) from the serverless egress IP |
| INPUT-12 | info | Cron secret compared with non-constant-time `!==`; the gate is skipped entirely when `CRON_SECRET` is unset outside production |

**Clean sweeps** (searched, nothing found — locked with regression tests): no SSRF (no `fetch()`
anywhere in `api/**` takes a caller-supplied URL), no raw SQL string concatenation, no `req.body`
spread into an `insert`/`upsert`, no ReDoS-prone regex over user input, no prototype pollution via
the player-events payload path, no path traversal reaching an S3 key.

---

## INPUT-01 — Unauthenticated bulk extraction of premium audio (high)

**Where:** `api/audio/batch-urls.ts:49-121`, gate at `api/_utils/audioAccess.ts:408` and `:538-543`.

**Evidence.** The endpoint has no authentication of any kind — it goes straight from method check to
body parse to presigned-URL issuance:

```ts
// api/audio/batch-urls.ts:60-81
if (req.method !== 'POST') { res.status(405)… }
const body = req.body as { audioIds?: unknown } | undefined
const audioIds = body?.audioIds
…
const ids = audioIds as string[]
```

The only gate is `resolveAudioEntitlement`, which defaults to fail-open:

```ts
// api/_utils/audioAccess.ts:408
export const ENTITLEMENT_STRICT = (process.env.ENTITLEMENT_ENFORCE || '').trim().toLowerCase() === 'strict'

// api/_utils/audioAccess.ts:538-543
if (ENTITLEMENT_STRICT) { return { allowed: false, gated: true } }
// DEFAULT (fail-open): do not regress live playback before the client
// attaches tokens.
return { allowed: true, gated: true, tag: rawToken ? 'token-invalid-open' : 'no-token-open' }
```

**What an attacker does.** POSTs `{"audioIds": [...500 uuids...]}` with no headers. The audio uuids
are not secret — the unauthenticated `/api/courses/:code/cycles` and `/bundle` routes hand them out
for any course. Loop the batch endpoint over the enumerated ids.

**What they get.** 500 presigned S3 GET URLs per request (`api/audio/batch-urls.ts:115-116`, TTL
300s), fetched directly from S3, bypassing the proxy entirely. That is the entire paid catalogue,
downloadable, with no account.

**Confidence.** CONFIRMED for the code path (test:
`api/audio/batchUrlsBulk.security.test.ts` — an anonymous request returns 500 premium URLs, 0
denied). UNVERIFIED whether `ENTITLEMENT_ENFORCE` is set to `strict` in the live Vercel projects —
I have no access to production env vars. If it is set, this drops to informational; if it is not,
it is live. **That one env-var check is the single most valuable thing to confirm from this audit.**

**Recommended fix (not applied).** Two independent layers: (a) require a verified session on
`batch-urls` regardless of the entitlement flag — it exists to serve signed-in offline downloaders,
so anonymous access buys nothing; (b) arm `ENTITLEMENT_ENFORCE=strict` once the `X-SSi-Entitlement`
tag shows client token coverage is complete. The existing strict-mode test in
`api/audio/batch-urls.test.ts` already proves the deny path works.

---

## INPUT-02 — PostgREST `.or()` filter injection in class-progress (medium)

**Where:** `api/school/class-progress.ts:224` and `:254`, reached from the dispatcher at `:374-386`.

**Evidence.** The handler forwards untyped positional args straight into the per-method writers, and
the file says so:

```ts
// api/school/class-progress.ts:383-386
// Positional args forwarded to the per-method handlers. Client-supplied and
// untyped by design … (Input validation of these is a separate concern, not this pass.)
const a: any[] = Array.isArray(args) ? args : []
```

Two of those writers interpolate an arg into a PostgREST logic tree, which is **syntax, not a
parameterised value**:

```ts
// api/school/class-progress.ts:218-225
const { error } = await svc
  .from('course_enrollments')
  .update(updateData)
  .eq('learner_id', learnerId)
  .eq('course_id', courseId)
  .or(`last_completed_round_index.is.null,last_completed_round_index.lte.${roundIndex}`)

// api/school/class-progress.ts:249-255 (the infplay ratchet)
  .or(`last_completed_lego_id.is.null,last_completed_lego_id.lt.${ratchetHighestTo.legoId}`)
```

**What an attacker does.** An authenticated teacher or school_admin POSTs
`{classId, method: "setLivePosition", args: ["S0001L01", "0,current_cycle_index.gte.0", 0]}`. The
filter sent to PostgREST becomes
`last_completed_round_index.is.null,last_completed_round_index.lte.0,current_cycle_index.gte.0` — a
third disjunct the code never wrote.

**What they get.** Control over the WHERE clause of a **service-role UPDATE**. The two `.eq()` calls
still pin the row set to the caller's own class learner and course, so this is not cross-tenant data
access; the achievable effects are defeating the forward-only ratchet these `.or()` clauses exist to
enforce (writing a lower position over a higher one), and turning a malformed filter into a 500 that
works as an error oracle. Severity is medium rather than high because of that containment — but the
containment is incidental, not designed, and any future `.or()` on this pattern without an `.eq()`
guard would be a full break.

**Confidence.** CONFIRMED — `api/_security/postgrestFilterInjection.security.test.ts` drives the real
handler and asserts the exact injected filter string.

**Recommended fix (not applied).** Coerce and validate before the template literal:
`roundIndex` through `Number()` + `Number.isInteger()`; `ratchetHighestTo.legoId` against
`/^S\d{4}L\d{2}$/`, which `api/courses/[code]/cycles.ts:61` already applies to the same value on the
read path. Reject with 400 rather than coercing silently.

---

## INPUT-03 — Mass assignment in `updateLegoProgress` (medium)

**Where:** `api/school/class-progress.ts:176-192`.

**Evidence.**

```ts
// api/school/class-progress.ts:185-192
if (!row || (row as any).learner_id !== learnerId) {
  throw new Error('updateLegoProgress: row does not belong to this class')
}
const { error } = await svc
  .from('lego_progress')
  .update({ ...updates, updated_at: new Date().toISOString() })
  .eq('id', id)
```

The ownership hop proves the row belongs to the class learner. Nothing constrains **which columns**
are written.

**What an attacker does.** POSTs
`{classId, method: "updateLegoProgress", args: ["<row id>", {"learner_id": "<any learner uuid>"}]}`.

**What they get.** The `lego_progress` row is re-pointed at an arbitrary learner — corrupting another
account's progress, or `course_id` set to a course that learner is not enrolled in. Bounded to the
`lego_progress` table, so this is data integrity rather than disclosure.

**Note the asymmetry:** the sibling writer `saveLegoProgress` (`:152-171`) already allow-lists its
columns and carries a comment explaining exactly why. `updateLegoProgress` skipped it.

**Confidence.** CONFIRMED — test asserts `learner_id` from the request body lands in the update
payload, and a companion control test proves `saveLegoProgress` drops the same spoofed field.

**Recommended fix (not applied).** Allow-list the writable columns (`fibonacci_position`,
`skip_number`, `reps_completed`, `is_retired`, `last_practiced_at`) and explicitly drop `id`,
`learner_id`, `course_id` — mirroring `saveLegoProgress`.

---

## INPUT-04 — Unauthenticated telemetry attributed to an arbitrary learner (medium)

**Where:** `api/player-events.ts:88-113`, insert at `:201`.

**Evidence.**

```ts
// api/player-events.ts:111-112
const rawUserId = (req.cookies?.['ssi-user-id'] as string | undefined) || null
return rawUserId && UUID_RE.test(rawUserId) ? rawUserId : null
```

The bearer path above it is genuinely verified and is the right design — but when no bearer is
present, a **client-set cookie** is trusted after nothing more than a uuid shape check, and the rows
are written with the service-role key.

**What an attacker does.** `curl -X POST /api/player-events -H 'Cookie: ssi-user-id=<learner uuid>'
-d '{"events":[…]}'`. No account required.

**What they get.** Arbitrary fabricated events written against a named learner. `player_events` is
not decorative: it is the declared source of truth for audio plays (CLAUDE.md), and feeds
`api/me/engaged-time.ts`, `api/admin/attention.ts` and the board metrics. So this poisons the
analytics that drive operational decisions, and can be pointed at a specific learner.

The file's own header calls the spoofing acceptable — *"nobody benefits from injecting fake logs into
their own row"*. That reasoning holds for self-attribution and misses the case here, which is
attribution to **someone else's** row.

**Confidence.** CONFIRMED (test drives the handler and asserts the victim uuid in the insert payload).
The downstream impact on engaged-time/attention is read from the code, not measured — UNVERIFIED how
much those surfaces filter.

**Recommended fix (not applied).** Without a verified bearer, insert `learner_id: null` (an anonymous
event) instead of trusting the cookie. Guests already log as null, so the shape is unchanged.

---

## INPUT-05 — Unanchored subtree path matching crosses tenants (medium)

**Where:** `api/school/rate-compare.ts:119` and `:230`; `api/_utils/orgPlatform.ts:142`.

**Evidence.**

```ts
// api/school/rate-compare.ts:119
const { data: subtreeGroups } = await svc.from('groups').select('id').like('path', `${path}%`)
```

`groups.path` is a slug chain built by `compute_group_path()` (`supabase/schema.sql:2287`):
`LOWER(REGEXP_REPLACE(NEW.name, '[^a-zA-Z0-9]+', '-', 'g'))`, segments joined with `/`. `'acme%'`
therefore matches not only `acme` and `acme/year-7` but also **`acme-group`** — a different root org
belonging to a different customer.

The correct idiom already exists in this repo, with a comment naming this exact hazard:

```ts
// api/groups/[id]/invites.ts:130-132
// Segment-safe path prefix (path 'a/b' matches 'a/b' and 'a/b/…', never 'a/b-c')
.or(`path.eq.${path},path.like.${path}/%`)
```

**What an attacker does.** Nothing active — this is a naming coincidence, not an exploit chain. A
leader of "Acme" whose neighbour registers "Acme Group" silently absorbs their subtree.

**What they get.** Another tenant's classes folded into rate-compare cohorts (aggregate analytics
leakage), and — via `orgPlatform.ts:142`, which resolves platform/trial state over the same
unanchored subtree — potentially another tenant's commercial state influencing their own.

**Confidence.** CONFIRMED for the LIKE semantics and the slug rules (test demonstrates both idioms
side by side). UNVERIFIED whether any colliding sibling pair exists live — that needs a DB query I
did not have access to (see GAPS). Note the repo has *already been burned once* by slug collisions:
`api/_utils/groupSubtree.ts:6-11` documents two orgs both named "Deborah Testing" merging into each
other's rollups.

**Recommended fix (not applied).** Replace all three call sites with the segment-safe
`path.eq.${path},path.like.${path}/%` form from `invites.ts:132`.

---

## INPUT-06 — `.or()` injection via the admin user search (low)

**Where:** `api/admin/users.ts:313-318`.

```ts
if (search) {
  const orParts = [`display_name.ilike.%${search}%`]
  if (learnerIdsMatchingEmail.length > 0) orParts.push(`id.in.(${learnerIdsMatchingEmail.join(',')})`)
  query = query.or(orParts.join(','))
}
```

`search` is a raw query param. A comma in it adds a disjunct. Note that the *neighbouring* use of the
same value at `:299` — `.ilike('email', `%${search}%`)` — is **safe**, because there it is a value
argument that postgrest-js encodes; only the `.or()` string is syntax. That is the trap worth
naming: the same interpolated variable is safe in one call and injectable in the next.

**Impact.** The endpoint is behind `verifyAdmin`, and PostgREST's logic tree only addresses columns
of the queried table, so the ceiling is an already-privileged caller re-shaping a `learners` filter.
Low. Reported because the pattern must not be copied to an unauthenticated endpoint.

**Fix.** Escape `, . ( ) :` in the interpolated value, or split the search into two queries and merge.

**Test.** Pure string-construction characterization in
`api/_security/postgrestFilterInjection.security.test.ts` (another audit worker owns tests under
`api/admin/`, so the handler itself is not driven here).

---

## INPUT-07 — Unhandled TypeError on a non-string email (low)

**Where:** `api/email/verify.ts:30-36`.

```ts
const { email, token } = req.body || {}
if (!email || !token) { return res.status(400)… }
const normalizedEmail = email.toLowerCase().trim()   // line 36 — no type check
```

Line 36 sits **outside** the `try` that begins at line 44, so `{"email": {"a":1}, "token": "1"}`
throws a `TypeError` out of the handler: an opaque platform 500 and a stack trace in the logs, from
an authenticated but otherwise unprivileged caller. Every neighbouring endpoint does
`typeof x === 'string' ? … : ''`.

**Fix.** Type-check `email` and `token` as strings and return 400 otherwise.
**Test.** `api/_security/inputSurfaces.security.test.ts` asserts the handler rejects with a TypeError
and never sets a status.

---

## INPUT-08 — S3 key and raw AWS error in the proxy's 502 body (low)

**Where:** `api/audio/[audioId].ts:211-215`.

```ts
res.status(502).json({
  error: 'Failed to fetch audio from storage',
  details: s3Error?.message || s3Error?.Code || s3Error?.name || 'Unknown error',
  key: sample.s3_key,
})
```

An anonymous caller who triggers any S3 failure gets the internal object key and the AWS message —
which routinely carries the bucket ARN and the key-prefix layout. The same handler's 500 branch
(line 221) does this correctly: generic body, detail to the log.

**Fix.** Return a generic body; keep `key`/`details` in the existing `console.error` above it.
**Test.** `api/audio/audioProxy.security.test.ts` asserts both fields in the 502 body today.

---

## INPUT-09 — Unbounded and untyped string writes (low)

Three instances, all authenticated-or-anonymous writes with no length bound and (for the first two)
no type check:

- `api/player-events.ts:186` `course_code: e.course_code || null` — no type check, no cap. A
  non-string reaches the insert (guaranteed Postgres error → 500); a 100 KB string is stored as-is.
  Anonymous, 50 per batch. Contrast `event_type` at `:187`, which is correctly `.slice(0, 64)`.
- `api/player-events.ts:189` `client_version: e.client_version || null` — same.
- `api/school/rename-class.ts:45` and `api/teacher/classes.ts:186` — `class_name` is type-checked and
  trimmed but never capped, unlike `api/school/update-profile.ts:47` (`.slice(0, 200)`) and
  `api/onboarding/profile.ts:40` (`.slice(0, 120)`). `classes.class_name` is unbounded text, so a
  teacher can store a multi-megabyte name that every roster and analytics response then carries.

**Fix.** Apply the `typeof === 'string' ? x.slice(0, N) : null` pattern the sibling endpoints already
use.
**Tests.** `api/player-events.security.test.ts` (100 KB stored, object stored untyped),
`api/_security/writeLengthCaps.security.test.ts` (250 KB class name stored).

---

## INPUT-10 — Host header reflected into the app origin (low)

**Where:** `api/_utils/appOrigin.ts:9-15`, duplicated verbatim at `api/admin/create-signin-link.ts:32`
and `api/groups/[id]/demo-mint.ts:61`.

```ts
const host = ((req.headers['host'] as string) || '').toLowerCase().replace(/:\d+$/, '')
if (host === 'saysomethingin.app' || host === 'www.saysomethingin.app') return 'https://saysomethingin.app'
if (host === 'staging.saysomethingin.app') return 'https://staging.saysomethingin.app'
if (host) return `https://${host}`          // ← anything else, verbatim
```

The value is not even constrained to a hostname — `Host: attacker.example/phish` yields
`https://attacker.example/phish`. The result builds join/redeem links
(`api/groups/[id]/invites.ts:205,257,335,417,590`) and Supabase's `redirectTo`
(`create-signin-link.ts:113`).

**Two things stop this being serious, and both should be kept:** Vercel only routes a request here
when the Host is one of the deployment's own domains, and Supabase drops a `redirectTo` outside the
project allow-list. Neither is a guarantee this function makes for itself. **The genuinely important
control is `toInviteEmailUrl`** (`api/_utils/sendInviteEmail.ts:79-86`), which rebuilds every
*emailed* link onto a fixed origin, keeping only path/query/hash — so a poisoned Host cannot reach a
real inbox. That is the property to protect if the email path is ever refactored.

**Confidence.** The reflection is CONFIRMED (test). The Vercel Host-routing assumption is UNVERIFIED
— I did not test the live edge.
**Fix.** Allow-list the host (or require a `.saysomethingin.app` / `.vercel.app` suffix) and fall
back to production otherwise.

---

## INPUT-11 — Unauthenticated input drives outbound DNS (low)

**Where:** `api/_utils/emailValidation.ts:64-84`, called from `api/auth/possession-redeem.ts`.

`hasMxRecord()` runs `dns.resolveMx(domain)` on a domain taken from an unauthenticated request body.
That is an attacker-steerable outbound request from the serverless egress IP — a low-bandwidth
beacon/exfiltration channel and a way to make this app query arbitrary nameservers. DNS only (no HTTP
fetch), fails open, 2s timeout, hence low.

Minor adjacent nit: the `Promise.race` timeout at `:74` is never cleared, so the timer runs to
completion on every successful lookup.

**Fix.** Rate-limit per IP ahead of the lookup; keep the existing fail-open semantics.

---

## INPUT-12 — Cron gate hygiene (info)

**Where:** `api/cron/expire-demo-schools.ts:28-41`, `api/cron/teacher-payouts.ts:90-107`.

Both gates are correct in production and I verified them: unauthenticated → 401, wrong bearer → 401,
and `CRON_SECRET` unset in production → 500 refuse-to-run (fail closed) with no DB touched. Two
residual notes:

- The comparison is `authHeader !== \`Bearer ${cronSecret}\`` — not constant time. Impractical to
  exploit across the internet; `crypto.timingSafeEqual` costs nothing and removes the question.
- When `CRON_SECRET` is unset **and** the environment is not production, the check is skipped
  entirely (`if (cronSecret && …)`) and any caller runs the job — including `teacher-payouts`, which
  creates Wise transfers. Deliberate for local dev, but a preview or self-hosted deployment that
  forgets the env var exposes a service-role money job. Failing closed whenever `VERCEL_ENV` is set
  at all would close it.

**Tests.** `api/cron/cronAuth.security.test.ts` — 10 passing across both endpoints.

---

## Controls verified as HOLDING (regression-locked)

Worth recording, because several are the fix pattern the findings above should copy:

1. **`groups.path` cannot carry PostgREST metacharacters.** `compute_group_path()` slugifies to
   `[a-z0-9-]` + `/`, so the `path` interpolations in `api/groups/[id]/invites.ts:132` are *not*
   second-order injectable. Locked via `groupSlug()` — if that slug rule ever widens, the test fires.
2. **`api/courses/**` input validation is exemplary** — `^[a-z0-9_]+$` on the course code,
   `^S\d{4}L\d{2}$` on the LEGO id, `limit` clamped to `MAX_LIMIT`, all rejected *before* any DB call,
   RPC args passed as named parameters. 28 hostile inputs tested; none reached Postgres.
3. **No path traversal reaches an S3 key.** `isValidAudioId` gates on a strict uuid(`.vN`) regex, and
   the key always comes from the DB row. Traversal, null-byte and array-valued `audioId` all 400.
4. **`saveLegoProgress` allow-lists its columns** and overwrites a spoofed `learner_id`/`course_id`
   with the server-resolved values.
5. **player-events caps hold**: 50-event batch, 8 KB payload (truncated to a marker, not rejected),
   64-char `event_type`, uuid-validated `session_id`, non-uuid cookie → null, `env` derived
   server-side from Host, and a `__proto__` payload key does not pollute `Object.prototype`.
6. **Email rendering escapes.** `renderInviteEmail` entity-escapes the URL into both the `href` and
   the body; subject and lead copy are constants. The Resend send is a JSON POST, so a CRLF in an
   address is JSON-escaped, never an SMTP header boundary. Persona-domain addresses are never mailed.
7. **`verifyEntitlementToken`** length-checks before `timingSafeEqual` and rejects a forged signature
   (verified in strict mode against the real handler).
8. **No SSRF.** The only two `fetch()` calls in `api/**` are a hardcoded `https://api.resend.com` and
   the Wise client's env-base URL. No handler fetches a caller-supplied URL.
9. **No `req.body` spread into an insert/upsert** anywhere in `api/**` (swept programmatically; the
   test re-walks the tree so a future one fails the build). The one `.update({...body})` is INPUT-03.
10. **No ReDoS.** Every regex over user input is a single character class with one quantifier; a
    200 KB hostile course code and a 100 KB hostile email both reject in well under a second.

---

## GAPS — what I could not check

Reported explicitly rather than papered over:

- **No production/staging environment access.** I could not read the live Vercel env vars, so
  **whether `ENTITLEMENT_ENFORCE=strict` is set is UNVERIFIED** — that single fact decides whether
  INPUT-01 is live or already mitigated. Same for `CRON_SECRET`, `ENTITLEMENT_TOKEN_SECRET` and
  `RESEND_API_KEY` presence.
- **No database access.** INPUT-05's real-world impact depends on whether any two sibling groups
  have prefix-colliding slugs today. The query to settle it is
  `SELECT a.id, a.path, b.id, b.path FROM groups a JOIN groups b ON b.path LIKE a.path || '%' AND b.path <> a.path AND b.path NOT LIKE a.path || '/%'`.
  I did not run it. Given the repo already documents one live slug collision
  (`api/_utils/groupSubtree.ts:6-11`), I would not assume the count is zero.
- **No live traffic.** Per the audit rules, nothing was sent to staging or production, so every
  finding is proven against the code and against mocked handlers, not against a live response. The
  Vercel edge's Host-header routing behaviour (which bounds INPUT-10) is therefore assumed, not
  measured.
- **Rate limiting was not assessed as its own surface.** I found no rate limiter anywhere in
  `api/**`; several findings above (INPUT-01 bulk extraction, INPUT-04 telemetry poisoning, INPUT-11
  DNS) are materially worse without one. Whether Vercel's platform-level protection covers this is
  outside what I could check and may belong to another audit area.
- **Client-side `packages/player-vue/**` was out of scope** — this pass covers `api/**` only, so any
  DOM-injection or client-trust issue is unexamined here.
- **Areas owned by other workers** (`api/school`, `api/admin`, `api/auth`, `api/org`,
  `api/entitlement`) were read for input-handling defects and are reported above where found, but I
  did not audit their authorisation logic, and my tests for them live in `api/_security/`.

---

## Test files added

| File | Cases | Covers |
|---|---|---|
| `api/_security/postgrestFilterInjection.security.test.ts` | 11 | INPUT-02, INPUT-02b, INPUT-03, INPUT-06 + slug/allow-list controls |
| `api/_security/inputSurfaces.security.test.ts` | 23 | INPUT-05, INPUT-07, INPUT-10, INPUT-11 + email/SSRF/mass-assignment sweeps |
| `api/_security/writeLengthCaps.security.test.ts` | 6 | INPUT-09c + the capping pattern to copy |
| `api/audio/audioProxy.security.test.ts` | 16 | INPUT-01, INPUT-08 + traversal/key/entitlement controls |
| `api/audio/batchUrlsBulk.security.test.ts` | 8 | INPUT-01 bulk shape + input caps |
| `api/courses/courseInput.security.test.ts` | 28 | controls only — the validation pattern to copy |
| `api/cron/cronAuth.security.test.ts` | 14 | INPUT-12, INPUT-12b + prod fail-closed controls |
| `api/player-events.security.test.ts` | 14 | INPUT-04, INPUT-09, INPUT-09b + batch/payload caps |

Every real vulnerability is a **characterization test asserting today's behaviour** (so CI stays
green) with a `// SECURITY FINDING <ID>` comment naming what should happen instead, plus an
`it.todo` naming the fix. 20 `it.todo` entries total — that list is the remediation backlog.
