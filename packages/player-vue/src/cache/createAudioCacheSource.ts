/**
 * createAudioCacheSource — AudioSource adapter for the Wave 3 AudioCache
 *
 * This is the read-path bridge that makes the Wave 3 AudioCache
 * (IndexedDB `ssi-audio-cache-v2`) actually serve audio to the
 * RealAudioController. It conforms to the same surface
 * (`getAudioUrl(audioRef)` + `revokeAllBlobUrls()`) that the controller
 * already consumes from the legacy `@ssi/core` AudioSource, so swapping
 * one for the other is a one-line factory change at the call site
 * (LearningPlayer.vue — wired up by task D, not here).
 *
 * Behaviour:
 *  - getAudioUrl(audioRef): asks AudioCache for a blob URL by id. If the
 *    cache has it, we track the URL so we can revoke it later and return
 *    it. If not, we return `audioRef.url` unchanged so the controller
 *    falls through to network (Service Worker / proxy / S3).
 *
 *  - revokeAllBlobUrls(): URL.revokeObjectURL every URL we issued, then
 *    clear the internal Set. Safe to call repeatedly.
 *
 * `courseId` is unused by behaviour (AudioCache stores by id, not course)
 * but kept in the signature for API parity with the legacy
 * `createAudioSource(cache, courseId)` factory. This lets the call site
 * swap factories without changing its arguments.
 *
 * Memoisation note: this source does NOT memoise blob URLs by id. The
 * AudioCache is the source of truth — if it returns a blob URL twice for
 * the same id, we trust both are valid and track both for revocation. If
 * it returns null on a second call (e.g. quota eviction between calls),
 * we fall through to network. Trusting the cache keeps this layer thin.
 */

import type { AudioRef } from '@ssi/core'
import type { AudioCache } from './AudioCache.types'

/**
 * Minimal AudioSource surface this adapter exposes. Matches the methods
 * the RealAudioController in LearningPlayer.vue actually calls. We don't
 * import the concrete `AudioSource` class from `@ssi/core` because it
 * also drags in `preloadAudio` / `isAvailable` (`IAudioSource`) and a
 * full `IOfflineCache` constructor signature — neither of which the
 * controller uses on the read path.
 */
export interface AudioCacheSource {
  getAudioUrl(audioRef: AudioRef): Promise<string>
  revokeAllBlobUrls(): void
}

export function createAudioCacheSource(
  audioCache: AudioCache,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _courseId: string,
): AudioCacheSource {
  // Set, not Map<id, url> — AudioCache may legitimately hand out
  // different blob URLs for the same id across calls (e.g. after a
  // namespace migration); we revoke every URL we ever issued.
  const issuedBlobUrls = new Set<string>()

  return {
    async getAudioUrl(audioRef: AudioRef): Promise<string> {
      const blobUrl = await audioCache.getBlobUrl(audioRef.id)
      if (blobUrl) {
        issuedBlobUrls.add(blobUrl)
        return blobUrl
      }
      // Cache miss — let the controller hit the network path.
      return audioRef.url
    },

    revokeAllBlobUrls(): void {
      for (const url of issuedBlobUrls) {
        URL.revokeObjectURL(url)
      }
      issuedBlobUrls.clear()
    },
  }
}
