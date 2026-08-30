/**
 * useCourseBundle — the client store for the server-issued course bundle.
 *
 * Bundle-cutover step 4 (archive/docs-retired-2026-08-24/bundle-cutover-design.md
 * §3 "the rewiring (client)" / §5 step 4; live status in
 * docs/bundle-cutover-status.md).
 *
 * ONE fetch of `GET /api/courses/:code/bundle` — the entitlement-gated door —
 * replaces the six course-wide anon-key table reads the client generator does
 * today, and, once the bootstrap cutover flips, the round-map + N×cycles +
 * infplay-cycles calls too. With the bundle in memory, `generateScript`
 * (@ssi/core) materialises any stretch of the script synchronously, with zero
 * further network.
 *
 * Cache identity (design §2): `(courseCode, contentVersion, scriptShapeVersion,
 * previewOnly)`. The `?head=1` probe returns just `{ contentVersion,
 * scriptShapeVersion }`, so a returning learner spends one tiny request to
 * confirm the cached bundle is current and otherwise goes fully offline.
 * `previewOnly` is IN the key deliberately: a learner who subscribes must not
 * keep playing the sliced preview bundle they cached as a guest.
 *
 * Storage is IndexedDB, not localStorage — a bundle is hundreds of KB and
 * localStorage's ~5 MB budget is already carrying scripts, round maps and
 * cycles caches.
 *
 * This module is DARK until a consumer opts in (see `docs/bundle-cutover-status.md`):
 * nothing here changes what any learner hears.
 */

import type { CourseBundle } from '@ssi/core'

const DB_NAME = 'ssi-bundle-cache'
/**
 * 2 (2026-08-29) — the bundle wire gained `BundlePhrase.targetSyllableCount`,
 * the shared selector's shortest-first sort key. The cache identity
 * (`bundleCacheKey`) is content+shape version only and cannot see a wire-shape
 * change, so a cached v1 bundle would keep being served WITHOUT the key and its
 * debut order would silently differ from a freshly-fetched one. Bumping the
 * IndexedDB version drops the store on upgrade: one refetch per learner per
 * course (~300KB gzipped), once.
 */
const DB_VERSION = 2
const STORE = 'bundles'

/** Bundle fetches are boot-adjacent; never let one hang a session. */
const FETCH_TIMEOUT_MS = 20000
/** A head probe is two DB reads server-side — it should be fast or skipped. */
const HEAD_TIMEOUT_MS = 5000

export interface BundleIdentity {
  contentVersion: string | number
  scriptShapeVersion: number
  previewOnly: boolean
}

interface CachedBundle {
  courseCode: string
  cacheKey: string
  cachedAt: number
  bundle: CourseBundle
}

// ---------------------------------------------------------------------------
// AUTH — same pattern as useInstantPlayback's provider, and for the same
// reason: /bundle is entitlement-gated, so an anonymous fetch by a signed-in
// paid learner returns the sliced preview bundle rather than the course.
// ---------------------------------------------------------------------------

let authTokenProvider: (() => Promise<string | null>) | null = null

export function setCourseBundleAuthProvider(fn: (() => Promise<string | null>) | null): void {
  authTokenProvider = fn
}

/** True when a signed-in session token is available for this fetch. */
async function hasAuthToken(): Promise<boolean> {
  if (!authTokenProvider) return false
  try {
    return !!(await authTokenProvider())
  } catch {
    return false
  }
}

