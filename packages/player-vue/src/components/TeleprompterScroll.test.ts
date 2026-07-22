import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TeleprompterScroll from './TeleprompterScroll.vue'

// jsdom has no real layout, so scrollIntoView doesn't exist — the component
// calls it unconditionally on mount/index-change. Stub it as a no-op.
Element.prototype.scrollIntoView = vi.fn()

function makeLines(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `line-${i}`,
    target: `target ${i}`,
    known: `known ${i}`,
  }))
}

describe('TeleprompterScroll', () => {
  it('windows around currentIndex and marks current/past/future', () => {
    const wrapper = mount(TeleprompterScroll, {
      props: { lines: makeLines(20), currentIndex: 10, windowSize: 5 },
    })
    const rows = wrapper.findAll('.phrase-row')
    // windowSize=5, half=2 → rows 8..12
    expect(rows).toHaveLength(5)
    expect(rows[0].text()).toContain('target 8')
    expect(rows[2].classes()).toContain('current')
    expect(rows[0].classes()).toContain('past')
    expect(rows[4].classes()).toContain('future')
  })

  it('clamps the window at the start of the list', () => {
    const wrapper = mount(TeleprompterScroll, {
      props: { lines: makeLines(20), currentIndex: 0, windowSize: 5 },
    })
    const rows = wrapper.findAll('.phrase-row')
    expect(rows[0].text()).toContain('target 0')
    expect(rows[0].classes()).toContain('current')
  })

  it('default rendering shows the known gloss only on the current row', () => {
    const wrapper = mount(TeleprompterScroll, {
      props: { lines: makeLines(3), currentIndex: 1 },
    })
    const rows = wrapper.findAll('.phrase-row')
    expect(rows[1].find('.phrase-known').exists()).toBe(true)
    expect(rows[0].find('.phrase-known').exists()).toBe(false)
    expect(rows[2].find('.phrase-known').exists()).toBe(false)
  })

  it('hides the known gloss everywhere when showGloss is false', () => {
    const wrapper = mount(TeleprompterScroll, {
      props: { lines: makeLines(3), currentIndex: 1, showGloss: false },
    })
    expect(wrapper.find('.phrase-known').exists()).toBe(false)
  })

  it('renders a speaker chip only on rows that carry a speakerName', () => {
    const lines = [
      { id: '1', target: 'a', speakerName: 'Ana', speakerColor: '#B5552D' },
      { id: '2', target: 'b' },
    ]
    const wrapper = mount(TeleprompterScroll, { props: { lines, currentIndex: 0 } })
    const rows = wrapper.findAll('.phrase-row')
    expect(rows[0].find('.phrase-speaker').exists()).toBe(true)
    expect(rows[0].find('.phrase-speaker').text()).toContain('Ana')
    expect(rows[1].find('.phrase-speaker').exists()).toBe(false)
  })

  it('non-interactive rows never emit select on click', async () => {
    const wrapper = mount(TeleprompterScroll, {
      props: { lines: makeLines(3), currentIndex: 0 },
    })
    await wrapper.find('.phrase-row').trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('interactive rows emit select with the clicked row\'s display index', async () => {
    const wrapper = mount(TeleprompterScroll, {
      props: { lines: makeLines(5), currentIndex: 2, windowSize: 5, interactive: true },
    })
    const rows = wrapper.findAll('.phrase-row')
    await rows[3].trigger('click') // display index 3 within the [0..4] window
    expect(wrapper.emitted('select')).toEqual([[3]])
  })

  it('a #line slot override fully replaces the default row content', () => {
    const wrapper = mount(TeleprompterScroll, {
      props: { lines: makeLines(2), currentIndex: 0 },
      slots: {
        line: `<template #line="{ line }"><div class="custom-row">{{ line.target }}!</div></template>`,
      },
    })
    expect(wrapper.find('.custom-row').exists()).toBe(true)
    expect(wrapper.find('.phrase-target').exists()).toBe(false)
  })
})
