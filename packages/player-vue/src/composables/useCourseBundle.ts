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
 * keep playing the sliced preview bundle they cached as a guest. The record
 * also carries `ownerId` — the identity that fetched it — and a cached FULL
 * bundle is served only back to that same identity, which is the mirror of the
 * preview rule and what keeps a payer's paid course off the next person's
 * session on a shared device (SEC0901-D-02).
 *
 * Storage is IndexedDB, not localStorage — a bundle is hundreds of KB and
 * localStorage's ~5 MB budget is already carrying scripts, round maps and
 * cycles caches.
 *
 * This module is DARK until a consumer opts in (see `docs/bundle-cutover-status.md`):
 * nothing here changes what any learner hears.
 */

import type { CourseBundle } from '@ssi/core'
import { setCourseVoicePace } from '../playback/voicePaceStore'
import { reportBundleTier } from '../playback/bundleTierTelemetry'

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
  /**
   * The learner identity that fetched this bundle — `null` for a signed-out
   * caller. The IndexedDB store is keyed by course alone (one record per
   * course per DEVICE), so this field is what makes the record learner-scoped:
   * a cached FULL bundle is only valid for the identity it was fetched under
   * (SEC0901-D-02). A record written before this field existed has no
   * `ownerId` property at all and is treated as unknown-owner, i.e. invalid
   * for any full bundle — one re-fetch, once.
   */
  ownerId?: string | null
  /**
   * THE DECLARATION (#685). The tier this record was fetched under, stated
   * rather than inferred, and — the part that does not exist anywhere else —
   * whether the fetch carried an auth token at all.
   *
   * `fetchedWithAuth: false` makes the record PROVISIONAL: it says what the
   * server hands an anonymous caller, which is a fact about the app's boot
   * timing and nothing at all about what this learner is entitled to. The app
   * names its first course and fetches the bundle before Supabase has restored
   * the session (#676's pole-position race), so the very first record written
   * on a device is routinely provisional — and until `revalidateCachedBundles`
   * existed nothing ever re-asked, because the in-memory `session` map pins the
   * first answer for the life of the tab.
   *
   * `fetchedWithAuth: true` makes it authoritative FOR `ownerId`: the server
   * saw who was asking and answered accordingly.
   *
   * A record written before this field existed has neither property; treated as
   * provisional, i.e. re-validated once the moment an identity exists.
   */
  tier?: 'preview' | 'full'
  fetchedWithAuth?: boolean
  bundle: CourseBundle
}

/** The tier a bundle IS, read off the wire shape. */
function tierOf(bundle: CourseBundle): 'preview' | 'full' {
  return bundle.previewOnly ? 'preview' : 'full'
}

/**
 * Does this stored record still describe the caller in front of us, or must we
 * go and ask the server again?
 *
 * Three ways a record can disagree with the present:
 *  1. it is PROVISIONAL (fetched with no token) and we now hold one — the
 *     pole-position race, and the common case;
 *  2. it declares `preview` while we hold a token — the upgrade-to-paid case
 *     the read path already guards, restated here so the sweep sees it too;
 *  3. it declares `full` for a different identity — SEC0901-D-02, again.
 */
function declarationDisagrees(cached: CachedBundle, hasToken: boolean, identity: string | null): boolean {
  const declaredTier = cached.tier ?? tierOf(cached.bundle)
  const declaredWithAuth = cached.fetchedWithAuth === true
  if (hasToken && !declaredWithAuth) return true
  if (hasToken && declaredTier === 'preview') return true
  if (declaredTier === 'full' && !cachedOwnerMatches(cached, identity)) return true
  return false
}

// ---------------------------------------------------------------------------
// AUTH — same pattern as useInstantPlayback's provider, and for the same
// reason: /bundle is entitlement-gated, so an anonymous fetch by a signed-in
// paid learner returns the sliced preview bundle rather than the course.
// ---------------------------------------------------------------------------

let authTokenProvider: (() => Promise<string | null>) | null = null

/**
 * Who the current caller is (the Supabase auth uid), or null when signed out.
 *
 * Separate from the token provider on purpose: a token rotates on every
 * refresh, so it cannot identify the owner of a cached record — the uid can.
 */
let identityProvider: (() => Promise<string | null>) | null = null

export function setCourseBundleAuthProvider(fn: (() => Promise<string | null>) | null): void {
  authTokenProvider = fn
}

export function setCourseBundleIdentityProvider(fn: (() => Promise<string | null>) | null): void {
  identityProvider = fn
}

/** The caller's identity for cache-ownership purposes. Null = signed out. */
async function currentIdentityId(): Promise<string | null> {
  if (!identityProvider) return null
  try {
    return (await identityProvider()) ?? null
  } catch {
    return null
  }
}

