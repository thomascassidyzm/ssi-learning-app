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

// ---------------------------------------------------------------------------
// SHARED TENANTS (job #385). The rule is pure (isSharedTenantFor); the three
// moments it acts at are exercised against an in-memory stand-in for the
// tables it reads, so the same file proves the claim refusal, the arrival-time
// suppression and the door — no network.
// ---------------------------------------------------------------------------
import {
  isSharedTenantFor,
  claimDomainForSchool,
  claimsVouchingFor,
  schoolsClaimingDomainOf,
  schoolsLivingOn,
} from './schoolDomain'

describe('isSharedTenantFor — another household on the domain makes it a tenant', () => {
  const newport = { school_id: 'newport', group_id: null }
  it('a school alone on its domain is not a tenant', () => {
    expect(isSharedTenantFor(newport, [{ school_id: 'newport', group_id: null }])).toBe(false)
    expect(isSharedTenantFor(newport, [])).toBe(false)
  })
  it('a second, unrelated school living there makes it shared', () => {
    expect(isSharedTenantFor(newport, [
      { school_id: 'newport', group_id: null },
      { school_id: 'monmouth', group_id: null },
    ])).toBe(true)
  })
  it('a sibling in the same trust is the same household — not shared', () => {
    const trustSchool = { school_id: 'a', group_id: 'trust' }
    expect(isSharedTenantFor(trustSchool, [
      { school_id: 'a', group_id: 'trust' },
      { school_id: 'b', group_id: 'trust' },
    ])).toBe(false)
  })
  it('a school in a DIFFERENT group is another household', () => {
    const trustSchool = { school_id: 'a', group_id: 'trust' }
    expect(isSharedTenantFor(trustSchool, [{ school_id: 'z', group_id: 'other-trust' }])).toBe(true)
  })
})

/**
 * A tiny stand-in for the four tables the rule reads. Supports exactly the
 * builder calls schoolDomain.ts makes: select / eq / neq / in / or(ilike) /
 * maybeSingle / insert, awaited as a thenable like the real client.
 */
function fakeSupabase(tables: Record<string, any[]>) {
  const inserted: Array<{ table: string; row: any }> = []
  const builder = (table: string) => {
    let rows = [...(tables[table] || [])]
    let single = false
    let embed: string | null = null
    const b: any = {
      select(cols: string) {
        const m = /(\w+)\(([^)]*)\)/.exec(cols || '')
        if (m) embed = m[1]
        return b
      },
      eq(col: string, v: any) { rows = rows.filter((r) => r[col] === v); return b },
      neq(col: string, v: any) { rows = rows.filter((r) => r[col] !== v); return b },
      in(col: string, vs: any[]) { rows = rows.filter((r) => vs.includes(r[col])); return b },
      or(expr: string) {
        const pats = expr.split(',').map((p) => p.replace(/^email\.ilike\./, ''))
        rows = rows.filter((r) => pats.some((p) => {
          const re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i')
          return re.test(r.email)
        }))
        return b
      },
      maybeSingle() { single = true; return b },
      insert(row: any) {
        inserted.push({ table, row })
        const dup = (tables[table] || []).some((r) => r.school_id === row.school_id && r.kind === row.kind && r.value === row.value)
        return Promise.resolve({ error: dup ? { code: '23505', message: 'dup' } : null })
      },
      then(resolve: any) {
        let data: any = rows.map((r) => {
          if (!embed) return r
          const fk = r[embed === 'schools' ? 'school_id' : embed + '_id']
          const target = (tables[embed] || []).find((x) => x.id === fk) || null
          return { ...r, [embed]: target }
        })
        if (single) data = data[0] || null
        return resolve({ data, error: null })
      },
    }
    return b
  }
  return { client: { from: builder } as any, inserted }
}

/** Live-data shape of the Hwb case: two Welsh schools whose founding admins both
 *  sit on hwbcymru.net; Newport signed up first and claimed it. */
