import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { nextTick, ref } from 'vue'
import { usePodListeningReminder } from './usePodListeningReminder'

// onUnmounted has no active component instance in these direct-call tests —
// Vue logs a warning but the composable still works (watch()/setTimeout are
// plain reactivity, not lifecycle-gated). Silence that expected noise only.
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
afterAll(() => warnSpy.mockRestore())

describe('usePodListeningReminder', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is hidden before any pod lap starts', () => {
    const playing = ref(false)
    const { visible } = usePodListeningReminder(playing)
    expect(visible.value).toBe(false)
  })

  it('shows as soon as a pod lap starts, then auto-hides after holdMs', async () => {
    const playing = ref(false)
    const { visible } = usePodListeningReminder(playing, 4000)

    playing.value = true
    await nextTick()
    expect(visible.value).toBe(true)

    vi.advanceTimersByTime(3999)
    expect(visible.value).toBe(true)

    vi.advanceTimersByTime(1)
    expect(visible.value).toBe(false)
  })

  it('hides immediately if the lap ends before the hold elapses', async () => {
    const playing = ref(false)
    const { visible } = usePodListeningReminder(playing, 4000)

    playing.value = true
    await nextTick()
    expect(visible.value).toBe(true)

    vi.advanceTimersByTime(1000)
    playing.value = false
    await nextTick()
    expect(visible.value).toBe(false)

    // The stale timer from the interrupted lap must not resurrect it later.
    vi.advanceTimersByTime(3000)
    expect(visible.value).toBe(false)
  })

  it('re-arms once per lap — a new lap starting shows it again', async () => {
    const playing = ref(false)
    const { visible } = usePodListeningReminder(playing, 4000)

    playing.value = true
    await nextTick()
    vi.advanceTimersByTime(4000)
    expect(visible.value).toBe(false)

    playing.value = false
    await nextTick()
    playing.value = true
    await nextTick()
    expect(visible.value).toBe(true)

    vi.advanceTimersByTime(4000)
    expect(visible.value).toBe(false)
  })
})
