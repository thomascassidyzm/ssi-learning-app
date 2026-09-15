/**
 * #838 — a bundle cached under the PREVIOUS IndexedDB version is discarded on
 * upgrade, so a returning learner refetches once and gets seeds stamped with
 * clip durations (#793/#804). Those jobs changed the wire shape without
 * bumping content or shape version, so the head probe alone would have agreed
 * with the stale record forever.
 *
 * Fails on the pre-fix code (DB_VERSION = 2): the planted record survives and
 * getCourseBundle returns it without a bundle fetch. Passes on the fix.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const COURSE = 'cym_for_eng'
const PRE_FIX_DB_VERSION = 2

function bundle(stamped: boolean) {
  return {
    courseCode: COURSE, version: 1, contentVersion: 7, scriptShapeVersion: 1, generatorVersion: 1,
    mainLoopCount: 3, legos: [], phrases: [], roundMap: [], pods: [],
    seeds: [{ seedId: 'S0001', seedNumber: 1, ...(stamped ? { clipDurationMs: 1234 } : {}) }],
  }
}

const headOk = { ok: true, json: async () => ({ contentVersion: 7, scriptShapeVersion: 1 }) }

/** Plant an unstamped record exactly as a pre-#838 client would have left it. */
async function plantPreFixRecord() {
  await new Promise<void>((resolve, reject) => {
    const q = indexedDB.open('ssi-bundle-cache', PRE_FIX_DB_VERSION)
    q.onupgradeneeded = () => q.result.createObjectStore('bundles', { keyPath: 'courseCode' })
    q.onsuccess = () => {
      const db = q.result
      const tx = db.transaction('bundles', 'readwrite')
      tx.objectStore('bundles').put({
        courseCode: COURSE, bundle: bundle(false), storedAt: Date.now(),
        tier: 'full', fetchedWithAuth: true, ownerId: 'learner-1',
      })
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
    q.onerror = () => reject(q.error)
  })
}

describe('#838: the bundle cache drops pre-fix records and keeps post-fix ones', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('a cached unstamped bundle is discarded and refetched once; the stamped one is then kept', async () => {
    await plantPreFixRecord()
    const mod = await import('./useCourseBundle')
    mod.setCourseBundleAuthProvider(async () => 'token')
    mod.setCourseBundleIdentityProvider(async () => 'learner-1')
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('head=1') ? headOk : { ok: true, json: async () => bundle(true) })
    vi.stubGlobal('fetch', fetchMock)

    const first = await mod.getCourseBundle(COURSE)
    const bundleFetches = () =>
      fetchMock.mock.calls.filter(([u]) => String(u).includes('/bundle') && !String(u).includes('head=1'))
    expect(bundleFetches()).toHaveLength(1)
    expect((first.seeds[0] as { clipDurationMs?: number }).clipDurationMs).toBe(1234)
    await new Promise((r) => setTimeout(r, 30))

    // A fresh module (new tab) finds the post-fix record and does not refetch.
    vi.resetModules()
    const mod2 = await import('./useCourseBundle')
    mod2.setCourseBundleAuthProvider(async () => 'token')
    mod2.setCourseBundleIdentityProvider(async () => 'learner-1')
    const second = await mod2.getCourseBundle(COURSE)
    expect(bundleFetches()).toHaveLength(1)
    expect((second.seeds[0] as { clipDurationMs?: number }).clipDurationMs).toBe(1234)
  })
})

/**
 * #853 — an OLDER TAB still holding a v2 connection blocks the upgrade. The
 * new tab must not hang: it gives up on the cache after a short wait and
 * fetches the bundle from the network; once the old connection closes the
 * upgrade completes on its own and the cache works again.
 *
 * Fails on the pre-fix code: getCourseBundle never resolves while the planted
 * connection stays open (the test times out). Passes on the fix.
 */
describe('#853: an open old-version connection does not stall the bundle load', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('falls back to the network while blocked, then upgrades once the old tab closes', async () => {
    // Fresh database at v2 with a connection deliberately left OPEN and with
    // no onversionchange handler — exactly what a pre-#853 build holds.
    await new Promise<void>((resolve, reject) => {
      const del = indexedDB.deleteDatabase('ssi-bundle-cache')
      del.onsuccess = () => resolve()
      del.onerror = () => reject(del.error)
    })
    const oldTab = await new Promise<IDBDatabase>((resolve, reject) => {
      const q = indexedDB.open('ssi-bundle-cache', PRE_FIX_DB_VERSION)
      q.onupgradeneeded = () => q.result.createObjectStore('bundles', { keyPath: 'courseCode' })
      q.onsuccess = () => resolve(q.result)
      q.onerror = () => reject(q.error)
    })

    const mod = await import('./useCourseBundle')
    mod.setCourseBundleAuthProvider(async () => 'token')
    mod.setCourseBundleIdentityProvider(async () => 'learner-1')
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('head=1') ? headOk : { ok: true, json: async () => bundle(true) })
    vi.stubGlobal('fetch', fetchMock)

    const started = Date.now()
    const loaded = await mod.getCourseBundle(COURSE)
    expect((loaded.seeds[0] as { clipDurationMs?: number }).clipDurationMs).toBe(1234)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(oldTab.version).toBe(PRE_FIX_DB_VERSION) // upgrade genuinely still pending

    // The old tab goes away; the pending upgrade now lands at v3.
    oldTab.close()
    await new Promise((r) => setTimeout(r, 50))
    const version = await new Promise<number>((resolve, reject) => {
      const q = indexedDB.open('ssi-bundle-cache')
      q.onsuccess = () => { const v = q.result.version; q.result.close(); resolve(v) }
      q.onerror = () => reject(q.error)
    })
    expect(version).toBe(3)

    // The cache works again: a new tab fetches at most once (the queued
    // background persist from the blocked tab may already have landed), and
    // the tab after it is served from the store without a bundle fetch.
    const bundleFetches = () =>
      fetchMock.mock.calls.filter(([u]) => String(u).includes('/bundle') && !String(u).includes('head=1')).length
    vi.resetModules()
    const mod2 = await import('./useCourseBundle')
    mod2.setCourseBundleAuthProvider(async () => 'token')
    mod2.setCourseBundleIdentityProvider(async () => 'learner-1')
    fetchMock.mockClear()
    await mod2.getCourseBundle(COURSE)
    await new Promise((r) => setTimeout(r, 30))
    expect(bundleFetches()).toBeLessThanOrEqual(1)
    const beforeThirdTab = bundleFetches()
    vi.resetModules()
    const mod3 = await import('./useCourseBundle')
    mod3.setCourseBundleAuthProvider(async () => 'token')
    mod3.setCourseBundleIdentityProvider(async () => 'learner-1')
    const third = await mod3.getCourseBundle(COURSE)
    expect(bundleFetches()).toBe(beforeThirdTab)
    expect((third.seeds[0] as { clipDurationMs?: number }).clipDurationMs).toBe(1234)
  }, 15000)
})
