# Area C — the rewritten tenant-data endpoints

Scope: `api/school/{roster,rate-compare,class-progress,rename-class,update-profile}.ts`,
`api/teacher/{create-class-learner,create-class-join-code,by-code,classes}.ts`, `api/player-events.ts`,
`api/groups/{table,tree,[id]/home}.ts`, `api/email/verify.ts`. Method: `git diff 6c2b867a origin/dev --
<path>` per file, evidence-first — every claim below is traced to a file:line, not inferred from a
docstring.

**Headline: this slice is in unusually good shape.** Of the ~14 endpoints, every rewritten authorization
path either (a) already carries a prior audit's fix and correctly re-checks the request-supplied id
against the caller's own resolved scope, or (b) delegates to a shared, separately-and-thoroughly-tested
predicate (`canTeachClass` / `classTeacherAuth.ts`, `descendantIds` / `groupSubtree.ts`). I found no IDOR,
no mass-assignment, and no unauthorized write in the changed lines. What I found is two low-severity,
narrow findings below, plus one confirmation of a genuinely new control (the player-events play-as-class
exception) that had shipped without a dedicated test.

---

## Findings

### SEC0901-C-01 — `player-events.ts` event_type has no server-side allowlist · **low/info**

`api/player-events.ts:220` accepts any non-empty string up to 64 characters as `event_type`, including
`cycle_prosody` — the exact type `api/_utils/vadProsody.ts:139` folds into the VAD/prosody aggregates that
feed the teacher and admin analytics boards (`api/admin/vad-prosody.ts`, `api/org/vad.ts`). Payload is
JSON-shape-checked only for serialized size (8 KB cap), not for field types or ranges.

**Attack:** an authenticated learner (or a guest, unattributed) POSTs a batch containing
`{event_type: 'cycle_prosody', payload: {peakEnergyDb: 999, ...}}`. It inserts.

