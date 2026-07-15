/**
 * Model-voice envelope metadata cache (adaptation v2, workstream C — WP-7a).
 *
 * Batch-fetches `course_audio_envelope` rows (precomputed offline by the
 * dashboard-repo pipeline job, WP-7b) for a set of target1 audio ids, and
 * caches them in memory for the session.
 *
 * Deliberately simpler than `listeningMetaCache`'s IndexedDB pattern: stage 2
 * only ever runs with a live microphone (no mic → no envelope evidence at
 * all, spec §6.4), so there is no offline use case to serve — an in-memory
 * cache is the whole requirement. A missing row (course without envelope
 * data yet) is cached as `null` so repeated lookups for the same id don't
 * re-fetch; the delta producer (WP-8) treats `null`/`undefined` as a no-op.
 *
 * `docs/adaptation/adaptation-v2-build-spec.md` §5.2 is the design authority.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** One `course_audio_envelope` row, camelCased for the delta producer. */
export interface ModelEnvelopeRow {
  audioId: string
  durationMs: number
  peakCount: number
  peakToMeanRatio: number
  meanPeakWidthMs: number
  extractorVersion: number
}

export interface EnvelopeMetadataCache {
  /** Batch-fetch any of `audioIds` not already cached (hit or confirmed-miss). */
  fetchBatch(audioIds: string[]): Promise<void>
  /** `undefined` = never fetched; `null` = fetched, no model row exists yet. */
  get(audioId: string): ModelEnvelopeRow | null | undefined
}

const CHUNK_SIZE = 150 // mirrors listeningMetaCache's PostgREST in()-list chunking

export function createEnvelopeMetadataCache(client: SupabaseClient): EnvelopeMetadataCache {
  const cache = new Map<string, ModelEnvelopeRow | null>()

  const fetchBatch = async (audioIds: string[]): Promise<void> => {
    const missing = [...new Set(audioIds)].filter((id) => !cache.has(id))
    if (missing.length === 0) return

    for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
      const chunk = missing.slice(i, i + CHUNK_SIZE)
      try {
        const { data, error } = await client
          .from('course_audio_envelope')
          .select('audio_id, duration_ms, peak_count, peak_to_mean_ratio, mean_peak_width_ms, extractor_version')
          .in('audio_id', chunk)
        if (error) throw new Error(error.message)

        const found = new Set<string>()
        for (const r of data ?? []) {
          cache.set(r.audio_id, {
            audioId: r.audio_id,
            durationMs: r.duration_ms,
            peakCount: r.peak_count,
            peakToMeanRatio: r.peak_to_mean_ratio,
            meanPeakWidthMs: r.mean_peak_width_ms,
            extractorVersion: r.extractor_version,
          })
          found.add(r.audio_id)
        }
        // Confirmed-missing ids (course has no envelope row for this audio yet)
        // cache as null so a repeat lookup this session doesn't re-fetch.
        for (const id of chunk) if (!found.has(id)) cache.set(id, null)
      } catch (err) {
        // Fetch failure: leave this chunk's ids uncached (undefined) so a
        // later fetchBatch call retries — never poison with a false null.
        console.warn('[EnvelopeMetadataCache] batch fetch failed (stage-2 no-op for this batch):', err)
      }
    }
  }

  const get = (audioId: string): ModelEnvelopeRow | null | undefined => cache.get(audioId)

  return { fetchBatch, get }
}
