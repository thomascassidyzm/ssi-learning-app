/**
 * useInstantPlayback - Sub-second time-to-first-play composable
 *
 * Implements the "instant playback" architecture from
 * `new_vision/INSTANT_PLAYBACK_SPEC.md` in the dashboard repo.
 *
 * Critical-path cold start:
 *   1. Read user's `last_completed_lego_id` (or accept an override).
 *   2. Fetch the course's `round-map` (one tiny query, cached forever
 *      per course version).
 *   3. Fetch ONE cycle from `/api/courses/:code/cycles?from=:legoId&limit=1`.
 *   4. Hand it back to the caller — audio fetch is the existing audio
 *      controller's job, not ours.
 *
 * Prefetch tiers run during playback (never block):
 *   - Tier 1: rest of the current round's cycles (limit=15)
 *   - Tier 3: next round's cycles
 *
 * Listening/presentation audio is NOT bulk-prefetched here (the old
 * Tier 2 was disabled 2026-05-23) — it JIT-fetches at use time and
 * rides `audioCache.persistent.ensure` + the service-worker
 * `CacheFirst` strategy, with `SimplePlayer.prefetchNextCycle`
 * warming the upcoming cycle's voices during the prompt/pause window.
 *
 * Coexists with `usePrefetchManager` (30-min audio buffer). The
 * critical path *replaces* the upfront whole-course assembly when the
 * feature flag is on; the legacy path stays in tree as the flag-off
 * fallback.
 *
 * The composable never touches the Audio element directly — the
 * existing `RealAudioController` plays cycles, we just provide the
 * cycle metadata.
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Cycle shape returned by the new backend `cycles` endpoint.
 *
 * This is the wire format from `GET /api/courses/:code/cycles`. It is
 * intentionally distinct from `types/Cycle.ts`'s atomic playback
 * `Cycle` (which is bound to a single PROMPT/PAUSE/VOICE_1/VOICE_2
 * pair). The backend cycle is one element in the round's sequence —
 * intro, debut, build, use, or listening hook — and the player layer
 * is responsible for converting it into one or more atomic
 * playback cycles.
 */
export interface BackendCycle {
  id: string
  type: 'intro' | 'debut' | 'build' | 'use' | 'listening'
  lego_id: string
  seed_number: number
  known_text: string
  target_text: string
  target_text_native?: string
  components?: Array<{ known: string; target: string }>
  decomposition?: Array<{
    legoId: string | null
    target: string
    known: string
    isGhost: boolean
  }>
  /** Authored display tiles ({n: native, r: roman, salient}) from
   * course_practice_phrases.display_tiling — rendered verbatim by the player
   * when present (native primary, roman ruby); absent → runtime segmenter. */
  display_tiling?: Array<{ n: string; r: string; salient?: boolean }>
  audio: {
    known_id?: string
    target1_id?: string
    target2_id?: string
    presentation_id?: string
  }
  durations: {
    target1_ms?: number
    target2_ms?: number
  }
  is_new: boolean
}
import { buildAudioUrl, setAudioRevisions } from '@ssi/core'

export interface RoundMapEntry {
  /** Round index (1-based per spec, matches `course_round_index.round_index`) */
  r: number
  legoId: string
  seed: number
}

export interface RoundMap {
  course_code: string
  /** Bumped on any LEGO/decomposition change — used for cache busting */
  version: number
  rounds: RoundMapEntry[]
}

export interface CyclesResponse {
  course_code: string
  version: number
  cycles: BackendCycle[]
  next_lego_id: string | null
  /** Repaired clips only (revision > 1). Absent = all bare URLs, as before. */
  audioRevisions?: Record<string, number>
}

export interface BootstrapResult {
  firstCycle: BackendCycle
  mapVersion: number
}

export interface UseInstantPlaybackOptions {
  /**
   * Resolver for the learner's current position — `last_completed_lego_id`
   * from the enrollment row (or `null` for a fresh start). Caller wires
   * this to whichever store owns position (usually the
   * `progressStore.getEnrollment` path used by `LearningPlayer.vue`).
   *
   * If the caller passes an explicit `legoId` to `bootstrap()`, the
   * resolver is bypassed.
   */
  resolveStartLegoId?: () => Promise<string | null> | string | null

