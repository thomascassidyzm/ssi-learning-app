/**
 * Who owns the audio bytes cached on this device (SEC0901-D-02, amplification).
 *
 * `AudioCache` (`ssi-audio-cache-v2`) is keyed by audio id alone, with no
 * learner in the key — so a departing learner's downloaded audio is readable by
 * whoever uses the device next. The obvious fix, "wipe the audio cache on
 * sign-out", is WORSE than the bug it closes: Offline Mode is an explicit,
 * deliberate, potentially multi-gigabyte download, and a learner signing out on
 * their own phone would lose all of it every time.
 *
 * So the rule here is narrower and matches the actual threat: purge only when
 * the device's signed-in identity ACTUALLY CHANGES — a different learner signs
 * in than the one whose audio is cached. A same-account sign-out/sign-in cycle
 * keeps every byte. A guest-cached set (no recorded owner) is adopted rather
 * than purged: those bytes are free/preview content by definition, since the
 * uuids that address anything else come from the entitlement-gated bundle and
 * cycles endpoints.
 *
 * The owner marker lives in localStorage rather than IndexedDB so that reading
 * it costs nothing on the boot path and it cannot itself be the thing that
 * fails; a missing marker degrades to "adopt", never to "purge".
 */

import { peekAudioCache, discardAudioCacheSingleton } from './createAudioCache'

const OWNER_KEY = 'ssi-audio-cache-owner'
const DB_NAME = 'ssi-audio-cache-v2'

export type AudioCacheOwnerOutcome = 'kept' | 'adopted' | 'purged' | 'unavailable'

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

function writeOwner(id: string): void {
  try {
    localStorage.setItem(OWNER_KEY, id)
  } catch {
    // A device that cannot persist the marker re-adopts next boot: at worst
    // one extra no-op reconcile, never an unwanted purge.
  }
}

function deleteAudioDb(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve()
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.deleteDatabase(DB_NAME) as unknown as IDBOpenDBRequest
    } catch {
      return resolve()
    }
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    // `blocked` fires when another tab still holds the connection. Resolving
    // is right: the delete stays queued and completes when that tab lets go,
    // and blocking sign-in on it would be a worse failure than a late purge.
    ;(req as unknown as { onblocked: (() => void) | null }).onblocked = () => resolve()
  })
}

/**
 * Reconcile the cached audio against the identity now signed in on this device.
 *
 * Call it whenever an auth session resolves to a user. Idempotent and cheap:
 * the common case is one localStorage read and nothing else.
 */
export async function reconcileAudioCacheOwner(identityId: string | null): Promise<AudioCacheOwnerOutcome> {
  if (!identityId) return 'unavailable' // signed out — never a reason to purge
  const previous = readOwner()
  if (previous === identityId) return 'kept'
  if (previous === null) {
    writeOwner(identityId)
    return 'adopted'
  }
  console.warn('[AudioCacheOwner] signed-in identity changed on this device — clearing cached audio')
  // An open connection blocks deleteDatabase, so close the live cache first
  // and drop the singleton; the next getAudioCache() re-opens on empty.
  try {
    peekAudioCache()?.close()
    discardAudioCacheSingleton()
  } catch {
    // A failed close must not stop the purge — deleteDatabase still queues.
  }
  await deleteAudioDb()
  writeOwner(identityId)
  return 'purged'
}

/** Test seam / recovery path: forget who owns the cache without touching it. */
export function forgetAudioCacheOwner(): void {
  try {
    localStorage.removeItem(OWNER_KEY)
  } catch {
    // nothing to do
  }
}
