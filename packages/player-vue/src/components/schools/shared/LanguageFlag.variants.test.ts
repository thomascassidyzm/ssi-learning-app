import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LanguageFlag from './LanguageFlag.vue'
import deuFlag from '@/assets/flags/deu.svg'
import porFlag from '@/assets/flags/por.svg'
import cymFlag from '@/assets/flags/cym.svg'
import gleFlag from '@/assets/flags/gle.svg'
import spaFlag from '@/assets/flags/spa.svg'
import araFlag from '@/assets/flags/ara.svg'
import fraFlag from '@/assets/flags/fra.svg'
import deuAtFlag from '@/assets/flags/deu_at.svg'
import deuChFlag from '@/assets/flags/deu_ch.svg'
import porBrFlag from '@/assets/flags/por_br.svg'
import spaMxFlag from '@/assets/flags/spa_mx.svg'
import araEgFlag from '@/assets/flags/ara_eg.svg'
import araLbFlag from '@/assets/flags/ara_lb.svg'
import araSyFlag from '@/assets/flags/ara_sy.svg'
import fraCaFlag from '@/assets/flags/fra_ca.svg'

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

  it('flies its own national flag for every other national variant', () => {
    expect(srcOf('deu_ch_for_eng')).toBe(deuChFlag)
    expect(srcOf('spa_mx_for_eng')).toBe(spaMxFlag)
    expect(srcOf('ara_eg_for_eng')).toBe(araEgFlag)
    expect(srcOf('ara_lb_for_eng')).toBe(araLbFlag)
    expect(srcOf('ara_sy_for_eng')).toBe(araSyFlag)
    expect(srcOf('fra_ca_for_eng')).toBe(fraCaFlag)
  })

  it('gives each Arabic variant a DIFFERENT flag, not one shared one', () => {
    const flags = ['ara_eg_for_eng', 'ara_lb_for_eng', 'ara_sy_for_eng'].map(srcOf)
    expect(new Set(flags).size).toBe(3)
    expect(flags).not.toContain(araFlag)
  })

  it('keeps the parent flag for the main courses', () => {
    expect(srcOf('deu_for_eng')).toBe(deuFlag)
    expect(srcOf('por_for_eng')).toBe(porFlag)
    expect(srcOf('spa_for_eng')).toBe(spaFlag)
    expect(srcOf('ara_for_eng')).toBe(araFlag)
    expect(srcOf('fra_for_eng')).toBe(fraFlag)
  })

  it('falls back to the parent flag for a variant with no flag of its own', () => {
    // The Welsh and Irish dialects are regions inside one country's flag —
    // they carry a variant_label instead and stay on the parent flag.
    expect(srcOf('cym_n_for_eng')).toBe(cymFlag)
    expect(srcOf('cym_s_for_eng')).toBe(cymFlag)
    expect(srcOf('gle_cn_for_eng')).toBe(gleFlag)
    expect(srcOf('gle_mu_for_eng')).toBe(gleFlag)
    expect(srcOf('gle_ul_for_eng')).toBe(gleFlag)
  })

  it('still accepts a bare language code', () => {
    expect(srcOf('deu')).toBe(deuFlag)
    expect(srcOf('deu_at')).toBe(deuAtFlag)
  })
})
