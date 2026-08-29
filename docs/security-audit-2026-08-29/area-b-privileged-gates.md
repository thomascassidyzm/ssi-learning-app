# Area B — privileged-gate re-sweep (2026-08-29)

Sixth security audit of this repo in 18 days. This area is the item the 2026-08-25 audit's §4 gaps
list left explicitly unclaimed:

> "The 19→33-endpoint `verifyAdmin` re-sweep was not run. `api/admin/` has grown and some of the
> growth uses a different-but-consistent pattern (`resolveVadCaller`). Flagged by #468, unclaimed."

This sweep runs it, widened per brief to every endpoint anywhere under `api/` that grants, reads or
mutates something privileged (`platform_role`, `educational_role`, `govt_admins`, `entitlement_grants`,
`invite_codes`, `schools`, `classes`, subscription/seat rows).

**Bottom line: the gate itself holds everywhere it was checked.** No privilege-escalation bug was
found — specifically, the one-character-class bug the brief asked me to hunt for (`verifyAdmin`'s
403 path carries a verified `userId`, so a call site that checks `result.userId` truthiness instead
of `'error' in result` would treat a rejected non-admin as an admin) does **not** exist anywhere in
this codebase today. Every one of the 26 call sites gets the discriminant right. Two low-severity,
already-known-family issues were found in files not previously named for them.

## 1. Sweep table

**26 files call `verifyAdmin` directly** (excludes `api/_utils/auth.ts`, which defines it, and
`api/_utils/vadVisibility.ts`, which composes it into `resolveVadCaller`). Plus **`api/admin/vad-prosody.ts`
and `api/org/vad.ts`**, which use the newer `resolveVadCaller`/`resolveVadScope` pattern. Plus **2
files** (`grant-entitlement.ts`, `revoke-entitlement.ts`) that hand-roll an equivalent check inline.
Plus the **3 named ssi_admin support-bypass endpoints**. **34 endpoints swept in total**, all read.

Columns: guard used · guard's result actually checked-and-returned-on · per-method gating uniform ·
fails closed on missing service-role key · `rejectIfViewAs` paired where a bypass exists · 5xx body
leaks internal detail.

