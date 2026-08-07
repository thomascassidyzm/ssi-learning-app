/**
 * A /redeem/ link is either COMPLETE or it does not exist.
 *
 * Production, 2026-08-07: a cover teacher's class page rendered
 * `https://saysomethingin.app/redeem/` — the join code was missing because an
 * unrelated view timed out, and the template interpolated the empty string.
 * She would have copied that and handed it to a class of pupils.
 */
import { describe, it, expect } from 'vitest'
import { redeemLink, displayableCode } from './inviteLink'

const ORIGIN = 'https://saysomethingin.app'

describe('redeemLink', () => {
  it('builds the link when the code is real', () => {
    expect(redeemLink('RXQ-304', ORIGIN)).toBe('https://saysomethingin.app/redeem/RXQ-304')
  })

  it('returns null for an empty code — the exact production failure', () => {
    expect(redeemLink('', ORIGIN)).toBeNull()
    expect(redeemLink('   ', ORIGIN)).toBeNull()
  })

  it('returns null for a missing code rather than /redeem/undefined', () => {
    expect(redeemLink(undefined, ORIGIN)).toBeNull()
    expect(redeemLink(null, ORIGIN)).toBeNull()
  })

  it('returns null for the placeholders the composables use for "no code"', () => {
    for (const placeholder of ['N/A', 'n/a', 'none', 'null', 'undefined', '-']) {
      expect(redeemLink(placeholder, ORIGIN)).toBeNull()
    }
  })

  it('never emits a double slash from a trailing-slash origin', () => {
    expect(redeemLink('ABC-123', 'https://x/')).toBe('https://x/redeem/ABC-123')
  })

  it('trims a padded code rather than rejecting it', () => {
    expect(redeemLink(' ABC-123 ', ORIGIN)).toBe('https://saysomethingin.app/redeem/ABC-123')
  })
})

describe('displayableCode', () => {
  it('gives back a real code and nothing else', () => {
    expect(displayableCode('RXQ-304')).toBe('RXQ-304')
    expect(displayableCode('')).toBeNull()
    expect(displayableCode('N/A')).toBeNull()
    expect(displayableCode(undefined)).toBeNull()
  })
})
