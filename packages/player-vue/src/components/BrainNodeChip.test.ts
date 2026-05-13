/**
 * Component smoke tests for BrainNodeChip.
 *
 * The chip's job is small: render the focused node's target text, give
 * the learner two voice buttons, emit `close` when dismissed. No L1
 * text. No internal LEGO ids leaking to the UI.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { mount } from '@vue/test-utils'
import BrainNodeChip from './BrainNodeChip.vue'
import type { NetworkNode } from '../types/brainNetwork'

const makeNode = (overrides: Partial<NetworkNode> = {}): NetworkNode => ({
  legoId: 'S0001L01',
  type: 'atom',
  text: 'ciao',
  knownText: 'hello',
  audioId: 'audio-ciao-target1',
  beltIndex: 0,
  seedNumber: 1,
  position: { x: 0, y: 0 },
  isRevealed: true,
  masteryState: 'acquisition',
  introducedAt: '2026-05-13T00:00:00.000Z',
  ...overrides,
})

beforeAll(() => {
  if (typeof HTMLMediaElement !== 'undefined') {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: () => Promise.resolve(),
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: () => {},
    })
  }
})

describe('BrainNodeChip', () => {
  it('renders nothing when node is null', () => {
    const wrapper = mount(BrainNodeChip, {
      props: { node: null, screenX: 100, screenY: 100 },
    })
    expect(wrapper.find('.brain-chip').exists()).toBe(false)
  })

  it('renders the target text and both voice buttons', () => {
    const wrapper = mount(BrainNodeChip, {
      props: {
        node: makeNode({ text: 'buongiorno' }),
        screenX: 120,
        screenY: 240,
      },
    })
    const html = wrapper.html()
    expect(html).toContain('buongiorno')
    expect(wrapper.findAll('.brain-chip-voice-btn')).toHaveLength(2)
  })

  it('does NOT render the known-language translation', () => {
    // V2 design memo: no translation text on the canvas. The chip
    // shows only target text + audio.
    const wrapper = mount(BrainNodeChip, {
      props: {
        node: makeNode({ text: 'arrivederci', knownText: 'goodbye' }),
        screenX: 0,
        screenY: 0,
      },
    })
    expect(wrapper.text()).not.toContain('goodbye')
  })

  it('does not leak the internal legoId into visible text', () => {
    const wrapper = mount(BrainNodeChip, {
      props: {
        node: makeNode({ legoId: 'S0042L07', text: 'grazie' }),
        screenX: 0,
        screenY: 0,
      },
    })
    const visible = wrapper.text().toLowerCase()
    expect(visible).not.toContain('lego')
    expect(visible).not.toContain('s0042l07')
    expect(visible).not.toContain('seed')
  })

  it('positions itself at the provided screen coordinates', () => {
    const wrapper = mount(BrainNodeChip, {
      props: {
        node: makeNode(),
        screenX: 250,
        screenY: 400,
      },
    })
    const style = wrapper.find('.brain-chip').attributes('style') ?? ''
    expect(style).toContain('left: 250px')
    expect(style).toContain('top: 400px')
  })

  it('emits close when the close button is tapped', async () => {
    const wrapper = mount(BrainNodeChip, {
      props: {
        node: makeNode(),
        screenX: 0,
        screenY: 0,
      },
    })
    await wrapper.find('.brain-chip-close').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('voice 2 button is disabled until a voice2 audio id resolves', () => {
    // No supabase client injected → loadVoice2 short-circuits, voice2 stays null
    // → second button stays disabled.
    const wrapper = mount(BrainNodeChip, {
      props: {
        node: makeNode(),
        screenX: 0,
        screenY: 0,
      },
    })
    const buttons = wrapper.findAll('.brain-chip-voice-btn')
    // voice 1 is always enabled (has audioId)
    expect((buttons[0]!.element as HTMLButtonElement).disabled).toBe(false)
    // voice 2 starts disabled
    expect((buttons[1]!.element as HTMLButtonElement).disabled).toBe(true)
  })
})
