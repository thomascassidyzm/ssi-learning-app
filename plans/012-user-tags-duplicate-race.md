# Plan 012: Idempotent invite redemption — stop duplicate user_tags rows

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions — this plan touches the live DB and MUST use the canary
> runbook. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- api/code/redeem.ts supabase/migrations`
> Also re-read `CLAUDE.md`'s "RLS doctrine" and "Canonical RLS / auth pattern"
> sections before writing any migration.

## Status

- **Priority**: P2
- **Effort**: S (code) + a canaried migration
- **Risk**: MED (a migration on a shared dev/staging/prod DB; must dedupe existing
  rows first and follow the canary runbook)
- **Depends on**: none
- **Category**: bug / migration
- **Planned at**: commit `5fb4a42f`, 2026-07-17
- **Confidence note**: the race is certain from the code; the **absence** of a unique
  index on `user_tags` needs live-schema verification (Step 1). If an index already
  exists, this plan reduces to the `23505`-handling code change.

## Why this matters

The invite-redemption branches for `teacher`, `school_admin_join`, and `student` in
`api/code/redeem.ts` insert `user_tags` rows after a check-then-act dedup **read**,
with no `23505` (unique-violation) handling — unlike the `govt_admins` and `schools`
branches, which got unique-index backstops in the 2026-07-13 migration. Two concurrent
redemptions of the same invite by the same user (multi-tab, or a retry after timeout —
the client single-flight only covers one tab) both pass the dedup read and both
insert, producing duplicate active `SCHOOL:`/`CLASS:` tags. Downstream `.single()` /
count reads over `user_tags` then error or double-count the member. This is the same
race that produced "3 schools rows for one admin on staging" before the schools unique
index landed.

## Current state

`api/code/redeem.ts` — the three unguarded branches (`:450-495`):

```ts
  } else if (codeType === 'school_admin_join') {
    const { error: tagError } = await supabase.from('user_tags').insert({
      user_id: userId, tag_type: 'school', tag_value: `SCHOOL:${inviteRow.grants_school_id}`,
      role_in_context: 'admin', added_by: userId,
    })
    if (tagError) { console.error(...); res.status(500)...; return }   // any error → 500, incl. 23505
  } else if (codeType === 'teacher') {
    const { error: tagError } = await supabase.from('user_tags').insert({
      user_id: userId, tag_type: 'school', tag_value: `SCHOOL:${inviteRow.grants_school_id}`,
      role_in_context: 'teacher', added_by: userId,
    })
    if (tagError) { console.error(...); res.status(500)...; return }
  } else if (codeType === 'student') {
    const { error: tagError } = await supabase.from('user_tags').insert({
      user_id: userId, tag_type: 'class', tag_value: `CLASS:${inviteRow.grants_class_id}`,
      role_in_context: 'student', added_by: userId,
    })
    if (tagError) { console.error(...); res.status(500)...; return }
  }
