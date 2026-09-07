import { describe, it, expect } from 'vitest'
import {
  canonicalEmail,
  emailEquivalenceKey,
  isAppleRelayEmail,
  isPlaceholderEmail,
  emailDisplayClass,
  isVerifiedEmailWorthy,
} from './emailCanon'

describe('canonicalEmail — the exact key that may ACT', () => {
  it('lowercases and trims, nothing cleverer', () => {
    expect(canonicalEmail('  Ravi.Kumar+app@Gmail.COM ')).toBe('ravi.kumar+app@gmail.com')
  })

  it('does NOT fold gmail dots or +tags (D4: acting keys stay exact)', () => {
    expect(canonicalEmail('a.b@gmail.com')).not.toBe(canonicalEmail('ab@gmail.com'))
    expect(canonicalEmail('a+1@gmail.com')).not.toBe(canonicalEmail('a@gmail.com'))
  })

  it('returns empty for non-addresses so garbage never matches garbage', () => {
    expect(canonicalEmail('')).toBe('')
    expect(canonicalEmail(null)).toBe('')
    expect(canonicalEmail(undefined)).toBe('')
    expect(canonicalEmail('no-at-sign')).toBe('')
    expect(canonicalEmail('@nolocal.com')).toBe('')
    expect(canonicalEmail('trailing@')).toBe('')
    expect(canonicalEmail('   ')).toBe('')
  })
})

describe('emailEquivalenceKey — the loose key that may only SUGGEST', () => {
  it('drops +tags on every provider', () => {
    expect(emailEquivalenceKey('a+work@example.org')).toBe('a@example.org')
  })

  it('drops local-part dots only on gmail/googlemail', () => {
    expect(emailEquivalenceKey('r.a.v.i@gmail.com')).toBe('ravi@gmail.com')
    expect(emailEquivalenceKey('r.a.v.i@googlemail.com')).toBe('ravi@googlemail.com')
    expect(emailEquivalenceKey('r.a.v.i@example.org')).toBe('r.a.v.i@example.org')
  })

  it('folds the canonical trial-farm trio onto one key', () => {
    const keys = ['a+1@gmail.com', 'a+2@gmail.com', 'a@gmail.com'].map(emailEquivalenceKey)
    expect(new Set(keys).size).toBe(1)
  })

  it('is empty for non-addresses', () => {
    expect(emailEquivalenceKey('junk')).toBe('')
  })

  it('a leading + is not a tag separator', () => {
    expect(emailEquivalenceKey('+odd@example.org')).toBe('+odd@example.org')
  })
})

describe('display-layer classification (model §5 rule 2 / D3)', () => {
  it('an Apple relay names but is never shown', () => {
    const relay = 'K9x2fq7wpn@Privaterelay.AppleID.com'
    expect(isAppleRelayEmail(relay)).toBe(true)
    expect(emailDisplayClass(relay)).toBe('relay')
    expect(isVerifiedEmailWorthy(relay)).toBe(true)
  })

  it('a link-auth placeholder neither names nor shows', () => {
    const ph = 'link-123@invite.saysomethingin.app'
    expect(isPlaceholderEmail(ph)).toBe(true)
    expect(emailDisplayClass(ph)).toBe('placeholder')
    expect(isVerifiedEmailWorthy(ph)).toBe(false)
  })

  it('an ordinary address is displayable and verified-email-worthy', () => {
    expect(emailDisplayClass('ravi@gmail.com')).toBe('displayable')
    expect(isVerifiedEmailWorthy('ravi@gmail.com')).toBe(true)
  })

  it('a lookalike domain does not pass the relay/placeholder tests', () => {
    expect(isAppleRelayEmail('a@notprivaterelay.appleid.com.evil.com')).toBe(false)
    expect(isPlaceholderEmail('a@invite.saysomethingin.app.evil.com')).toBe(false)
  })

  it('garbage is invalid', () => {
    expect(emailDisplayClass('')).toBe('invalid')
    expect(isVerifiedEmailWorthy(null)).toBe(false)
  })
})
