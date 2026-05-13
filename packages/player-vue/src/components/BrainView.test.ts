/**
 * BrainView v2 test
 *
 * Mounts BrainView with the v2 fixture and asserts:
 *  - header renders with the language name from data
 *  - subline reports revealed-count + synapse-count
 *  - the scrubber renders with the right min/max bounds
 *  - dragging the scrubber to a past time calls renderer.setVisibleAt
 *  - pressing play auto-advances the playhead over time
 *
 * useBrainRenderer is mocked because happy-dom has no WebGL context and
 * PIXI.Application.init() would throw. The renderer has its own coverage
 * via the dev server / e2e suite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'

import { brainNetworkFixture } from '../fixtures/brainNetworkFixture'

// Capture the most recent call args so individual tests can assert against them.
const setVisibleAtSpy = vi.fn()
const setFocusSpy = vi.fn()
const destroySpy = vi.fn()
const resizeSpy = vi.fn()

vi.mock('../composables/useBrainRenderer', () => {
  return {
    useBrainRenderer: vi.fn(() => ({
      setVisibleAt: setVisibleAtSpy,
      setFocus: setFocusSpy,
      focusedLegoId: ref(null),
      destroy: destroySpy,
      resize: resizeSpy,
      ready: Promise.resolve(),
    })),
  }
})

beforeEach(() => {
  setVisibleAtSpy.mockClear()
  setFocusSpy.mockClear()
  destroySpy.mockClear()
  resizeSpy.mockClear()
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

afterEach(() => {
  vi.useRealTimers()
})

async function mountBrainView() {
  const { default: BrainView } = await import('./BrainView.vue')
  return mount(BrainView, {
    props: {
      data: brainNetworkFixture,
    },
    attachTo: document.body,
  })
}

describe('BrainView v2', () => {
  it('renders a canvas inside the host', async () => {
    const wrapper = await mountBrainView()
    await nextTick()
    const canvas = wrapper.find('[data-testid="brain-canvas"]')
    expect(canvas.exists()).toBe(true)
    expect(canvas.element.tagName).toBe('CANVAS')
    wrapper.unmount()
  })

  it('shows the language-specific header from data.languageName', async () => {
    const wrapper = await mountBrainView()
    expect(wrapper.text()).toContain(`Your brain on ${brainNetworkFixture.languageName}`)
    wrapper.unmount()
  })

  it('shows the count subline ("X things you can say · Y synapses")', async () => {
    const wrapper = await mountBrainView()
    // Playhead starts at "now" → all nodes revealed, all edges fired.
    const totalNodes = brainNetworkFixture.nodes.length
    const totalEdges = brainNetworkFixture.edges.length
    expect(wrapper.text()).toContain(`${totalNodes} things you can say`)
    expect(wrapper.text()).toContain(`${totalEdges} synapses`)
    wrapper.unmount()
  })

  it('renders the scrubber with min/max bounds matching the data', async () => {
    const wrapper = await mountBrainView()
    const scrubber = wrapper.find('[data-testid="brain-scrubber"]')
    expect(scrubber.exists()).toBe(true)

    const firstEventAt = Date.parse(brainNetworkFixture.events[0].at)
    const min = Number(scrubber.attributes('data-min'))
    const max = Number(scrubber.attributes('data-max'))
    expect(min).toBe(firstEventAt)
    expect(max).toBeGreaterThan(min)
    // "now" should be roughly the current time — generous bound.
    const drift = Math.abs(max - Date.now())
    expect(drift).toBeLessThan(60_000) // within a minute
    wrapper.unmount()
  })

  it('renders 4 speed options (1×, 2×, 4×, 8×)', async () => {
    const wrapper = await mountBrainView()
    const speedButtons = wrapper.findAll('.speed-btn')
    expect(speedButtons).toHaveLength(4)
    expect(speedButtons.map((b) => b.text())).toEqual(['1×', '2×', '4×', '8×'])
    wrapper.unmount()
  })

  it('emits close when the close button is clicked', async () => {
    const wrapper = await mountBrainView()
    await wrapper.find('.close-btn').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('dragging the scrubber to a past time calls renderer.setVisibleAt with that time', async () => {
    const wrapper = await mountBrainView()
    await nextTick()

    const scrubber = wrapper.find('[data-testid="brain-scrubber"]')
    const min = Number(scrubber.attributes('data-min'))
    const max = Number(scrubber.attributes('data-max'))

    // Stub getBoundingClientRect so timeFromClientX has predictable maths.
    const el = scrubber.element as HTMLElement
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 26, width: 200, height: 26, x: 0, y: 0, toJSON: () => '' }) as DOMRect

    // Drag to 25% of the way along → playhead should land near min + 0.25*span.
    await el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, pointerId: 1, bubbles: true }))
    await nextTick()

    const expectedT = min + (max - min) * 0.25
    // The watcher pushes ISO into setVisibleAt — assert the most recent call.
    expect(setVisibleAtSpy).toHaveBeenCalled()
    const lastCall = setVisibleAtSpy.mock.calls[setVisibleAtSpy.mock.calls.length - 1]
    const calledMs = Date.parse(lastCall[0])
    // Tolerance: a few ms to account for floating-point ratio maths.
    expect(Math.abs(calledMs - expectedT)).toBeLessThan(50)
    wrapper.unmount()
  })

  it('pressing play auto-advances the playhead over time', async () => {
    vi.useFakeTimers()
    const wrapper = await mountBrainView()
    await nextTick()

    // Jump to start so play actually has events to advance through.
    await wrapper.find('[aria-label="Jump to start"]').trigger('click')
    await nextTick()
    setVisibleAtSpy.mockClear()

    // Press play.
    await wrapper.find('[aria-label="Play"]').trigger('click')
    await nextTick()

    // Advance fake timers — 250ms per event at 1× speed. Run a few cycles.
    await vi.advanceTimersByTimeAsync(1000)

    // The watcher should have pushed multiple setVisibleAt calls as the
    // playhead stepped through events.
    expect(setVisibleAtSpy.mock.calls.length).toBeGreaterThanOrEqual(2)

    wrapper.unmount()
  })
})