  /** Override the default `/api/courses` base — useful for testing. */
  apiBase?: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ROUND_MAP_STORAGE_PREFIX = 'ssi-instant-playback-roundmap-'
const CYCLES_STORAGE_PREFIX = 'ssi-instant-playback-cycles-'

/**
 * Bootstrap fetches the whole first round in one shot (limit≈15) so
 * SimplePlayer can be initialised with a complete round structure and
 * audio can start playing immediately. The spec originally proposed
 * limit=1 + tier-1-during-playback, but appending cycles to an
 * already-running round adds engine complexity for ~zero latency win
 * (the cycles endpoint costs roughly the same for limit=1 vs limit=15
 * once the Lambda is warm — the payload is tiny either way). Cheaper
 * × simpler to grab the full round at bootstrap.
 */
const BOOTSTRAP_LIMIT = 15
/** Tier 1: rest of the current round. Kept for backwards compatibility but bootstrap now covers it. */
const TIER_1_LIMIT = 15
/** Tier 3: next round. Same limit as tier 1. */
const TIER_3_LIMIT = 15

// ============================================================================
// ROUND-MAP CACHE (localStorage, version-stamped)
// ============================================================================

interface CachedRoundMap {
  map: RoundMap
  cachedAt: number
}

function readCachedRoundMap(courseCode: string): RoundMap | null {
  try {
    const raw = localStorage.getItem(ROUND_MAP_STORAGE_PREFIX + courseCode)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedRoundMap
    if (parsed?.map?.course_code === courseCode && Array.isArray(parsed.map.rounds)) {
      return parsed.map
    }
    return null
  } catch (err) {
    console.warn('[InstantPlayback] Failed to read cached round-map:', err)
    return null
  }
}

function writeCachedRoundMap(courseCode: string, map: RoundMap): void {
  try {
    const payload: CachedRoundMap = { map, cachedAt: Date.now() }
    localStorage.setItem(
      ROUND_MAP_STORAGE_PREFIX + courseCode,
      JSON.stringify(payload),
    )
  } catch (err) {
    console.warn('[InstantPlayback] Failed to write round-map cache:', err)
  }
}

// ============================================================================
// CYCLES CACHE (localStorage, version-stamped)
// ============================================================================
//
// Caches the cycles response keyed by {course, fromLegoId}. Stamped with the
// course version observed at write time — readers compare against the current
// round-map's version and evict on mismatch, so a content edit that bumps
// courses.version invalidates all cached cycle responses for that course on
// the next fetch.
//
// Why we do this: legacy's useScriptCache made returning visitors feel
// instant because the script lived in localStorage. The new instant-playback
// path caches the round-map but, without this cache, paid the full cycles
// network round-trip every visit. Caching the cycles too makes "open a
// course I was just learning" a zero-network operation until content changes.

interface CachedCycles {
  response: CyclesResponse
  cachedAt: number
}

function cyclesCacheKey(courseCode: string, fromLegoId: string): string {
  return CYCLES_STORAGE_PREFIX + courseCode + '-' + fromLegoId
}

function readCachedCycles(
  courseCode: string,
  fromLegoId: string,
  expectedVersion: number,
): CyclesResponse | null {
  try {
    const raw = localStorage.getItem(cyclesCacheKey(courseCode, fromLegoId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedCycles
    if (
      parsed?.response?.course_code === courseCode &&
      Array.isArray(parsed.response.cycles) &&
      parsed.response.version === expectedVersion
    ) {
      return parsed.response
    }
    return null
  } catch (err) {
    console.warn('[InstantPlayback] Failed to read cycles cache:', err)
    return null
  }
}

function writeCachedCycles(
  courseCode: string,
  fromLegoId: string,
  response: CyclesResponse,
): void {
  try {
    const payload: CachedCycles = { response, cachedAt: Date.now() }
    localStorage.setItem(
      cyclesCacheKey(courseCode, fromLegoId),
      JSON.stringify(payload),
    )
  } catch (err) {
    // localStorage may be full (rare — ~5MB budget, our payloads are ~5-10KB).
    // Swallow — cache miss next time is fine; no functional impact.
    console.warn('[InstantPlayback] Failed to write cycles cache:', err)
  }
}

// ============================================================================
// IN-FLIGHT REQUEST COALESCING (round-map / cycles cold fetches)
// ============================================================================
//
// prewarmInstantCaches (fire-and-forget on course select), the player-mount
// bootstrap, the resume resolver's getOrFetchRoundMap, and the post-cache-hit
// revalidate all fire the SAME round-map / cycles GETs. On a COLD course switch
// they race each other — every one misses the not-yet-written localStorage
// cache and fetches cold — so one round-map + one cycles fetch became ×3 each.
// Prewarm was ADDING load instead of preventing it.
//
// This coalesces concurrent identical GETs by URL: the first caller starts the
// fetch, later callers within its in-flight window share the SAME promise, and
// the entry clears on settle — so a genuinely-later refetch (e.g. an intentional
// post-first-paint revalidate once the first has already landed) still hits the
// network. The shared promise resolves to ALREADY-PARSED JSON, so the response
// body is never shared raw and there is no "body already read" hazard.

const BOOT_FETCH_TIMEOUT_MS = 9000

interface CoalescedJson {
  ok: boolean
  status: number
  statusText: string
  data: unknown
}

// ---------------------------------------------------------------------------
// AUTH TOKEN for the fast-path content fetches (round-map / cycles / infplay).
// ---------------------------------------------------------------------------
// The /cycles + /infplay-cycles endpoints are entitlement-gated server-side
// (d4396730): a PREMIUM course past the free-preview window (seed <=19) returns
// 403 to any caller the server can't see a valid session for. These fetches
// used to go out as bare GETs with NO Authorization header, so a SIGNED-IN
// paid/admin learner past seed 19 was treated as anonymous → 403 → the client
// silently fell back to the slow legacy full-course walk. Invisible to guests
// (they never get past seed 19), which is why guest cold-switch benchmarks
// looked fine. Attaching the caller's Supabase access token makes the gate
// authorise paid users and the fast path holds.
//
// The provider is a module-level getter set once at app init (App.vue, after
// the Supabase client exists). getSession() reads the token from local storage
// with no network round-trip, so calling it per fetch is cheap. Null provider
// or null token → the fetch goes out anonymous exactly as before (correct for
// guests and free courses).
let authTokenProvider: (() => Promise<string | null>) | null = null

export function setInstantPlaybackAuthProvider(
  fn: (() => Promise<string | null>) | null,
): void {
  authTokenProvider = fn
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

const inflightGets = new Map<string, Promise<CoalescedJson>>()

/** AbortError shaped like a real fetch abort, so existing
 *  `(err).name === 'AbortError'` guards keep working in any JS env
 *  (DOMException isn't guaranteed outside the browser). */
function abortError(): Error {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

function sharedJsonGet(url: string): Promise<CoalescedJson> {
  const existing = inflightGets.get(url)
  if (existing) return existing
  const p = (async (): Promise<CoalescedJson> => {
    // The shared fetch owns its own timeout so a fire-and-forget prewarm (no
    // caller signal) can't leak forever; per-caller early-abort is layered on
    // top in coalescedJsonGet without touching this shared request.
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), BOOT_FETCH_TIMEOUT_MS)
    try {
      const headers = await authHeaders()
      const res = await fetch(url, headers ? { signal: ctrl.signal, headers } : { signal: ctrl.signal })
      if (!res.ok) {
        // LOUD on entitlement denial — a signed-in paid user hitting 403 here
        // means the fast path is about to silently degrade to the slow legacy
        // walk. This must never pass unnoticed again (regression: d4396730 shipped
        // the gate; the client wasn't sending the token). Callers also surface
        // this to telemetry via the `.status` on the thrown error.
        if (res.status === 403) {
          console.error(
            `[InstantPlayback] 403 on ${url} — entitlement gate denied the fast path. ` +
            `If the learner is signed-in and paid, the auth token is not reaching the server; ` +
            `playback will degrade to the slow legacy walk.`,
          )
        }
        return { ok: false, status: res.status, statusText: res.statusText, data: null }
      }
      const body = await res.json()
      // Publish any repaired-clip revisions into the shared @ssi/core
      // registry so every audio-URL builder emits /api/audio/<id>?v=<rev>
      // and the year-long immutable cache is bypassed for exactly those
      // clips. No-op when the field is absent (the normal case, and every
      // pre-revision cached payload).
      setAudioRevisions((body as { audioRevisions?: Record<string, number> })?.audioRevisions)
      return { ok: true, status: res.status, statusText: res.statusText, data: body }
    } finally {
      clearTimeout(timer)
    }
  })()
  inflightGets.set(url, p)
  const clear = () => { inflightGets.delete(url) }
  p.then(clear, clear)
  return p
}

/**
 * Coalesced JSON GET. Concurrent identical URLs share one fetch (see above).
 * An optional caller `signal` lets a specific caller stop awaiting (its boot
 * timeout, or cancel() on course-switch/unmount) without aborting the shared
 * fetch that other coalesced callers — or a fire-and-forget prewarm — still
 * depend on. The caller's promise rejects with an AbortError, matching the
 * pre-coalescing behaviour every call site already handles.
 */
function coalescedJsonGet(url: string, signal?: AbortSignal): Promise<CoalescedJson> {
  const shared = sharedJsonGet(url)
  if (!signal) return shared
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<CoalescedJson>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    shared.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) },
    )
  })
}

