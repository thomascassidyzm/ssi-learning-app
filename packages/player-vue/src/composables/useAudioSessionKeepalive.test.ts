/**
 * useAudioSessionKeepalive — the AudioContext half of an iOS audio-session
 * interruption.
 *
 * Tom, 2026-08-09: backgrounded and playing, switch to WhatsApp, and SSi audio
 * SOMETIMES never comes back. The element half of that is pinned in
 * playback/audioInterruption.test.ts. This file pins the layer underneath: iOS
 * Safari parks the AudioContext in its own non-standard **`interrupted`**
 * state, which the old `state === 'suspended'` checks skipped straight past —
 * so the thing whose only job is holding the iOS audio session quietly stopped
 * holding it for the rest of the session.
 *
 * The crux, same as the element half: recovery only ever happens while the
 * session is still meant to be playing. A learner who deliberately paused is
 * never resumed behind their back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'

type FakeState = 'running' | 'suspended' | 'interrupted' | 'closed'

/** Minimal AudioContext stand-in with iOS's extra `interrupted` state. */
function makeFakeContext(opts: { resumeFails?: boolean } = {}) {
  const listeners: Array<() => void> = []
  const ctx = {
    state: 'suspended' as FakeState,
    resumeCalls: 0,
    resume: vi.fn(() => {
      ctx.resumeCalls++
      if (opts.resumeFails) return Promise.reject(new Error('interrupted'))
      ctx.state = 'running'
      return Promise.resolve()
    }),
    suspend: vi.fn(() => { ctx.state = 'suspended'; return Promise.resolve() }),
    close: vi.fn(() => { ctx.state = 'closed'; return Promise.resolve() }),
    createGain: () => ({ gain: { value: 1 }, connect: () => {} }),
    createOscillator: () => ({
      frequency: { value: 0 },
      connect: () => {},
      start: () => {},
      stop: () => {},
      disconnect: () => {},
    }),
    destination: {},
    addEventListener: (_type: string, fn: () => void) => { listeners.push(fn) },
    removeEventListener: (_type: string, fn: () => void) => {
      const i = listeners.indexOf(fn)
      if (i >= 0) listeners.splice(i, 1)
    },
    /** What iOS does to us: take the session and announce it. */
    interrupt: () => {
      ctx.state = 'interrupted'
      listeners.forEach(fn => fn())
    },
  }
  return ctx
}

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

async function harness(active: Ref<boolean>, ctx: ReturnType<typeof makeFakeContext>) {
  ;(window as unknown as { AudioContext: unknown }).AudioContext = function () { return ctx } as unknown
  const { useAudioSessionKeepalive } = await import('./useAudioSessionKeepalive')
  const Comp = defineComponent({
    setup() {
      useAudioSessionKeepalive(active)
      return () => h('div')
    },
  })
  const wrapper = mount(Comp, { attachTo: document.body })
  // The watcher is not immediate — flip once to bring the context up.
  active.value = !active.value
  await wrapper.vm.$nextTick()
  active.value = !active.value
  await wrapper.vm.$nextTick()
  await Promise.resolve()
  return wrapper
}

beforeEach(() => {
  vi.resetModules()
  setVisibility('visible')
})
afterEach(() => { vi.restoreAllMocks() })

describe('useAudioSessionKeepalive — outside audio-session interruptions', () => {
  it("resumes a context iOS parked in 'interrupted', not just 'suspended'", async () => {
    const ctx = makeFakeContext()
    const active = ref(true)
    const wrapper = await harness(active, ctx)
    expect(ctx.state).toBe('running')

    // Another app takes the session mid-session.
    ctx.interrupt()
    await Promise.resolve()

    expect(ctx.state).toBe('running')
    wrapper.unmount()
  })

  it('recovers on return to the foreground when the statechange was missed', async () => {
    const ctx = makeFakeContext()
    const active = ref(true)
    const wrapper = await harness(active, ctx)

    // Backgrounded, interrupted, and no statechange delivered to us.
    setVisibility('hidden')
    ctx.state = 'interrupted'
    const before = ctx.resumeCalls

    setVisibility('visible')
    await Promise.resolve()

    expect(ctx.resumeCalls).toBeGreaterThan(before)
    expect(ctx.state).toBe('running')
    wrapper.unmount()
  })

  it('never revives the session the learner deliberately paused', async () => {
    vi.useFakeTimers()
    const ctx = makeFakeContext()
    const active = ref(true)
    const wrapper = await harness(active, ctx)

    // The learner pauses: `active` goes false and, after the release debounce,
    // we intentionally suspend. Nothing after this may bring it back.
    active.value = false
    await wrapper.vm.$nextTick()
    vi.advanceTimersByTime(3000)
    await Promise.resolve()
    expect(ctx.state).toBe('suspended')
    const afterPause = ctx.resumeCalls

    ctx.interrupt()
    setVisibility('hidden')
    setVisibility('visible')
    vi.advanceTimersByTime(10000)
    await Promise.resolve()

    expect(ctx.resumeCalls).toBe(afterPause)
    expect(ctx.state).not.toBe('running')
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('retries a rejected resume, but a bounded number of times', async () => {
    vi.useFakeTimers()
    const ctx = makeFakeContext({ resumeFails: true })
    const active = ref(true)
    const wrapper = await harness(active, ctx)

    // Every resume is rejected — iOS does that while the other app still holds
    // the session. We retry, and we stop; no unbounded timer chain.
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
      await Promise.resolve()
    }

    expect(ctx.resumeCalls).toBeGreaterThan(1)
    expect(ctx.resumeCalls).toBeLessThanOrEqual(6)
    wrapper.unmount()
    vi.useRealTimers()
  })
})
