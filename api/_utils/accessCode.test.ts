/**
 * Tests for the access-code primitives.
 *
 * The whole reason this file exists is READABILITY UNDER A HUMAN EYE: the code
 * gets read down a phone, off a printed slip, or aloud across a staffroom. So
 * the alphabet assertion below is not a style preference — a `0` or an `I` in
 * a generated code is a teacher failing to get in.
 */
import { describe, it, expect } from 'vitest'
import {
  ACCESS_CODE_ALPHABET,
  ACCESS_CODE_LENGTH,
  ACCESS_CODE_TTL_MS,
  accessCodeUrl,
  formatAccessCode,
  generateAccessCode,
  hashAccessCode,
  normaliseAccessCode,
} from './accessCode'

describe('access code alphabet', () => {
  it('contains no character that can be misread as another one in it', () => {
    for (const banned of ['0', '1', 'I', 'L', 'O', 'U']) {
      expect(ACCESS_CODE_ALPHABET).not.toContain(banned)
    }
  })

  it('has no duplicates', () => {
    expect(new Set(ACCESS_CODE_ALPHABET).size).toBe(ACCESS_CODE_ALPHABET.length)
  })
})

describe('generateAccessCode', () => {
  it('is the right length and only ever uses the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateAccessCode()
      expect(code).toHaveLength(ACCESS_CODE_LENGTH)
      for (const ch of code) expect(ACCESS_CODE_ALPHABET).toContain(ch)
    }
  })

  it('does not repeat itself', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) seen.add(generateAccessCode())
    expect(seen.size).toBe(500)
  })
})

describe('normaliseAccessCode', () => {
  it('accepts what a person actually types', () => {
    const code = 'ABCD2345'
    for (const typed of ['ABCD2345', 'abcd2345', 'ABCD-2345', 'abcd 2345', '  AbCd-2345  ', 'ABCD.2345']) {
      expect(normaliseAccessCode(typed)).toBe(code)
    }
  })

  it('refuses a character that is never generated, rather than guessing', () => {
    // Silently remapping a typo turns "check that again" into the far more
    // confusing "expired or already used".
    for (const bad of ['ABCD234O', 'ABCD234I', 'ABCD2340', 'ABCD2341', 'ABCD234L', 'ABCD234U']) {
      expect(normaliseAccessCode(bad)).toBeNull()
    }
  })

  it('refuses the wrong length', () => {
    expect(normaliseAccessCode('ABCD234')).toBeNull()
    expect(normaliseAccessCode('ABCD23456')).toBeNull()
    expect(normaliseAccessCode('')).toBeNull()
  })

  it('refuses anything that is not a string', () => {
    expect(normaliseAccessCode(null)).toBeNull()
    expect(normaliseAccessCode(undefined)).toBeNull()
    expect(normaliseAccessCode(1234 as unknown as string)).toBeNull()
    expect(normaliseAccessCode({} as unknown as string)).toBeNull()
  })

  it('round-trips its own generated codes, in both plain and pretty form', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateAccessCode()
      expect(normaliseAccessCode(code)).toBe(code)
      expect(normaliseAccessCode(formatAccessCode(code))).toBe(code)
    }
  })
})

describe('hashAccessCode', () => {
  it('is a sha256 hex digest, and never the code itself', () => {
    const code = generateAccessCode()
    const hash = hashAccessCode(code)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(code)
  })

  it('is stable and distinct', () => {
    expect(hashAccessCode('ABCD2345')).toBe(hashAccessCode('ABCD2345'))
    expect(hashAccessCode('ABCD2345')).not.toBe(hashAccessCode('ABCD2346'))
  })
})

describe('presentation', () => {
  it('formats as two groups of four', () => {
    expect(formatAccessCode('ABCD2345')).toBe('ABCD-2345')
  })

  it('builds a short /join URL on the origin it was minted from', () => {
    expect(accessCodeUrl('https://staging.saysomethingin.app', 'ABCD2345')).toBe(
      'https://staging.saysomethingin.app/join/ABCD-2345',
    )
  })
})

describe('expiry', () => {
  it('is two days — Tom\'s "a day or two", taken at the top', () => {
    expect(ACCESS_CODE_TTL_MS).toBe(48 * 60 * 60 * 1000)
  })
})
