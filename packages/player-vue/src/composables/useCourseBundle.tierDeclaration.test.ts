/**
 * #685 — a stored bundle DECLARES the entitlement tier it was fetched under,
 * and the app heals itself when the declaration disagrees with what the learner
 * actually holds.
 *
 * THE BUG THIS PINS. The app names its first course and fetches its bundle at
 * ~250ms, before Supabase has restored the session (#676: the pole-position
 * race). The server correctly hands an anonymous caller the 19-seed free
 * preview, that preview is written to IndexedDB, and the in-memory `session`
 * map then pins it for the life of the tab. Measured on a real poisoned profile
 * (#685 step 2, local build + `Vary: Authorization`): thirty seconds after a
 * premium session appeared in the same tab, the app had made ZERO further
 * bundle requests and the record still read preview / 57 legos / ownerId null.
 * A reload healed it; nothing short of a reload did.
 *
 * THE RULE UNDER TEST. The record carries `tier` and `fetchedWithAuth`. A
 * record written with no token is PROVISIONAL — it describes the app's boot
 * timing, not the learner's entitlement — and `revalidateCachedBundles()`,
 * called when an identity arrives, silently refetches every course whose
 * declaration disagrees and re-seats both the store and the in-memory session
 * map. No learner-visible surface: the alarm goes to telemetry.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const COURSE = 'zho_for_eng'
const COURSE_B = 'jpn_for_eng'
const COURSE_C = 'tha_for_eng'
const COURSE_D = 'heb_for_eng'
const COURSE_E = 'pol_for_eng'

function previewBundle(courseCode: string) {
  return {
    courseCode, version: 1, contentVersion: 7, scriptShapeVersion: 1, generatorVersion: 1,
    mainLoopCount: 57, legos: [], phrases: [], seeds: [], roundMap: [], pods: [],
    previewOnly: true,
  }
}

function fullBundle(courseCode: string) {
  return {
    courseCode, version: 1, contentVersion: 7, scriptShapeVersion: 1, generatorVersion: 1,
    mainLoopCount: 1102,
    legos: [{
      legoId: 'S0300L01', seedNumber: 300, legoIndex: 1, seedId: 'S0300', type: 'A',
      knownText: 'the premium sentence only an entitled learner should see',
      targetText: 'la frase premium', isNew: true,
    }],
    phrases: [], seeds: [], roundMap: [], pods: [],
  }
}

const headOk = { ok: true, json: async () => ({ contentVersion: 7, scriptShapeVersion: 1 }) }
const settle = () => new Promise((r) => setTimeout(r, 20))

/** The boot-time, token-less fetch that writes the poisoned record. */
async function poisonAnonymously(courseCode: string) {
  vi.resetModules()
  const mod = await import('./useCourseBundle')
  mod.setCourseBundleAuthProvider(async () => null)
  mod.setCourseBundleIdentityProvider(async () => null)
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    url.includes('head=1') ? headOk : { ok: true, json: async () => previewBundle(courseCode) }))
  await mod.getCourseBundle(courseCode)
  await settle()
  return mod
}

