/**
 * Job #128. The name a cycle id carries is the phrase's OWN id — never a
 * count. Phrase ids have gaps where rows were deleted, and a counted index
 * then names a phrase the class never heard.
 */
import { describe, it, expect } from 'vitest'
import { phraseCycleName } from './phraseCycleName'
import { phraseIdFromCycleId } from './classBrain'

describe('phraseCycleName', () => {
  it('turns a phrase row id into the name a cycle id carries', () => {
    expect(phraseCycleName('cym_n_for_eng:S0042L03U05')).toBe('S0042L03_use_05')
    expect(phraseCycleName('deu_for_eng:S0010L01B12')).toBe('S0010L01_build_12')
  })

  it('names nothing it cannot read', () => {
    expect(phraseCycleName(null)).toBeNull()
    expect(phraseCycleName(undefined)).toBeNull()
    expect(phraseCycleName('cym_n_for_eng:S0249L01C01')).toBeNull() // a component
    expect(phraseCycleName('S0042L03')).toBeNull()
  })

  it('round-trips through the brain’s parser, gap and all', () => {
    // deu_for_eng S0010L01 really does jump U02 -> U03: the third USE row of
    // that LEGO is U03, and a count would have called it U01.
    const name = phraseCycleName('deu_for_eng:S0010L01U03')!
    expect(phraseIdFromCycleId(`${name}_review_7`, 'deu_for_eng')).toBe('deu_for_eng:S0010L01U03')
    expect(phraseIdFromCycleId(name, 'deu_for_eng')).toBe('deu_for_eng:S0010L01U03')
  })
})