```

- The 2026-07-13 migration added unique-index backstops for `govt_admins`/`schools`;
  find it in `supabase/migrations/` (grep for the schools unique index) to copy the
  pattern.
- Canary toolkit + runbook: `supabase/secfix-toolkit/` (per `CLAUDE.md`).
- `user_tags` has a `removed_at`-style soft-delete concept (rows can be deactivated) —
  verify the exact column in Step 1 so the unique index is **partial** (active rows only).

## Commands you will need

| Purpose      | Command                                | Expected |
|--------------|----------------------------------------|----------|
| Install      | `pnpm install`                         | exit 0   |
| Test redeem  | `pnpm test:api -- api/code/redeem`     | pass     |
| All API tests| `pnpm test:api`                        | all pass |
| API typecheck| `pnpm typecheck:api`                   | exit 0   |

DB verification/migration commands come from `supabase/secfix-toolkit/` — read its
runbook; do not invent psql invocations.

## Scope

**In scope**:
- A new migration in `supabase/migrations/` adding a **partial unique index** on
  active `user_tags(user_id, tag_type, tag_value)` (exact column names per Step 1),
  preceded by a dedupe of any existing duplicate active rows, ending with
  `NOTIFY pgrst, 'reload schema';` (per `CLAUDE.md` doctrine rule 6).
- `api/code/redeem.ts` — treat `23505` on the three tag inserts as success
  (idempotent), mirroring the govt_admins/schools branches.
- `api/code/redeem.test.ts` — add an idempotency test.

**Out of scope**:
- RLS policy changes on `user_tags` (that's the gated org-table RLS work — do NOT
  turn on RLS here).
- The `govt_admins`/`schools` branches (already handled).
- Merging any learner rows (multiple accounts per person are intentional per `CLAUDE.md`).

## Git workflow

- Branch: `advisor/012-user-tags-duplicate-race` from `dev`.
- Commit style: `fix(api): idempotent user_tags insert + partial unique index (redeem race)`.

## Steps

### Step 1: Verify the live schema (gate the whole plan)

Using the secfix toolkit's read tooling, confirm against the live DB:
1. Whether a unique index already exists on `user_tags(user_id, tag_type, tag_value)`
   (or the active subset). If it does → skip Step 2's index, keep only the code change.
2. The exact soft-delete column (`removed_at`? `is_active`? `deleted_at`?) so the
   partial index predicate is correct.
3. Whether duplicate active rows already exist today (they must be deduped before a
   unique index can be created).

**Verify**: findings recorded. If you cannot safely read the live schema, STOP.

### Step 2: Write the dedupe + partial unique index migration

Model on the 2026-07-13 schools unique-index migration. The migration must:
1. Delete/deactivate existing duplicate active rows (keep the earliest per group).
2. `CREATE UNIQUE INDEX ... ON user_tags (user_id, tag_type, tag_value) WHERE <active predicate>;`
3. End with `NOTIFY pgrst, 'reload schema';`.
Do NOT apply it yet.

**Verify**: migration file present; SQL reviewed against the doctrine (partial index,
NOTIFY at end).

### Step 3: Make the three inserts idempotent

In `redeem.ts`, for each of the three branches: if `tagError` is a `23505`
unique-violation, treat it as success (the tag already exists — the redemption is
idempotent) instead of returning 500. Match exactly how the govt_admins/schools
branches handle `23505`.

**Verify**: `pnpm typecheck:api` exits 0.

### Step 4: Test

In `redeem.test.ts`, add a test per branch (or one representative) where the
`user_tags` insert responder returns a `23505` error; assert the redemption still
succeeds (200, no 500). Pattern: existing redeem tests.

**Verify**: `pnpm test:api -- api/code/redeem` passes.

### Step 5: Apply the migration via the canary runbook

Follow `supabase/secfix-toolkit/`'s canary method: apply in one transaction, replay
real redemption queries, assert the unique index holds and legit redemptions still
work, COMMIT iff green. Stage on `staging` first per `CLAUDE.md`.

**Verify**: canary run green; no duplicate rows creatable.

### Step 6: Full suite green

**Verify**: `pnpm test:api` all pass; `pnpm typecheck:api` exits 0.

## Test plan

- New idempotency test(s) in `redeem.test.ts` (23505 → 200).
- The migration's own canary replay is the DB-level test.
- Verification: API suite passes; canary green.

## Done criteria

ALL must hold:

- [ ] Live schema verified (Step 1 findings recorded).
- [ ] Partial unique index exists on active `user_tags(user_id, tag_type, tag_value)`
      (or confirmed pre-existing).
- [ ] The three redeem branches treat `23505` as success.
- [ ] Idempotency test(s) pass; `pnpm test:api` all pass; `pnpm typecheck:api` exits 0.
- [ ] Migration applied via the canary runbook, staged on `staging` first.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- You cannot read the live schema or run the canary toolkit — this plan MUST NOT ship
  a blind migration on the shared prod DB.
- Existing duplicate active rows can't be deduped unambiguously (e.g. they differ in a
  meaningful column) — report for a human decision.
- Turning on the unique index would conflict with intentional duplicate tags (verify
  the semantics in Step 1).
- `redeem.ts` branches don't match the excerpt (drift).

## Maintenance notes

- Any future `user_tags`-writing path must also handle `23505` idempotently.
- This does NOT enable RLS on `user_tags` — that remains the gated org-table work.
- Reviewer: confirm the index predicate matches the real soft-delete column, or it
  will either be too strict (blocks re-adding after removal) or too loose (allows dupes).
