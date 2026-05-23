/**
 * drivingModeAdapter.ts - Bridge between SimplePlayer and audioConcatenator cycle formats
 *
 * SimplePlayer uses resolved proxy URLs (audioUrl, voice1Url, voice2Url).
 * The audioConcatenator expects typed Cycles with audio IDs (audioId, voice1AudioId, voice2AudioId).
 * This adapter extracts UUIDs from proxy URLs to create typed Cycles.
 *
 * Also hosts the chunked-prefetch helper that wires driving-mode's
 * `prefetchAudio` option to AudioCache + BundleDownloader. Lives here so
 * LearningPlayer.vue's hookup stays small (two callbacks pulled in) and
 * the two-phase fetch logic is testable in isolation.
 */

import type { Cycle as TypedCycle } from '../types/Cycle'
import type { Cycle as SimpleCycle } from '../playback/SimplePlayer'
import type { AudioCache } from '../cache/AudioCache.types'
import type { BundleDownloader } from '../cache/BundleDownloader'
import type { CourseBundle } from '../types/courseBundle'

/**
 * Extract audio UUID from a proxy URL like /api/audio/{uuid}?courseId=xxx.
 * Exported so chunked-prefetch callers (driving-mode → BundleDownloader)
 * can derive priorityIds from the same SimpleRound cycle objects the
 * audio concatenator sees.
 */
export function extractAudioId(url: string): string {
  if (!url) return ''
  const lastSegment = url.split('/').pop() || ''
  return lastSegment.split('?')[0]
}

/**
 * Collect every audio id that a round will consume during driving-mode
 * playback (known + voice1 + voice2 across all cycles). Used to seed
 * BundleDownloader's priorityIds so the cache fills with the round's
 * audio first, ahead of the bundle's long-tail walk.
 *
 * Drops empty/invalid ids — extractAudioId returns "" for missing URLs,
 * which would otherwise confuse the downloader's dedup logic.
 */
export function audioIdsForSimpleRound(
  cycles: ReadonlyArray<SimpleCycle>,
): string[] {
  const ids: string[] = []
  for (const c of cycles) {
    const k = extractAudioId(c.known?.audioUrl ?? '')
    const t1 = extractAudioId(c.target?.voice1Url ?? '')
    const t2 = extractAudioId(c.target?.voice2Url ?? '')
    if (k) ids.push(k)
    if (t1) ids.push(t1)
    if (t2) ids.push(t2)
  }
  return ids
}

// ============================================================================
// Chunked Prefetch (Driving Mode entry path)
// ============================================================================

export interface ChunkedPrefetchDeps {
  audioCache: AudioCache
  /** Returns the loaded CourseBundle or null if still loading. */
  getBundle: () => CourseBundle | null
  /**
   * Lazy-init the BundleDownloader (sharing instance across chunks).
   * Returns null when the bundle isn't loaded — phase 2 background
   * fill is skipped in that case (phase 1 direct ensures still run).
   */
  getDownloader: () => BundleDownloader | null
}

/**
 * Build the `prefetchAudio` callback driving-mode wants. Implements Tom's
 * two-phase chunked download:
 *
 *   Phase 1 (BLOCKING, fast): pull just THIS round's audio ids in
 *     parallel through audioCache.persistent.ensure(). 60ish small files
 *     (~3 MB total) land in 1–3 s on a typical mobile connection. As
 *     soon as these are cached, audioConcatenator builds the WAV blob
 *     without paying for any network round-trip.
 *
 *   Phase 2 (BACKGROUND): kick off BundleDownloader with the caller's
 *     maxBytes cap. The downloader fills additional course audio behind
 *     the learner so the next round's phase 1 is even faster. Fire-and-
 *     forget — activation latency is bounded by phase 1 alone.
 *
 * Errors are swallowed: concatenateRound's `getAudioSource` falls
 * through to the proxy URL for any uncached id, so a partial warm-up
 * still gets a working round.
 */
export function createChunkedPrefetch(deps: ChunkedPrefetchDeps) {
  const { audioCache, getBundle, getDownloader } = deps

  return async function prefetchAudio(
    audioIds: string[],
    opts?: { maxBytes?: number },
  ): Promise<void> {
    // Phase 1: direct cache ensure for the priority list. Skip jitter /
    // retry — BundleDownloader's politeness is for the long-tail
    // background walk; the user is staring at the screen waiting for
    // audio.
    if (audioIds.length > 0) {
      await Promise.all(
        audioIds.map((id) =>
          audioCache.persistent.ensure(id).catch((err) => {
            // Swallow per-id errors. concatenateRound falls through to
            // /api/audio/${id} for anything still missing.
            console.warn(`[drivingModePrefetch] phase 1 ensure failed for ${id}:`, err)
          }),
        ),
      )
    }

    // Phase 2: background chunk fill (fire-and-forget).
    const bundle = getBundle()
    const dl = getDownloader()
    if (dl && bundle) {
      void dl.start(bundle, { maxBytes: opts?.maxBytes }).catch((err) => {
        console.warn('[drivingModePrefetch] phase 2 background chunk failed:', err)
      })
    }
  }
}

/**
 * Convert SimplePlayer cycles to typed Cycles for the audioConcatenator.
 *
 * durationMs fields are set to 0 — the concatenator gets real durations
 * from decoded audio buffers. pauseDurationMs must come from SimplePlayer's
 * calculated value for correct pause timing.
 */
export function simpleRoundToTypedCycles(cycles: SimpleCycle[]): TypedCycle[] {
  return cycles.map((c, i) => ({
    id: c.id || `cycle-${i}`,
    seedId: '',
    legoId: '',
    type: (c.pauseDuration === 0 ? 'intro' : 'practice') as any,
    known: {
      text: c.known.text,
      audioId: extractAudioId(c.known.audioUrl),
      durationMs: 0,
    },
    target: {
      text: c.target.text,
      voice1AudioId: extractAudioId(c.target.voice1Url),
      voice2AudioId: extractAudioId(c.target.voice2Url),
      voice1DurationMs: 0,
      voice2DurationMs: 0,
    },
    pauseDurationMs: c.pauseDuration ?? 6500,
  }))
}
