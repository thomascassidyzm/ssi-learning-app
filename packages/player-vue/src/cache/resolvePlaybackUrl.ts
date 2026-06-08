/**
 * resolveCachedPlaybackUrl — the ONE definition of "turn an audio id into a
 * URL the <audio> element can actually play under lock".
 *
 * Why this is the substrate both the main flow and the listening overlay
 * share: iOS Safari throttles the network and the service-worker layer's
 * Range handling when the tab is backgrounded or the screen is locked, so a
 * streamed `/api/audio/<id>` mp3 stalls (200-in-response-to-Range → iOS
 * plays ~0.5s then waits forever; 'ended' never fires). A WAV blob decoded
 * from IndexedDB is real PCM with no network dependency — WebKit plays it
 * locked. The main 4-phase cycle already resolves through this (SimplePlayer
 * resolveAudioUrl override); routing listening through the SAME primitive is
 * what makes listening lock-screen-safe too, instead of maintaining a
 * second, weaker bytes-to-speaker path.
 *
 * Returns the cached WAV blob URL when the bytes are in IndexedDB, else the
 * supplied fallback (the proxy URL — instant first play on a cold cache).
 * Never throws: a cache miss or decode error falls through to the fallback,
 * because audio must never stop.
 *
 * Note on lifetime: AudioCache.getWavBlobUrl memoises the blob URL per id
 * (wavUrlCache), so callers must NOT revokeObjectURL it — it is reused
 * across replays of the same clip. (Mirrors how the main flow consumes it.)
 */
import type { AudioCache } from './AudioCache.types'

export async function resolveCachedPlaybackUrl(
  audioCache: Pick<AudioCache, 'getWavBlobUrl'>,
  id: string,
  fallbackUrl: string,
): Promise<string> {
  try {
    const wav = await audioCache.getWavBlobUrl(id)
    return wav || fallbackUrl
  } catch {
    return fallbackUrl
  }
}
