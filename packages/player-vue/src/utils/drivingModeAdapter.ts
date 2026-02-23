/**
 * drivingModeAdapter.ts - Bridge between SimplePlayer and audioConcatenator cycle formats
 *
 * SimplePlayer uses resolved proxy URLs (audioUrl, voice1Url, voice2Url).
 * The audioConcatenator expects typed Cycles with audio IDs (audioId, voice1AudioId, voice2AudioId).
 * This adapter extracts UUIDs from proxy URLs to create typed Cycles.
 */

import type { Cycle as TypedCycle } from '../types/Cycle'
import type { Cycle as SimpleCycle } from '../playback/SimplePlayer'

/**
 * Extract audio UUID from a proxy URL like /api/audio/{uuid}?courseId=xxx
 */
function extractAudioId(url: string): string {
  if (!url) return ''
  const lastSegment = url.split('/').pop() || ''
  return lastSegment.split('?')[0]
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
