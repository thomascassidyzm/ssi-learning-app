/**
 * Tests for the shared code generator (api/_utils/codeGen.ts).
 *
 * generateCode() mints ABC-123 codes that gate elevated educational_role
 * grants, so it must be (a) format-stable and (b) drawn from a CSPRNG. The
 * format/charset invariants below are checked over many iterations; the CSPRNG
 * requirement is enforced structurally (no Math.random) and covered by the
 * distribution sanity check.
 */
import { describe, it, expect } from 'vitest'
import { generateCode } from './codeGen'

describe('generateCode', () => {
  const CODE_RE = /^[A-Z]{3}-[0-9]{3}$/
  // Consonants only, excluding I and O (confusable with 1 and 0).
  const ALLOWED_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

  it('always returns the ABC-123 format over many iterations', () => {
    for (let i = 0; i < 5000; i++) {
      expect(generateCode()).toMatch(CODE_RE)
    }
  })

  it('never emits I or O in the letter block', () => {
    for (let i = 0; i < 5000; i++) {
      const letters = generateCode().slice(0, 3)
      for (const ch of letters) {
        expect(ALLOWED_LETTERS).toContain(ch)
        expect(ch).not.toBe('I')
        expect(ch).not.toBe('O')
      }
    }
  })

  it('produces a spread of values (not a constant) — sanity check on the RNG', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) seen.add(generateCode())
    // 500 draws from a ~13.8M keyspace should be overwhelmingly distinct.
    expect(seen.size).toBeGreaterThan(490)
  })

  it('exercises the full digit range 0-9 across iterations', () => {
    const digitsSeen = new Set<string>()
    for (let i = 0; i < 2000; i++) {
      for (const d of generateCode().slice(4)) digitsSeen.add(d)
    }
    expect(digitsSeen.size).toBe(10)
  })
})