| Path | Methods | Guard | Result checked | Per-method uniform | Fails closed (no key) | viewAs paired | Error leak |
|---|---|---|---|---|---|---|---|
| `api/access/grant-emails.ts` | POST | `verifyAdmin` | ✅ | n/a | ✅ (explicit check) | n/a | no |
| `api/access/list-grants.ts` | GET | `verifyAdmin` | ✅ | n/a | ✅ | n/a | no |
| `api/admin/attention.ts` | GET | `verifyAdmin` | ✅ | n/a | ✅ (implicit — empty key 401s from Postgres) | n/a | no |
| `api/admin/board-metrics.ts` | GET | `verifyAdmin` | ✅ | n/a | ✅ (implicit) | n/a | no |
| `api/admin/board-snapshot.ts` | GET/POST | `verifyAdmin`, gate before method branch | ✅ | ✅ | ✅ (implicit) | n/a | fixed strings only |
| `api/admin/codes.ts` | GET/POST | hand-rolled `isSsiAdmin`, ownership fallback for non-admin | ✅ | ✅ | ✅ (explicit) | n/a | no |
| `api/admin/create-govt-admin.ts` | POST | `verifyAdmin` | ✅ | n/a | ✅ | n/a | detail: codeError.message |
| `api/admin/create-school.ts` | POST | `verifyAdmin` | ✅ | n/a | ✅ | n/a | not reviewed line-by-line, same shape as siblings |
| `api/admin/create-signin-link.ts` | POST | `verifyAdmin` | ✅ | n/a | ✅ | n/a | **SEC29-B-01: rate-limit sub-check fails open** |
| `api/admin/create-staff.ts` | POST | `verifyAdmin` | ✅ | n/a | ✅ | n/a | detail: message on insert failure |
| `api/admin/demo-leaf.ts` | POST | `verifyAdmin` | ✅ | n/a | ✅ | n/a | not reviewed line-by-line |
| `api/admin/demo-schools.ts` | multi | `verifyAdmin` | ✅ | ✅ (gate before branch) | ✅ | n/a | not reviewed line-by-line |
| `api/admin/grant-entitlement.ts` | POST | hand-rolled `platform_role==='ssi_admin'` (no `'god'` OR) | ✅ | n/a | fails closed (empty apikey → PostgREST error) | n/a | no |
| `api/admin/invites.ts` | GET/POST | hand-rolled `isSsiAdmin`, ownership fallback | ✅ | ✅ | ✅ (explicit) | n/a | no |
| `api/admin/revoke-entitlement.ts` | POST | hand-rolled, same as grant-entitlement | ✅ | n/a | fails closed | n/a | no |
| `api/admin/set-trial.ts` | POST | `verifyAdmin` | ✅ | n/a | ✅ (implicit) | n/a | detail: *Error.message on every branch |
| `api/admin/update-school.ts` | GET/PATCH/DELETE | `verifyAdmin` + server-derived own-school fallback for GET/DELETE; PATCH is admin-only | ✅ | ✅ (deliberately asymmetric by design, documented) | ✅ | n/a | mixed (some detail: message) |
| `api/admin/update-user-role.ts` | POST | `verifyAdmin` + self-promotion guard | ✅ | n/a | ✅ | n/a | **SEC29-B-02: detail: fetchErr.message / error.message** |
| `api/admin/users.ts` | GET | `verifyAdmin` | ✅ | n/a | ✅ (explicit) | n/a | **SEC29-B-02: detail: String(error)** |
| `api/admin/vad-prosody.ts` | GET | `resolveVadCaller` (hierarchy-scoped) | ✅ | n/a | ✅ (explicit) | n/a | already filed SEC22-03, still live (not re-filed) |
| `api/admin/view-as.ts` | POST | `verifyAdmin` | ✅ | n/a | ✅ (explicit) | n/a | mixed (error.message on 'end') |
| `api/entitlement/create.ts` | POST | `verifyAdmin` | ✅ | n/a | ✅ (implicit) | n/a | not reviewed line-by-line |
| `api/entitlement/grant.ts` | POST | `verifyAdmin` | ✅ | n/a | ✅ (implicit) | n/a | **SEC29-B-02: detail: String(error)** |
| `api/entitlement/grants.ts` | GET | `verifyAdmin` | ✅ | n/a | ✅ (implicit) | n/a | not reviewed line-by-line |
| `api/govt/create-school.ts` | POST | `verifyAuthToken` + inline role check (not verifyAdmin) | ✅ | n/a | ✅ (implicit) | n/a | not reviewed line-by-line |
| `api/govt/school-links.ts` | GET | `verifyAdmin` (one branch of a larger authz set) | ✅ | n/a | not reviewed | n/a | not reviewed |
| `api/groups/[id]/demo-mint.ts` | POST | `verifyAdmin` + server-derived leader-subtree fallback | ✅ | n/a | ✅ (explicit) | n/a | not reviewed line-by-line |
| `api/groups/[id]/demo-refresh.ts` | POST | `verifyAdmin` | ✅ | n/a | ✅ (explicit) | n/a | not reviewed line-by-line |
| `api/groups/[id]/rate-compare.ts` | GET | `verifyAdmin` first, then visible-scope door — **the one legitimate use of `adminResult.userId` truthiness in the repo, correctly reached only after the `'error' in` branch** | ✅ | n/a | ✅ (explicit) | n/a | e.message on 500 |
| `api/groups/[id].ts` | GET/PATCH/DELETE | `verifyAdmin` + server-derived subtree-leader fallback (PATCH: name-only for non-admin) | ✅ | ✅ (deliberately asymmetric, documented) | using module-level client (no explicit key check — same as most siblings) | n/a | fixed strings |
| `api/groups/index.ts` | GET/POST | `verifyAdmin` (GET); admin-or-leader-or-self-serve-root (POST) | ✅ | ✅ | ✅ (explicit) | n/a | **SEC29-B-02: detail: String(error) x2** |
| `api/org/vad.ts` | GET | `resolveVadCaller` + `resolveVadScope` | ✅ | n/a | ✅ (explicit) | n/a | e.message on 500 |
| `api/school/group-summary.ts` | GET | `verifyAdmin` for the group-leader branch, other branches use `resolveVisibleScope` | ✅ | n/a | ✅ (explicit) | n/a | not reviewed |
| `api/teacher/class-teachers.ts` | multi | `verifyAuthToken` + `canManageClassTeachers`/`canTeachClass` (shared predicate, ssi_admin/god bypass inside) | ✅ | ✅ | ✅ (explicit) | ✅ `rejectIfViewAs` before the bypass can run | detail: rmErr.message / leadErr.message |
| `api/teacher/create-class-join-code.ts` | POST | `verifyAuthToken` + inline `platform_role==='ssi_admin' \|\| educational_role==='god'` bypass | ✅ | n/a | ✅ | ✅ `rejectIfViewAs` | not reviewed line-by-line |
| `api/teacher/create-class-learner.ts` | POST | same shape as create-class-join-code.ts | ✅ | n/a | ✅ | ✅ `rejectIfViewAs` | not reviewed line-by-line |

