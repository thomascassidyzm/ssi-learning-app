# Plan 011: Give entitlement tokens a dedicated HMAC secret (stop reusing the service-role key)

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- api/_utils/audioAccess.ts api/try-link/validate.ts`
> If either changed, re-read the fallback lines before editing.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (tokens minted under the old fallback simply expire; short-lived)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

The HMAC signing secret for entitlement tokens falls back to the Supabase
**service-role key** when `ENTITLEMENT_TOKEN_SECRET` is unset. That couples two very
different trust tiers: a high-value, all-powerful DB credential is repurposed to sign
low-value, widely-distributed entitlement tokens. It broadens where the service-role
key is referenced in signing code and means rotating the entitlement secret would
force a service-role rotation. The key isn't exposed to clients, so this is hardening,
not an active leak — but it's cheap to fix and removes a latent coupling.

## Current state

- `api/_utils/audioAccess.ts:176-178`:
  ```ts
  const entitlementSecret = (
    process.env.ENTITLEMENT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  ).trim()
  ```
- `api/try-link/validate.ts:15-18` — the same `|| SUPABASE_SERVICE_ROLE_KEY` fallback
  for the entitlement/try-link token secret.
- Entitlement tokens are short-lived (they gate audio requests / try-links), so
  invalidating any tokens signed under the old fallback is low-impact.

## Commands you will need

| Purpose      | Command                                   | Expected |
|--------------|-------------------------------------------|----------|
| Install      | `pnpm install`                            | exit 0   |
| API typecheck| `pnpm typecheck:api`                       | exit 0   |
| API tests    | `pnpm test:api`                           | all pass |

## Scope

**In scope**:
- `api/_utils/audioAccess.ts` — remove the service-role fallback; require a dedicated
  secret; fail closed in production if unset.
- `api/try-link/validate.ts` — same change (and any other file with the identical
  `ENTITLEMENT_TOKEN_SECRET || SUPABASE_SERVICE_ROLE_KEY` fallback — grep in Step 1).

**Out of scope**:
- The token format / HMAC algorithm — unchanged (so tokens signed with a correctly-set
  `ENTITLEMENT_TOKEN_SECRET` keep verifying).
- Provisioning the env var in Vercel — that's an operator action; document it (see
  Maintenance) but the code change is what this plan delivers.
- The fail-open `ENTITLEMENT_STRICT` behavior — that's a separate tracked item, not
  this plan.

## Git workflow

- Branch: `advisor/011-entitlement-hmac-secret` from `dev`.
- Commit style: `fix(security): require dedicated ENTITLEMENT_TOKEN_SECRET (no service-role fallback)`.

## Steps

### Step 1: Find all fallback sites

`grep -rn "ENTITLEMENT_TOKEN_SECRET" api/` — expect `audioAccess.ts` and
`try-link/validate.ts` (and possibly a minting site). Every read of the secret must be
changed consistently.

### Step 2: Remove the fallback; fail closed in prod

Replace the `|| process.env.SUPABASE_SERVICE_ROLE_KEY` fallback with a dedicated read:
```ts
const entitlementSecret = (process.env.ENTITLEMENT_TOKEN_SECRET || '').trim()
```
Add a guard: if `entitlementSecret` is empty **and** the runtime is production
(`process.env.VERCEL_ENV === 'production'` or the repo's existing prod check — match
how the crons fail closed on missing `CRON_SECRET`), throw / refuse to sign or verify
rather than silently using an empty secret. In non-prod, an empty secret may fall back
to a clearly-marked dev default or also throw — match the crons' posture.

**Verify**: `pnpm typecheck:api` exits 0.

### Step 3: Keep mint and verify consistent

Ensure the minting side and the verifying side both read the secret the same way (if
minting is in a different file, apply the same change there). A mismatch would make all
tokens fail to verify.

**Verify**: `grep -rn "SUPABASE_SERVICE_ROLE_KEY" api/ | grep -i entitlement` returns
nothing; `pnpm test:api` all pass.

### Step 4: Tests

If there's an existing test that mints+verifies an entitlement token (check
`api/audio/*.test.ts` and any try-link test), ensure it sets `ENTITLEMENT_TOKEN_SECRET`
in its env setup (like `redeem.test.ts` sets `SUPABASE_*`). Add a test asserting that
minting/verifying with a set secret round-trips, and (if feasible) that the prod
fail-closed path throws when the secret is absent.

**Verify**: `pnpm test:api` all pass.

## Test plan

- Round-trip test: token minted and verified with a set `ENTITLEMENT_TOKEN_SECRET`.
- Fail-closed test (if the prod check is testable): absent secret in prod mode →
  refuse.
- Verification: `pnpm test:api` all pass.

## Done criteria

ALL must hold:

- [ ] No entitlement-secret read falls back to `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Missing secret in production fails closed (matches the cron posture).
- [ ] Mint and verify sites read the secret identically.
- [ ] `pnpm test:api` all pass; `pnpm typecheck:api` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- Removing the fallback would break existing tests that relied on the service-role key
  being the signer (fix the test env instead — but report if the coupling is deeper
  than env setup).
- There's a mint site you can't locate the verify counterpart for (or vice versa) —
  report rather than risk a mint/verify secret mismatch in prod.

## Maintenance notes

- **Operator action required after merge**: set `ENTITLEMENT_TOKEN_SECRET` in Vercel
  (all environments) to a fresh random value BEFORE deploying, or the prod fail-closed
  guard will refuse to sign. Note this in the PR description so it isn't missed.
- Do NOT reproduce any secret value in the repo or logs.
- Reviewer: confirm mint and verify read the same env var.
