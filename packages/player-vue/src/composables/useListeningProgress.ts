/**
 * useListeningProgress — per-learner per-seed Layer 1 fire-count persistence.
 *
 * The DB row is keyed by lego_id (the seed's completing LEGO — highest
 * lego_index for that seed_number) per the codebase convention "always
 * use LEGO number which encrypts seed number within it". The script
 * generator internally uses seed_num (cheap integer map ops) so this
 * composable bridges the two: catalogue lookup builds a seedNum ↔
 * lastLegoId map on init, conversion happens at hydrate + flush.
 *
 * Without this persistence the script generator's `seedL1FireCount`
 * resets every script generation, so the Stage 1 → 4 playlist
 * progression never compounds across sessions. Every L1 listening
 * cluster perpetually plays the slow-first Stage 1 playlist and the
 * methodology's decay to a single 2× rep never happens.
 *
 * Lifecycle:
 *   - initialize()       — load catalogue + persisted fire counts
 *   - getFireCounts()    — seedNum-keyed Map, fed into generateLearningScript
 *   - recordClusterFire(seedNumbers[]) — bump each seed's count by 1
 *   - flush()            — upsert dirty rows to Supabase (lego_id-keyed)
 *   - dispose()          — pagehide flush + cleanup
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
  initialize(): Promise<void>
  /** seedNum-keyed map for `generateLearningScript`'s `initialL1FireCounts`. */
  getFireCounts(): Map<number, number>
  recordClusterFire(seedNumbers: number[]): void
  flush(): Promise<void>
  dispose(): void
}

function legoKey(seedNum: number, legoIndex: number): string {
  return `S${String(seedNum).padStart(4, '0')}L${String(legoIndex).padStart(2, '0')}`
}

function parseSeedNum(legoId: string): number | null {
  const m = legoId.match(/^S(\d+)L\d+$/)
  return m ? parseInt(m[1], 10) : null
}

export function useListeningProgress(
  config: UseListeningProgressConfig,
): UseListeningProgressReturn {
  // Internal state: keyed by seed_num for fast script-gen integration.
  const fireCounts = new Map<number, number>()
  // Conversion map built from the course catalogue on initialize().
  const seedToLastLegoId = new Map<number, string>()
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

  /**
   * Load the course catalogue to build seedNum → lastLegoId map.
   * One small query (seed_number + lego_index for all LEGOs in the course).
   */
  async function loadCatalogue(): Promise<void> {
    const client = config.supabase
    if (!client) return
    const { data, error } = await client
      .from('course_legos')
      .select('seed_number, lego_index')
      .eq('course_code', config.courseCode)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .limit(10000)
    if (error) {
      console.warn('[useListeningProgress] Catalogue load failed:', error.message)
      return
    }
    for (const row of (data || []) as Array<{ seed_number: number; lego_index: number }>) {
      // Iteration order is seed_number asc, lego_index asc → final write per
      // seed wins, giving us the highest-index (= completing) LEGO id.
      seedToLastLegoId.set(row.seed_number, legoKey(row.seed_number, row.lego_index))
    }
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
      await loadCatalogue()
      const loaded = await s.loadAll(config.learnerId, config.courseCode)
      // Translate lego_id → seedNum on the way in.
      for (const [legoId, fireCount] of loaded) {
        const sNum = parseSeedNum(legoId)
        if (sNum !== null) fireCounts.set(sNum, fireCount)
      }
      console.log(
        `[useListeningProgress] Hydrated ${fireCounts.size} L1 fire counts (${seedToLastLegoId.size} seeds in catalogue) for ${config.courseCode}`,
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
    const skipped: number[] = []
    for (const sNum of dirty) {
      const legoId = seedToLastLegoId.get(sNum)
      if (!legoId) {
        // Catalogue didn't have this seed — shouldn't happen for L1 graduated
        // seeds (graduation is derived from the same catalogue), but be
        // defensive: skip rather than write an orphan row.
        skipped.push(sNum)
        continue
      }
      rows.push({
        learner_id: config.learnerId,
        course_code: config.courseCode,
        lego_id: legoId,
        fire_count: fireCounts.get(sNum) ?? 0,
        last_fired_at: now,
      })
    }

    if (skipped.length > 0) {
      console.warn('[useListeningProgress] Skipped unmapped seeds:', skipped)
    }

    dirty.clear()
    bumpsSinceFlush = 0

    try {
      await s.upsertMany(rows)
    } catch (err) {
      console.warn('[useListeningProgress] Flush failed:', err)
      // Re-mark as dirty so next flush retries (only the ones we actually
      // had a lego_id for — the orphans stay logged but not retried).
      for (const r of rows) {
        const sNum = parseSeedNum(r.lego_id)
        if (sNum !== null) dirty.add(sNum)
      }
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
