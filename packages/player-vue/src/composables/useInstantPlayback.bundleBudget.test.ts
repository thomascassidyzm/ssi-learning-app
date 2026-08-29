/**
 * useInstantPlayback — the bundle boot budget, and its visibility.
 *
 * A flagged course is supposed to boot off the single course bundle. When the
 * bundle isn't in hand inside the boot budget the session falls back to the old
 * /round-map + /cycles endpoints — correct safety behaviour, but until
 * 2026-08-29 it was announced only as a console.warn, which is how a cutover
 * that was falling back on nearly every cold first play went unnoticed on
 * staging.
 *
 * These tests pin the two things that fix depends on:
 *  1. the bundle is raced against BUNDLE_BOOT_BUDGET_MS, not the 2500ms
 *     CRITICAL_PATH_TIMEOUT_MS written for a 20 KB round-map;
 *  2. both outcomes — bundle served, and fallback — reach the telemetry sink,
 *     so the fallback share is queryable rather than folklore.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useInstantPlayback } from './useInstantPlayback'
import { CRITICAL_PATH_TIMEOUT_MS, BUNDLE_BOOT_BUDGET_MS } from '../config/networkGate'
import {
  setBundlePathTelemetrySink,
  type BundlePathEvent,
} from '../playback/bundlePathTelemetry'

/** On the cutover list — see BUNDLE_BOOTSTRAP_COURSES. */
const BUNDLE_COURSE = 'hun_for_eng'

describe('useInstantPlayback — bundle boot budget', () => {
  let events: BundlePathEvent[]

  beforeEach(() => {
    events = []
    setBundlePathTelemetrySink((e) => events.push(e))
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    setBundlePathTelemetrySink(null)
    vi.useRealTimers()
  })

  it('gives the bundle a budget of its own, well past the 20 KB round-map budget', () => {
    expect(BUNDLE_BOOT_BUDGET_MS).toBeGreaterThan(CRITICAL_PATH_TIMEOUT_MS)
    // The worst flagged course measured 1.9s wired and ~4s on 4G (2026-08-29).
    expect(BUNDLE_BOOT_BUDGET_MS).toBeGreaterThanOrEqual(6000)
  })

  it('reports a budget fallback to telemetry instead of only the console', async () => {
    vi.useFakeTimers()

    // Every fetch hangs until aborted — the bundle never arrives, and neither
    // does the /round-map fallback, so bootstrap ultimately rejects. What we
    // are asserting is the REPORT, not the outcome.
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

    const instant = useInstantPlayback(ref(BUNDLE_COURSE), {
      resolveStartLegoId: () => null,
    })
    const settled = instant.bootstrap().then(
      () => 'resolved',
      () => 'rejected',
    )

    // Nothing may be reported before the budget expires: reporting early would
    // mean the boot path gave up sooner than the budget claims.
    await vi.advanceTimersByTimeAsync(CRITICAL_PATH_TIMEOUT_MS + 500)
    expect(events).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(BUNDLE_BOOT_BUDGET_MS + 1000)
    await settled

    const fallback = events.find((e) => e.outcome === 'fallback')
    expect(fallback).toBeDefined()
    expect(fallback?.stage).toBe('round_map')
    expect(fallback?.reason).toBe('budget')
    expect(fallback?.budgetMs).toBe(BUNDLE_BOOT_BUDGET_MS)
    expect(fallback?.waitedMs).toBeGreaterThanOrEqual(BUNDLE_BOOT_BUDGET_MS)
  })
})
