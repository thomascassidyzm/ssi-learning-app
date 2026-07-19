/**
 * usePullToRefresh — the touch half of the ONE refresh protocol.
 *
 * Pins that a committed downward pull from the top fires the SAME shared
 * refresh() as the navbar button, and that ordinary gestures (short pull,
 * upward drag, horizontal swipe) do NOT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'

// Make the composable believe this is a touch device (checked at call time).
beforeEach(() => {
  ;(window as unknown as { ontouchstart: null }).ontouchstart = null
  vi.resetModules()
})
afterEach(() => vi.restoreAllMocks())

function touchEvent(type: string, x: number, y: number): Event {
  const e = new Event(type, { cancelable: true, bubbles: true }) as Event & {
    touches: Array<{ clientX: number; clientY: number }>
  }
  e.touches = [{ clientX: x, clientY: y }]
  return e
}

async function harness() {
  const { usePullToRefresh } = await import('./usePullToRefresh')
  const { useDashboardRefresh } = await import('./useDashboardRefresh')

  const loader = vi.fn(async () => {})
  const Comp = defineComponent({
    setup() {
      const el = ref<HTMLElement | null>(null)
      const { registerRefresh } = useDashboardRefresh()
      registerRefresh(loader, { immediate: false })
      usePullToRefresh(el)
      return () => h('div', { ref: el }, 'scroll root')
    },
  })
  const wrapper = mount(Comp, { attachTo: document.body })
  const el = wrapper.element as HTMLElement
  return { el, loader, wrapper }
}

describe('usePullToRefresh', () => {
  it('a downward pull past threshold fires the shared refresh', async () => {
    const { el, loader } = await harness()
    el.dispatchEvent(touchEvent('touchstart', 100, 10))
    el.dispatchEvent(touchEvent('touchmove', 100, 200)) // dy=190, *0.5 resistance ≈ 95px > 72 threshold
    el.dispatchEvent(touchEvent('touchend', 100, 200))
    await Promise.resolve()
    await Promise.resolve()
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('a short pull below threshold does NOT refresh', async () => {
    const { el, loader } = await harness()
    el.dispatchEvent(touchEvent('touchstart', 100, 10))
    el.dispatchEvent(touchEvent('touchmove', 100, 60)) // dy=50, *0.5 = 25px < 72
    el.dispatchEvent(touchEvent('touchend', 100, 60))
    await Promise.resolve()
    expect(loader).not.toHaveBeenCalled()
  })

  it('an upward drag does NOT refresh (that is a scroll)', async () => {
    const { el, loader } = await harness()
    el.dispatchEvent(touchEvent('touchstart', 100, 300))
    el.dispatchEvent(touchEvent('touchmove', 100, 100)) // upward
    el.dispatchEvent(touchEvent('touchend', 100, 100))
    await Promise.resolve()
    expect(loader).not.toHaveBeenCalled()
  })

  it('a horizontal swipe does NOT refresh', async () => {
    const { el, loader } = await harness()
    el.dispatchEvent(touchEvent('touchstart', 20, 10))
    el.dispatchEvent(touchEvent('touchmove', 300, 40)) // dx=280 >> dy=30
    el.dispatchEvent(touchEvent('touchend', 300, 40))
    await Promise.resolve()
    expect(loader).not.toHaveBeenCalled()
  })
})
