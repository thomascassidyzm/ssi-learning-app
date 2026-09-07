/**
 * The squat-takeover rule (job #345), tested where it lives.
 *
 * Every case here is a step of the real attack, which was reproduced against
 * the live project on 2026-09-07 before any of this existed: type a stranger's
 * address into the purchase form, plant a password, keep the session, and wait.
 */
import { describe, it, expect } from 'vitest'
import {
  buildUnclaimedMint,
  readUnclaimedMint,
  clearedUnclaimedMint,
  provedMailbox,
  mayClaim,
  UNCLAIMED_MINT_KEY,
} from './unclaimedMint'

const OTP = [{ method: 'otp', timestamp: 1 }]
const PASSWORD = [{ method: 'password', timestamp: 1 }]
const MINT_SESSION = 'session-the-squatter-holds'
const OWNER_SESSION = 'session-the-owner-just-got'

describe('unclaimed-mint marker', () => {
  it('round-trips through app_metadata', () => {
    const user = { app_metadata: buildUnclaimedMint(MINT_SESSION, 'buyer_account') }
    expect(readUnclaimedMint(user)?.session_id).toBe(MINT_SESSION)
    expect(readUnclaimedMint(user)?.minted_by).toBe('buyer_account')
  })

  it('reads nothing from an account that was never minted unclaimed', () => {
    expect(readUnclaimedMint({ app_metadata: {} })).toBeNull()
    expect(readUnclaimedMint({ app_metadata: null })).toBeNull()
    expect(readUnclaimedMint(null)).toBeNull()
  })

  it('refuses a malformed marker rather than reading past it', () => {
    expect(readUnclaimedMint({ app_metadata: { [UNCLAIMED_MINT_KEY]: 'yes' } })).toBeNull()
    expect(readUnclaimedMint({ app_metadata: { [UNCLAIMED_MINT_KEY]: { session_id: '' } } })).toBeNull()
  })

  it('keeps the rest of app_metadata when the marker is spent', () => {
    const before = { possession_claim: { invite_code_id: 'abc' }, ...buildUnclaimedMint(MINT_SESSION, 'x') }
    const after = clearedUnclaimedMint(before)
    expect(after[UNCLAIMED_MINT_KEY]).toBeNull()
    expect(after.possession_claim).toEqual({ invite_code_id: 'abc' })
  })
})

describe('provedMailbox', () => {
  it('counts a mailed code as proof', () => {
    expect(provedMailbox(OTP)).toBe(true)
    expect(provedMailbox([{ method: 'magiclink' }])).toBe(true)
  })
  it('does NOT count a password — that is the credential the squatter planted', () => {
    expect(provedMailbox(PASSWORD)).toBe(false)
  })
  it('refuses on doubt', () => {
    expect(provedMailbox(undefined)).toBe(false)
    expect(provedMailbox('otp')).toBe(false)
    expect(provedMailbox([])).toBe(false)
  })
})

describe('mayClaim — the whole attack, one case per step', () => {
  const marker = readUnclaimedMint({ app_metadata: buildUnclaimedMint(MINT_SESSION, 'buyer_account') })

  it('THE FIX: the mailbox owner signing in with a mailed code claims the account', () => {
    expect(mayClaim(marker, OWNER_SESSION, OTP)).toBe(true)
  })

  it('the squatter cannot clear their own marker from the session they were handed', () => {
    expect(mayClaim(marker, MINT_SESSION, OTP)).toBe(false)
  })

  it('the squatter cannot claim the account with the password they planted', () => {
    // They sign out, sign back in with their own password: a NEW session id,
    // so the check above no longer stops them. The method does.
    expect(mayClaim(marker, 'a-brand-new-session-of-the-squatters', PASSWORD)).toBe(false)
  })

  it('an account nobody minted unclaimed is never swept', () => {
    expect(mayClaim(null, OWNER_SESSION, OTP)).toBe(false)
  })

  it('a token with no session_id claims nothing', () => {
    expect(mayClaim(marker, null, OTP)).toBe(false)
  })
})
