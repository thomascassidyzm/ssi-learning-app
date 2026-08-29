/**
 * Behavioural cover for the SEC25 INPUT-02 / INPUT-06 filter-DSL helpers.
 */
import { describe, it, expect } from 'vitest'
import { quoteFilterValue, safeIdToken, safeInteger } from './postgrestFilter'

describe('quoteFilterValue', () => {
  it('leaves an ordinary search term searchable, just quoted', () => {
    expect(quoteFilterValue('%ana%')).toBe('"%ana%"')
  })
  it('neutralises the DSL punctuation that would add a disjunct', () => {
    const expr = `display_name.ilike.${quoteFilterValue('%a,id.in.(1)%')}`
    // Everything after the operator is inside one quoted value.
    expect(expr).toBe('display_name.ilike."%a,id.in.(1)%"')
  })
  it('escapes embedded quotes and backslashes', () => {
    expect(quoteFilterValue('a"b\\c')).toBe('"a\\"b\\\\c"')
  })
})

describe('safeIdToken', () => {
  it('passes a real lego id through unchanged', () => {
    expect(safeIdToken('S0001L01')).toBe('S0001L01')
    expect(safeIdToken('7b2f1c0e-0000-4000-8000-000000000000')).toBe('7b2f1c0e-0000-4000-8000-000000000000')
  })
  it('strips the characters that carry meaning in a filter expression', () => {
    expect(safeIdToken('S0001L01,last_completed_lego_id.not.is.null'))
      .toBe('S0001L01last_completed_lego_idnotisnull')
  })
  it('caps the length and tolerates null/undefined', () => {
    expect(safeIdToken('x'.repeat(200))).toHaveLength(64)
    expect(safeIdToken(null)).toBe('')
    expect(safeIdToken(undefined)).toBe('')
  })
})

describe('safeInteger', () => {
  it('keeps real numbers', () => {
    expect(safeInteger(12)).toBe(12)
    expect(safeInteger('7')).toBe(7)
  })
  it('falls back on an injection attempt or junk', () => {
    expect(safeInteger('0,last_completed_round_index.gte.0')).toBe(0)
    expect(safeInteger(undefined)).toBe(0)
    expect(safeInteger(NaN, -1)).toBe(-1)
  })
})
