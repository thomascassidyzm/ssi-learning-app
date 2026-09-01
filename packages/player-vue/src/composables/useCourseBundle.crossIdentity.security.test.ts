/**
 * SEC0901-D-02 — the local (IndexedDB) course-bundle cache survives sign-out
 * and is not scoped to a learner identity, so a full paid-course bundle
 * cached by one account is handed straight back to whoever next uses the app
 * on that device — no re-authentication, no re-entitlement check.
 *
 * `useCourseBundle.ts` already has a deliberate, well-commented guard for the
 * OPPOSITE direction: a guest's cached PREVIEW bundle is discarded once the
 * caller holds an auth token, so an upgrade-to-paid is never masked by a
 * stale preview cache (`cached?.bundle?.previewOnly && (await hasAuthToken())`).
 * There is no equivalent guard the other way: a cached FULL (non-preview)
 * bundle is served to any caller — anonymous, signed out, or signed in as a
 * DIFFERENT, unentitled account — as long as the version head-probe (which
 * itself carries no entitlement check; `bundle.ts`'s own comment says so)
 * still agrees on `contentVersion`/`scriptShapeVersion`. This is exactly the
 * shared-device scenario CLAUDE.md flags for this product ("this product
 * ships to SCHOOLS, so shared devices are the norm").
 *
 * Compounding evidence: `useAuth.ts`'s `signOut()` purges Supabase auth
 * storage, the role/subscription/entitlement caches, and the remembered
 * identity — but never calls `clearCachedBundle()`, which exists, is
 * exported, and is not imported anywhere else in the app (confirmed by grep
 * during this audit). The IndexedDB store (`ssi-bundle-cache`) is keyed by
 * `courseCode` alone, not by learner id.
 *
 * This is a CHARACTERIZATION test: it pins CURRENT behaviour and passes
 * today. It should go RED the day either (a) `getCourseBundle` re-validates
 * entitlement server-side for a cached FULL bundle the same way it already
 * does for a cached PREVIEW one, or (b) `signOut()` (or an equivalent
 * device-identity-change hook) calls `clearCachedBundle()` for every course —
 * red here means SEC0901-D-02 is closed.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const COURSE = 'spa_for_eng'
const COURSE_2 = 'fra_for_eng'

function fullBundleFixture(courseCode: string = COURSE) {
  return {
    courseCode,
    version: 1,
    contentVersion: 7,
    scriptShapeVersion: 1,
    generatorVersion: 1,
    mainLoopCount: 400,
    // The actual paid product: real known/target text for premium,
    // past-preview LEGOs (seed 300 is well past the Yellow-belt ceiling of
    // 19). This is what a signed-out / unentitled second user on the same
    // device receives straight from disk in the vulnerable path below.
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

describe('SEC0901-D-02: useCourseBundle IndexedDB cache is not identity-scoped', () => {
  beforeEach(() => {
    // Each test uses its own course code (COURSE / COURSE_2) as its IndexedDB
    // key, so tests don't need to tear down the shared fake-indexeddb between
    // runs — deleteDatabase() blocks forever here while any connection from a
    // prior test is still open (fake-indexeddb doesn't fire onblocked the way
    // this suite would need), which is exactly what hung this hook.
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('a full bundle cached by a signed-in payer is served, unauthenticated, to whoever uses the app next', async () => {
    // ── "Session 1": paying learner, signed in, fetches and caches the full bundle. ──
    const mod1 = await import('./useCourseBundle')
    mod1.setCourseBundleAuthProvider(async () => 'payer-jwt')
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('head=1')) {
        return { ok: true, json: async () => ({ contentVersion: 7, scriptShapeVersion: 1 }) }
      }
      return { ok: true, json: async () => fullBundleFixture() }
    })
    vi.stubGlobal('fetch', fetchMock)

    const bundle1 = await mod1.getCourseBundle(COURSE)
    expect(bundle1.previewOnly).toBeUndefined()
    expect(bundle1.legos[0].knownText).toContain('premium sentence')
    // Persist happens in the background (fire-and-forget) — give the
    // microtask/IDB transaction a tick to land before the next "session".
    await new Promise((r) => setTimeout(r, 20))

    // ── "Session 2": app reloaded (fresh module graph, mirroring what a
    // sign-out + navigation or a different learner opening the app produces
    // in a real browser), NO auth token this time — signed out, or a
    // different, unentitled account. IndexedDB is untouched: sign-out never
    // clears it (see file header). ──
    vi.resetModules()
    const mod2 = await import('./useCourseBundle')
    mod2.setCourseBundleAuthProvider(async () => null) // signed out / no token
    const fetchMock2 = vi.fn(async (url: string) => {
      if (url.includes('head=1')) {
        // The head probe itself is NOT entitlement-gated (bundle.ts's own
        // comment: "no entitlement check ... course-level constants"), so it
        // agrees regardless of who's asking.
        return { ok: true, json: async () => ({ contentVersion: 7, scriptShapeVersion: 1 }) }
      }
      throw new Error('should never re-fetch the full body — that is the point of this test')
    })
    vi.stubGlobal('fetch', fetchMock2)

    const bundle2 = await mod2.getCourseBundle(COURSE)

    // THE FINDING: an unauthenticated caller (session 2) received the full,
    // entitled, past-preview bundle straight from the on-disk cache — the
    // actual paid course text — with no server round-trip to re-check
    // entitlement beyond the entitlement-blind head probe.
    expect(bundle2.previewOnly).toBeUndefined()
    expect(bundle2.legos[0]?.knownText).toContain('premium sentence')
    // Confirms this came from cache, not a fresh authenticated fetch.
    expect(fetchMock2).toHaveBeenCalledTimes(1) // the head probe only
  })

  it('CONTROL — the opposite direction (cached preview, then a real token appears) IS guarded, by design', async () => {
    // This is the asymmetry made explicit: the exact scenario the code
    // comments say they protect against works correctly today.
    const mod1 = await import('./useCourseBundle')
    mod1.setCourseBundleAuthProvider(async () => null) // guest
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('head=1')
          ? { ok: true, json: async () => ({ contentVersion: 7, scriptShapeVersion: 1 }) }
          : { ok: true, json: async () => previewBundleFixture(COURSE_2) }
      )
    )
    const guestBundle = await mod1.getCourseBundle(COURSE_2)
    expect(guestBundle.previewOnly).toBe(true)
    await new Promise((r) => setTimeout(r, 20))

    vi.resetModules()
    const mod2 = await import('./useCourseBundle')
    mod2.setCourseBundleAuthProvider(async () => 'now-signed-in-payer-jwt')
    const refetch = vi.fn(async (url: string) =>
      url.includes('head=1')
        ? { ok: true, json: async () => ({ contentVersion: 7, scriptShapeVersion: 1 }) }
        : { ok: true, json: async () => fullBundleFixture(COURSE_2) }
    )
    vi.stubGlobal('fetch', refetch)

    const bundle2 = await mod2.getCourseBundle(COURSE_2)
    // The guard works: previewOnly + a token present forces a real re-fetch.
    expect(bundle2.previewOnly).toBeUndefined()
    expect(refetch).toHaveBeenCalled()
  })
})
