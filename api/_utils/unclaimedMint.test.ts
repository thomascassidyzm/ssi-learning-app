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
  mintIsRevocable,
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

/**
 * PROVENANCE — job #354, the live breakage.
 *
 * The schools teacher-invite flow stamps the SAME marker as the purchase path
 * did, deliberately. The password on a schools account is the teacher's own,
 * set through SchoolsPasswordPrompt because school mail gateways quarantine
 * our sign-in codes. Rotating it on a routine second-device code sign-in is a
 * total lockout, and nothing visible goes wrong at the moment it happens.
 */
describe('provenance — whose credentials this rule may destroy', () => {
  const OTHER_SESSION = 'a-second-device-signing-in-by-code'
  const markerFrom = (mintedBy: string) =>
    readUnclaimedMint({ app_metadata: buildUnclaimedMint(MINT_SESSION, mintedBy) })

  it('CASE 1 — a buyer-path mint is still swept: the original security property holds', () => {
    expect(mayClaim(markerFrom('buyer_account'), OWNER_SESSION, OTP)).toBe(true)
  })

  it('CASE 2 — a schools mint is NEVER swept, so the teacher keeps the password they set', () => {
    expect(mayClaim(markerFrom('possession_redeem'), OTHER_SESSION, OTP)).toBe(false)
    expect(mayClaim(markerFrom('possession_adopt'), OTHER_SESSION, OTP)).toBe(false)
  })

  it('CASE 3 — absent or unrecognised provenance fails CLOSED, destroying nothing', () => {
    // readUnclaimedMint fills 'unknown' when the field is missing or not a string.
    const noProvenance = readUnclaimedMint({
      app_metadata: { [UNCLAIMED_MINT_KEY]: { session_id: MINT_SESSION } },
    })
    expect(noProvenance?.minted_by).toBe('unknown')
    expect(mayClaim(noProvenance, OWNER_SESSION, OTP)).toBe(false)
    expect(mayClaim(markerFrom('some_future_endpoint'), OWNER_SESSION, OTP)).toBe(false)
    expect(mayClaim(markerFrom(''), OWNER_SESSION, OTP)).toBe(false)
  })

  it('names the allowlist directly, so a new minting path has to opt in', () => {
    expect(mintIsRevocable('buyer_account')).toBe(true)
    expect(mintIsRevocable('possession_redeem')).toBe(false)
    expect(mintIsRevocable('unknown')).toBe(false)
    expect(mintIsRevocable(null)).toBe(false)
    expect(mintIsRevocable(undefined)).toBe(false)
  })
})