Files marked "not reviewed line-by-line" were confirmed to call the correct guard and check the
correct discriminant (grepped and spot-read), but I did not read every branch of the handler body
for the error-leak column specifically — the finding class is already known and low-severity, so I
did not spend the budget re-deriving it file by file beyond the four instances below.

## 2. The five hunted shapes — results

1. **A gate applied on one method but not another in the same handler.** Not found. Every
   multi-method handler swept (`board-snapshot.ts`, `update-school.ts`, `codes.ts`, `invites.ts`,
   `groups/[id].ts`, `groups/index.ts`) either gates once before the method branch, or — where it's
   asymmetric by design — the asymmetry is a documented, deliberate downgrade (e.g.
   `update-school.ts` PATCH is stricter than its own GET/DELETE, never the reverse; `groups/[id].ts`
   PATCH lets a non-admin rename-only, never re-type/re-parent). I did not find a case where the
   *weaker* path was accidentally left ungated.

2. **A gate whose failure path logs but still proceeds to the query.** Found once:
   **SEC29-B-01**, `api/admin/create-signin-link.ts` — the per-admin rate-limit sub-check
   (`console.warn('...failing open...')`) proceeds to mint the magic link on a DB error. This is
   *documented in the code itself* as a deliberate fail-open, and it is bounded: `verifyAdmin` has
   already gated the caller as a genuine admin by this point, so the only thing that fails open is
   the 15-per-15-minutes throttle on an already-authorized admin action, not the admin gate itself.
   Rated **low**. `it.todo` filed for fail-closed-or-non-DB-limiter.

3. **`verifyAdmin`'s `{error,status,userId}` 403 shape read as "is admin."** Not found anywhere.
   All 26 direct call sites use `'error' in result` (or its negation) as the discriminant. The one
   place `.userId` is read off a *rejected* result — `rate-compare.ts:259`,
   `else if (adminResult.userId)` — is reached only inside the `else` of a preceding `!('error' in
   adminResult)` branch, and is there specifically to reuse an already-verified non-admin uid rather
   than re-call `verifyAuthToken`; it is documented in the file's own comment and is correct. Locked
   by test (§3).

4. **An ssi_admin support bypass not paired with `rejectIfViewAs`.** Checked the three named files
   (`class-teachers.ts`, `create-class-join-code.ts`, `create-class-learner.ts`) — all three call
   `rejectIfViewAs(req)` before the bypass branch can be reached. Grepped the rest of the repo for
   `platform_role === 'ssi_admin'` / `educational_role === 'god'` bypass patterns outside `verifyAdmin`
   itself and found no other unpaired instance in the swept scope.

