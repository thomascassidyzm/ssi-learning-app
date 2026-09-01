/**
 * SEC0901-D-02 (amplification) — cached AUDIO BYTES must not survive a change
 * of signed-in identity on a device, and must survive everything else.
 *
 * The audit's finding: `ssi-audio-cache-v2` is keyed by audio id with no
 * learner in the key and is never cleared, so a departing learner's downloaded
 * premium audio is readable by whoever uses the device next.
 *
 * The fix deliberately does NOT wipe on sign-out. Offline Mode is an explicit,
 * potentially multi-gigabyte download; destroying it whenever a learner signs
 * out on their own phone would be a worse regression than the leak. The rule
 * is "purge only when the signed-in identity actually CHANGES", and both
 * halves of that rule are pinned below — the second one (same account keeps
 * its download) is the one protecting real paying learners.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const DB_NAME = 'ssi-audio-cache-v2'

async function seedAudioDb(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('audio', 'readwrite')
      tx.objectStore('audio').put({ id: 'premium-clip', bytes: 'paid audio' })
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  })
}

async function audioDbHasClip(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME)
    req.onupgradeneeded = () => {
      // Opening a database that no longer exists recreates it empty — which is
      // itself the answer: the purge happened.
      const db = req.result
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('audio')) {
        db.close()
        return resolve(false)
      }
      const get = db.transaction('audio', 'readonly').objectStore('audio').get('premium-clip')
      get.onsuccess = () => {
        db.close()
        resolve(!!get.result)
      }
      get.onerror = () => {
        db.close()
        resolve(false)
      }
    }
    req.onerror = () => resolve(false)
  })
}

describe('SEC0901-D-02 amplification: audio cache is purged on identity change only', () => {
  beforeEach(async () => {
    vi.resetModules()
    localStorage.clear()
    await new Promise<void>((resolve) => {
      const del = indexedDB.deleteDatabase(DB_NAME)
      del.onsuccess = () => resolve()
      del.onerror = () => resolve()
      ;(del as unknown as { onblocked: (() => void) | null }).onblocked = () => resolve()
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('purges the cached audio when a DIFFERENT learner signs in on the device', async () => {
    const { reconcileAudioCacheOwner } = await import('./audioCacheOwner')
    await seedAudioDb()
    expect(await reconcileAudioCacheOwner('learner-A')).toBe('adopted')
    expect(await audioDbHasClip()).toBe(true) // adopting never destroys

    expect(await reconcileAudioCacheOwner('learner-B')).toBe('purged')
    expect(await audioDbHasClip()).toBe(false)
  })

  it('NO REGRESSION — the same learner keeps every byte across a sign-out/sign-in cycle', async () => {
    const { reconcileAudioCacheOwner } = await import('./audioCacheOwner')
    await seedAudioDb()
    await reconcileAudioCacheOwner('learner-A')

    // Sign out: reconcile is never called with an identity, and nothing else
    // touches the cache. Then the SAME learner signs back in.
    expect(await reconcileAudioCacheOwner(null)).toBe('unavailable')
    expect(await reconcileAudioCacheOwner('learner-A')).toBe('kept')
    expect(await audioDbHasClip()).toBe(true)
  })

  it('signing out alone never purges — a guest session cannot destroy a download', async () => {
    const { reconcileAudioCacheOwner } = await import('./audioCacheOwner')
    await seedAudioDb()
    await reconcileAudioCacheOwner('learner-A')
    await reconcileAudioCacheOwner(null)
    await reconcileAudioCacheOwner(null)
    expect(await audioDbHasClip()).toBe(true)
  })

  it('sign-out clears the bundle cache AND useAuth reconciles the audio owner on sign-in', async () => {
    // Structural pin: the two hooks the fix depends on are wired into useAuth.
    // A behavioural test of signOut() lives in useAuth.signOutBundleCache.test.ts;
    // this asserts the sign-IN half, which has no equivalent single entry point.
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, resolve } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(resolve(here, '../composables/useAuth.ts'), 'utf8')
    expect(src).toContain('reconcileAudioCacheOwner')
    expect(src).toContain('clearAllCachedBundles')
  })
})
