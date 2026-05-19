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
 *   - Tier 2: listening audio for tier-1 cycles (delegated to the
 *     existing `usePrefetchManager` / service-worker `CacheFirst`)
 *   - Tier 3: next round's cycles + listening audio
 *
 * Coexists with `usePrefetchManager` (30-min audio buffer) and
 * `PriorityRoundLoader` (legacy upfront-load lazy loader). The new
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
    return ctrl
  }

  function releaseAbort(ctrl: AbortController): void {
    activeAborts.delete(ctrl)
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
      void revalidateRoundMap(code, cached.version)
      return cached
    }

    // Cache miss — one tiny fetch (~20 KB for a 700-LEGO course)
    const ctrl = makeAbort()
    try {
      const res = await fetch(`${apiBase}/${encodeURIComponent(code)}/round-map`, {
        signal: ctrl.signal,
      })
      if (!res.ok) {
        throw new Error(
          `[InstantPlayback] round-map fetch failed: ${res.status} ${res.statusText}`,
        )
      }
      const map = (await res.json()) as RoundMap
      writeCachedRoundMap(code, map)
      return map
    } finally {
      releaseAbort(ctrl)
    }
  }

  /**
   * Background revalidation. If the server returns a higher version,
   * overwrite the cache so the NEXT cold start picks it up.
   * Never throws — pure best-effort.
   */
  async function revalidateRoundMap(code: string, cachedVersion: number): Promise<void> {
    try {
      const res = await fetch(`${apiBase}/${encodeURIComponent(code)}/round-map`)
      if (!res.ok) return
      const fresh = (await res.json()) as RoundMap
      if (fresh.version > cachedVersion) {
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

    const res = await fetch(url, { signal })
    if (!res.ok) {
      throw new Error(
        `[InstantPlayback] cycles fetch failed: ${res.status} ${res.statusText}`,
      )
    }
    const response = (await res.json()) as CyclesResponse
    // Write-through cache. Stamp is the version the server returned, which
    // gets compared against the current round-map version on read.
    writeCachedCycles(code, fromLegoId, response)
    return response
  }

  function bufferCycles(cycles: BackendCycle[]): void {
    const buf = cycleBuffer.value
    for (const cycle of cycles) {
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
    bufferCycles(response.cycles)
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
      bufferCycles(response.cycles)
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        console.warn('[InstantPlayback] tier-1 prefetch failed:', err)
      }
    } finally {
      releaseAbort(ctrl)
    }
  }

  /**
   * Tier 2 — listening audio for the cycles tier 1 fetched.
   *
   * Per the spec, listening audio (seed + pod sentences) is the big
   * file but isn't needed for ~5 minutes. We have the entire current
   * round to download them.
   *
   * The actual fetching is delegated to the service-worker
   * `CacheFirst` strategy on `/api/audio/*` — once we hit those URLs
   * with `fetch()`, they end up in the SW cache and stay there per
   * the existing audio architecture. `usePrefetchManager` (the
   * 30-min buffer) handles the LEGO short clips on the same
   * principle; tier 2 specifically targets the *presentation* (seed
   * sentence) audio IDs that round-end listening exercises fire.
   */
  async function prefetchTier2(): Promise<void> {
    const lego = currentLegoId.value
    if (!lego) return
    const cycles = cycleBuffer.value.get(lego) ?? []

    // Collect any presentation_id audio refs from the current round
    // — those are the seed/pod sentences. If none, this tier is a
    // no-op (round has no listening hook).
    const audioIds = cycles
      .map((c) => c.audio.presentation_id)
      .filter((id): id is string => !!id)

    if (audioIds.length === 0) return

    const ctrl = makeAbort()
    try {
      await Promise.allSettled(
        audioIds.map((id) =>
          fetch(`/api/audio/${encodeURIComponent(id)}`, {
            signal: ctrl.signal,
          }).then((res) => {
            // Consume the body so the SW CacheFirst gets a fully
            // populated cache entry. We don't need the blob in JS —
            // the audio controller will fetch from the SW cache.
            return res.ok ? res.arrayBuffer() : null
          }),
        ),
      )
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        console.warn('[InstantPlayback] tier-2 prefetch failed:', err)
      }
    } finally {
      releaseAbort(ctrl)
    }
  }

  /**
   * Tier 3 — cycles + listening for the NEXT round.
   *
   * Round N+1 is identified by walking the round-map forward from
   * the current round, then fetching ~15 cycles starting at that
   * round's legoId.
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
      bufferCycles(response.cycles)

      // Tier 3 also covers listening for round N+1. Mirror the
      // tier-2 logic against the freshly-fetched cycles.
      const audioIds = response.cycles
        .map((c) => c.audio.presentation_id)
        .filter((id): id is string => !!id)
      if (audioIds.length > 0) {
        await Promise.allSettled(
          audioIds.map((id) =>
            fetch(`/api/audio/${encodeURIComponent(id)}`, {
              signal: ctrl.signal,
            }).then((res) => (res.ok ? res.arrayBuffer() : null)),
          ),
        )
      }
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
    currentLegoId.value = null
    isReady.value = false
  }

  return {
    // First-paint critical path
    bootstrap,

    // Prefetch tiers
    prefetchTier1,
    prefetchTier2,
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

    // Lifecycle
    cancel,
    reset,
  }
}

export type InstantPlayback = ReturnType<typeof useInstantPlayback>
