/**
 * BrainView test
 *
 * Mounts BrainView with the brainNetworkFixture and asserts:
 *  - the host canvas is present
 *  - the header reads "Your brain on Italian"
 *  - the revealed-count subline matches the fixture
 *  - tour controls render
 *
 * We mock useBrainRenderer because happy-dom doesn't ship a WebGL context
 * and PIXI.Application.init() would throw. The component contract under
 * test here is the layout / template / tour state — the renderer has its
 * own real-browser coverage path via the dev server.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'

import { brainNetworkFixture, brainNetworkFixtureStats } from '../fixtures/brainNetworkFixture'

// Mock the renderer composable BEFORE importing BrainView so the SFC picks
// up the mock at module-init time.
vi.mock('../composables/useBrainRenderer', () => {
  return {
    useBrainRenderer: vi.fn(() => ({
      setFocus: vi.fn(),
      focusedLegoId: ref(null),
      destroy: vi.fn(),
      resize: vi.fn(),
      ready: Promise.resolve(),
    })),
  }
})

// ResizeObserver isn't in happy-dom by default.
beforeEach(() => {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

// Dynamic import so the mock is in place first.
async function mountBrainView() {
  const { default: BrainView } = await import('./BrainView.vue')
  return mount(BrainView, {
    props: {
      data: brainNetworkFixture,
      stats: brainNetworkFixtureStats,
    },
    attachTo: document.body,
  })
}

describe('BrainView', () => {
  it('renders a canvas inside the host', async () => {
    const wrapper = await mountBrainView()
    await nextTick()
    const canvas = wrapper.find('[data-testid="brain-canvas"]')
    expect(canvas.exists()).toBe(true)
    expect(canvas.element.tagName).toBe('CANVAS')
    wrapper.unmount()
  })

  it('shows the language-specific header', async () => {
    const wrapper = await mountBrainView()
    expect(wrapper.text()).toContain('Your brain on Italian')
    wrapper.unmount()
  })

  it('shows the revealed-count subline', async () => {
    const wrapper = await mountBrainView()
    const expected = `${brainNetworkFixtureStats.revealedCount} things you can say`
    expect(wrapper.text()).toContain(expected)
    wrapper.unmount()
  })

  it('renders tour controls including 4 speed options', async () => {
    const wrapper = await mountBrainView()
    expect(wrapper.find('.tour-controls').exists()).toBe(true)
    expect(wrapper.find('.play-btn').exists()).toBe(true)
    const speedButtons = wrapper.findAll('.speed-btn')
    expect(speedButtons).toHaveLength(4)
    expect(speedButtons.map((b) => b.text())).toEqual(['1x', '1.2x', '1.5x', '2x'])
    wrapper.unmount()
  })

  it('emits close when the close button is clicked', async () => {
    const wrapper = await mountBrainView()
    await wrapper.find('.close-btn').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('emits nodeTap for the first revealed node when play is pressed', async () => {
    const wrapper = await mountBrainView()
    await wrapper.find('.play-btn').trigger('click')
    const emitted = wrapper.emitted('nodeTap')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toBeTruthy()
    // First step in tour order — should be a revealed node from belt 0.
    const firstLegoId = emitted![0][0] as string
    const node = brainNetworkFixture.nodes.find((n) => n.legoId === firstLegoId)
    expect(node?.isRevealed).toBe(true)
    expect(node?.beltIndex).toBe(0)
    wrapper.unmount()
  })
})
