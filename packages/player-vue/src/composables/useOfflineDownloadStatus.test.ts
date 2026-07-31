// The founder invariant (2026-07-31): the app ALWAYS plays what it has and
// NEVER shows an offline dead-end. 9,732/9,742 cached is a playable course —
// readiness is a threshold, not complete==total, and the progress display
// never rounds 99.9% up to 100% only to then declare failure.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  OFFLINE_READY_MIN_FRACTION,
  offlineDlDone,
  offlineDlFailed,
  offlineDlState,
  offlineDlTotal,
  offlineDownloadHeadline,
  offlineDownloadLabel,
  offlineDownloadPct,
  resetOfflineDownloadStatus,
  resolveOfflineDlOutcome,
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
