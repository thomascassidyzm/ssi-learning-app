/**
 * THE OPT-IN GATE. Tom's ruling, 2026-09-01:
 *
 *   "Should be progressively loaded, yes. Never upfront loaded."
 *   "Because people still have the option if they choose to select the
 *    Offline Mode itself."
 *
 * A bulk download is the DELIBERATE path — reachable only when the learner has
 * turned Offline Mode on themselves. These tests fail if that gate is ever
 * weakened, so an automatic prefetch path cannot quietly acquire the ability to
 * pull a course down.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  bulkDownloadAudio,
  type BulkAudioDownloadCounters,
  type BulkAudioDownloadDeps,
} from './bulkAudioDownload'

const counters: BulkAudioDownloadCounters = { onDone: () => {}, onFailed: () => {} }

function deps(optedIn: boolean, spies: Partial<BulkAudioDownloadDeps> = {}): BulkAudioDownloadDeps {
  return {
    offlineModeOptIn: () => optedIn,
    fetchBatchUrls: async () => { throw new Error('fetchBatchUrls must not be called') },
    ensureFromUrl: async () => { throw new Error('ensureFromUrl must not be called') },
    ensure: async () => { throw new Error('ensure must not be called') },
    isCancelled: () => false,
    isPlaying: () => false,
    sleep: async () => {},
    ...spies,
  }
}

describe('bulkDownloadAudio — Offline Mode opt-in gate', () => {
  it('fetches NOTHING when the learner has not opted into Offline Mode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchBatchUrls = vi.fn()
    const ensureFromUrl = vi.fn()
    const ensure = vi.fn()

    const result = await bulkDownloadAudio(
      ['a', 'b', 'c'],
      deps(false, { fetchBatchUrls, ensureFromUrl, ensure }),
      counters,
    )

    expect(fetchBatchUrls).not.toHaveBeenCalled()
    expect(ensureFromUrl).not.toHaveBeenCalled()
    expect(ensure).not.toHaveBeenCalled()
    // Reported as a clean cancellation so a caller that somehow reached here
    // degrades to streaming rather than throwing into the playback path.
    expect(result).toEqual({ completed: false, failedIds: [] })
    warn.mockRestore()
  })

  it('says out loud why it refused, so the mistake is findable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await bulkDownloadAudio(['a'], deps(false), counters)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/Offline Mode opt-in/i)
    warn.mockRestore()
  })

  it('runs normally once the learner HAS opted in', async () => {
    const ensureFromUrl = vi.fn(async () => {})
    const result = await bulkDownloadAudio(
      ['a', 'b'],
      deps(true, {
        fetchBatchUrls: async (ids) => ({
          urls: Object.fromEntries(ids.map((id) => [id, `https://s3.example.com/${id}`])),
          denied: [],
        }),
        ensureFromUrl,
      }),
      counters,
    )
    expect(ensureFromUrl).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ completed: true, failedIds: [] })
  })

  it('re-checks the opt-in on every call, not once per module load', async () => {
    let optedIn = true
    const ensureFromUrl = vi.fn(async () => {})
    const d: BulkAudioDownloadDeps = {
      ...deps(true, {
        fetchBatchUrls: async (ids) => ({
          urls: Object.fromEntries(ids.map((id) => [id, `https://s3.example.com/${id}`])),
          denied: [],
        }),
        ensureFromUrl,
      }),
      offlineModeOptIn: () => optedIn,
    }

    await bulkDownloadAudio(['a'], d, counters)
    expect(ensureFromUrl).toHaveBeenCalledTimes(1)

    // Learner turns Offline Mode off; a later call must not resume downloading.
    optedIn = false
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const second = await bulkDownloadAudio(['b'], d, counters)
    expect(ensureFromUrl).toHaveBeenCalledTimes(1)
    expect(second.completed).toBe(false)
    warn.mockRestore()
  })
})
