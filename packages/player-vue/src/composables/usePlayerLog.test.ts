/**
 * usePlayerLog — the bearer must be on the FIRST sync flush too.
 *
 * Job #307 (2026-09-12): nine class-8H rows landed with a null learner_id
 * even though the client stamped the learner into every payload. All nine
 * were boot events at the head of their session, flushed by a tab-hide or an
 * unmount inside the first five seconds — before any timed flush had filled
 * the token cache. The sync path cannot await a token, so with an empty cache
 * it fell through to sendBeacon, which cannot carry a header, and the server
 * (rightly, SEC25 INPUT-04) attributed nothing. The cache is now primed at
 * mount. This test fails on the pre-fix code and passes on the post-fix code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { usePlayerLog } from './usePlayerLog'

vi.mock('../config/networkGate', () => ({ isOfflineish: () => false }))
vi.mock('@/platform/apiBase', () => ({ apiUrl: (p: string) => p }))
vi.mock('@/platform/capabilities', () => ({ platform: () => ({ shell: 'web' }) }))

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0))

describe('usePlayerLog — first sync flush carries the bearer', () => {
  let fetchSpy: ReturnType<typeof vi.fn>
  let beaconSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn(async () => ({ ok: true }))
    beaconSpy = vi.fn(() => true)
    vi.stubGlobal('fetch', fetchSpy)
    Object.defineProperty(navigator, 'sendBeacon', { value: beaconSpy, configurable: true })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a tab hidden before any timed flush still sends the boot events with Authorization', async () => {
    let log!: ReturnType<typeof usePlayerLog>
    const Host = defineComponent({
      setup() {
        log = usePlayerLog({
          learnerId: '2efbfb3b-4cdb-4889-9785-36d62dcdd49a',
          getToken: async () => 'signed-token',
          flushIntervalMs: 60_000, // a timed flush never runs inside this test
        })
        return () => h('div')
      },
    })
    const wrapper = mount(Host)
    await nextTick()
    await flushMicrotasks() // lets the mount-time token prime settle

    log.event('cold_start', { guest: false })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await flushMicrotasks()

    // Pre-fix: the cache is empty, so the batch goes out as a header-less
    // beacon and the server stores it with learner_id = null.
    expect(beaconSpy).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer signed-token')
    expect(init.keepalive).toBe(true)
    wrapper.unmount()
  })

  it('a tab hidden while the mount-time token prime is STILL PENDING waits for it and sends with Authorization (job #317)', async () => {
    // Astra (#316·G) on #307: "A pending mount-time token still produces an
    // unattributed beacon." The prime here does not resolve until AFTER the
    // tab has hidden — the shape of a pupil backgrounding the app inside the
    // first few hundred milliseconds, before getSession() has answered.
    let resolveToken!: (t: string | null) => void
    const deferred = new Promise<string | null>((r) => { resolveToken = r })
    let log!: ReturnType<typeof usePlayerLog>
    const Host = defineComponent({
      setup() {
        log = usePlayerLog({
          learnerId: '2efbfb3b-4cdb-4889-9785-36d62dcdd49a',
          getToken: () => deferred,
          flushIntervalMs: 60_000,
        })
        return () => h('div')
      },
    })
    const wrapper = mount(Host)
    await nextTick()
    // Deliberately NOT awaiting the prime: it is in flight.

    log.event('cold_start', { guest: false })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await flushMicrotasks()

    // Nothing may have gone out yet: a beacon here is the unattributed row.
    expect(beaconSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()

    resolveToken('signed-token')
    await flushMicrotasks()

    expect(beaconSpy).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer signed-token')
    expect(init.keepalive).toBe(true)
    wrapper.unmount()
  })

  it('a pending prime that resolves to null (a guest) still beacons, unattributed', async () => {
    let resolveToken!: (t: string | null) => void
    const deferred = new Promise<string | null>((r) => { resolveToken = r })
    let log!: ReturnType<typeof usePlayerLog>
    const Host = defineComponent({
      setup() {
        log = usePlayerLog({ learnerId: 'guest-abc', getToken: () => deferred, flushIntervalMs: 60_000 })
        return () => h('div')
      },
    })
    const wrapper = mount(Host)
    await nextTick()
    log.event('cold_start', { guest: true })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await flushMicrotasks()
    resolveToken(null)
    await flushMicrotasks()
    expect(beaconSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('a prime that never settles falls back to the beacon after the bounded wait, so the batch is not lost', async () => {
    vi.useFakeTimers()
    try {
      let log!: ReturnType<typeof usePlayerLog>
      const Host = defineComponent({
        setup() {
          log = usePlayerLog({
            learnerId: '2efbfb3b-4cdb-4889-9785-36d62dcdd49a',
            getToken: () => new Promise<string | null>(() => { /* never */ }),
            flushIntervalMs: 60_000,
          })
          return () => h('div')
        },
      })
      const wrapper = mount(Host)
      await nextTick()
      log.event('cold_start', { guest: false })
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(100)
      expect(beaconSpy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(beaconSpy).toHaveBeenCalledTimes(1)
      expect(fetchSpy).not.toHaveBeenCalled()
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a guest (no token at all) still beacons, unattributed, exactly as before', async () => {
    let log!: ReturnType<typeof usePlayerLog>
    const Host = defineComponent({
      setup() {
        log = usePlayerLog({ learnerId: 'guest-abc', getToken: async () => null, flushIntervalMs: 60_000 })
        return () => h('div')
      },
    })
    const wrapper = mount(Host)
    await nextTick()
    await flushMicrotasks()
    log.event('cold_start', { guest: true })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await flushMicrotasks()
    expect(beaconSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
