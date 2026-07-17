# Plan 009: Close the entitlement-code cap bypass (claim-first, like the invite path)

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- api/code/redeem.ts`
> If it changed, re-read the entitlement branch below before editing.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (claim-first re-introduces a "downstream failure burns a use" tradeoff
  — the invite path already accepts it; apply the same reasoning)
- **Depends on**: 004 (webhook/entitlement tests give a safety net; not strictly
  required but strongly recommended before touching money code)
- **Category**: bug
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

The entitlement-code branch of `api/code/redeem.ts` checks `use_count >= max_uses`,
then inserts the grant, then claims a use **last** — and the claim's `false` result
(code exhausted) is only `console.warn`ed, never rolled back. So two users racing on
the last use of a capped entitlement code both pass the early check and both receive
`user_entitlements` rows; only one use is claimed. The per-user `UNIQUE(learner_id,
entitlement_code_id)` only stops the *same* user double-redeeming. For paid-access
codes, the cap is advisory under concurrency. The invite branch in the same file does
it correctly (claim-first gates the grant).

## Current state

`api/code/redeem.ts`, entitlement branch:

```ts
// :586-589  early check (racy)
  if (entitlementRow.max_uses !== null && entitlementRow.use_count >= entitlementRow.max_uses) {
    res.status(200).json({ success: false, error: 'Code fully used' }); return
  }
  ...
// :621-635  grant inserted FIRST
  const { error: insertError } = await supabase.from('user_entitlements').insert({...})
  if (insertError) { ...; res.status(500)...; return }
// :637-647  claim LAST, non-fatal
  try {
    const claimed = await claimCodeUse(supabase, 'entitlement_codes', 'claim_entitlement_code_use', entitlementRow.id)
    if (!claimed) console.warn('[CodeRedeem] entitlement use not claimed (code exhausted/expired after grant):', entitlementRow.id)
  } catch (e) { console.error('[CodeRedeem] Failed to claim entitlement use (non-fatal, entitlement granted):', e?.message) }
```

The **correct** pattern is the invite branch in the same file (`redeemInviteCode`,
around `:184-188`): it calls `claimCodeUse` **before** granting and returns "Code fully
used" when the claim fails. `claimCodeUse` (in `api/_utils/`) runs an atomic RPC
(`claim_entitlement_code_use` / the invite equivalent) that increments use_count only
if under the cap, returning whether it succeeded.

Test file: `api/code/redeem.test.ts` (exists — has the Supabase mock + concurrency
cases already).

## Commands you will need

| Purpose      | Command                                | Expected |
|--------------|----------------------------------------|----------|
| Install      | `pnpm install`                         | exit 0   |
| Test redeem  | `pnpm test:api -- api/code/redeem`     | pass     |
| All API tests| `pnpm test:api`                        | all pass |
| API typecheck| `pnpm typecheck:api`                   | exit 0   |

## Scope

**In scope**:
- `api/code/redeem.ts` — the entitlement branch: reorder to claim-first (mirror the
  invite branch), or delete the just-inserted grant when the claim returns false.
- `api/code/redeem.test.ts` — add a race/exhaustion test for the entitlement branch.

**Out of scope**:
- The invite branch (already correct).
- The `claimCodeUse` helper / the RPC (assume correct — it's used by the working
  invite path). Do not change its signature.
- The per-user UNIQUE constraint (leave it — it's a complementary backstop).

## Git workflow

- Branch: `advisor/009-entitlement-code-cap-race` from `dev`.
- Commit style: `fix(api): claim entitlement-code use before granting (close cap bypass)`.

## Steps

### Step 1: Reorder to claim-first

Move the `claimCodeUse` call to **before** the `user_entitlements` insert, matching
the invite branch. If `claimed === false`, return `{ success: false, error: 'Code
fully used' }` and do **not** insert the grant. Keep the existing per-user "already
redeemed" `maybeSingle` check ahead of the claim (so a same-user re-redeem returns the
friendly message without burning a use — confirm ordering preserves that).

Accept the invite path's documented tradeoff: if the grant insert later fails (500),
one use is burned. This matches the invite branch's deliberate choice; note it in a
comment referencing the invite branch.

**Verify**: `pnpm typecheck:api` exits 0.

### Step 2: Add a race/exhaustion test

In `redeem.test.ts`, add a test where the `claim_entitlement_code_use` RPC responder
returns `claimed:false` (code exhausted). Assert: no `user_entitlements` insert was
recorded, and the response is `{ success:false, error:'Code fully used' }`. Use the
existing `writes` recorder to assert the absence of the insert.

**Verify**: `pnpm test:api -- api/code/redeem` — new test passes and fails if Step 1
is reverted (with the old order the insert *would* be recorded).

### Step 3: Full suite green

**Verify**: `pnpm test:api` all pass.

## Test plan

- New test: "entitlement redemption does not grant when the atomic claim reports the
  code exhausted."
- Keep any existing same-user re-redeem test passing (ordering must not regress it).
- Pattern: existing concurrency tests in `redeem.test.ts`.

## Done criteria

ALL must hold:

- [ ] In the entitlement branch, `claimCodeUse` runs before the `user_entitlements`
      insert; a failed claim skips the insert.
- [ ] New test proves no grant on exhausted claim; existing redeem tests still pass.
- [ ] `pnpm test:api` all pass; `pnpm typecheck:api` exits 0.
- [ ] Only the two in-scope files changed.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- The `claim_entitlement_code_use` RPC is not actually atomic (check its definition in
  `supabase/migrations/` — it should increment-if-under-cap in one statement). If it's
  a non-atomic read-then-write, the reorder alone doesn't fully close the race — report
  so the RPC can be fixed first.
- Reordering breaks the same-user "already redeemed" behavior.
- The entitlement branch doesn't match the excerpt (drift).

## Maintenance notes

- After this, both code branches share the claim-first invariant. Any new code-granting
  branch must claim before it grants.
- Reviewer: confirm the atomic RPC is the real gate; the app-level check is only an
  early-out.
