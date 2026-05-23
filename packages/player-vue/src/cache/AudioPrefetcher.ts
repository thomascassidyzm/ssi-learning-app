/**
 * AudioPrefetcher — JIT warming for the new cache-based content loading.
 *
 * Two responsibilities:
 *
 *   1. EPHEMERAL ACQUIRE AHEAD — when a new round starts (or on init),
 *      look at the next ~2 LEGOs in the upcoming script. For each, call
 *      `audioCache.ephemeral.acquireForLego({ legoId, audioIds })` where
 *      audioIds is the union of:
 *        - lego.ephemeralAudio.{known, target1, target2, presentation}
 *        - all phrase.audio.{known, target1, target2} for phrases with
 *          role === 'build' for that LEGO
 *      USE phrases are persistent — those go through `persistent.ensure`.
 *
 *   2. EPHEMERAL RELEASE ON COMPLETION — when a round completes, if that
 *      round's LEGO is leaving the working set (no future round needs its
 *      ephemeral set within the lookahead window), call
 *      `audioCache.ephemeral.releaseForLego(legoId)`.
 *
 * Replaces the ~250-line warm-up tangle in LearningPlayer.vue with one
 * small, focused module. The script generator hands us the round queue
 * already assembled — there's no guessing here. We just ensure what's
 * about to play is cached, and clean up what won't play again.
 *
 * No reactivity dependencies — pure JS. A future composable wraps this
 * in onMounted/onUnmounted and wires the SimplePlayer events.
 */

import type { CourseBundle, BundleLego, BundlePhrase } from '../types/courseBundle'
import { legosById } from '../types/courseBundle'
import type { AudioCache } from './AudioCache.types'

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export interface AudioPrefetcherOptions {
  audioCache: AudioCache
  /**
   * How many LEGOs ahead to ephemeral-acquire. Default 2. Increasing
   * this widens the working set; decreasing makes the prefetcher more
   * reactive (less work done speculatively).
   */
  lookahead?: number
  /**
   * How many cycles ahead to ensure persistent audio is cached
   * (backstop in case BundleDownloader hasn't reached this far yet).
   * Default 30 (~5 minutes of playback).
   */
  persistentLookaheadCycles?: number
}

/** Shape of a single round in the queue (subset of SimplePlayer.Round). */
export interface PrefetcherRound {
  legoId?: string
  cycles: ReadonlyArray<PrefetcherCycle>
}

/** Shape of a single cycle in a round (subset of SimplePlayer.Cycle). */
export interface PrefetcherCycle {
  known: { audioUrl: string }
  target: { voice1Url: string; voice2Url: string }
}

export interface AudioPrefetcher {
  /** Set the bundle once at session start. Builds the index for fast lookup. */
  setBundle(bundle: CourseBundle): void

  /**
   * Called when the player's current round changes. Walks lookahead
   * LEGOs ahead and ephemeral-acquires each. Also ensures persistent
   * audio for the next `persistentLookaheadCycles` cycles.
   *
   * Idempotent: cache calls are no-ops if already cached.
   */
  onRoundChanged(
    roundQueue: ReadonlyArray<PrefetcherRound>,
    currentRoundIndex: number,
  ): Promise<void>

  /**
   * Called when a round COMPLETES. If the completed round's LEGO is
   * past the lookahead window, releases its ephemeral set.
   */
  onRoundCompleted(
    roundQueue: ReadonlyArray<{ legoId?: string }>,
    completedRoundIndex: number,
  ): Promise<void>

