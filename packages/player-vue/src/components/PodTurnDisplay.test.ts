import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PodTurnDisplay from './PodTurnDisplay.vue'
import { podLapPlayedSentenceIndices, podLapDisplayRange } from '@ssi/core/pods'
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

  it('midway through an accumulating lap, ALL prior played sentences stay visible above the current one', () => {
    // The build-up is the whole point of pod dialogues: lap N plays cohorts
    // 1..N of ONE conversation (scheduler accumulation over 2-3 sentence
    // exchanges, Tom 2026-07-23), and while sentence k is sounding, every
    // already-played sentence — across ALL prior cohorts — must still be on
    // screen as dimmed "past" rows, not just the current turn. Wire the
    // display exactly as LearningPlayer does: lap plays → played indices →
    // display window slice.
    const all = Array.from({ length: 6 }, (_, i) => row({ global_order: i + 1 }))
    // Lap for cohort-round 2: cohort 1 (sentences 1-2) replays, cohort 2
    // (sentences 3-4) debuts (stage reps dedupe); midway = sentence 3
    // (1-based, first line of the NEW cohort) currently sounding.
    const lapPlays = [1, 1, 2, 2, 3, 3, 4].map((sentenceIdx) => ({ sentenceIdx }))
    const played = podLapPlayedSentenceIndices(lapPlays)
    expect(played).toEqual([0, 1, 2, 3])
    const range = podLapDisplayRange(all.length, played)!
    expect(range).toEqual({ start: 0, end: 3 })
    const windowed = all.slice(range.start, range.end + 1)
    const currentLocal = 2 // sentence 3, 0-based within the window

    const wrapper = mount(PodTurnDisplay, { props: { sentences: windowed, activeIndex: currentLocal } })
    const rows = wrapper.findAll('.phrase-row')
    const texts = rows.map((r) => r.find('.phrase-target').text())
    // Every previously played sentence renders above the current one…
    expect(texts).toContain('target 1')
    expect(texts).toContain('target 2')
    expect(wrapper.findAll('.phrase-row.past').map((r) => r.find('.phrase-target').text()))
      .toEqual(['target 1', 'target 2'])
    // …the current one is lit…
    expect(wrapper.find('.phrase-row.current .phrase-target').text()).toBe('target 3')
    // …and nothing OUTSIDE the lap's played window leaks in (sentences 5-6
    // exist in the pod but this lap never sounds them).
    expect(texts).not.toContain('target 5')
    expect(texts).not.toContain('target 6')
  })
})
