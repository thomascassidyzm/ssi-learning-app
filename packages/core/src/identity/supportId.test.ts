import { describe, it, expect } from 'vitest'
import {
  supportIdForLearnerId,
  learnerIdPrefixFromSupportId,
  learnerIdRangeFromSupportId,
} from './supportId'

const LEARNER = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

describe('supportIdForLearnerId', () => {
  it('is eight unambiguous characters in two groups', () => {
    const code = supportIdForLearnerId(LEARNER)
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
  })

  it('never contains a character that could be misheard as another', () => {
    // I/L/O/U are absent from the alphabet by construction, so nothing in a
    // code can be confused with anything else in it when read out loud.
    for (const seed of ['0', '1', '7', 'a', 'e', 'f']) {
      const code = supportIdForLearnerId(`${seed.repeat(8)}-1111-2222-3333-444444444444`)!
      expect(code).not.toMatch(/[ILOU]/)
    }
  })

  it('is stable for the same learner and different for another', () => {
    expect(supportIdForLearnerId(LEARNER)).toBe(supportIdForLearnerId(LEARNER))
    expect(supportIdForLearnerId(LEARNER)).not.toBe(
      supportIdForLearnerId('3f2504e0-4f89-11d3-9a0c-0305e82c3302'.replace('3f2504e0', '9a1b2c3d')),
    )
  })

  it('refuses anything that is not a learner id rather than inventing a code', () => {
    expect(supportIdForLearnerId('')).toBeNull()
    expect(supportIdForLearnerId(null)).toBeNull()
    expect(supportIdForLearnerId('guest-local')).toBeNull()
  })
})

describe('learnerIdPrefixFromSupportId', () => {
  it('round-trips back to the start of the learner id it came from', () => {
    const code = supportIdForLearnerId(LEARNER)!
    expect(learnerIdPrefixFromSupportId(code)).toBe(LEARNER.replace(/-/g, '').slice(0, 10))
  })

  it('forgives how a code arrives by ear or by copy-paste', () => {
    const code = supportIdForLearnerId(LEARNER)!
    const canonical = learnerIdPrefixFromSupportId(code)
    expect(learnerIdPrefixFromSupportId(code.toLowerCase())).toBe(canonical)
    expect(learnerIdPrefixFromSupportId(code.replace('-', ''))).toBe(canonical)
    expect(learnerIdPrefixFromSupportId(` ${code} `)).toBe(canonical)
  })

  it('reads O as zero and I or L as one, the two mistakes people make aloud', () => {
    expect(learnerIdPrefixFromSupportId('O0O0-1I1L')).toBe(
      learnerIdPrefixFromSupportId('0000-1111'),
    )
  })

  it('rejects a code of the wrong length or with a symbol we never emit', () => {
    expect(learnerIdPrefixFromSupportId('ABC')).toBeNull()
    expect(learnerIdPrefixFromSupportId('ABCD-EFG')).toBeNull()
    expect(learnerIdPrefixFromSupportId('ABCD-EFG$')).toBeNull()
    expect(learnerIdPrefixFromSupportId('')).toBeNull()
  })
})

describe('learnerIdRangeFromSupportId', () => {
  it('brackets the learner it was made from', () => {
    const range = learnerIdRangeFromSupportId(supportIdForLearnerId(LEARNER))!
    expect(range.low <= LEARNER).toBe(true)
    expect(range.high >= LEARNER).toBe(true)
    expect(range.low).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('excludes a learner whose id starts differently', () => {
    const range = learnerIdRangeFromSupportId(supportIdForLearnerId(LEARNER))!
    const other = 'ff2504e0-4f89-11d3-9a0c-0305e82c3301'
    expect(other >= range.low && other <= range.high).toBe(false)
  })

  it('is null for a code that is not one of ours', () => {
    expect(learnerIdRangeFromSupportId('nope')).toBeNull()
  })
})