  /** Drop in-memory indices. Cache state preserved. */
  reset(): void
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extract an audio id from a `/api/audio/<id>` URL. Returns null if the
 * URL doesn't match the expected pattern — callers skip null defensively
 * so a malformed cycle never breaks the prefetcher.
 */
function extractAudioId(url: string | undefined | null): string | null {
  if (!url || typeof url !== 'string') return null
  // Format: `/api/audio/<id>` — id is the last path segment.
  // Use split('/') to tolerate query strings: take the last non-empty,
  // strip any `?…` tail.
  const parts = url.split('/')
  const last = parts[parts.length - 1]
  if (!last) return null
  const id = last.split('?')[0]
  if (!id) return null
  return id
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

export function createAudioPrefetcher(options: AudioPrefetcherOptions): AudioPrefetcher {
  const { audioCache } = options
  // Defaults updated 2026-05-23 to streaming-first values.
  //
  // Earlier defaults (lookahead=2, persistentLookaheadCycles=30) were
  // sized for "bundle the next few minutes of audio into IDB so plays
  // read from blob". That works on fast networks (96% blob-URL hit
  // rate) but produces ~120 parallel fetches per round transition,
  // which saturates 3G pipes and competes with the audio element's
  // own fetches for current-cycle playback.
  //
  // Streaming-first defaults: cache the absolute minimum needed for
  // the next cycle to enter without races. The SW CacheFirst layer
  // (warmed by SimplePlayer.prefetchNextCycle) handles everything
  // else — slightly slower per play (one SW round-trip) but
  // dramatically less network noise.
  //
  // Learners who want full caching (plane journeys, etc.) get
  // driving mode's chunked accumulation (createChunkedPrefetch) or
  // the future paid "Download for offline" opt-in. Default path is
  // streaming.
  const lookahead = Math.max(0, options.lookahead ?? 1)
  const persistentLookaheadCycles = Math.max(0, options.persistentLookaheadCycles ?? 3)

  let bundle: CourseBundle | null = null
  let legoIndex: Map<string, BundleLego> = new Map()
  let buildPhrasesByLego: Map<string, BundlePhrase[]> = new Map()

  /**
   * Compute the union of audio ids the prefetcher must hold ephemerally
   * for a given LEGO: the LEGO's own ephemeralAudio + every BUILD phrase
   * audio under it. USE phrases are excluded (persistent).
   */
  function computeEphemeralAudioIds(legoId: string): string[] {
    const lego = legoIndex.get(legoId)
    if (!lego) return []

    const ids = new Set<string>()
    const eph = lego.ephemeralAudio
    if (eph.known?.id) ids.add(eph.known.id)
    if (eph.target1?.id) ids.add(eph.target1.id)
    if (eph.target2?.id) ids.add(eph.target2.id)
    if (eph.presentation?.id) ids.add(eph.presentation.id)

    const builds = buildPhrasesByLego.get(legoId) ?? []
    for (const phrase of builds) {
      if (phrase.audio.known?.id) ids.add(phrase.audio.known.id)
      if (phrase.audio.target1?.id) ids.add(phrase.audio.target1.id)
      if (phrase.audio.target2?.id) ids.add(phrase.audio.target2.id)
    }

    return Array.from(ids)
  }

  /**
   * Walk cycles starting at currentRoundIndex and yield up to
   * `persistentLookaheadCycles` distinct audio ids extracted from
   * known.audioUrl, target.voice1Url, target.voice2Url.
   */
  function collectPersistentAudioIds(
    roundQueue: ReadonlyArray<PrefetcherRound>,
    currentRoundIndex: number,
  ): string[] {
    const ids: string[] = []
    const seen = new Set<string>()
    let collected = 0

    for (let i = currentRoundIndex; i < roundQueue.length; i++) {
      const round = roundQueue[i]
      if (!round?.cycles) continue
      for (const cycle of round.cycles) {
        if (collected >= persistentLookaheadCycles) return ids
        const urls = [cycle.known?.audioUrl, cycle.target?.voice1Url, cycle.target?.voice2Url]
        for (const url of urls) {
          const id = extractAudioId(url)
          if (!id || seen.has(id)) continue
          seen.add(id)
          ids.push(id)
        }
        collected++
      }
    }
    return ids
  }

  return {
    setBundle(nextBundle: CourseBundle): void {
      bundle = nextBundle
      legoIndex = legosById(nextBundle)
      buildPhrasesByLego = new Map()
      for (const phrase of nextBundle.phrases) {
        if (phrase.role !== 'build') continue
        const list = buildPhrasesByLego.get(phrase.legoId)
        if (list) list.push(phrase)
        else buildPhrasesByLego.set(phrase.legoId, [phrase])
      }
    },

    async onRoundChanged(
      _roundQueue: ReadonlyArray<PrefetcherRound>,
      _currentRoundIndex: number,
    ): Promise<void> {
      // 2026-05-23: DISABLED. The persistent.ensure / ephemeral.acquireForLego
      // fetches both poison the SW CacheFirst layer with 200 responses,
      // which iOS Safari can't reconcile with its own Range requests for
      // media playback. Audio plays ~0.5s of buffered data then stalls
      // waiting for "next range" that never comes. 'ended' never fires.
      //
      // Streaming-first principle: the audio element fetches when it
      // needs to. SW cache miss → origin returns 206 → SW caches 206 →
      // subsequent plays of same audio hit cached 206. iOS happy.
      //
      // IDB is still populated when the audio element's request flows
      // through the SW pipeline (responses can be stored downstream by
      // explicit driving mode / offline opt-in paths). The prefetcher
      // just doesn't proactively populate either layer anymore.
      //
      // Function kept as a no-op so the call-site reactive watcher
      // (LearningPlayer.vue:1513) remains a single grep-handle in case
      // we ever want a non-iOS-hostile prefetch mechanism.
      return
    },

    async onRoundCompleted(
      roundQueue: ReadonlyArray<{ legoId?: string }>,
      completedRoundIndex: number,
    ): Promise<void> {
      if (!Array.isArray(roundQueue) || roundQueue.length === 0) return
      if (completedRoundIndex < 0 || completedRoundIndex >= roundQueue.length) return

      const completedLegoId = roundQueue[completedRoundIndex]?.legoId
      if (!completedLegoId) return

      // Does any of the next `lookahead` rounds still need this LEGO's
      // ephemeral audio? If so, keep it warm.
      const lookaheadEnd = Math.min(completedRoundIndex + 1 + lookahead, roundQueue.length)
      for (let i = completedRoundIndex + 1; i < lookaheadEnd; i++) {
        if (roundQueue[i]?.legoId === completedLegoId) {
          // Still needed — bail.
          return
        }
      }

      try {
        const evicted = await audioCache.ephemeral.releaseForLego(completedLegoId)
        if (evicted > 0) {
          console.log('[AudioPrefetcher] released ephemeral set', {
            legoId: completedLegoId,
            evicted,
          })
        }
      } catch (err) {
        console.warn('[AudioPrefetcher] ephemeral.releaseForLego failed', {
          legoId: completedLegoId,
          err,
        })
      }
    },

    reset(): void {
      bundle = null
      legoIndex = new Map()
      buildPhrasesByLego = new Map()
    },
  }
}
