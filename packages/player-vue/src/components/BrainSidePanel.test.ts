/**
 * Component smoke tests for BrainSidePanel.
 *
 * Verifies the panel renders the target/known text, emits the right
 * events, and translates the internal legoId chips into a `nodeFocus`
 * payload (the boundary where "lego" becomes "this is the word you
 * tapped"). No live Supabase — phrases stay loading/empty, which is
 * fine; we just want the shell to render.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import BrainSidePanel from './BrainSidePanel.vue'
import type { NetworkNode } from '../types/brainNetwork'

const makeNode = (overrides: Partial<NetworkNode> = {}): NetworkNode => ({
  legoId: 'S0001L01',
  type: 'atom',
  text: 'ciao',
  knownText: 'hello',
  audioId: 'audio-hello-target1',
  beltIndex: 0,
  seedNumber: 1,
  position: { x: 0, y: 0 },
  isRevealed: true,
  masteryState: 'acquisition',
  introducedAt: null,
  ...overrides,
})

beforeAll(() => {
  // jsdom-style stubs for the audio element so the component doesn't
  // explode when it tries to instantiate one.
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

describe('BrainSidePanel', () => {
  it('renders nothing when node is null', () => {
    const wrapper = mount(BrainSidePanel, {
      props: {
        node: null,
        beltName: 'white',
      },
    })
    expect(wrapper.find('.brain-side-panel').exists()).toBe(false)
  })

  it('renders target text, known text and belt provenance', () => {
    const wrapper = mount(BrainSidePanel, {
      props: {
        node: makeNode({ text: 'buongiorno', knownText: 'good morning' }),
        beltName: 'yellow',
      },
    })
    const html = wrapper.html()
    expect(html).toContain('buongiorno')
    expect(html).toContain('good morning')
    expect(html).toContain('First learned at')
    expect(html).toContain('yellow')
  })

  it('renders "Connects with" chips when connectedLegos provided', () => {
    const wrapper = mount(BrainSidePanel, {
      props: {
        node: makeNode(),
        beltName: 'white',
        connectedLegos: [
          { legoId: 'S0002L01', text: 'grazie' },
          { legoId: 'S0003L01', text: 'prego' },
        ],
      },
    })
    const chips = wrapper.findAll('.bsp-chip')
    expect(chips).toHaveLength(2)
    expect(chips[0]!.text()).toBe('grazie')
    expect(chips[1]!.text()).toBe('prego')
  })

  it('emits nodeFocus with the legoId when a chip is tapped', async () => {
    const wrapper = mount(BrainSidePanel, {
      props: {
        node: makeNode(),
        beltName: 'white',
        connectedLegos: [{ legoId: 'S0002L01', text: 'grazie' }],
      },
    })
    await wrapper.find('.bsp-chip').trigger('click')
    expect(wrapper.emitted('nodeFocus')).toBeTruthy()
    expect(wrapper.emitted('nodeFocus')![0]).toEqual(['S0002L01'])
  })

  it('emits close when the close button is tapped', async () => {
    const wrapper = mount(BrainSidePanel, {
      props: {
        node: makeNode(),
        beltName: 'white',
      },
    })
    await wrapper.find('.bsp-close').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('does not surface the internal legoId in any visible text', async () => {
    // The contract is firm: nodes are *words and phrases*. The user
    // must never see "S0001L01" or any "lego" label.
    const wrapper = mount(BrainSidePanel, {
      props: {
        node: makeNode({ legoId: 'S0042L07', text: 'arrivederci' }),
        beltName: 'orange',
        connectedLegos: [{ legoId: 'S0099L02', text: 'a presto' }],
      },
    })
    await flushPromises()
    const visible = wrapper.text().toLowerCase()
    expect(visible).not.toContain('lego')
    expect(visible).not.toContain('s0042l07')
    expect(visible).not.toContain('s0099l02')
    expect(visible).not.toContain('seed')
    expect(visible).not.toContain('round')
  })
})