// ============================================================================
// PREWARM (course switch / hover / idle)
// ============================================================================

/**
 * Warm the instant-playback localStorage caches for a course WITHOUT mounting
 * the player, so the next mount's bootstrap() is a cache hit instead of two
 * cold serial network round-trips. Call on course switch (before the player
 * remounts), course-card hover, or idle. Reuses the EXACT cache keys the
 * composable reads. Fire-and-forget; silent on failure; skips work already
 * cached. round-map is position-independent (helps any switch); the
 * first-round cycles specifically de-cold the fresh-learner case (no saved
 * position → bootstrap starts at rounds[0]), which is the slow course-switch.
 */
export async function prewarmInstantCaches(
  courseCode: string,
  apiBase = '/api/courses',
): Promise<void> {
  if (!courseCode) return
  try {
    let map = readCachedRoundMap(courseCode)
    if (!map) {
      const res = await coalescedJsonGet(`${apiBase}/${encodeURIComponent(courseCode)}/round-map`)
      if (!res.ok) return
      map = res.data as RoundMap
      writeCachedRoundMap(courseCode, map)
    }
    const first = map.rounds?.[0]
    if (!first) return
    let cycles = readCachedCycles(courseCode, first.legoId, map.version)
    if (!cycles) {
      const res = await coalescedJsonGet(
        `${apiBase}/${encodeURIComponent(courseCode)}/cycles?from=${encodeURIComponent(first.legoId)}&limit=15`,
      )
      if (!res.ok) return
      cycles = res.data as CyclesResponse
      writeCachedCycles(courseCode, first.legoId, cycles)
    }
    // Precache the FIRST cycle's audio into the SW CacheFirst layer so
    // warmFirstKnownAudio (the ready gate) and the opening PROMPT/VOICE plays
    // hit cache instead of streaming — the dominant cold-switch cost. Plain
    // GETs (same URL shape warmFirstKnownAudio uses), fire-and-forget.
    const c0 = cycles.cycles?.[0]
    for (const id of [c0?.audio?.known_id, c0?.audio?.target1_id, c0?.audio?.target2_id]) {
      if (id) void fetch(buildAudioUrl(encodeURIComponent(id))).catch(() => {})
    }
  } catch {
    /* best-effort prewarm — a cold mount just pays the round-trips as before */
  }
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useInstantPlayback(
  courseCode: Ref<string>,
  options: UseInstantPlaybackOptions = {},
) {
  const apiBase = options.apiBase ?? '/api/courses'
  const resolveStartLegoId = options.resolveStartLegoId

  // -----------------------------------------------------------
  // State
  // -----------------------------------------------------------

  const roundMap = ref<RoundMap | null>(null)
  const isReady = ref(false)
  /** Last legoId returned/observed — drives `currentRound` lookup. */
  const currentLegoId = ref<string | null>(null)

  /**
   * Cycle buffer — Map<legoId, BackendCycle[]>. Populated by tier 1 + 3
   * prefetches. The first entry for a given lego is the introduction,
   * the last is the listening hook (per spec ordering).
   */
  const cycleBuffer = ref<Map<string, BackendCycle[]>>(new Map())

  /**
   * AbortController per active fetch — letting `cancel()` walk and
   * abort everything when the user navigates away.
   */
  const activeAborts = new Set<AbortController>()
  const abortTimers = new WeakMap<AbortController, ReturnType<typeof setTimeout>>()

  // The round-map / cycles fetches below are the boot-critical path
  // (bootstrap() awaits them directly from LearningPlayer's onMounted).
  // None of these fetch() calls carried a timeout — on a flaky mobile
  // connection they hang unboundedly, which is what stretched cold_start
  // telemetry's tail to 10s-133s+. Bounding at makeAbort() covers every
  // call site (bootstrap, bootstrapInfPlay, prefetch) with one change;
  // existing catch/finally blocks already treat abort as an ordinary
  // failure, so this only bounds worst-case duration, not behavior.
  // (BOOT_FETCH_TIMEOUT_MS is module-scoped — shared with the coalescer.)

  // -----------------------------------------------------------
  // Computed
  // -----------------------------------------------------------

  const currentRound: ComputedRef<number | null> = computed(() => {
    const lego = currentLegoId.value
    const map = roundMap.value
    if (!lego || !map) return null
    const entry = map.rounds.find((r) => r.legoId === lego)
    return entry?.r ?? null
  })

  // -----------------------------------------------------------
  // Internals
  // -----------------------------------------------------------

  function makeAbort(): AbortController {
    const ctrl = new AbortController()
    activeAborts.add(ctrl)
    abortTimers.set(ctrl, setTimeout(() => ctrl.abort(), BOOT_FETCH_TIMEOUT_MS))
    return ctrl
  }

  function releaseAbort(ctrl: AbortController): void {
    activeAborts.delete(ctrl)
    const timer = abortTimers.get(ctrl)
    if (timer) {
      clearTimeout(timer)
      abortTimers.delete(ctrl)
    }
  }

  async function fetchRoundMap(): Promise<RoundMap> {
    const code = courseCode.value
    if (!code) throw new Error('[InstantPlayback] courseCode is empty')

    // Cache hit — instant
    const cached = readCachedRoundMap(code)
    if (cached) {
      // We still fire a background revalidation to pick up version
      // bumps without blocking the cold path. Fire-and-forget; no
      // await, errors swallowed.
      void revalidateRoundMap(code, cached)
      return cached
    }

    // Cache miss — one tiny fetch (~20 KB for a 700-LEGO course)
    const ctrl = makeAbort()
    try {
      const res = await coalescedJsonGet(
        `${apiBase}/${encodeURIComponent(code)}/round-map`,
        ctrl.signal,
      )
      if (!res.ok) {
        throw Object.assign(
          new Error(`[InstantPlayback] round-map fetch failed: ${res.status} ${res.statusText}`),
          { status: res.status },
        )
      }
      const map = res.data as RoundMap
      writeCachedRoundMap(code, map)
      return map
    } finally {
      releaseAbort(ctrl)
    }
  }

  /**
   * Background revalidation. Overwrite the cache when the server map differs
   * from the cached one — a higher version (normal content bump) OR a changed
   * round count at the same version (content edited without a clean version
   * bump, or a map that was cached while the source matview was still partial/
   * unrefreshed). The latter is what stranded a freshly-built course at "one
   * seed → INF PLAY". The fix lands on the NEXT cold start. Never throws.
   */
  async function revalidateRoundMap(code: string, cached: RoundMap): Promise<void> {
    try {
      const res = await coalescedJsonGet(`${apiBase}/${encodeURIComponent(code)}/round-map`)
      if (!res.ok) return
      const fresh = res.data as RoundMap
      const changed =
        fresh.version > cached.version ||
        (fresh.version === cached.version && fresh.rounds.length !== cached.rounds.length)
      if (changed) {
        writeCachedRoundMap(code, fresh)
        // Mirror into the live ref so consumers see the new version
        // immediately if they query roundMap.value afterward.
        if (roundMap.value && roundMap.value.course_code === code) {
          roundMap.value = fresh
        }
      }
    } catch {
      // Offline / network blip — keep the cached copy.
    }
  }

  async function fetchCycles(
    fromLegoId: string,
    limit: number,
    signal?: AbortSignal,
    expectedVersion?: number,
  ): Promise<CyclesResponse> {
    const code = courseCode.value
    if (!code) throw new Error('[InstantPlayback] courseCode is empty')

    // Cache-first: if we know the expected version (i.e. the caller already
    // has the round-map and can validate), serve the cached cycles response
    // when it matches. Skip network entirely. This is the "zero-network
    // resume" path for returning visitors to a previously-fetched position.
    if (typeof expectedVersion === 'number') {
      const cached = readCachedCycles(code, fromLegoId, expectedVersion)
      if (cached) {
        // Only return cache if it covers >= the requested limit — a tiny
        // cached response (e.g. an old limit=1 entry) shouldn't satisfy a
        // limit=15 request.
        if (cached.cycles.length >= limit || cached.next_lego_id === null) {
          return cached
        }
      }
    }

    const url =
      `${apiBase}/${encodeURIComponent(code)}/cycles` +
      `?from=${encodeURIComponent(fromLegoId)}&limit=${limit}`

    const res = await coalescedJsonGet(url, signal)
    if (!res.ok) {
      throw Object.assign(
        new Error(`[InstantPlayback] cycles fetch failed: ${res.status} ${res.statusText}`),
        { status: res.status },
      )
    }
    const response = res.data as CyclesResponse
    // Write-through cache. Stamp is the version the server returned, which
    // gets compared against the current round-map version on read.
    writeCachedCycles(code, fromLegoId, response)
    return response
  }

  /**
   * LEGOs currently known to be PARTIAL — the API returned cycles for them
   * but stopped mid-LEGO (response.next_lego_id pointed back at them). We
   * must NOT emit a Round for these LEGOs yet: SimplePlayer's appendRounds
   * dedupes by roundNumber, so a partial Round becomes permanently stuck.
   * Wait until a follow-up fetch clears the partial flag (= a later response
   * either pushed cycles for the NEXT LEGO, or returned the partial LEGO's
   * remaining cycles with next_lego_id pointing past it).
   *
   * Cleared the instant a response includes ANY cycles for the LEGO without
   * setting next_lego_id back to it: that means the API has now emitted past
   * the partial point, so all of this LEGO's cycles are in the buffer.
   */
  const partialLegoIds = ref<Set<string>>(new Set())

  /**
   * Buffer cycles from a /cycles or /infplay-cycles response. The
   * `nextLegoId` arg is the response's pagination cursor: if non-null
   * AND it matches a LEGO that received cycles in this batch, that
   * LEGO is partial. Every other LEGO that received cycles is now
   * fully buffered (the API emits cycles in round-map order).
   */
  function bufferCycles(cycles: BackendCycle[], nextLegoId?: string | null): void {
    const buf = cycleBuffer.value
    const legosInBatch = new Set<string>()
    for (const cycle of cycles) {
      legosInBatch.add(cycle.lego_id)
      const existing = buf.get(cycle.lego_id)
      if (!existing) {
        buf.set(cycle.lego_id, [cycle])
        continue
      }
      // Dedupe by cycle.id — re-fetching the same round is a no-op,
      // and we never want to silently double-count cycles in the
      // buffer (would make `next_lego_id` walking double-emit).
      if (!existing.some((c) => c.id === cycle.id)) {
        existing.push(cycle)
      }
    }
    // Update partial-LEGO bookkeeping. Every LEGO that received cycles
    // EXCEPT the partial tail (if any) is now complete.
    const partial = partialLegoIds.value
    let mutated = false
    for (const id of legosInBatch) {
      if (id === nextLegoId) {
        if (!partial.has(id)) { partial.add(id); mutated = true }
      } else {
        if (partial.delete(id)) mutated = true
      }
    }
    if (mutated) partialLegoIds.value = new Set(partial)
  }

  /**
   * True iff every cycle for `legoId` is in the buffer. False both for
   * LEGOs not yet fetched AND for LEGOs whose last fetch was a partial
   * tail. `backendCyclesToRounds` uses this to gate Round emission so a
   * partial LEGO never becomes a permanently-truncated Round.
   */
  function isLegoComplete(legoId: string): boolean {
    if (!cycleBuffer.value.has(legoId)) return false
    return !partialLegoIds.value.has(legoId)
  }

  // -----------------------------------------------------------
  // Public API: INF PLAY bootstrap — parallel to bootstrap() but
  // sources cycles from /api/courses/:code/infplay-cycles instead of
  // /cycles. Same instant-playback shape: ~150-300ms to first cycle,
  // background prefetch keeps the queue ahead of playback.
  //
  // Tom 2026-05-20: prior INF PLAY entry fell back to legacy
  // generateScript (5-15s on cold cache); this endpoint matches the
  // main-loop bootstrap latency.
  // -----------------------------------------------------------

  /** Pagination cursor for infplay round prefetch (1-based). */
  const nextInfRoundCursor = ref<number>(1)

  /** Cycles buffered from /infplay-cycles, walked by SimplePlayer in
   *  the order they were emitted (server returns spaced rep before
   *  random USE per round). Each cycle has inf_round on it. */
  const infPlayCycles = ref<BackendCycle[]>([])

  async function fetchInfPlayCycles(
    fromRound: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<{ cycles: BackendCycle[]; nextInfRound: number; mainLoopCount: number; version: number }> {
    const code = courseCode.value
    if (!code) throw new Error('[InstantPlayback] courseCode is empty')
    const url = `${apiBase}/${encodeURIComponent(code)}/infplay-cycles?from_round=${fromRound}&limit=${limit}`
    // INF PLAY is even more strongly gated than /cycles — non-entitled callers
    // get a hard 403 (no partial-preview slice). Attach the session token so a
    // signed-in paid learner isn't seen as anonymous. (Same regression class as
    // /cycles above.)
    const headers = await authHeaders()
    const res = await fetch(url, headers ? { signal, headers } : { signal })
    if (!res.ok) {
      if (res.status === 403) {
        console.error(
          `[InstantPlayback] 403 on ${url} — entitlement gate denied INF PLAY; ` +
          `signed-in paid session token not reaching the server.`,
        )
      }
      throw Object.assign(
        new Error(`[InstantPlayback] infplay-cycles fetch failed: ${res.status}`),
        { status: res.status },
      )
    }
    const json = (await res.json()) as {
      course_code: string
      version: number
      cycles: BackendCycle[]
      next_inf_round: number
      main_loop_count: number
      audioRevisions?: Record<string, number>
    }
    setAudioRevisions(json.audioRevisions)
    return {
      cycles: json.cycles,
      nextInfRound: json.next_inf_round,
      mainLoopCount: json.main_loop_count,
      version: json.version,
    }
  }

  /**
   * `fromRound` is the learner's CURRENT INF PLAY round (1-based;
   * round 1 = first round past main-loop). For fresh-into-infplay or
   * a learner who hasn't accumulated any infplay rounds yet, pass 1.
   * For a returning deep-infplay learner (e.g. infplay_round_index=
   * 50), pass 50 so spaced rep math computes correctly for absolute
   * round = mainLoopCount + 50, not + 1.
   */
  async function bootstrapInfPlay(fromRound: number = 1): Promise<BootstrapResult> {
    isReady.value = false
    nextInfRoundCursor.value = Math.max(1, fromRound)
    const ctrl = makeAbort()
    try {
      const result = await fetchInfPlayCycles(nextInfRoundCursor.value, BOOTSTRAP_LIMIT, ctrl.signal)
      infPlayCycles.value = result.cycles
      nextInfRoundCursor.value = result.nextInfRound
      const firstCycle = result.cycles[0]
      if (!firstCycle) {
        throw new Error('[InstantPlayback] /infplay-cycles returned no cycles')
      }
      // Buffer into the standard map so backendCyclesToRounds can pick
      // them up. INF PLAY rounds don't have a round-map equivalent —
      // we synthesize one from the inf_round numbers below.
      bufferCycles(result.cycles)
      currentLegoId.value = firstCycle.lego_id
      isReady.value = true
      // Manufacture a "round-map" for backendCyclesToRounds. Each
      // unique inf_round becomes a synthetic round entry. legoId is
      // the FIRST cycle in that inf_round (purely cosmetic — keeps
      // adapter happy; cursor logic uses lastMainLoopLegoId anyway).
      const seenRounds = new Map<number, BackendCycle>()
      for (const c of result.cycles) {
        const r = (c as any).inf_round as number
        if (typeof r === 'number' && !seenRounds.has(r)) seenRounds.set(r, c)
      }
      roundMap.value = {
        course_code: courseCode.value,
        version: result.version,
        rounds: [...seenRounds.entries()]
          .sort(([a], [b]) => a - b)
          .map(([r, c]) => ({
            r: result.mainLoopCount + r,  // absolute round number
            legoId: c.lego_id,
            seed: c.seed_number,
          })),
      }
      return { firstCycle, mapVersion: result.version }
    } finally {
      releaseAbort(ctrl)
    }
  }

  /** Background prefetch — fetches the next INF PLAY round window. */
  async function prefetchNextInfPlayBatch(): Promise<void> {
    const ctrl = makeAbort()
    try {
      const result = await fetchInfPlayCycles(
        nextInfRoundCursor.value,
        BOOTSTRAP_LIMIT,
        ctrl.signal,
      )
      if (result.cycles.length === 0) return
      bufferCycles(result.cycles)
      infPlayCycles.value = [...infPlayCycles.value, ...result.cycles]
      nextInfRoundCursor.value = result.nextInfRound
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        console.warn('[InstantPlayback] infplay prefetch failed:', err)
      }
    } finally {
      releaseAbort(ctrl)
    }
  }

  // -----------------------------------------------------------
  // Public API: bootstrap (the critical path)
  // -----------------------------------------------------------

  async function bootstrap(legoId?: string): Promise<BootstrapResult> {
    isReady.value = false

    // 1. Resolve starting legoId from the caller / position store. The
    //    resolver is responsible for translating "where the learner left
    //    off" into "what LEGO should we load now" — typically NEXT(last
    //    completed) via the round-map, so the resume LEGO is genuinely
    //    new to the learner and its intro plays naturally. Returning
    //    null = fresh learner; bootstrap falls to the round-map's first
    //    LEGO. Throwing = "no content available" (e.g. course end);
    //    bootstrap propagates and the caller falls to the legacy path.
    let startLegoId: string | null = legoId ?? null
    if (!startLegoId && resolveStartLegoId) {
      const resolved = await resolveStartLegoId()
      startLegoId = resolved ?? null
    }

    // 2. The bootstrap critical path: round-map fetch + first-round
    //    cycles fetch. These are INDEPENDENT when we already have a
    //    startLegoId — the cycles URL doesn't need the round-map to
    //    construct, just the LEGO. Run them in parallel via Promise.all
    //    so total wall time = max(map, cycles) instead of map+cycles.
    //    For a returning learner with cached round-map this is one
    //    cycles roundtrip and we're done.
    //
    //    If we DON'T have a startLegoId yet (fresh learner, empty
    //    position store), we have to wait for the round-map to find
    //    R1's legoId before the cycles fetch can fire. This is the
    //    one case where we're stuck serial — but it's rare (first ever
    //    visit, no progress) and even so it's only two roundtrips, the
    //    same as before.
    // Optimistic cache-hit path: if we have BOTH a known startLegoId AND a
    // cached round-map, the cycles cache can be checked with the expected
    // version before any network call fires. When both caches hit, this is
    // a zero-network resume.
    const cachedMap = startLegoId ? readCachedRoundMap(courseCode.value) : null
    const expectedVersion = cachedMap?.version

    const ctrl = makeAbort()
    let map: RoundMap
    let response: CyclesResponse
    try {
      if (startLegoId) {
        const [m, r] = await Promise.all([
          fetchRoundMap(),
          fetchCycles(startLegoId, BOOTSTRAP_LIMIT, ctrl.signal, expectedVersion),
        ])
        map = m
        response = r
      } else {
        map = await fetchRoundMap()
        const first = map.rounds[0]
        if (!first) {
          throw new Error('[InstantPlayback] round-map has no rounds')
        }
        startLegoId = first.legoId
        response = await fetchCycles(
          startLegoId,
          BOOTSTRAP_LIMIT,
          ctrl.signal,
          map.version,
        )
      }
    } finally {
      releaseAbort(ctrl)
    }

    roundMap.value = map

    const firstCycle = response.cycles[0]
    if (!firstCycle) {
      throw new Error(
        `[InstantPlayback] no cycles returned for legoId=${startLegoId}`,
      )
    }

    // Bootstrap returns the whole first round in `response.cycles`. The
    // buffer now holds intro+debut+builds+uses for the start LEGO, and
    // potentially the first cycles of the next LEGO too (if the round
    // had <BOOTSTRAP_LIMIT cycles). SimplePlayer can be initialised
    // with a complete round structure from this — no tier-1 await
    // needed before play.
    bufferCycles(response.cycles, response.next_lego_id)
    currentLegoId.value = firstCycle.lego_id
    isReady.value = true

    return { firstCycle, mapVersion: response.version }
  }

  // -----------------------------------------------------------
  // Public API: prefetch tiers
  // -----------------------------------------------------------

  /**
   * Tier 1 — rest of the current round.
   *
   * Walks forward from the current legoId, fetches the next ~15
   * cycles, and adds them to the buffer. Cancellable, error-swallow.
   * Never blocks playback.
   */
  async function prefetchTier1(): Promise<void> {
    const lego = currentLegoId.value
    if (!lego) return
    const ctrl = makeAbort()
    try {
      const response = await fetchCycles(
        lego,
        TIER_1_LIMIT,
        ctrl.signal,
        roundMap.value?.version,
      )
      bufferCycles(response.cycles, response.next_lego_id)
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        console.warn('[InstantPlayback] tier-1 prefetch failed:', err)
      }
    } finally {
      releaseAbort(ctrl)
    }
  }

  /**
   * Tier 3 — cycles for the NEXT round.
   *
   * The cycle metadata fetch (round queue continuation) stays — it
   * needs to land before round N+1 starts. 2026-05-23: dropped the
   * inline ~15-audio bulk prefetch that followed it (and the old
   * Tier 2 listening prefetch). Presentation audios don't need to land
   * that early; JIT fetch + SW CacheFirst + SimplePlayer.prefetchNextCycle
   * cover the upcoming cycle's audio.
   */
  async function prefetchTier3(): Promise<void> {
    const map = roundMap.value
    const lego = currentLegoId.value
    if (!map || !lego) return

    const idx = map.rounds.findIndex((r) => r.legoId === lego)
    const next = idx >= 0 ? map.rounds[idx + 1] : null
    if (!next) return

    const ctrl = makeAbort()
    try {
      const response = await fetchCycles(
        next.legoId,
        TIER_3_LIMIT,
        ctrl.signal,
        map.version,
      )
      bufferCycles(response.cycles, response.next_lego_id)
      // No audio prefetch here — presentation audios JIT-fetch at use time.
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        console.warn('[InstantPlayback] tier-3 prefetch failed:', err)
      }
    } finally {
      releaseAbort(ctrl)
    }
  }

  // -----------------------------------------------------------
  // Public API: navigation + cleanup
  // -----------------------------------------------------------

  /**
   * Set the active legoId — called by the player layer after each
   * cycle/round transition so that `currentRound`, tier-1 and tier-3
   * resolve against the right anchor.
   */
  function setCurrentLegoId(legoId: string | null): void {
    currentLegoId.value = legoId
  }

  /**
   * Read cached cycles for a legoId — used by the player layer to
   * iterate through the round after `bootstrap()` returns. Returns
   * an empty array if no prefetch has populated this round yet.
   */
  function getBufferedCyclesForLego(legoId: string): BackendCycle[] {
    return cycleBuffer.value.get(legoId) ?? []
  }

  /**
   * Abort every in-flight fetch — call this on course switch /
   * unmount so we don't keep loading data the user isn't going to
   * consume.
   */
  function cancel(): void {
    for (const ctrl of activeAborts) {
      try {
        ctrl.abort()
      } catch {
        // Swallow — `AbortController.abort()` should never throw,
        // but be defensive about exotic environments.
      }
    }
    activeAborts.clear()
  }

  /** Drop in-memory state. Round-map localStorage cache is preserved. */
  function reset(): void {
    cancel()
    roundMap.value = null
    cycleBuffer.value = new Map()
    partialLegoIds.value = new Set()
    currentLegoId.value = null
    isReady.value = false
  }

  return {
    // First-paint critical path
    bootstrap,
    bootstrapInfPlay,
    prefetchNextInfPlayBatch,
    infPlayCycles,
    nextInfRoundCursor,

    // Prefetch tiers
    prefetchTier1,
    prefetchTier3,

    // State
    currentRound,
    roundMap,
    isReady,

    // Resolver helpers — the caller's resolveStartLegoId needs the
    // round-map to compute NEXT(lastCompleted). Cached path is instant;
    // uncached path is one tiny fetch (~20 KB).
    getOrFetchRoundMap: fetchRoundMap,

    // Navigation helpers (player layer uses these to keep the
    // composable in sync with playback position).
    setCurrentLegoId,
    getBufferedCyclesForLego,
    isLegoComplete,

    // Lifecycle
    cancel,
    reset,
  }
}

export type InstantPlayback = ReturnType<typeof useInstantPlayback>