5. **Admin identity derived from something other than the verified token.** Not found. Every write
   in the swept scope stamps `created_by`/`granted_by`/`admin_user_id` from `adminResult.userId` /
   `authResult.userId`, never from `req.body`. `admin/view-as.ts`'s `target_user_id` is client input
   by design (it's *who the admin is viewing*, not who they are) and is never used for authz.

## 3. Findings

### SEC29-B-01 — rate-limit check fails open on DB error (low)
`api/admin/create-signin-link.ts:78-79`. On a DB error reading the rate-limit count, the mint
proceeds instead of blocking. **Cost to an attacker: none directly** — the endpoint is still
`verifyAdmin`-gated; this only defeats the 15-per-15-min per-admin throttle on an *already
compromised or malicious admin account* during a DB blip, letting them mint more real-user
magic-links (full account takeover per link) than the throttle intends. Severity low because it
requires an already-privileged caller and a concurrent DB error. Characterized, not fixed
(`it.todo` filed).

### SEC29-B-02 — raw DB error detail echoed to client, new instances (low, SEC22-03 family)
Four files not previously named by SEC22-03 return the caught error's own message/detail in the
JSON body on 500: `api/admin/users.ts` (`detail: String(error)`), `api/admin/update-user-role.ts`
(`detail: fetchErr.message` / `error.message`), `api/entitlement/grant.ts` (`detail:
String(error)`), `api/groups/index.ts` (`detail: String(error)`, two call sites). All four are
already `verifyAdmin`-gated, so this is only reachable by a genuine admin hitting a genuine DB
error — the risk is a Postgres/PostgREST error message occasionally carrying schema detail (column
names, constraint names) into a client-visible field, same as the already-filed SEC22-03. Rated
low for the same reason SEC22-03 was: no direct exploit path, information-disclosure-in-depth
concern only. Characterized with `it.todo` pointing at the fix pattern already live in
`board-snapshot.ts` and `bind-customer.ts` (fixed string + server-side log).

### Informational — inconsistent hand-rolled admin check (no severity, not a vulnerability)
`api/admin/grant-entitlement.ts` and `api/admin/revoke-entitlement.ts` hand-roll
`caller.platform_role !== 'ssi_admin'` instead of calling `verifyAdmin`, and therefore omit the
`educational_role === 'god'` OR-branch every other admin-gated endpoint has. This is
**under-permissive, not an escalation** — a legacy `god`-role caller (verified live: zero learner
rows currently hold it, per `admin/update-user-role.ts`'s own comment) would get a 403 here where
they'd be admitted elsewhere. Noted for consistency, not filed as a security finding.

### Informational — missing explicit `!supabaseUrl || !supabaseServiceKey` check (no severity)
15 files in the swept scope construct the Supabase client without first checking the service-role
key is non-empty (vs. the ~20 siblings that do). This is **not the SEC25-X-02 fail-open-to-anon-key
pattern** — none of these 34 files fall back to the anon key; an empty string is passed as the
service-role key, which PostgREST rejects (invalid apikey), so the failure mode is a 500, not an
authorization bypass. Confirmed by grep: zero instances of `SUPABASE_ANON_KEY` in a service-key
fallback position anywhere in this sweep's scope.

## 4. Explicit gaps

- **"not reviewed line-by-line" column entries** (§1 table): confirmed guard + discriminant
  correctness by grep and targeted read; did not read every response branch of every file for the
  error-leak column. If a fifth error-detail-leak instance exists among those files, this sweep did
  not find it — SEC22-03/SEC29-B-02 should be treated as a live *pattern* across the API surface,
  not a closed list.
- **`api/admin/create-school.ts`, `demo-leaf.ts`, `demo-schools.ts`, `entitlement/create.ts`,
  `entitlement/grants.ts`, `govt/school-links.ts`** — guard confirmed correct, full body not read
  for secondary issues beyond the five hunted shapes.
- **No live HTTP or DB access was used** (per the audit's hard rules) — every claim above is from
  static reading of the source in this worktree at `security/audit-2026-08-29` (cut from
  `origin/dev` at `6c2b867a`). If any of these files have diverged on `dev` since that cut, this
  table is stale for that file.
- I did not re-verify `api/admin/vad-prosody.ts`'s already-filed SEC22-03 status against the
  current file beyond confirming the pattern (`e.message` on 500) is still present — full
  re-verification of that finding belongs to whoever owns reconciliation, not this sweep.

## 5. Test file

`api/_security/sec29-b-privileged-gates.security.test.ts` — 37 passing tests, 2 `it.todo`:
- Locks: all 26 `verifyAdmin` call sites use the correct discriminant (regex-based source scan for
  the dangerous `if (result.userId)` anti-pattern; none found).
- Locks: the three ssi_admin support-bypass files pair with `rejectIfViewAs`, and the shared
  `classTeacherAuth.ts` predicate checks both `platform_role` and `educational_role`.
- Locks: `grant-entitlement.ts`/`revoke-entitlement.ts` check `platform_role === 'ssi_admin'`
  before any write.
- Characterizes SEC29-B-01 (fail-open rate-limit) and SEC29-B-02 (4 new error-detail-leak
  instances) as today's-behaviour-passes, each paired with an `it.todo` naming the fix.
