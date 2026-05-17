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

/** Tier 1: rest of the current round. The spec settles on limit=15. */
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
  ): Promise<CyclesResponse> {
    const code = courseCode.value
    if (!code) throw new Error('[InstantPlayback] courseCode is empty')

    const url =
      `${apiBase}/${encodeURIComponent(code)}/cycles` +
      `?from=${encodeURIComponent(fromLegoId)}&limit=${limit}`

    const res = await fetch(url, { signal })
    if (!res.ok) {
      throw new Error(
        `[InstantPlayback] cycles fetch failed: ${res.status} ${res.statusText}`,
      )
    }
    return (await res.json()) as CyclesResponse
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

    // 1. Resolve starting legoId
    let startLegoId: string | null = legoId ?? null
    if (!startLegoId && resolveStartLegoId) {
      const resolved = await resolveStartLegoId()
      startLegoId = resolved ?? null
    }

    // 2. Fetch round-map (cached → instant; cold → ~one indexed query)
    const map = await fetchRoundMap()
    roundMap.value = map

    // 3. Pick a starting legoId if the caller / resolver didn't supply
    //    one — fresh learner starts at round 1.
    if (!startLegoId) {
      const first = map.rounds[0]
      if (!first) {
        throw new Error('[InstantPlayback] round-map has no rounds')
      }
      startLegoId = first.legoId
    }

    // 4. Fetch ONE cycle — this is the minimum to render the first
    //    frame. The caller hands the audio refs to the existing
    //    audio controller, which streams the first audio file in
    //    parallel with the rest of UI hydration.
    const ctrl = makeAbort()
    let response: CyclesResponse
    try {
      response = await fetchCycles(startLegoId, 1, ctrl.signal)
    } finally {
      releaseAbort(ctrl)
    }

    const firstCycle = response.cycles[0]
    if (!firstCycle) {
      throw new Error(
        `[InstantPlayback] no cycles returned for legoId=${startLegoId}`,
      )
    }

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
      const response = await fetchCycles(lego, TIER_1_LIMIT, ctrl.signal)
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
      const response = await fetchCycles(next.legoId, TIER_3_LIMIT, ctrl.signal)
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