function hwbWorld() {
  return fakeSupabase({
    schools: [
      { id: 'newport', group_id: null, admin_user_id: 'u-newport', school_name: 'Newport High School' },
      { id: 'monmouth', group_id: null, admin_user_id: 'u-monmouth', school_name: 'Monmouth Comprehensive' },
      { id: 'chepstow', group_id: null, admin_user_id: 'u-chepstow', school_name: 'Chepstow School' },
    ],
    learners: [
      { id: 'l-newport', user_id: 'u-newport' },
      { id: 'l-monmouth', user_id: 'u-monmouth' },
      { id: 'l-chepstow', user_id: 'u-chepstow' },
    ],
    learner_emails: [
      { learner_id: 'l-newport', email: 'head@hwbcymru.net' },
      { learner_id: 'l-monmouth', email: 'head2@hwbcymru.net' },
      { learner_id: 'l-chepstow', email: 'head@chepstowschool.net' },
    ],
    school_identity_claims: [
      { school_id: 'newport', kind: 'domain', value: 'hwbcymru.net' },
      { school_id: 'chepstow', kind: 'domain', value: 'chepstowschool.net' },
    ],
  })
}

describe('schoolsLivingOn — residents are derived from the live rows, never a list', () => {
  it('finds both Welsh schools on hwbcymru.net and only Chepstow on its own domain', async () => {
    const { client } = hwbWorld()
    expect((await schoolsLivingOn(client, 'hwbcymru.net'))!.map((r) => r.school_id).sort()).toEqual(['monmouth', 'newport'])
    expect((await schoolsLivingOn(client, 'chepstowschool.net'))!.map((r) => r.school_id)).toEqual(['chepstow'])
  })
  it('a look-alike domain is not a resident', async () => {
    const { client } = hwbWorld()
    expect(await schoolsLivingOn(client, 'bcymru.net')).toEqual([])
  })
})

describe('claimDomainForSchool — the second school on a tenant is refused, the first is not', () => {
  it('Monmouth cannot claim hwbcymru.net: Newport already lives there', async () => {
    const { client, inserted } = hwbWorld()
    const out = await claimDomainForSchool(client, {
      schoolId: 'monmouth', email: 'head2@hwbcymru.net', source: 'founding_admin', addedBy: 'u-monmouth',
    })
    expect(out).toEqual({ status: 'not_claimable', domain: 'hwbcymru.net', reason: 'shared_tenant' })
    expect(inserted).toEqual([])
  })
  it('Chepstow, alone on chepstowschool.net, is already_ours (idempotent) — its own row is not evidence against it', async () => {
    const { client } = hwbWorld()
    const out = await claimDomainForSchool(client, {
      schoolId: 'chepstow', email: 'deputy@chepstowschool.net', source: 'founding_admin', addedBy: 'u-chepstow',
    })
    expect(out).toEqual({ status: 'already_ours', domain: 'chepstowschool.net' })
  })
})

describe('claimsVouchingFor — a claim on a domain that has become shared vouches for nobody', () => {
  it("Newport's hwbcymru.net row is suppressed once Monmouth lives there; nothing is deleted", async () => {
    const { client } = hwbWorld()
    expect(await claimsVouchingFor(client, 'newport')).toEqual([])
    // the row itself is untouched — suppression is the un-claim
    expect(await claimsVouchingFor(client, 'chepstow')).toMatchObject([{ kind: 'domain', value: 'chepstowschool.net' }])
  })
})

describe('schoolsClaimingDomainOf — the door names only an effective holder', () => {
  it('a third Hwb head sees no holder at all: the domain belongs to nobody', async () => {
    const { client } = hwbWorld()
    expect(await schoolsClaimingDomainOf(client, 'head3@hwbcymru.net')).toEqual([])
  })
  it('a second Chepstow address is still pointed at Chepstow', async () => {
    const { client } = hwbWorld()
    expect(await schoolsClaimingDomainOf(client, 'someone@chepstowschool.net')).toMatchObject([{ school_id: 'chepstow' }])
  })
})