**Why this is low, not high:** attribution is separately and correctly locked down (see SEC0901-C-02
below) — a caller can only ever attribute a fabricated row to **their own** `learner_id`, never another
tenant's. The blast radius is self-serving: a learner could skew their own row's aggregates upward on a
metric a teacher might glance at. It cannot poison another learner's, class's, or school's numbers. This
is the same "nobody benefits from injecting fake logs into their own row" trade the endpoint's original
author accepted (see the file's pre-diff docstring) — the SEC25 INPUT-04 rewrite tightened attribution but
left this side untouched, and it's a reasonable thing to have left untouched.

**Test:** `api/playerEventsAttribution.security.test.ts`, describe block "event_type has no server-side
allowlist" — CHARACTERIZATION, passes today, goes red on purpose if an allowlist is added (red = closed).

### SEC0901-C-02 — player-events play-as-class attribution exception — CONFIRMED SECURE, previously untested · **info**

`api/player-events.ts`'s SEC25 INPUT-04 rewrite (this delta) added `isAuthorisedClassLearner()`
(`api/player-events.ts:129-146`): the only way a verified caller's own identity can be overridden by the
client-set `ssi-user-id` cookie is when the cookie names a class-learner entity that is inside the
caller's own `resolveVisibleScope().classIds`. I traced this and it is correctly wired: the class lookup
resolves the cookie's claimed learner id to a real `classes` row, then checks that row's id (not the
cookie) against the caller's scope. A teacher cannot claim a class they don't teach, and a plain learner
(no staff scope at all) cannot claim any class. This control shipped with no dedicated test — the existing
`api/player-events.test.ts` covers the general identity resolution but not this exception.

**Verdict: HELD.** Added `api/playerEventsAttribution.security.test.ts` (5 tests, all SECURE-ASSERTION) as
the regression lock: in-scope class honoured, out-of-scope real class refused (falls back to verified
identity, never silently drops the event), no-staff-scope caller refused, nonexistent class-learner id
never attributes to it.

### SEC0901-C-03 — `detail: String(error)` on the three group-tree read surfaces' 500 path · **low**

`api/groups/table.ts:97`, `api/groups/tree.ts:111`, `api/groups/[id]/home.ts:691` all catch unexpected
exceptions and return `{ error: 'Internal server error', detail: String(error) }`. `String(error)` on a
Postgres/PostgREST error can carry a column name, constraint name, or relation name. These three
endpoints are correctly authenticated (`resolveGroupTreeCaller`) and scope-checked
(`callerCanSeeGroup`/`caller.ownGroupId` — see the table below), so the audience for this leak is never an
anonymous caller — it's an authenticated govt_admin/school_admin leader (or ssi_admin) who is authorized
to be on the endpoint at all, just not necessarily trusted with internal schema detail. Same convention
also appears in `api/groups/index.ts` (not in my area) — this is an estate-wide pattern, not unique to
these three files, and is likely a deliberate "authenticated staff, so detail is fine" trade rather than
an oversight; I'm flagging it because the brief asked specifically about error/response leakage and this
is the one place in my slice where it's true.

**Contrast:** `api/school/rename-class.ts` (also service-role, also mine) returns
`err?.message || 'Internal server error'` — same general shape (message leaks), but `api/school/roster.ts`
and `api/school/class-progress.ts` both return a fixed generic string with no error text at all. There is
no single convention across even my own slice.

**Test:** `api/groups/groupsErrorLeakage.security.test.ts` — CHARACTERIZATION, source-only, pins the
current text of all three catch blocks plus a contrasting example that does NOT leak.

### SEC0901-C-04 — `api/teacher/classes.ts` `course_code` accepted unvalidated at class-creation · **info, not filed as a finding**

`api/teacher/classes.ts:250` (unchanged by this delta except for the SEC25 INPUT-09 length cap) inserts a
teacher-supplied `course_code` into `classes` with no check that it names a real, entitled course. I traced
whether this could bypass the paid-course entitlement gate and could not find a live path: audio/content
delivery is gated separately by `courseBoundary.ts` / `resolveServerCourseAccess` at read time, not by the
mere existence of a `classes.course_code` value, so setting a bogus or unpurchased code on class creation
gets you a class that cannot actually play anything. **Not filed as a finding** — flagged so the next
auditor doesn't have to re-derive this; UNVERIFIED beyond static tracing (I did not exercise the actual
content-delivery path, which is Area D's subject).

---

## The uniformity census — all ~14 endpoints

| Endpoint | Guard used | Is the request-id re-checked against caller scope? | `rejectIfViewAs` on writes? | Verdict |
|---|---|---|---|---|
| `school/roster.ts` (GET, no class_id) | `verifyAuthToken` + `resolveVisibleScope` | Yes — school/teacher scope resolved server-side, teacher's pupil rows filtered to `scope.classIds` | n/a (read-only) | **Clean** |
| `school/roster.ts` (`?class_id=`) | `verifyAuthToken` + `canTeachClass` | Yes — `classId` param checked via shared predicate (TENANCY-08 fix, both admin spellings) | n/a (read-only) | **Clean** |
| `school/rate-compare.ts` | `verifyAuthToken` + `resolveVisibleScope` | Yes — `entity_id`/`entity_level` explicitly checked against `scope.classIds`/`schoolIds`/`groupId` (`rate-compare.ts:349-353`); subtree resolution now walks `parent_id` via `descendantIds`, closing the old slug-collision hole (TENANCY-04/05) | n/a (read-only) | **Clean** |
| `school/class-progress.ts` | `verifyAuthToken` + `resolveVisibleScope` | Yes — `classId` checked against `scope.classIds`; `learnerId`/`courseId` always server-derived from the class row, never client-supplied; `updateLegoProgress`/`saveLegoProgress` explicitly allow-list columns (INPUT-03 fix); `.or()` ratchets sanitised via `safeIdToken`/`safeInteger` (INPUT-02 fix) | n/a — govt_admin explicitly excluded, only teacher/school_admin, both of which have no legitimate act-as reason here (not independently re-verified this pass; see gaps) | **Clean** |
| `school/rename-class.ts` | `verifyAuthToken` + `resolveVisibleScope` | Yes — `class_id` checked against `scope.classIds` | No — but by design: authz is via caller's own scope, and ssi_admin (the only view-as actor) has no teacher/school scope of their own, so the admin bypass this guards against doesn't exist on this endpoint (matches `actAsGuard.ts`'s documented exemption class) | **Clean** |
| `school/update-profile.ts` | (unchanged auth path; diff is input-only) | Not re-examined this pass (diff was `region_code` FK-validation only) | Not re-examined | **Not re-audited — diff out of authz scope** |
| `teacher/create-class-learner.ts` | `verifyAuthToken` + `canTeachClass` | Yes — `classId` checked via shared predicate | **Yes** (`rejectIfViewAs`, present pre-diff, still wired) | **Clean** |
| `teacher/create-class-join-code.ts` | `verifyAuthToken` + `canTeachClass` | Yes — same predicate | **Yes** (`rejectIfViewAs`) | **Clean** |
| `teacher/by-code.ts` | none (deliberately public) | n/a — public join-code gateway by design | n/a | **Clean** — new per-IP throttle (TENANCY-06) + generic error messages replacing raw DB text |
| `teacher/classes.ts` | `verifyAuthToken` (create path) | n/a for POST (creates caller's own class); GET path not re-examined this pass | Not re-examined | **Diff (length caps) is clean; full endpoint not re-audited** |
| `player-events.ts` | `verifyAuthToken` (optional — guest telemetry is legitimate) | Yes for the play-as-class exception — cookie-claimed learner id checked against `resolveVisibleScope().classIds` (SEC0901-C-02) | n/a (not a staff-write endpoint) | **Clean**, with SEC0901-C-01 (event_type allowlist) as a low/info residual |
| `groups/table.ts` | `resolveGroupTreeCaller` | n/a — scope is always `caller.ownGroupId`, no client-supplied override | n/a (read-only) | **Clean**, SEC0901-C-03 (error leak) |
| `groups/tree.ts` | `resolveGroupTreeCaller` + `callerCanSeeGroup` | Yes — `?root=` checked via `callerCanSeeGroup` before use (`tree.ts:88`) | n/a (read-only) | **Clean**, SEC0901-C-03 (error leak) |
| `groups/[id]/home.ts` | `resolveGroupTreeCaller` + `callerCanSeeGroup` | Yes — `:id` checked via `callerCanSeeGroup` (`home.ts:145`) | n/a (read-only) | **Clean**, SEC0901-C-03 (error leak) |
| `email/verify.ts` | `getAuthUserId` | Yes — trivially: the write target is always the caller's own learner row (`.eq('user_id', userId)`), never client-supplied; new OTP-guess throttle (AUTH-CORE-04) on both email and auth_user_id axes; collision probe now fails closed (AUTH-CORE-06) | n/a (self-write only) | **Clean** |

---

## What held (controls verified, not just assumed)

- **`canTeachClass` / `classTeacherAuth.ts`** (`roster.ts`, `create-class-learner.ts`,
  `create-class-join-code.ts`): all three call sites pass the class's `id`, `teacher_user_id`, `school_id`,
  `group_id` straight through from a fresh DB read — none of them narrow or reshape the row before handing
  it to the predicate, which is the exact kind of wiring bug that would silently reopen TENANCY-08. The
  predicate itself is independently and thoroughly tested in
  `api/_utils/classTeacherAuth.tagAdmin.test.ts` (10 tests, including cross-school and revoked-tag denial).
- **`descendantIds` / `groupSubtree.ts`** (`rate-compare.ts`): the parent_id walk that replaced
  `path LIKE`-prefix matching is used consistently across all four cohort branches in `rate-compare.ts`
  (class-vs-group, school-vs-group, group-vs-region, group/school-vs-global) — no branch was missed in the
  rewrite. Regression-locked by `api/_utils/groupSubtree.test.ts` ("excludes an unrelated root — including
  one that would share a slug") and by `rate-compare.test.ts`'s ancestor/descendant exclusion tests.
- **`class-progress.ts` learner/course derivation**: every one of the 13 `Method` branches receives
  `learnerId`/`courseId` from the server-side class lookup, never from `req.body`. Traced each branch by
  hand; none accept a client-supplied learner or course id.
- **Mass-assignment guards**: `updateLegoProgress` (`pickLegoProgressUpdates`) and `saveLegoProgress`
  (explicit field list) both allow-list exactly the columns the client is meant to touch — identity columns
  and the row id are never in the writable set.
- **`rejectIfViewAs`**: present and wired on both endpoints in my slice that carry a deliberate ssi_admin
  support bypass (`create-class-learner.ts`, `create-class-join-code.ts`), matching the doctrine in
  `actAsGuard.ts`'s own docstring. Confirmed by the pre-existing tests
  ("rejects an admin write attempted while viewing-as…") in both files' `.test.ts` siblings — still green.
- **OTP throttling** (`email/verify.ts`): dual-axis (email + auth_user_id), logged before the guess is
  relayed (so an abandoned request still spends budget), and the learner-collision probe fails closed on a
  DB error rather than silently treating "unreadable" as "no collision."
- **Rate/entropy on the public gateway** (`teacher/by-code.ts`): shares the estate-wide
  `codeAttemptThrottle` bucket and limit with the other three code-guessing surfaces, so a sweep spread
  across all four accumulates in one place rather than resetting per-endpoint.

## Gaps — what I did not cover, and why

- **`school/update-profile.ts`, `teacher/classes.ts` GET path**: the diffs in my slice for these two were
  input-validation-only (region FK check, length caps) and did not touch authorization, so I did not
  re-derive their full authz path from scratch. UNVERIFIED beyond "the diff itself introduces no new IDOR."
- **`class-progress.ts`'s view-as posture**: I reasoned from the endpoint's own role gate (govt_admin
  excluded, teacher/school_admin only) that an ssi_admin viewing-as has no scope here, mirroring
  `rename-class.ts`'s exemption — but I did not independently write a test proving an ssi_admin token with
  `X-Ssi-View-As: 1` and a forged `resolveVisibleScope` result is refused. UNVERIFIED; would need a test
  forcing `resolveVisibleScope` to return a teacher-shaped scope for an admin identity to be certain.
- **SEC0901-C-04** (`teacher/classes.ts` course_code): traced statically only; did not exercise the actual
  content-delivery/entitlement path, which belongs to Area D.
- **The three `groups/*` files' full read-side correctness** (e.g., whether `computeNodeExtras` or
  `directMemberPracticeSeconds` themselves leak cross-tenant data once scope is established) was out of
  my brief's IDOR/input-handling focus and is unchanged code the 08-25 audit already catalogued
  (`docs/security-audit-2026-08-25/handler-map.md:110,114,115`) — I verified the entry-point scope check
  only, not every downstream query inside those handlers.
- **Load/DoS shape of `player-events.ts`**: `MAX_BATCH = 50` and 8 KB/payload are bounded, but I did not
  check whether a client can send an unbounded RATE of 50-event batches (i.e., no request-level rate limit
  on the endpoint itself, only on payload shape). UNVERIFIED — would need to check for a request-level
  throttle alongside the payload caps.

## Tests added this pass

- `api/playerEventsAttribution.security.test.ts` (5 tests, SECURE-ASSERTION — the play-as-class exception)
- `api/groups/groupsErrorLeakage.security.test.ts` (4 tests, CHARACTERIZATION — SEC0901-C-03)
- Grew the pinned roster in `api/_utils/securityTestMachineryIntegrity.security.test.ts` to include the new
  `groupsErrorLeakage` file (the `playerEventsAttribution` filename was already present in the pin before I
  wrote it, so no roster change was needed there).

Full suite after these additions: **142 files, 1578 passing, 5 skipped, 11 todo** — 0 failures.
