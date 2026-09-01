/**
 * Sign-out clears the course-bundle cache — SEC0901-D-02.
 *
 * The bundle store (`ssi-bundle-cache`) is keyed by courseCode alone, with no
 * learner in the key. Before this fix, signOut() purged auth storage, identity,
 * role, subscription and entitlement caches but left the bundle behind — so on
 * a shared school device a paying learner's FULL course bundle was served
 * byte-for-byte to whoever signed in next. This pins the teardown.
 */

import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAuth } from './useAuth'
import { getCachedCourseBundle, getCourseBundle } from './useCourseBundle'

function queryBuilder(result: any = { data: null, error: { code: 'PGRST116' } }) {
  const b: any = {}
  for (const m of ['select', 'eq', 'update', 'insert', 'upsert', 'delete', 'single', 'maybeSingle', 'order', 'limit', 'in', 'is']) {
    b[m] = () => b
  }
  b.then = (resolve: (v: any) => void) => Promise.resolve(result).then(resolve)
  return b
}

function makeClient() {
  return {
    from: () => queryBuilder(),
    rpc: async () => ({ data: null, error: null }),
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn(async () => ({ data: { session: null } })),
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  } as any
}

/** The shape getCourseBundle persists: a full (non-preview) paid bundle. */
const paidBundle = {
  courseCode: 'spa_for_eng',
  version: 7,
  contentVersion: 7,
  scriptShapeVersion: 1,
  phrases: [{ id: 'p1', knownText: 'paid content past the preview ceiling' }],
} as any

async function cachePaidBundle(): Promise<void> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => paidBundle,
  })) as any
  vi.stubGlobal('fetch', fetchMock)
  await getCourseBundle('spa_for_eng', { forceRefresh: true, skipVersionCheck: true })
  // getCourseBundle persists in the background — let the put commit.
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0))
  vi.unstubAllGlobals()
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('signOut tears down the course-bundle cache (SEC0901-D-02)', () => {
  it('leaves no cached bundle for the next learner on the device', async () => {
    await cachePaidBundle()
    // Precondition: the leak-shaped state actually exists.
    expect((await getCachedCourseBundle('spa_for_eng'))?.phrases?.[0]?.knownText)
      .toBe('paid content past the preview ceiling')

    const auth = useAuth()
    await auth.initialize(makeClient())
    await auth.signOut()

    expect(await getCachedCourseBundle('spa_for_eng')).toBeNull()
  })

  it('clears every course, not just the one a learner last played', async () => {
    await cachePaidBundle()
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ ...paidBundle, courseCode: 'fra_for_eng' }),
    })) as any
    vi.stubGlobal('fetch', fetchMock)
    await getCourseBundle('fra_for_eng', { forceRefresh: true, skipVersionCheck: true })
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0))
    vi.unstubAllGlobals()

    const auth = useAuth()
    await auth.initialize(makeClient())
    await auth.signOut()

    expect(await getCachedCourseBundle('spa_for_eng')).toBeNull()
    expect(await getCachedCourseBundle('fra_for_eng')).toBeNull()
  })
})