/**
 * Is this cached record valid for the caller in front of us?
 *
 * A PREVIEW bundle is the free window, identical for everyone, so ownership
 * does not matter (the existing preview→paid guard handles the other
 * direction). A FULL bundle is paid content and is only ever valid for the
 * identity that fetched it — including "no identity", so a signed-out or
 * different learner on a shared device falls through to the network and lets
 * the server decide. This is the exact mirror of the preview guard below.
 */
function cachedOwnerMatches(cached: CachedBundle, current: string | null): boolean {
  if (!Object.prototype.hasOwnProperty.call(cached, 'ownerId')) return false
  return (cached.ownerId ?? null) === current
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

async function readAllCached(): Promise<CachedBundle[]> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly')
      const all = tx.objectStore(STORE).getAll()
      all.onsuccess = () => resolve((all.result as CachedBundle[]) ?? [])
      all.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

export async function clearCachedBundle(courseCode: string): Promise<void> {
  session.delete(courseCode)
  revalidated.delete(courseCode)
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

/**
 * Drop every cached bundle, whoever cached it.
 *
 * The mirror of the `previewOnly` guard in `getCourseBundle`: that one stops a
 * guest's preview surviving an upgrade to paid, this one stops a payer's FULL
 * bundle surviving a sign-out on a shared device (schools ship to shared
 * devices). The store is keyed by course alone, so sign-out cannot name the
 * courses a departing learner cached — it has to clear the lot.
 */
export async function clearAllCachedBundles(): Promise<void> {
  session.clear()
  revalidated.clear()
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
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

/**
 * Returns the body AND whether the request actually carried an Authorization
 * header. The caller stores that second fact on the cache record: a bundle
 * fetched without a token is provisional, and knowing so is what lets the app
 * re-ask exactly once rather than either trusting it forever (#676's poisoned
 * preview) or re-fetching on every load.
 */
async function getJson<T>(url: string, timeoutMs: number): Promise<{ data: T; sentAuth: boolean }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const headers = await authHeaders()
    const res = await fetch(url, headers ? { signal: ctrl.signal, headers } : { signal: ctrl.signal })
    if (!res.ok) throw new Error(`bundle fetch ${res.status} ${res.statusText}`)
    return { data: (await res.json()) as T, sentAuth: !!headers }
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
    return (
      await getJson<{ contentVersion: string | number; scriptShapeVersion: number }>(
        `${apiBase}/${encodeURIComponent(courseCode)}/bundle?head=1`,
        HEAD_TIMEOUT_MS,
      )
    ).data
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

/**
 * Which courses this session has already re-validated, and for whom. Keyed by
 * course, valued by identity, so a sign-out-and-in as somebody else re-asks
 * while a settled learner does not. Cleared with the caches.
 */
const revalidated = new Map<string, string>()

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

    // Does the record's own declaration still describe this caller? A cached
    // PREVIEW is only valid for someone still unentitled; a cached FULL bundle
    // only for the identity that fetched it (SEC0901-D-02); and a record
    // fetched with no token at all is provisional, so it is re-asked the
    // moment an identity exists (#685). When any of those disagree we fall
    // through to the network and let the server say — the head probe compares
    // versions only and would happily agree with a poisoned record.
    if (
      cached?.bundle &&
      !declarationDisagrees(cached, await hasAuthToken(), await currentIdentityId())
    ) {
      if (opts.skipVersionCheck) return cached.bundle
      const head = await probeBundleVersion(courseCode, apiBase)
      if (!head) return cached.bundle // offline / probe failed — trust the cache
      const current = identityOf(cached.bundle)
      const stillCurrent =
        String(head.contentVersion) === String(current.contentVersion) &&
        head.scriptShapeVersion === current.scriptShapeVersion
      if (stillCurrent) return cached.bundle
    }

    const { data: bundle, sentAuth } = await getJson<CourseBundle>(
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
      ownerId: await currentIdentityId(),
      tier: tierOf(bundle),
      fetchedWithAuth: sentAuth,
      bundle,
    })
    return bundle
  })()

  inflight.set(courseCode, run)
  try {
    const bundle = await run
    session.set(courseCode, bundle)
    // Seat the per-voice pace facts where the speed path can reach them
    // (plate S-345). Both the fresh and the cached-hit branch resolve through
    // `run`, so this one line covers both. A bundle stored before pace shipped
    // carries none, which CLEARS the entry rather than leaving a stale one —
    // the fallback is "uncorrected", and it has to be reachable.
    setCourseVoicePace(courseCode, bundle.voicePace)
    return bundle
  } finally {
    inflight.delete(courseCode)
  }
}

