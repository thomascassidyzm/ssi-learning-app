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
 *
 * Job #317 made the sync flush wait, bounded, for an in-flight bearer. Job
 * #320 (Astra's cold verification, #319) states the bound honestly as a
 * trade-off, lifts it wherever the page is not at eviction risk, and stops a
 * refused sendBeacon from dropping its batch. See the #320 block below.
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

  // ── job #320: what #317 narrowed, stated honestly, and the beacon-refusal miss ──

  const mountDeferredHost = (tokenAt: number, learnerId = '2efbfb3b-4cdb-4889-9785-36d62dcdd49a') => {
    let log!: ReturnType<typeof usePlayerLog>
    const Host = defineComponent({
      setup() {
        log = usePlayerLog({
          learnerId,
          getToken: () => new Promise<string | null>((r) => setTimeout(() => r('signed-token'), tokenAt)),
          flushIntervalMs: 60_000,
        })
        return () => h('div')
      },
    })
    const wrapper = mount(Host)
    return { wrapper, log: () => log }
  }
  const hide = () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }
  const show = () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('a tab that hides and STAYS hidden beacons unattributed at the bound; a bearer at 1200ms is NOT applied to that batch (the documented trade-off)', async () => {
    vi.useFakeTimers()
    try {
      const { wrapper, log } = mountDeferredHost(1200)
      await nextTick()
      log().event('cold_start', { guest: false })
      hide()
      await vi.advanceTimersByTimeAsync(700)
      expect(beaconSpy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(200) // past the 800ms hidden bound
      expect(beaconSpy).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1000) // the bearer resolves at 1200ms
      // The batch has already been secured: no second send, attributed or not.
      expect(beaconSpy).toHaveBeenCalledTimes(1)
      expect(fetchSpy).not.toHaveBeenCalled()
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a player UNMOUNTED inside a live tab waits past 800ms and sends the batch with the 1200ms bearer', async () => {
    vi.useFakeTimers()
    try {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      const { wrapper, log } = mountDeferredHost(1200)
      await nextTick()
      log().event('cold_start', { guest: false })
      wrapper.unmount()
      await vi.advanceTimersByTimeAsync(1000) // pre-fix: the beacon has already gone here, unattributed
      expect(beaconSpy).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(300)
      expect(beaconSpy).not.toHaveBeenCalled()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer signed-token')
      expect(init.keepalive).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a tab hidden then brought BACK before the bound keeps waiting and sends with the 1200ms bearer', async () => {
    vi.useFakeTimers()
    try {
      const { wrapper, log } = mountDeferredHost(1200)
      await nextTick()
      log().event('cold_start', { guest: false })
      hide()
      await vi.advanceTimersByTimeAsync(400)
      show()
      await vi.advanceTimersByTimeAsync(600) // 1000ms in: hidden-only code would have beaconed at 800
      expect(beaconSpy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(300)
      expect(beaconSpy).not.toHaveBeenCalled()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer signed-token')
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('an unmount whose getter hangs past the safe budget still sends the batch, unattributed, rather than never', async () => {
    vi.useFakeTimers()
    try {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
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
      wrapper.unmount()
      await vi.advanceTimersByTimeAsync(9_000)
      expect(beaconSpy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(beaconSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a beacon the browser REFUSES (sendBeacon returns false) falls through to keepalive fetch, so the batch is not lost', async () => {
    beaconSpy.mockReturnValue(false)
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
    hide()
    await flushMicrotasks()
    expect(beaconSpy).toHaveBeenCalledTimes(1)
    // Pre-fix: nothing else happens and the batch is gone.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/player-events')
    expect(init.keepalive).toBe(true)
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
    const sent = JSON.parse(init.body as string)
    expect(sent.events).toHaveLength(1)
    expect(sent.events[0].event_type).toBe('cold_start')
    wrapper.unmount()
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

describe('usePlayerLog — the postbox can flush every live log and read what is still buffered', () => {
  it('pendingPlayerEvents lists a mounted log\'s buffer and flushAllPlayerLogs drains it', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchSpy)
    const mod = await import('./usePlayerLog')
    let log!: ReturnType<typeof usePlayerLog>
    const Host = defineComponent({
      setup() {
        log = usePlayerLog({ getToken: async () => 'signed-token', flushIntervalMs: 60_000 })
        return () => h('div')
      },
    })
    const wrapper = mount(Host)
    await nextTick()
    log.event('tap_pause', { where: 'player' })
    expect(mod.pendingPlayerEvents().map((e) => e.event_type)).toEqual(['tap_pause'])
    await mod.flushAllPlayerLogs()
    expect(mod.pendingPlayerEvents()).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    log.event('after_unmount')
    expect(mod.pendingPlayerEvents()).toEqual([])
    vi.unstubAllGlobals()
  })
})
