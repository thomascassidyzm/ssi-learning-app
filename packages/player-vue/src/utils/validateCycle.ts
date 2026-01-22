import type { Cycle, CachedAudio, ValidationResult } from '../types/Cycle'

/**
 * Validates that a single Cycle has all required audio files in the cache.
 * @param cycle - The Cycle to validate
 * @param audioCache - Map of cached audio by ID
 * @returns ValidationResult indicating if cycle is ready or which audio IDs are missing
 */
export function validateCycle(
  cycle: Cycle,
  audioCache: Map<string, CachedAudio>
): ValidationResult {
  const missing: string[] = []

  // Check known audio
  if (!audioCache.has(cycle.known.audioId)) {
    missing.push(cycle.known.audioId)
  }

  // Check target voice 1 audio
  if (!audioCache.has(cycle.target.voice1AudioId)) {
    missing.push(cycle.target.voice1AudioId)
  }

  // Check target voice 2 audio
  if (!audioCache.has(cycle.target.voice2AudioId)) {
    missing.push(cycle.target.voice2AudioId)
  }

  if (missing.length > 0) {
    return { ready: false, missing }
  }

  return { ready: true }
}

/**
 * Validates that all Cycles in a session have their required audio files cached.
 * @param cycles - Array of Cycles to validate
 * @param audioCache - Map of cached audio by ID
 * @returns ValidationResult with all missing audio IDs aggregated
 */
export function validateSession(
  cycles: Cycle[],
  audioCache: Map<string, CachedAudio>
): ValidationResult {
  const allMissing = new Set<string>()

  for (const cycle of cycles) {
    const result = validateCycle(cycle, audioCache)
    if (!result.ready && 'missing' in result) {
      result.missing.forEach(id => allMissing.add(id))
    }
  }

  if (allMissing.size > 0) {
    return { ready: false, missing: Array.from(allMissing) }
  }

  return { ready: true }
}