/**
 * THE HEAL (#685). Re-ask the server for every course this device holds whose
 * stored declaration disagrees with the entitlement the learner actually has,
 * and quietly swap the fuller bundle in.
 *
 * Called when an identity ARRIVES — session restore, sign-in, token refresh —
 * which is precisely the moment the boot-time answer can turn out to have been
 * wrong. #676 proved the poison: the app names its first course and fetches the
 * bundle before Supabase has restored the session, the server correctly hands
 * an anonymous caller the 19-seed free preview, and that preview is then held
 * by the in-memory `session` map for the life of the tab. Measured on a
 * poisoned profile (#685 step 2): thirty seconds after a premium session
 * appeared in the same tab, the app had made ZERO further bundle requests and
 * the stored record still read `preview / 57 legos / ownerId null`. A reload
 * heals it; nothing short of a reload did.
 *
 * The repair is AUTOMATIC and SILENT (Tom, 2026-09-06: "better to do it
 * automatically"). No prompt, no toast, no banner, no button — the alarm goes
 * to telemetry (`bundle_tier_heal`), never to the learner.
 *
 * Rules it keeps:
 *  - EVERY course held on the device, not just the one in pole position. The
 *    bug is pole-position; the mechanism is general.
 *  - A failed refetch (offline, 5xx) changes nothing: the cached bundle keeps
 *    serving and we try again on the next load. Serving slightly stale content
 *    beats refusing to play — this module's standing philosophy.
 *  - It never tears down a running player. Replacing the `session` entry means
 *    the NEXT script materialisation (the next belt tap, the next round build)
 *    picks up the fuller bundle; audio already in flight is untouched.
 *  - It asks ONCE per (course, identity). A confirmed-preview learner — someone
 *    genuinely unentitled — is not re-asked on every load: the refetch stamps
 *    `fetchedWithAuth`, which makes the record authoritative and the
 *    disagreement go away.
 */
export async function revalidateCachedBundles(opts: GetBundleOptions = {}): Promise<void> {
  const apiBase = opts.apiBase ?? '/api/courses'
  const hasToken = await hasAuthToken()
  const identity = await currentIdentityId()
  // No token = nothing to re-validate against. A signed-out caller's records
  // are already correct for a signed-out caller.
  if (!hasToken) return

  const cached = await readAllCached()
  // The in-memory map can hold a course whose IndexedDB write has not landed
  // yet (the persist is deliberately backgrounded), so sweep both.
  const codes = new Set<string>([...cached.map((c) => c.courseCode), ...session.keys()])

  for (const courseCode of codes) {
    const record = cached.find((c) => c.courseCode === courseCode)
    const inSession = session.get(courseCode)
    const disagrees = record
      ? declarationDisagrees(record, hasToken, identity)
      // Nothing on disk yet: the session entry is provisional exactly when it
      // is a preview, which is the only thing an anonymous fetch can return
      // that a token might improve on.
      : !!inSession?.previewOnly
    if (!disagrees) continue
    if (revalidated.get(courseCode) === (identity ?? '')) continue
    revalidated.set(courseCode, identity ?? '')

    const storedTier: 'preview' | 'full' =
      record?.tier ?? (record ? tierOf(record.bundle) : inSession ? tierOf(inSession) : 'preview')
    const storedWithAuth = record?.fetchedWithAuth === true
    const startedAt = Date.now()
    try {
      // forceRefresh so it goes past both the session map and the record it is
      // there to replace; getCourseBundle re-writes the store and we re-seat
      // the session entry, so the running player's next materialisation sees it.
      const fresh = await getCourseBundle(courseCode, { ...opts, apiBase, forceRefresh: true })
      const resolvedTier = tierOf(fresh)
      session.set(courseCode, fresh)
      reportBundleTier({
        courseCode,
        storedTier,
        storedWithAuth,
        resolvedTier,
        outcome: resolvedTier !== storedTier ? 'healed' : 'confirmed',
        tookMs: Date.now() - startedAt,
      })
    } catch (err) {
      // Try again next load — never blank a player, never surface an error.
      revalidated.delete(courseCode)
      reportBundleTier({
        courseCode,
        storedTier,
        storedWithAuth,
        outcome: 'failed',
        tookMs: Date.now() - startedAt,
        detail: String((err as Error)?.message ?? err).slice(0, 160),
      })
    }
  }
}

/** Cached copy only — no network, ever. For offline play and boot fast paths. */
export async function getCachedCourseBundle(courseCode: string): Promise<CourseBundle | null> {
  const cached = await readCached(courseCode)
  if (!cached?.bundle) return null
  // Same ownership rule as getCourseBundle — an offline fast path must not be
  // the way round the guard (SEC0901-D-02).
  if (!cached.bundle.previewOnly && !cachedOwnerMatches(cached, await currentIdentityId())) return null
  // The offline fast path is a real course load and gets the same pace facts.
  setCourseVoicePace(courseCode, cached.bundle.voicePace)
  return cached.bundle
}
