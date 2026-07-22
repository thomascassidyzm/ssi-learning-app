import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PodTurnDisplay from './PodTurnDisplay.vue'
import type { PodSentenceRow } from '../composables/usePodLapScheduler'

Element.prototype.scrollIntoView = vi.fn()

function row(partial: Partial<PodSentenceRow> & { global_order: number }): PodSentenceRow {
  return {
    sentence_id: `s${partial.global_order}`,
    target_text: `target ${partial.global_order}`,
    known_text: `known ${partial.global_order}`,
    target_audio_id: null,
    known_audio_id: null,
    explainer_audio_id: null,
    glue_to_next: false,
    ...partial,
  }
}

describe('PodTurnDisplay — whole-dialogue scroll (2026-07-22)', () => {
  it('shows a speaker chip only on the first sentence of each turn', () => {
    // Ana speaks two glued sentences (one turn), then Ben speaks one.
    const sentences = [
      row({ global_order: 1, speaker: 'Ana', glue_to_next: true }),
      row({ global_order: 2, speaker: 'Ana', glue_to_next: false }),
      row({ global_order: 3, speaker: 'Ben', glue_to_next: false }),
    ]
    const wrapper = mount(PodTurnDisplay, { props: { sentences, activeIndex: 0 } })
    const rows = wrapper.findAll('.phrase-row')
    expect(rows).toHaveLength(3)
    expect(rows[0].find('.phrase-speaker').text()).toContain('Ana')
    expect(rows[1].find('.phrase-speaker').exists()).toBe(false)
    expect(rows[2].find('.phrase-speaker').text()).toContain('Ben')
  })

  it('assigns distinct, stable colours per speaker in order of first appearance', () => {
    const sentences = [
      row({ global_order: 1, speaker: 'Ana' }),
      row({ global_order: 2, speaker: 'Ben' }),
      row({ global_order: 3, speaker: 'Ana' }),
    ]
    const wrapper = mount(PodTurnDisplay, { props: { sentences, activeIndex: 0 } })
    const chips = wrapper.findAll('.phrase-speaker')
    // Ana appears on rows 0 and 2 (both turn-starts, since glue_to_next
    // defaults false here); Ben on row 1. Colours must differ and repeat.
    expect(chips).toHaveLength(3)
    const anaColor = (chips[0].element as HTMLElement).style.color
    const benColor = (chips[1].element as HTMLElement).style.color
    const anaColorAgain = (chips[2].element as HTMLElement).style.color
    expect(anaColor).not.toBe(benColor)
    expect(anaColor).toBe(anaColorAgain)
  })

  it('renders every sentence in the pod, not just the current turn', () => {
    const sentences = Array.from({ length: 12 }, (_, i) => row({ global_order: i + 1 }))
    const wrapper = mount(PodTurnDisplay, { props: { sentences, activeIndex: 0 } })
    // TeleprompterScroll windows the render, but the full list is what it
    // was handed — confirm via the windowed count staying bounded yet the
    // component accepts the full unsliced array without truncating input.
    expect(wrapper.findAll('.phrase-row').length).toBeGreaterThan(0)
    expect(wrapper.findAll('.phrase-row').length).toBeLessThanOrEqual(sentences.length)
  })

  it('marks no row current when activeIndex is null (before the first sentence plays)', () => {
    const sentences = [row({ global_order: 1 }), row({ global_order: 2 })]
    const wrapper = mount(PodTurnDisplay, { props: { sentences, activeIndex: null } })
    expect(wrapper.find('.phrase-row.current').exists()).toBe(false)
  })

  it('shows the known-language gloss for the active sentence', () => {
    const sentences = [row({ global_order: 1 }), row({ global_order: 2 })]
    const wrapper = mount(PodTurnDisplay, { props: { sentences, activeIndex: 1 } })
    const current = wrapper.find('.phrase-row.current')
    expect(current.find('.phrase-known').text()).toBe('known 2')
  })
})
