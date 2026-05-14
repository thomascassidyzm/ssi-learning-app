/**
 * useListeningProgress — per-learner per-seed Layer 1 fire-count persistence.
 *
 * Without this, the script generator's `seedL1FireCount` resets every script
 * generation, so the Stage 1 → 4 playlist progression never compounds across
 * sessions. Every L1 listening cluster perpetually plays the slow-first
 * Stage 1 playlist and the methodology's decay to a single 2× rep never
 * happens.
 *
 * Lifecycle:
 *   - initialize()       — load persisted fire counts from learner_l1_state
 *   - getFireCounts()    — current Map, fed into generateLearningScript
 *   - recordClusterFire(seedNumbers[]) — bump each seed's count by 1
 *   - flush()            — upsert dirty rows to Supabase
 *   - dispose()          — pagehide flush + cleanup
 *
 * "Complete, not continuous" — batched flush every N bumps + on pagehide,
 * matching the per-LEGO adaptive pause persistence pattern.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  LegoListeningStore,
  type LegoListeningUpsert,
} from '@ssi/core'

const FLUSH_EVERY_N_BUMPS = 10

export interface UseListeningProgressConfig {
  supabase: SupabaseClient | null
  learnerId: string | null
  courseCode: string
}

export interface UseListeningProgressReturn {
  /** Load persisted counts. Safe with no client / guest — becomes a no-op. */
  initialize(): Promise<void>
  /** Current per-seed fire counts, suitable for `generateLearningScript`'s
   *  `initialL1FireCounts` parameter. */
  getFireCounts(): Map<number, number>
  /** Bump fire_count by 1 for each seed in an L1 cluster that just played.
   *  Updates the in-memory map immediately; flushes when dirty buffer hits
   *  threshold or on pagehide. */
  recordClusterFire(seedNumbers: number[]): void
  /** Write dirty rows to Supabase. Silent on failure. */
  flush(): Promise<void>
  /** pagehide cleanup + final flush. */
  dispose(): void
}

export function useListeningProgress(
  config: UseListeningProgressConfig,
): UseListeningProgressReturn {
  const fireCounts = new Map<number, number>()
  const dirty = new Set<number>()
  let bumpsSinceFlush = 0
  let initialized = false
  let pageHideHandler: (() => void) | null = null

  const canSync = (): boolean =>
    !!(
      config.supabase &&
      config.learnerId &&
      !config.learnerId.startsWith('guest-')
    )

  const store = (): LegoListeningStore | null => {
    if (!canSync() || !config.supabase) return null
    return new LegoListeningStore({ client: config.supabase })
  }

  const registerPageHide = (): void => {
    if (typeof window === 'undefined' || pageHideHandler) return
    pageHideHandler = () => { void flush() }
    window.addEventListener('pagehide', pageHideHandler)
  }

  const initialize = async (): Promise<void> => {
    if (initialized) return
    initialized = true

    const s = store()
    if (!s || !config.learnerId) {
      registerPageHide()
      return
    }

    try {
      const loaded = await s.loadAll(config.learnerId, config.courseCode)
      for (const [seedNum, fireCount] of loaded) fireCounts.set(seedNum, fireCount)
      console.log(
        `[useListeningProgress] Hydrated ${loaded.size} L1 fire counts for course ${config.courseCode}`,
      )
    } catch (err) {
      console.warn('[useListeningProgress] Hydration failed:', err)
    }

    registerPageHide()
  }

  const getFireCounts = (): Map<number, number> => fireCounts

  const recordClusterFire = (seedNumbers: number[]): void => {
    if (!seedNumbers || seedNumbers.length === 0) return
    for (const sNum of seedNumbers) {
      if (typeof sNum !== 'number' || sNum <= 0) continue
      fireCounts.set(sNum, (fireCounts.get(sNum) ?? 0) + 1)
      dirty.add(sNum)
      bumpsSinceFlush++
    }
    if (bumpsSinceFlush >= FLUSH_EVERY_N_BUMPS) {
      void flush()
    }
  }

  const flush = async (): Promise<void> => {
    if (dirty.size === 0) return
    const s = store()
    if (!s || !config.learnerId) {
      dirty.clear()
      bumpsSinceFlush = 0
      return
    }

    const now = new Date()
    const rows: LegoListeningUpsert[] = []
    for (const sNum of dirty) {
      rows.push({
        learner_id: config.learnerId,
        course_code: config.courseCode,
        seed_num: sNum,
        fire_count: fireCounts.get(sNum) ?? 0,
        last_fired_at: now,
      })
    }

    dirty.clear()
    bumpsSinceFlush = 0

    try {
      await s.upsertMany(rows)
    } catch (err) {
      console.warn('[useListeningProgress] Flush failed:', err)
      // Re-mark as dirty so next flush retries
      for (const r of rows) dirty.add(r.seed_num)
    }
  }

  const dispose = (): void => {
    if (pageHideHandler && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', pageHideHandler)
      pageHideHandler = null
    }
    void flush()
  }

  return { initialize, getFireCounts, recordClusterFire, flush, dispose }
}
