import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LanguageFlag from './LanguageFlag.vue'
import deuFlag from '@/assets/flags/deu.svg'
import porFlag from '@/assets/flags/por.svg'
import cymFlag from '@/assets/flags/cym.svg'
import gleFlag from '@/assets/flags/gle.svg'
import deuAtFlag from '@/assets/flags/deu_at.svg'
import porBrFlag from '@/assets/flags/por_br.svg'

/**
 * A language variant flies its own flag when we have one, and its parent
 * language's flag when we don't — so adding a variant course can never
 * blank out an existing flag.
 */
function srcOf(code: string) {
  return mount(LanguageFlag, { props: { code } }).find('img').attributes('src') ?? ''
}

describe('LanguageFlag variants', () => {
  it('flies the Austrian flag for Austrian German', () => {
    expect(srcOf('deu_at_for_eng')).toBe(deuAtFlag)
    expect(srcOf('deu_at_for_eng')).not.toBe(deuFlag)
  })

  it('flies the Brazilian flag for Brazilian Portuguese', () => {
    expect(srcOf('por_br_for_eng')).toBe(porBrFlag)
    expect(srcOf('por_br_for_eng')).not.toBe(porFlag)
  })

  it('keeps the parent flag for the main courses', () => {
    expect(srcOf('deu_for_eng')).toBe(deuFlag)
    expect(srcOf('por_for_eng')).toBe(porFlag)
  })

  it('falls back to the parent flag for a variant with no flag of its own', () => {
    // Swiss German and the Welsh/Irish dialects have no distinct flag here.
    expect(srcOf('deu_ch_for_eng')).toBe(deuFlag)
    expect(srcOf('cym_n_for_eng')).toBe(cymFlag)
    expect(srcOf('gle_cn_for_eng')).toBe(gleFlag)
  })

  it('still accepts a bare language code', () => {
    expect(srcOf('deu')).toBe(deuFlag)
    expect(srcOf('deu_at')).toBe(deuAtFlag)
  })
})
