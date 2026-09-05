/**
 * Tests for the shell-claim rule (api/_utils/shellClaim.ts) — the one place
 * that answers "may this invite bind this account shell?". The endpoint-level
 * takeover chain is covered in api/auth/possession-redeem.test.ts; this is the
 * predicate on its own, where every refusal branch is cheap to state.
 */
import { describe, it, expect } from 'vitest'
import { buildShellClaim, clearedShellClaim, shellClaimMatches, SHELL_CLAIM_TTL_MS } from './shellClaim'

const user = (claim: unknown) => ({ app_metadata: claim === undefined ? {} : { possession_claim: claim } })

describe('buildShellClaim', () => {
  it('names the invite and stamps the time', () => {
    const at = new Date('2026-09-05T10:00:00.000Z')
    expect(buildShellClaim('invite-1', at)).toEqual({
      possession_claim: { invite_code_id: 'invite-1', claimed_at: '2026-09-05T10:00:00.000Z' },
    })
  })
})

describe('shellClaimMatches', () => {
  const now = new Date('2026-09-05T10:00:00.000Z')
  const fresh = { invite_code_id: 'invite-1', claimed_at: '2026-09-05T09:59:00.000Z' }

  it('accepts a fresh claim naming this invite', () => {
    expect(shellClaimMatches(user(fresh), 'invite-1', now)).toBe(true)
  })

  it('refuses a shell with no claim at all — the send-code residue an attacker can manufacture', () => {
    expect(shellClaimMatches(user(undefined), 'invite-1', now)).toBe(false)
  })

  it('refuses a claim naming a different invite', () => {
    expect(shellClaimMatches(user({ ...fresh, invite_code_id: 'invite-2' }), 'invite-1', now)).toBe(false)
  })

  it('refuses a claim older than the TTL', () => {
    const stale = { invite_code_id: 'invite-1', claimed_at: new Date(now.getTime() - SHELL_CLAIM_TTL_MS - 1000).toISOString() }
    expect(shellClaimMatches(user(stale), 'invite-1', now)).toBe(false)
  })

  it('accepts a claim exactly at the TTL boundary', () => {
    const edge = { invite_code_id: 'invite-1', claimed_at: new Date(now.getTime() - SHELL_CLAIM_TTL_MS).toISOString() }
    expect(shellClaimMatches(user(edge), 'invite-1', now)).toBe(true)
  })

  it('refuses a future-dated claim (broken clock or forgery)', () => {
    const future = { invite_code_id: 'invite-1', claimed_at: new Date(now.getTime() + 60_000).toISOString() }
    expect(shellClaimMatches(user(future), 'invite-1', now)).toBe(false)
  })

  it('refuses malformed claims and missing users without throwing', () => {
    expect(shellClaimMatches(user('not-an-object'), 'invite-1', now)).toBe(false)
    expect(shellClaimMatches(user({ invite_code_id: 'invite-1' }), 'invite-1', now)).toBe(false)
    expect(shellClaimMatches(user({ invite_code_id: 'invite-1', claimed_at: 'nonsense' }), 'invite-1', now)).toBe(false)
    expect(shellClaimMatches(null, 'invite-1', now)).toBe(false)
    expect(shellClaimMatches(user(fresh), '', now)).toBe(false)
  })
})

describe('clearedShellClaim', () => {
  it('nulls the claim while leaving the rest of app_metadata alone', () => {
    expect(clearedShellClaim({ provider: 'email', possession_claim: { invite_code_id: 'x' } }))
      .toEqual({ provider: 'email', possession_claim: null })
  })
})