async function authHeaders(): Promise<Record<string, string> | undefined> {
  if (!authTokenProvider) return undefined
  try {
    const token = await authTokenProvider()
    return token ? { Authorization: `Bearer ${token}` } : undefined
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// IDENTITY
// ---------------------------------------------------------------------------

export function bundleCacheKey(id: BundleIdentity): string {
  return `${String(id.contentVersion)}|${id.scriptShapeVersion}|${id.previewOnly ? 'preview' : 'full'}`
}

export function identityOf(bundle: CourseBundle): BundleIdentity {
  return {
    contentVersion: bundle.contentVersion ?? bundle.version,
    scriptShapeVersion: bundle.scriptShapeVersion ?? 1,
    previewOnly: !!bundle.previewOnly,
  }
}

// ---------------------------------------------------------------------------
// INDEXEDDB
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      return resolve(null)
    }
    req.onupgradeneeded = () => {
      const db = req.result
      // Drop and recreate rather than migrate: a bundle is a derived artifact
      // the server can always re-issue, so re-fetching is strictly cheaper than
      // carrying migration code for every wire change.
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE)
      db.createObjectStore(STORE, { keyPath: 'courseCode' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

async function readCached(courseCode: string): Promise<CachedBundle | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly')
      const get = tx.objectStore(STORE).get(courseCode)
      get.onsuccess = () => resolve((get.result as CachedBundle) ?? null)
      get.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function writeCached(entry: CachedBundle): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(entry)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

export async function clearCachedBundle(courseCode: string): Promise<void> {
  session.delete(courseCode)
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(courseCode)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

// ---------------------------------------------------------------------------
// NETWORK
// ---------------------------------------------------------------------------

async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const headers = await authHeaders()
    const res = await fetch(url, headers ? { signal: ctrl.signal, headers } : { signal: ctrl.signal })
    if (!res.ok) throw new Error(`bundle fetch ${res.status} ${res.statusText}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Version probe. Returns null when the probe fails — the caller then TRUSTS
 * the cached bundle rather than blocking a session on a flaky network. Serving
 * slightly stale content beats refusing to play.
 */
export async function probeBundleVersion(
  courseCode: string,
  apiBase = '/api/courses',
): Promise<{ contentVersion: string | number; scriptShapeVersion: number } | null> {
  try {
    return await getJson(`${apiBase}/${encodeURIComponent(courseCode)}/bundle?head=1`, HEAD_TIMEOUT_MS)
  } catch {
    return null
  }
}

// In-flight coalescing: a course switch can fire several consumers at once and
// they must share ONE bundle fetch, not race three.
const inflight = new Map<string, Promise<CourseBundle>>()

/**
 * In-memory, per-session. The bundle is the unit of work for a whole session,
 * and callers ask for it once per generated page — so after the first
 * resolution it must cost NOTHING: no IndexedDB read, and crucially no head
 * probe. Version freshness is a once-per-session question, not a per-page one.
 */
const session = new Map<string, CourseBundle>()

export interface GetBundleOptions {
  apiBase?: string
  /** Skip the head probe (offline, or the caller already probed this session). */
  skipVersionCheck?: boolean
  /** Ignore any cached copy and refetch. */
  forceRefresh?: boolean
}

/**
 * IndexedDB-first, network on miss or version change.
 *
 * Order: cached copy → head probe → if the probe agrees with the cached
 * identity, serve the cache; otherwise fetch. A cached bundle whose
 * `previewOnly` differs from what the server now issues is replaced by the
 * fetch, which is what makes an upgrade-to-paid visible immediately.
 */
export async function getCourseBundle(
  courseCode: string,
  opts: GetBundleOptions = {},
): Promise<CourseBundle> {
  const apiBase = opts.apiBase ?? '/api/courses'
  if (!opts.forceRefresh) {
    const inSession = session.get(courseCode)
    if (inSession) return inSession
    const existing = inflight.get(courseCode)
    if (existing) return existing
  }

  const run = (async (): Promise<CourseBundle> => {
    const cached = opts.forceRefresh ? null : await readCached(courseCode)

    // A cached PREVIEW bundle is only valid for a caller who is still
    // unentitled. Cache identity carries `previewOnly` (bundleCacheKey) but
    // the IndexedDB store is keyed by course alone, so without this check a
    // learner who cached the 19-seed preview as a guest keeps being served it
    // after signing in — the head probe compares versions only and would
    // happily agree. If we now have a token, re-fetch and let the server say.
    if (cached?.bundle?.previewOnly && (await hasAuthToken())) {
      // fall through to the network fetch below
    } else if (cached?.bundle) {
      if (opts.skipVersionCheck) return cached.bundle
      const head = await probeBundleVersion(courseCode, apiBase)
      if (!head) return cached.bundle // offline / probe failed — trust the cache
      const current = identityOf(cached.bundle)
      const stillCurrent =
        String(head.contentVersion) === String(current.contentVersion) &&
        head.scriptShapeVersion === current.scriptShapeVersion
      if (stillCurrent) return cached.bundle
    }

    const bundle = await getJson<CourseBundle>(
      `${apiBase}/${encodeURIComponent(courseCode)}/bundle`,
      FETCH_TIMEOUT_MS,
    )
    // Persist in the BACKGROUND, never in front of the caller. Writing a
    // bundle to IndexedDB structured-clones the whole object graph — 13.9 MB
    // of JSON and ~15,000 phrase objects for spa_for_eng — and awaiting that
    // put the persist inside the boot budget the player races on a cold first
    // play. The caller already holds the bundle in memory; whether it also
    // reached disk yet changes nothing for this session, only for the next
    // one. (Measured 2026-08-29 during the boot-budget diagnosis.)
    void writeCached({
      courseCode,
      cacheKey: bundleCacheKey(identityOf(bundle)),
      cachedAt: Date.now(),
      bundle,
    })
    return bundle
  })()

  inflight.set(courseCode, run)
  try {
    const bundle = await run
    session.set(courseCode, bundle)
    return bundle
  } finally {
    inflight.delete(courseCode)
  }
}

/** Cached copy only — no network, ever. For offline play and boot fast paths. */
export async function getCachedCourseBundle(courseCode: string): Promise<CourseBundle | null> {
  const cached = await readCached(courseCode)
  return cached?.bundle ?? null
}
