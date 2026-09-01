/**
 * SEC0901-D-02 (REGRESSION TEST — was a characterization test) — the local
 * (IndexedDB) course-bundle cache must be scoped to the learner identity that
 * fetched it.
 *
 * HISTORY. This file was written by the 2026-09-01 audit as a CHARACTERIZATION
 * test: it pinned the vulnerable behaviour (a full paid bundle cached by one
 * account handed straight back to whoever next used the device) and its header
 * said it "should go RED the day getCourseBundle re-validates entitlement for
 * a cached FULL bundle the same way it already does for a cached PREVIEW one".
 * That day is 2026-09-01. The assertions below are inverted accordingly: they
 * now assert the FIXED behaviour, and they fail against the pre-fix code.
 *
 * THE RULE UNDER TEST. `useCourseBundle` records `ownerId` — the identity that
 * fetched the bundle — on the cached record, and serves a cached FULL
 * (non-preview) bundle only back to that same identity. Anyone else, including
 * a signed-out caller and including a record written before `ownerId` existed,
 * falls through to the network and lets the server decide. This is the exact
 * mirror of the pre-existing preview→paid guard, which is retained and still
 * covered by the control test at the end.
 *
 * The revenue-protecting direction is covered too: the SAME identity must
 * still be served from cache with no full re-fetch — otherwise the fix trades
 * a leak for a multi-megabyte re-download on every boot.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const COURSE = 'spa_for_eng'
const COURSE_2 = 'fra_for_eng'
const COURSE_3 = 'ita_for_eng'
const COURSE_4 = 'cym_for_eng'

function fullBundleFixture(courseCode: string = COURSE) {
  return {
    courseCode,
    version: 1,
    contentVersion: 7,
    scriptShapeVersion: 1,
    generatorVersion: 1,
    mainLoopCount: 400,
    // The actual paid product: real known/target text for premium,
    // past-preview LEGOs (seed 300 is well past the Yellow-belt ceiling of 19).
    legos: [
      {
        legoId: 'S0300L01',
        seedNumber: 300,
        legoIndex: 1,
        seedId: 'S0300',
        type: 'A',
        knownText: 'the premium sentence only a payer should ever see',
        targetText: 'la frase premium',
        isNew: true,
        ephemeralAudio: { target1: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', lifecycle: 'ephemeral' } },
      },
    ],
    phrases: [],
    seeds: [],
    roundMap: [],
    pods: [],
    // previewOnly is ABSENT — this is the full, entitled bundle.
  }
}

function previewBundleFixture(courseCode: string = COURSE) {
  return {
    courseCode,
    version: 1,
    contentVersion: 7,
    scriptShapeVersion: 1,
    generatorVersion: 1,
    mainLoopCount: 12,
    legos: [],
    phrases: [],
    seeds: [],
    roundMap: [],
    pods: [],
    previewOnly: true,
  }
}

const headOk = { ok: true, json: async () => ({ contentVersion: 7, scriptShapeVersion: 1 }) }

describe('SEC0901-D-02: the bundle cache is scoped to the identity that fetched it', () => {
  beforeEach(() => {
    // Each test uses its own course code as its IndexedDB key, so tests don't
    // need to tear down the shared fake-indexeddb between runs —
    // deleteDatabase() blocks forever here while any connection from a prior
    // test is still open.
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('a full bundle cached by a payer is NOT served to a signed-out caller on the same device', async () => {
    // ── "Session 1": paying learner, signed in, fetches and caches the full bundle. ──
    const mod1 = await import('./useCourseBundle')
    mod1.setCourseBundleAuthProvider(async () => 'payer-jwt')
    mod1.setCourseBundleIdentityProvider(async () => 'payer-auth-uid')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.includes('head=1') ? headOk : { ok: true, json: async () => fullBundleFixture() })),
    )

    const bundle1 = await mod1.getCourseBundle(COURSE)
    expect(bundle1.legos[0].knownText).toContain('premium sentence')
    // Persist is fire-and-forget — give the IDB transaction a tick.
    await new Promise((r) => setTimeout(r, 20))

    // ── "Session 2": app reloaded (fresh module graph), NO auth token — the
    // learner closed the app without signing out, and the next person opened
    // it. IndexedDB still holds session 1's record. ──
    vi.resetModules()
    const mod2 = await import('./useCourseBundle')
    mod2.setCourseBundleAuthProvider(async () => null)
    mod2.setCourseBundleIdentityProvider(async () => null) // signed out
    const fetch2 = vi.fn(async (url: string) =>
      url.includes('head=1') ? headOk : { ok: true, json: async () => previewBundleFixture(COURSE) },
    )
    vi.stubGlobal('fetch', fetch2)

    const bundle2 = await mod2.getCourseBundle(COURSE)

    // THE FIX: the cached full bundle was NOT reused. The caller went to the
    // server, and the server (which is the authority) issued the preview slice.
    expect(bundle2.previewOnly).toBe(true)
    expect(bundle2.legos).toHaveLength(0)
    expect(fetch2.mock.calls.some(([url]) => !String(url).includes('head=1'))).toBe(true)

    // And the offline fast path is not a way round the guard.
    expect(await mod2.getCachedCourseBundle(COURSE)).not.toBeNull() // now owned by the guest
    expect((await mod2.getCachedCourseBundle(COURSE))?.previewOnly).toBe(true)
  })

  it('a full bundle cached by one learner is NOT served to a DIFFERENT learner who signs in', async () => {
    const mod1 = await import('./useCourseBundle')
    mod1.setCourseBundleAuthProvider(async () => 'payer-jwt')
    mod1.setCourseBundleIdentityProvider(async () => 'learner-A')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('head=1') ? headOk : { ok: true, json: async () => fullBundleFixture(COURSE_3) },
      ),
    )
    await mod1.getCourseBundle(COURSE_3)
    await new Promise((r) => setTimeout(r, 20))

    vi.resetModules()
    const mod2 = await import('./useCourseBundle')
    // Learner B is signed in — a real, valid session, just not the one that
    // paid for this course. Sign-out clearing never ran (they never signed out).
    mod2.setCourseBundleAuthProvider(async () => 'learner-B-jwt')
    mod2.setCourseBundleIdentityProvider(async () => 'learner-B')
    const fetch2 = vi.fn(async (url: string) =>
      url.includes('head=1') ? headOk : { ok: true, json: async () => previewBundleFixture(COURSE_3) },
    )
    vi.stubGlobal('fetch', fetch2)

    const bundle2 = await mod2.getCourseBundle(COURSE_3)
    expect(bundle2.previewOnly).toBe(true)
    expect(bundle2.legos).toHaveLength(0)
    expect(fetch2.mock.calls.some(([url]) => !String(url).includes('head=1'))).toBe(true)
  })

  it('NO REGRESSION — the SAME learner is still served from cache, with no full re-fetch', async () => {
    const mod1 = await import('./useCourseBundle')
    mod1.setCourseBundleAuthProvider(async () => 'payer-jwt')
    mod1.setCourseBundleIdentityProvider(async () => 'payer-auth-uid')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('head=1') ? headOk : { ok: true, json: async () => fullBundleFixture(COURSE_4) },
      ),
    )
    await mod1.getCourseBundle(COURSE_4)
    await new Promise((r) => setTimeout(r, 20))

    vi.resetModules()
    const mod2 = await import('./useCourseBundle')
    mod2.setCourseBundleAuthProvider(async () => 'payer-jwt-refreshed') // token rotated
    mod2.setCourseBundleIdentityProvider(async () => 'payer-auth-uid') // same person
    const fetch2 = vi.fn(async (url: string) => {
      if (url.includes('head=1')) return headOk
      throw new Error('the same learner must NOT pay for a full re-download')
    })
    vi.stubGlobal('fetch', fetch2)

    const bundle2 = await mod2.getCourseBundle(COURSE_4)
    expect(bundle2.legos[0]?.knownText).toContain('premium sentence')
    expect(fetch2).toHaveBeenCalledTimes(1) // the head probe only
  })

  it('CONTROL — the pre-existing preview→paid guard still works', async () => {
    const mod1 = await import('./useCourseBundle')
    mod1.setCourseBundleAuthProvider(async () => null) // guest
    mod1.setCourseBundleIdentityProvider(async () => null)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('head=1') ? headOk : { ok: true, json: async () => previewBundleFixture(COURSE_2) },
      ),
    )
    const guestBundle = await mod1.getCourseBundle(COURSE_2)
    expect(guestBundle.previewOnly).toBe(true)
    await new Promise((r) => setTimeout(r, 20))

    vi.resetModules()
    const mod2 = await import('./useCourseBundle')
    mod2.setCourseBundleAuthProvider(async () => 'now-signed-in-payer-jwt')
    mod2.setCourseBundleIdentityProvider(async () => 'now-a-payer')
    const refetch = vi.fn(async (url: string) =>
      url.includes('head=1') ? headOk : { ok: true, json: async () => fullBundleFixture(COURSE_2) },
    )
    vi.stubGlobal('fetch', refetch)

    const bundle2 = await mod2.getCourseBundle(COURSE_2)
    expect(bundle2.previewOnly).toBeUndefined()
    expect(refetch).toHaveBeenCalled()
  })
})
