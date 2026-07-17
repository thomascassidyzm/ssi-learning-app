# Plan 007: Throttle the code-validation oracle and use a CSPRNG for codes

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- api/code/validate.ts api/_utils/codeGen.ts api/auth/possession-redeem.ts`
> If any changed, re-read them before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

`POST /api/code/validate` requires no auth and has **no rate limiting**. It returns a
discriminated `{valid, codeKind, ...}` for any submitted string. Codes are `ABC-123`
(3 consonants from a 24-char set + 3 digits ≈ 13.8M keyspace) and are minted with
`Math.random()`, which is not cryptographically secure and is predictable given
samples. Valid invite codes grant elevated `educational_role` (teacher /
school_admin / govt_admin) into a specific school/group on redemption, and
`api/auth/possession-redeem.ts` offers an unauthenticated path from a valid code to a
session — so enumeration → school infiltration. The sibling `possession-redeem`
endpoint already rate-limits per-IP and per-code; `validate` bypasses that entirely.

## Current state

- `api/code/validate.ts:18-56` — handler is unauthenticated, no throttle:
  ```ts
  export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(405)...; return }
    const { code } = req.body || {}
    ...
    const stripped = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    ...
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data: inviteRow } = await supabase.from('invite_code_validation')...
  ```
- `api/_utils/codeGen.ts:13-23` — weak RNG (note the share-code function right below it
  correctly uses `randomBytes`):
  ```ts
  export function generateCode(): string {
    let letters = ''
    for (let i = 0; i < 3; i++) letters += CODE_CONSONANTS[Math.floor(Math.random() * CODE_CONSONANTS.length)]
    let digits = ''
    for (let i = 0; i < 3; i++) digits += Math.floor(Math.random() * 10).toString()
    return `${letters}-${digits}`
  }
  ```
  `import { randomBytes } from 'crypto'` is already at the top of this file.
  Callers of `generateCode`: `api/invite/create.ts:147`, `api/entitlement/create.ts:108`,
  `api/try-link/create.ts:57`.
- **Existing rate-limit pattern to reuse** — `api/auth/possession-redeem.ts:143-199`
  uses a `possession_mint_attempts` table with per-IP then per-code windowed counts:
  ```ts
  const ipHash = hashIp(getClientIp(req))
  const { count: ipCount } = await supabase.from('possession_mint_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', new Date(Date.now() - RATE_WINDOW_MS).toISOString())
  if ((ipCount ?? 0) >= PER_IP_LIMIT) { await logAttempt(...); res.status(429)...; return }
  ```
  The migration `supabase/migrations/20260715_possession_mint_attempts.sql` created
  that table; `getClientIp`/`hashIp`/`logAttempt` helpers live alongside possession-redeem
  (find their import in that file and reuse them).

## Commands you will need

| Purpose          | Command                                             | Expected |
|------------------|----------------------------------------------------|----------|
| Install          | `pnpm install`                                       | exit 0   |
| API typecheck    | `pnpm typecheck:api`                                 | exit 0   |
| Test validate    | `pnpm test:api -- api/code/validate`                | pass     |
| All API tests    | `pnpm test:api`                                      | all pass |

## Scope

**In scope**:
- `api/code/validate.ts` — add per-IP (and optionally per-code) rate limiting reusing
  the possession-redeem pattern/table.
- `api/_utils/codeGen.ts` — replace `Math.random()` with `crypto.randomInt`.
- `api/code/validate.test.ts` (create) and/or `api/_utils/codeGen.test.ts` (create).

**Out of scope**:
- Widening the code keyspace/length (a product decision — note in Maintenance).
- The redemption logic in `api/code/redeem.ts` (its own plans).
- Changing the code **format** (`ABC-123`) — only the source of randomness.
- A new rate-limit table — reuse `possession_mint_attempts` (its schema already fits;
  confirm it has the columns you need or add a nullable `context`/reuse `invite_code_id`).

## Git workflow

- Branch: `advisor/007-code-enumeration-and-csprng` from `dev`.
- Commit style: `fix(security): throttle code/validate + CSPRNG for generated codes`.

## Steps

### Step 1: CSPRNG for generateCode

Rewrite `generateCode()` to draw each character index from `crypto.randomInt(n)`
instead of `Math.floor(Math.random()*n)`. Format unchanged (`ABC-123`). `randomBytes`
is already imported; `randomInt` is from the same `crypto` module — add it to the import.

**Verify**: `pnpm typecheck:api` exits 0; a quick unit test (Step 4) confirms format.

### Step 2: Rate-limit code/validate per IP

At the top of the `validate` handler (after method/body checks, before the DB
lookup), add a per-IP windowed count against `possession_mint_attempts` mirroring
`possession-redeem.ts:147-159`, returning `429` when the limit is exceeded. Reuse
`getClientIp`/`hashIp` and the same `RATE_WINDOW_MS`/`PER_IP_LIMIT` constants (import
or re-declare consistent values). Log the attempt via the same `logAttempt` helper so
the throttle has an audit trail. A per-code limit (after the code is resolved) is a
nice-to-have; per-IP is the minimum that closes the sweep.

**Verify**: `pnpm typecheck:api` exits 0.

### Step 3: Confirm the throttle table is reachable

`possession_mint_attempts` already exists (migration `20260715_...`). Confirm
`validate.ts`'s service-role client can read/insert it (it uses the same
service-role client possession-redeem does). No new migration should be needed; if the
table lacks a column you need for validate's context, prefer reusing existing columns
over altering the table (a schema change would be a separate canaried migration — see
`CLAUDE.md` RLS doctrine — and is out of scope here).

**Verify**: reasoning recorded; no migration file added unless unavoidable (if
unavoidable → STOP and report).

### Step 4: Tests

- `api/_utils/codeGen.test.ts`: `generateCode()` returns `^[A-Z]{3}-[0-9]{3}$` (and
  the consonant set excludes I/O); run it many times.
- `api/code/validate.test.ts`: model on `api/code/redeem.test.ts`'s Supabase mock;
  assert (a) a valid code returns `{valid:true}`, (b) after `PER_IP_LIMIT` attempts in
  the window the handler returns `429`. Mock the attempts-table count responder to
  simulate over-limit.

**Verify**: `pnpm test:api -- api/code api/_utils/codeGen` passes.

### Step 5: Full suite green

**Verify**: `pnpm test:api` all pass; `pnpm typecheck:api` exits 0.

## Test plan

- `codeGen.test.ts`: format + charset invariants over N iterations.
- `validate.test.ts`: valid-code happy path; over-limit → 429; invalid code → `{valid:false}`.
- Pattern: `api/code/redeem.test.ts`.
- Verification: `pnpm test:api` all pass.

## Done criteria

ALL must hold:

- [ ] `grep -n "Math.random" api/_utils/codeGen.ts` returns no matches.
- [ ] `api/code/validate.ts` returns `429` past a per-IP limit (test proves it).
- [ ] New tests exist and pass; `pnpm test:api` all pass; `pnpm typecheck:api` exits 0.
- [ ] No new migration added (or, if unavoidable, STOP was triggered and reported).
- [ ] Only in-scope files changed.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- Rate-limiting `validate` requires a schema change to `possession_mint_attempts`
  (a canaried migration is out of this plan's scope — report the needed column).
- The `getClientIp`/`hashIp`/`logAttempt` helpers are not importable from where
  `validate.ts` lives (report; do not duplicate hashing logic inconsistently).
- `possession-redeem.ts` no longer matches the excerpt (drift).

## Maintenance notes

- Product follow-up (not this plan): widen the keyspace/length for privileged code
  types (govt_admin/school_admin) so the throttle isn't the only defense.
- Keep `validate` and `possession-redeem` throttles consistent — if one's window/limit
  changes, revisit the other.
- Reviewer: confirm the 429 path also logs, so abuse is observable.
