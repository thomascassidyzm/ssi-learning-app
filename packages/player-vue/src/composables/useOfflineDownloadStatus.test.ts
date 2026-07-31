// The founder invariant (2026-07-31): the app ALWAYS plays what it has and
// NEVER shows an offline dead-end. 9,732/9,742 cached is a playable course —
// readiness is a threshold, not complete==total, and the progress display
// never rounds 99.9% up to 100% only to then declare failure.
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import {
  OFFLINE_DL_STALL_MS,
  OFFLINE_READY_MIN_FRACTION,
  offlineDlDone,
  offlineDlFailed,
  offlineDlLastProgressAt,
  offlineDlState,
  offlineDlTotal,
  offlineDownloadHeadline,
  offlineDownloadLabel,
  offlineDownloadPct,
  offlineDownloadStalled,
  resetOfflineDownloadStatus,
  resolveOfflineDlOutcome,
  tickOfflineDlStallClock,
} from './useOfflineDownloadStatus'

beforeEach(() => resetOfflineDownloadStatus())

describe('resolveOfflineDlOutcome — offline readiness is a threshold, never complete==total', () => {
  it('the founder shape: 9732/9742 with 10 failed is READY (partial), never error', () => {
    expect(resolveOfflineDlOutcome(9732, 9742, 10, false)).toBe('partial')
  })

  it('everything cached, aux pools intact → complete', () => {
    expect(resolveOfflineDlOutcome(9742, 9742, 0, false)).toBe('complete')
  })

  it('coverage genuinely below the threshold → error (still retried, never a gate)', () => {
    expect(resolveOfflineDlOutcome(4000, 9742, 5742, false)).toBe('error')
  })

  it('exactly at the threshold → ready', () => {
    const total = 1000
    const done = Math.ceil(total * OFFLINE_READY_MIN_FRACTION)
    expect(resolveOfflineDlOutcome(done, total, total - done, false)).toBe('partial')
  })

  it('aux bundle incomplete alone (all course clips cached) → partial, not error', () => {
    expect(resolveOfflineDlOutcome(9742, 9742, 0, true)).toBe('partial')
  })
})

describe('honest progress display', () => {
  it('9732/9742 shows 99%, never rounds up to 100', () => {
    offlineDlState.value = 'downloading'
    offlineDlDone.value = 9732
    offlineDlTotal.value = 9742
    expect(offlineDownloadPct.value).toBe(99)
    expect(offlineDownloadHeadline.value).toBe('Downloading… 99%')
  })

  it('partial state says Ready with the retrying tail — no dead-end, no signal blame', () => {
    offlineDlState.value = 'partial'
    offlineDlDone.value = 9732
    offlineDlTotal.value = 9742
    offlineDlFailed.value = 10
    expect(offlineDownloadHeadline.value).toBe('Ready offline ✓ (10 clips retrying)')
    expect(offlineDownloadLabel.value).toBe('Ready offline (10 clips retrying)')
    expect(offlineDownloadHeadline.value).not.toMatch(/incomplete|signal/i)
  })

  it('error copy reports true state and never claims bad signal', () => {
    offlineDlState.value = 'error'
    offlineDlDone.value = 4000
    offlineDlTotal.value = 9742
    offlineDlFailed.value = 5742
    expect(offlineDownloadLabel.value).toBe('Download incomplete — 4000/9742 cached, retrying in background')
    expect(offlineDownloadLabel.value).not.toMatch(/signal/i)
    expect(offlineDownloadHeadline.value).not.toMatch(/signal/i)
  })
})

describe('liveness — silently stuck forever is a forbidden state', () => {
  it('no progress event for the stall window → display flips to stalled-with-real-counts', async () => {
    offlineDlState.value = 'downloading'
    offlineDlDone.value = 8865
    offlineDlTotal.value = 9742
    await nextTick() // let the progress watcher stamp lastProgressAt
    expect(offlineDownloadStalled.value).toBe(false)
    expect(offlineDownloadHeadline.value).toBe('Downloading… 90%')

    // Nothing lands for the whole stall window.
    offlineDlLastProgressAt.value = Date.now() - OFFLINE_DL_STALL_MS - 1000
    tickOfflineDlStallClock()
    expect(offlineDownloadStalled.value).toBe(true)
    expect(offlineDownloadHeadline.value).toBe('Stalled at 90% — retrying…')
    expect(offlineDownloadLabel.value).toBe('Stalled at 90% (8865/9742) — retrying…')
  })

  it('a progress tick clears the stalled display', async () => {
    offlineDlState.value = 'downloading'
    offlineDlDone.value = 100
    offlineDlTotal.value = 200
    await nextTick()
    offlineDlLastProgressAt.value = Date.now() - OFFLINE_DL_STALL_MS - 1000
    tickOfflineDlStallClock()
    expect(offlineDownloadStalled.value).toBe(true)

    offlineDlDone.value++ // a clip lands
    await nextTick()
    expect(offlineDownloadStalled.value).toBe(false)
    expect(offlineDownloadHeadline.value).toMatch(/^Downloading/)
  })

  it('stalled never fires outside the downloading state', () => {
    offlineDlState.value = 'partial'
    offlineDlLastProgressAt.value = Date.now() - OFFLINE_DL_STALL_MS * 10
    tickOfflineDlStallClock()
    expect(offlineDownloadStalled.value).toBe(false)
  })
})