describe('#685: the stored bundle declares its tier and heals when it disagrees', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('a token-less fetch stores a PROVISIONAL declaration, and an authorised one an authoritative full record', async () => {
    await poisonAnonymously(COURSE)
    const raw = await new Promise<Record<string, unknown>>((resolve) => {
      const q = indexedDB.open('ssi-bundle-cache', 2)
      q.onsuccess = () => {
        const g = q.result.transaction('bundles', 'readonly').objectStore('bundles').get(COURSE)
        g.onsuccess = () => resolve(g.result as Record<string, unknown>)
      }
    })
    expect(raw.tier).toBe('preview')
    expect(raw.fetchedWithAuth).toBe(false)
    expect(raw.ownerId).toBeNull()

    // Now the same device, signed in: the refetch stamps the record authoritative.
    vi.resetModules()
    const mod2 = await import('./useCourseBundle')
    mod2.setCourseBundleAuthProvider(async () => 'jwt')
    mod2.setCourseBundleIdentityProvider(async () => 'learner-uid')
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('head=1') ? headOk : { ok: true, json: async () => fullBundle(COURSE) }))
    await mod2.getCourseBundle(COURSE)
    await settle()
    const raw2 = await new Promise<Record<string, unknown>>((resolve) => {
      const q = indexedDB.open('ssi-bundle-cache', 2)
      q.onsuccess = () => {
        const g = q.result.transaction('bundles', 'readonly').objectStore('bundles').get(COURSE)
        g.onsuccess = () => resolve(g.result as Record<string, unknown>)
      }
    })
    expect(raw2.tier).toBe('full')
    expect(raw2.fetchedWithAuth).toBe(true)
    expect(raw2.ownerId).toBe('learner-uid')
  })

  it('heals a poisoned preview pinned in the in-memory session map, WITHOUT a reload', async () => {
    // Boot in pole position: no session yet, so the preview is fetched, stored
    // AND pinned in the session map — the state the probe measured.
    vi.resetModules()
    const mod = await import('./useCourseBundle')
    let token: string | null = null
    let identity: string | null = null
    mod.setCourseBundleAuthProvider(async () => token)
    mod.setCourseBundleIdentityProvider(async () => identity)
    const fetchMock = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      if (url.includes('head=1')) return headOk
      const authed = !!init?.headers?.Authorization
      return { ok: true, json: async () => (authed ? fullBundle(COURSE_B) : previewBundle(COURSE_B)) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = await mod.getCourseBundle(COURSE_B)
    expect(first.previewOnly).toBe(true)
    await settle()

    // The session restores a beat later. Before the heal, the map still pins
    // the preview — this is the measured behaviour, asserted.
    token = 'jwt'; identity = 'payer-uid'
    expect((await mod.getCourseBundle(COURSE_B)).previewOnly).toBe(true)

    await mod.revalidateCachedBundles()
    await settle()

    // No reload, no clearing: the same module now serves the full bundle, and
    // the record on disk agrees.
    const healed = await mod.getCourseBundle(COURSE_B)
    expect(healed.previewOnly).toBeFalsy()
    expect(healed.legos[0].knownText).toContain('premium sentence')
    expect((await mod.getCachedCourseBundle(COURSE_B))?.previewOnly).toBeFalsy()
  })

  it('heals EVERY course on the device, not only the one in pole position', async () => {
    vi.resetModules()
    const mod = await import('./useCourseBundle')
    let token: string | null = null
    mod.setCourseBundleAuthProvider(async () => token)
    mod.setCourseBundleIdentityProvider(async () => (token ? 'payer-uid' : null))
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      if (url.includes('head=1')) return headOk
      const code = String(url).includes(COURSE_C) ? COURSE_C : COURSE_D
      const authed = !!init?.headers?.Authorization
      return { ok: true, json: async () => (authed ? fullBundle(code) : previewBundle(code)) }
    }))
    await mod.getCourseBundle(COURSE_C)
    await mod.getCourseBundle(COURSE_D)
    await settle()

    token = 'jwt'
    await mod.revalidateCachedBundles()
    await settle()

    expect((await mod.getCourseBundle(COURSE_C)).previewOnly).toBeFalsy()
    expect((await mod.getCourseBundle(COURSE_D)).previewOnly).toBeFalsy()
  })

  it('a failed background refetch changes nothing — the cached bundle keeps serving, and it retries next time', async () => {
    vi.resetModules()
    const mod = await import('./useCourseBundle')
    let token: string | null = null
    mod.setCourseBundleAuthProvider(async () => token)
    mod.setCourseBundleIdentityProvider(async () => (token ? 'payer-uid' : null))
    let offline = false
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      if (offline) throw new Error('offline')
      if (url.includes('head=1')) return headOk
      return { ok: true, json: async () => (init?.headers?.Authorization ? fullBundle(COURSE_E) : previewBundle(COURSE_E)) }
    }))
    await mod.getCourseBundle(COURSE_E)
    await settle()

    token = 'jwt'; offline = true
    await expect(mod.revalidateCachedBundles()).resolves.toBeUndefined() // never throws at the caller
    expect((await mod.getCachedCourseBundle(COURSE_E))?.previewOnly).toBe(true) // still playable

    // Back online: the retry is not blocked by the failed attempt.
    offline = false
    await mod.revalidateCachedBundles()
    await settle()
    expect((await mod.getCachedCourseBundle(COURSE_E))?.previewOnly).toBeFalsy()
  })

  it('a signed-out caller is never re-validated, and an entitled learner is asked once, not on every load', async () => {
    vi.resetModules()
    const mod = await import('./useCourseBundle')
    let token: string | null = null
    mod.setCourseBundleAuthProvider(async () => token)
    mod.setCourseBundleIdentityProvider(async () => (token ? 'payer-uid' : null))
    const fetchMock = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      if (url.includes('head=1')) return headOk
      return { ok: true, json: async () => (init?.headers?.Authorization ? fullBundle(COURSE) : previewBundle(COURSE)) }
    })
    vi.stubGlobal('fetch', fetchMock)
    await mod.getCourseBundle(COURSE)
    await settle()

    // Signed out: nothing to check against, so no network at all.
    const beforeSignedOut = fetchMock.mock.calls.length
    await mod.revalidateCachedBundles()
    expect(fetchMock.mock.calls.length).toBe(beforeSignedOut)

    token = 'jwt'
    await mod.revalidateCachedBundles()
    await settle()
    const afterFirstHeal = fetchMock.mock.calls.length
    // Called again in the same session (a token refresh, a second auth event):
    // the record is now authoritative, so nothing is re-asked.
    await mod.revalidateCachedBundles()
    await mod.revalidateCachedBundles()
    expect(fetchMock.mock.calls.length).toBe(afterFirstHeal)
  })
})
