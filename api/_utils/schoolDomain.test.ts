/**
 * The domain-similarity rule (job #371), tested where it lives — no network.
 */
import { describe, it, expect } from 'vitest'
import {
  domainMatches,
  matchArrival,
  whyDomainNotClaimable,
  isClaimableDomain,
  emailDomainOf,
  normaliseDomain,
  isDomainShaped,
} from './schoolDomain'

describe('domainMatches — "domain level similarity" is exact-or-subdomain', () => {
  it('matches the same domain, case-folded', () => {
    expect(domainMatches('Example.sch.uk', 'example.sch.uk')).toBe(true)
  })
  it('matches a subdomain of the claim', () => {
    expect(domainMatches('staff.example.sch.uk', 'example.sch.uk')).toBe(true)
  })
  it('does NOT match a look-alike', () => {
    expect(domainMatches('notexample.sch.uk', 'example.sch.uk')).toBe(false)
    expect(domainMatches('example-sch.uk', 'example.sch.uk')).toBe(false)
  })
  it('a claim on a subdomain never reaches its parent', () => {
    expect(domainMatches('example.sch.uk', 'staff.example.sch.uk')).toBe(false)
  })
  it('refuses empties', () => {
    expect(domainMatches('', 'example.sch.uk')).toBe(false)
    expect(domainMatches('example.sch.uk', '')).toBe(false)
  })
})

describe('matchArrival — the arrival decision', () => {
  const claims = [
    { kind: 'domain' as const, value: 'example.sch.uk', school_id: 's1' },
    { kind: 'address' as const, value: 'Supply.Teacher@gmail.com', school_id: 's1' },
  ]
  it('a school address is on-domain, via the domain', () => {
    expect(matchArrival('j.smith@example.sch.uk', claims)).toMatchObject({ onDomain: true, via: 'domain' })
  })
  it('a subdomain address is on-domain', () => {
    expect(matchArrival('j.smith@staff.example.sch.uk', claims)).toMatchObject({ onDomain: true, via: 'domain' })
  })
  it('a listed personal address is on-domain, via the address, case-folded', () => {
    expect(matchArrival('supply.teacher@GMAIL.com', claims)).toMatchObject({ onDomain: true, via: 'address' })
  })
  it('any other gmail address is off-domain — the list is the address, not its provider', () => {
    expect(matchArrival('someone.else@gmail.com', claims)).toMatchObject({ onDomain: false })
  })
  it('no claims at all means off-domain: the safe side', () => {
    expect(matchArrival('j.smith@example.sch.uk', [])).toMatchObject({ onDomain: false })
  })
  it('garbage is off-domain', () => {
    expect(matchArrival('not-an-address', claims)).toMatchObject({ onDomain: false })
  })
})

describe('whyDomainNotClaimable — a public domain can NEVER be a school', () => {
  it('refuses the public providers Tom named, and their aliases', () => {
    for (const d of ['gmail.com', 'googlemail.com', 'hotmail.co.uk', 'outlook.com', 'yahoo.co.uk', 'icloud.com', 'aol.com', 'gmx.de', 'proton.me']) {
      expect(whyDomainNotClaimable(d), d).toBe('public_mail')
    }
  })
  it('refuses the non-identities the identity model already names', () => {
    expect(whyDomainNotClaimable('invite.saysomethingin.app')).toBe('placeholder')
    expect(whyDomainNotClaimable('privaterelay.appleid.com')).toBe('relay')
    expect(whyDomainNotClaimable('mailinator.com')).toBe('disposable')
  })
  it('refuses things that are not domains', () => {
    expect(whyDomainNotClaimable('')).toBe('not_a_domain')
    expect(whyDomainNotClaimable('localhost')).toBe('not_a_domain')
    expect(whyDomainNotClaimable('has space.sch.uk')).toBe('not_a_domain')
  })
  it('accepts a real school domain, whatever the shape of its suffix', () => {
    expect(isClaimableDomain('ysgol-y-preseli.pembrokeshire.sch.uk')).toBe(true)
    expect(isClaimableDomain('greenfield.edu')).toBe(true)
    expect(isClaimableDomain('dpsrkp.net')).toBe(true)
    expect(isClaimableDomain('@Example.sch.uk')).toBe(true)
  })
})

describe('helpers', () => {
  it('emailDomainOf and normaliseDomain agree on shape', () => {
    expect(emailDomainOf('  J.Smith@Example.Sch.UK ')).toBe('example.sch.uk')
    expect(emailDomainOf('nope')).toBe('')
    expect(normaliseDomain('@.Example.sch.uk.')).toBe('example.sch.uk')
    expect(isDomainShaped('a.b')).toBe(true)
    expect(isDomainShaped('-a.b')).toBe(false)
  })
})
