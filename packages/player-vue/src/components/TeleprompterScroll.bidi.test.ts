import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TeleprompterScroll from './TeleprompterScroll.vue'

/**
 * Regression pin for the Arabic bidi rendering bug (plate A-157).
 *
 * Deborah, reviewing ara_lb_for_eng on 2026-08-17: "Is `!` still placed on the
 * wrong side in Arabic (appearing right, like English, should be
 * left/end-of-sentence)?" — and `?` was fine. `؟` U+061F is bidi class AL so it
 * joins the Arabic run; `!` U+0021 is class ON (neutral) so it inherits the
 * PARAGRAPH direction and, under an LTR paragraph, jumps to the visual right.
 *
 * A unit test cannot see glyph positions — jsdom has no bidi engine. What it CAN
 * pin is the input the browser's bidi algorithm receives: the `dir` attribute on
 * the element that paints the string. That is exactly what was missing, so it is
 * exactly what this asserts. The visual result was confirmed by eye separately.
 */

// jsdom has no real layout, so scrollIntoView doesn't exist — the component
// calls it unconditionally on mount/index-change. Stub it as a no-op.
Element.prototype.scrollIntoView = vi.fn()

// Real ara_lb_for_eng rows pulled from Supabase on 2026-08-18, not invented Arabic.
const ARA_EXCLAMATION = 'أحكي عربي هلق!' // known: "speak Arabic now!"
const ARA_FULL_STOP = 'بدي أحكي معك عربي هلق.' // known: "I want to speak Arabic with you now."

function mountLines(lines: Array<{ target: string; known: string }>) {
  return mount(TeleprompterScroll, {
    props: {
      lines: lines.map((l, i) => ({ id: `line-${i}`, ...l })),
      currentIndex: 0,
    },
  })
}

describe('TeleprompterScroll — bidi direction on target text', () => {
  it('marks an Arabic line ending in "!" as rtl', () => {
    const wrapper = mountLines([{ target: ARA_EXCLAMATION, known: 'speak Arabic now!' }])
    const target = wrapper.find('.phrase-target')
    expect(target.text()).toBe(ARA_EXCLAMATION)
    expect(target.attributes('dir')).toBe('rtl')
  })

  it('marks an Arabic line ending in a neutral full stop as rtl', () => {
    const wrapper = mountLines([
      { target: ARA_FULL_STOP, known: 'I want to speak Arabic with you now.' },
    ])
    expect(wrapper.find('.phrase-target').attributes('dir')).toBe('rtl')
  })

  it('leaves English target text ltr', () => {
    const wrapper = mountLines([{ target: 'I want to speak now!', known: 'I want to speak now!' }])
    expect(wrapper.find('.phrase-target').attributes('dir')).toBe('ltr')
  })

  it('decides per line, not per course — a mixed dialogue gets both', () => {
    const wrapper = mountLines([
      { target: ARA_EXCLAMATION, known: 'speak Arabic now!' },
      { target: 'Sorry, one moment!', known: 'Sorry, one moment!' },
    ])
    const dirs = wrapper.findAll('.phrase-target').map((el) => el.attributes('dir'))
    expect(dirs).toEqual(['rtl', 'ltr'])
  })

  it('keeps an English known gloss ltr beside rtl target text', () => {
    const wrapper = mountLines([{ target: ARA_EXCLAMATION, known: 'speak Arabic now!' }])
    const known = wrapper.find('.phrase-known')
    expect(known.exists()).toBe(true)
    expect(known.attributes('dir')).toBe('ltr')
  })

  it('gives an RTL KNOWN side its own direction — eng_for_ara, not just ara_*', () => {
    // eng_for_ara has 668 seeds with Arabic on the KNOWN side and English as the
    // target, so a target-only fix would leave that whole course mis-rendered.
    // Detection reads the string, so the two sides resolve independently.
    const wrapper = mountLines([
      { target: 'I want to speak English with you now.', known: 'أريد أن أتكلم الإنجليزية معك الآن.' },
    ])
    expect(wrapper.find('.phrase-target').attributes('dir')).toBe('ltr')
    expect(wrapper.find('.phrase-known').attributes('dir')).toBe('rtl')
  })
})
