/**
 * useInstantPlayback — boot-path fetch timeout.
 *
 * bootstrap() is awaited directly from LearningPlayer's onMounted (the
 * cold-start critical path). Its round-map/cycles fetch()es carried an
 * AbortController but nothing ever called .abort() on a timer, so a
 * flaky mobile connection could hang bootstrap forever. makeAbort() now
 * aborts every fetch it guards after BOOT_FETCH_TIMEOUT_MS — this
 * asserts bootstrap() rejects (letting the caller fall back to the
 * legacy load path) instead of hanging when the network never responds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useInstantPlayback } from './useInstantPlayback'

describe('useInstantPlayback — boot fetch timeout', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects bootstrap() instead of hanging forever when the round-map fetch never resolves', async () => {
    vi.useFakeTimers()
    try {
      // Real fetch() rejects with AbortError once its signal aborts; this
      // stub mirrors that instead of hanging forever unconditionally, so
      // the test actually exercises the abort wiring rather than timing
      // out the test runner itself.
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init?: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                const err = new Error('The operation was aborted')
                err.name = 'AbortError'
                reject(err)
              })
            }),
        ),
      )

      const instant = useInstantPlayback(ref('fra_for_eng'), {
        resolveStartLegoId: () => null,
      })

      const bootstrapPromise = instant.bootstrap()
      const observed = bootstrapPromise.then(
        () => 'resolved',
        () => 'rejected',
      )

      await vi.advanceTimersByTimeAsync(9000)

      expect(await observed).toBe('rejected')
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves normally on a fast response, well within the timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/round-map')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                course_code: 'fra_for_eng',
                version: 1,
                rounds: [{ r: 1, legoId: 'S0001L01', seed: 1 }],
              }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              course_code: 'fra_for_eng',
              version: 1,
              next_lego_id: null,
              cycles: [
                {
                  id: 'c1',
                  type: 'intro',
                  lego_id: 'S0001L01',
                  seed_number: 1,
                  known_text: 'hello',
                  target_text: 'bonjour',
                  audio: {},
                  durations: {},
                  is_new: true,
                },
              ],
            }),
        })
      }),
    )

    const instant = useInstantPlayback(ref('fra_for_eng'), {
      resolveStartLegoId: () => null,
    })

    const result = await instant.bootstrap()
    expect(result.firstCycle.lego_id).toBe('S0001L01')
  })
})
