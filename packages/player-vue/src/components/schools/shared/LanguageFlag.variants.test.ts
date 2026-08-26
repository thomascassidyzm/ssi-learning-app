import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LanguageFlag from './LanguageFlag.vue'
import { getLanguageFlag } from '@/composables/useI18n'
import deuFlag from '@/assets/flags/deu.svg'
import porFlag from '@/assets/flags/por.svg'
import cymFlag from '@/assets/flags/cym.svg'
import gleFlag from '@/assets/flags/gle.svg'
import spaFlag from '@/assets/flags/spa.svg'
import araFlag from '@/assets/flags/ara.svg'
import fraFlag from '@/assets/flags/fra.svg'
import zhoFlag from '@/assets/flags/zho.svg'

// The vendored circle-flags country set the automatic path resolves against.
import atFlag from '@/assets/flags/countries/at.svg'
import chFlag from '@/assets/flags/countries/ch.svg'
import brFlag from '@/assets/flags/countries/br.svg'
import mxFlag from '@/assets/flags/countries/mx.svg'
import egFlag from '@/assets/flags/countries/eg.svg'
import lbFlag from '@/assets/flags/countries/lb.svg'
import syFlag from '@/assets/flags/countries/sy.svg'
import caQcFlag from '@/assets/flags/countries/ca-qc.svg'
import coFlag from '@/assets/flags/countries/co.svg'
import arFlag from '@/assets/flags/countries/ar.svg'

/**
 * A language variant flies its own flag when its suffix names a real country,
 * and its parent language's flag when it doesn't — so adding a variant course
 * can never blank out an existing flag.
 */
function srcOf(code: string) {
  return mount(LanguageFlag, { props: { code } }).find('img').attributes('src') ?? ''
}

describe('LanguageFlag variants', () => {
  it('still flies the right flag for every variant that used to be hand-mapped', () => {
    // Regression: these eight were individually imported and listed in a
    // variantFlagMap. They now resolve through the automatic path instead.
    expect(srcOf('deu_at_for_eng')).toBe(atFlag)
    expect(srcOf('deu_ch_for_eng')).toBe(chFlag)
    expect(srcOf('por_br_for_eng')).toBe(brFlag)
    expect(srcOf('spa_mx_for_eng')).toBe(mxFlag)
    expect(srcOf('ara_eg_for_eng')).toBe(egFlag)
    expect(srcOf('ara_lb_for_eng')).toBe(lbFlag)
    expect(srcOf('ara_sy_for_eng')).toBe(syFlag)
    // Quebec French flies the fleurdelisé, not the maple leaf — the one alias.
    expect(srcOf('fra_ca_for_eng')).toBe(caQcFlag)
  })

  it('none of those fall back to the parent language flag', () => {
    expect(srcOf('deu_at_for_eng')).not.toBe(deuFlag)
    expect(srcOf('por_br_for_eng')).not.toBe(porFlag)
    expect(srcOf('fra_ca_for_eng')).not.toBe(fraFlag)
  })

  it('gives a NEW variant course its flag with no code change', () => {
    // Neither of these courses exists yet. Nothing in the codebase names 'spa_co'
    // or 'spa_ar' — they resolve purely because 'co' and 'ar' are ISO country
    // codes present in the vendored set. This is the whole point of the refactor.
    expect(srcOf('spa_co_for_eng')).toBe(coFlag)
    expect(srcOf('spa_ar_for_eng')).toBe(arFlag)
    expect(srcOf('spa_co_for_eng')).not.toBe(spaFlag)
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

  it('keeps the parent flag for a dialect split inside one country', () => {
    // Welsh and Irish dialects are regions inside one country's flag — they
    // carry a variant_label instead and stay on the parent flag.
    expect(srcOf('cym_n_for_eng')).toBe(cymFlag)
    expect(srcOf('cym_s_for_eng')).toBe(cymFlag)
    expect(srcOf('cym_nnew_for_eng')).toBe(cymFlag)
    expect(srcOf('cym_anthem_for_jpn')).toBe(cymFlag)
    expect(srcOf('gle_ul_for_eng')).toBe(gleFlag)
  })

  it('does not mistake an Irish dialect suffix for a country of the same name', () => {
    // 'cn' is Connemara, not China. 'mu' is Munster, not Mauritius.
    expect(srcOf('gle_cn_for_eng')).toBe(gleFlag)
    expect(srcOf('gle_cn_for_eng')).not.toBe(zhoFlag)
    expect(srcOf('gle_mu_for_eng')).toBe(gleFlag)
  })

  it('falls back gracefully on an unknown or garbage suffix', () => {
    expect(srcOf('eng_template')).toBe(srcOf('eng'))
    expect(srcOf('deu_zzzz_for_eng')).toBe(deuFlag)
    // 'qq' is a well-formed but unassigned code with no vendored flag.
    expect(srcOf('deu_qq_for_eng')).toBe(deuFlag)
  })

  it('still accepts a bare language code', () => {
    expect(srcOf('deu')).toBe(deuFlag)
    expect(srcOf('deu_at')).toBe(atFlag)
  })
})

describe('getLanguageFlag emoji fallback', () => {
  it('resolves variants by the same rule as the SVG path', () => {
    expect(getLanguageFlag('deu_at')).toBe('🇦🇹')
    expect(getLanguageFlag('por_br')).toBe('🇧🇷')
    // Automatic for a variant nobody has hand-listed.
    expect(getLanguageFlag('spa_co')).toBe('🇨🇴')
  })

  it('falls back to the parent language for a dialect split', () => {
    expect(getLanguageFlag('cym_n')).toBe(getLanguageFlag('cym'))
    expect(getLanguageFlag('gle_cn')).toBe(getLanguageFlag('gle'))
  })
})
