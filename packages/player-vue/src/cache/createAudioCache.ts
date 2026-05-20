/**
 * Factory and singleton accessor for the app-wide AudioCache.
 *
 * The cache is process-singleton because it owns a single IndexedDB
 * connection + in-memory id Sets — multiple instances would race on
 * writes and disagree on `has(id)`.
 */

import type { AudioCache, CreateAudioCacheOptions } from './AudioCache.types'
import { AudioCacheImpl } from './AudioCache'

let singleton: AudioCache | null = null

export function createAudioCache(options: CreateAudioCacheOptions = {}): AudioCache {
  return new AudioCacheImpl(options)
}

export function getAudioCache(options?: CreateAudioCacheOptions): AudioCache {
  if (!singleton) singleton = createAudioCache(options)
  return singleton
}

/** Test-only — resets the singleton between specs. */
export function resetAudioCacheForTesting(): void {
  singleton = null
}
