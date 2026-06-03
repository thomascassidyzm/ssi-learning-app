/**
 * useLayer1Scheduler — runtime scheduler for Layer-1 listening exercises.
 *
 * Sibling to usePodLapScheduler (Layer-2 pods), but deliberately SIMPLER:
 * no stages, no per-seed decay, no persisted ratchet. Layer-1 is fluency
 * maintenance — once a seed has fully dropped out of spaced repetition, it
 * gets replayed (target sentence) at normal speed, then the whole list again
 * at 2× as a "can you still parse it fast?" comprehension pass.
 *
 * WHY no ratchet: a Layer-1 lap is a pure function of (course catalogue,
 * main round). The bucket is "the seeds drained by round N"; the cadence is
 * `round % interval`; the retired sampling is SEEDED on (course, learner,
 * round). So the same position always produces the same lap — resume-safe by
 * construction, no DB state to keep in sync. Skipping a lap loses nothing:
 * the drained seeds persist and the next lap (50 rounds on) covers them again.
 *
 * Drained / eligible: a seed graduates when its LAST LEGO's catalogue ordinal
 * + `offset` (90) rounds have passed — i.e. every LEGO of the seed has fully
 * dropped out of spaced rep (final fib review at +89, graduation one round
 * later). currentOrdinal ≈ main round (one new LEGO per main round), so at
 * main round R a seed is drained iff seedLastOrdinal <= R - offset.
 *
 * Bucket (caps a session at ~100 seeds ≈ 200 plays ≈ ~10 min):
 *   • drained ≤ cap        → play them all (graduation order).
 *   • drained >  cap       → `activeSize` (80) freshest-drained
 *                            + (cap - activeSize) (20) SEEDED-random from the
 *                            retired rest, so old seeds rotate back through and
 *                            are never fully forgotten.
 *
 * Placement (the every-50-rounds cadence + adjacency) is owned by the caller
 * in LearningPlayer's round-boundary handler, mirroring the pod block — this
 * composable only decides WHETHER a lap is due and WHAT it contains.
 */

import { ref, shallowRef, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// Pure logic (exported for unit testing — no Vue/Supabase here)
// ============================================================================

/** Audio role for one Layer-1 play slot. ps = target @ 1.0×, ps2x = @ 2.0×. */
export type Layer1PlayRole = 'ps' | 'ps2x'

/** Role → playback rate. Single source of truth. */
export const L1_ROLE_SPEED: Record<Layer1PlayRole, number> = { ps: 1.0, ps2x: 2.0 }

export interface Layer1Config {
  /** Rounds after a seed's last LEGO before it graduates into listening. */
  offset: number
  /** Fire a lap every N main rounds from `activationRound` onward. */
  interval: number
  /** First main round at which a lap may fire (also needs a non-empty bucket). */
  activationRound: number
  /** Hard cap on seeds per session (~100 ≈ 10 min). */
  bucketCap: number
  /** Freshest-drained seeds always kept; the rest are "retired" and sampled. */
  activeSize: number
}

export const DEFAULT_LAYER1_CONFIG: Layer1Config = {
  offset: 90,
  interval: 50,
  activationRound: 100,
  bucketCap: 100,
  activeSize: 80,
}

/**
 * Deterministic [0,1) RNG seeded on a string. mulberry32 over a cyrb-style
 * 32-bit string hash. Same string ⇒ same stream, every session/regeneration —
 * this is what keeps the retired-20 sampling resume-safe (matches the seeded
 * INF-PLAY model). Never use unseeded Math.random for placement/selection.
 */
export function seededRng(seedStr: string): () => number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let a = h >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Sample `n` items without replacement via a partial Fisher–Yates with an
 *  injectable rng. Returns a copy; never mutates the input. */
export function sampleSeeded<T>(arr: readonly T[], n: number, rng: () => number): T[] {
  if (n >= arr.length) return [...arr]
  if (n <= 0) return []
  const a = [...arr]
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (a.length - i))
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp
  }
  return a.slice(0, n)
}

/**
 * Build seedNum → ordinal-of-its-last-LEGO from the course catalogue
 * (course_legos rows ORDERED BY seed_number, lego_index). Last write per seed
 * wins = that seed's highest-index LEGO's absolute course ordinal.
 */
export function computeSeedLastOrdinals(
  catalogue: ReadonlyArray<{ seed_number: number; lego_index: number }>,
): Map<number, number> {
  const out = new Map<number, number>()
  let ord = 0
  for (const row of catalogue) {
    ord++
    out.set(row.seed_number, ord) // ordered query → final write per seed = its last LEGO
  }
  return out
}

/**
 * Seeds drained by `currentOrdinal`, returned in GRADUATION ORDER (oldest
 * first = ascending last-LEGO ordinal). A seed is drained iff its last LEGO
 * is at least `offset` ordinals behind the current position.
 */
export function drainedSeedsAt(
  seedLastOrdinal: ReadonlyMap<number, number>,
  currentOrdinal: number,
  offset: number,
): number[] {
  const drained: Array<{ seedNum: number; lastOrd: number }> = []
  for (const [seedNum, lastOrd] of seedLastOrdinal) {
    if (lastOrd > 0 && currentOrdinal - lastOrd >= offset) drained.push({ seedNum, lastOrd })
  }
  drained.sort((a, b) => a.lastOrd - b.lastOrd || a.seedNum - b.seedNum)
  return drained.map((d) => d.seedNum)
}

/**
 * Compose the session bucket from drained seeds (graduation order, oldest
 * first). ≤ cap → all of them. > cap → keep the `activeSize` freshest, fill
 * the remaining `cap - activeSize` slots with a seeded-random draw from the
 * retired rest. Result stays in graduation order (oldest → freshest) so the
 * normal and 2× passes share one stable order.
 */
export function composeBucket(
  drainedOldestFirst: readonly number[],
  cfg: Pick<Layer1Config, 'bucketCap' | 'activeSize'>,
  rng: () => number,
  lastOrdOf?: ReadonlyMap<number, number>,
): number[] {
  const n = drainedOldestFirst.length
  if (n <= cfg.bucketCap) return [...drainedOldestFirst]
  const active = drainedOldestFirst.slice(n - cfg.activeSize) // freshest tail
  const retired = drainedOldestFirst.slice(0, n - cfg.activeSize)
  const pull = Math.max(0, cfg.bucketCap - cfg.activeSize)
  const sample = sampleSeeded(retired, pull, rng)
  const bucket = [...sample, ...active]
  // Stable order for both passes: by graduation order when ordinals known.
  if (lastOrdOf) bucket.sort((a, b) => (lastOrdOf.get(a) ?? 0) - (lastOrdOf.get(b) ?? 0) || a - b)
  return bucket
}

/** True iff a lap is due at this main round (cadence only — caller adds adjacency). */
export function shouldFireAtRound(mainRound: number, cfg: Pick<Layer1Config, 'interval' | 'activationRound'>): boolean {
  if (mainRound < cfg.activationRound) return false
  const interval = Math.max(1, Math.floor(cfg.interval))
  return (mainRound - cfg.activationRound) % interval === 0
}

// ============================================================================
// Runtime types
// ============================================================================

export interface L1SeedRow {
  seed_number: number
  known_text: string
  target_text: string
  target_text_roman: string | null
  known_audio_id: string | null
  target1_audio_id: string | null
}

export interface L1BookendAudio {
  id: string
  text: string
  duration_ms?: number
}

export interface L1Play {
  seedNumber: number
  /** Always the seed's target sentence audio (target1_audio_id). */
  audioId: string
  /** Target text (roman variant when present). */
  text: string
  /** 1.0 for the normal pass, 2.0 for the speed pass. */
  playbackSpeed: number
}

export interface L1Lap {
  mainRound: number
  /** Number of distinct seeds in the bucket (plays.length === 2 × this, minus any audio-less). */
  bucketSize: number
  intro: L1BookendAudio | null
  /** Normal pass (all seeds @ 1.0×) followed by speed pass (all @ 2.0×). */
  plays: L1Play[]
  outro: L1BookendAudio | null
}

export interface UseLayer1SchedulerOptions {
  supabase: Ref<SupabaseClient | null> | SupabaseClient | null
  courseCode: Ref<string> | string
  learnerId: Ref<string | null | undefined> | string | null | undefined
  /** Optional config override (e.g. from algorithm_config). Reactive. */
  config?: Ref<Partial<Layer1Config>> | Partial<Layer1Config>
}

const unwrap = <T,>(v: Ref<T> | T): T =>
  v && typeof v === 'object' && 'value' in (v as any) ? (v as Ref<T>).value : (v as T)

// ============================================================================
// Composable
// ============================================================================

export function useLayer1Scheduler(options: UseLayer1SchedulerOptions) {
  const isInitialized = ref(false)
  const isLoading = ref(false)
  const seeds = shallowRef<Map<number, L1SeedRow>>(new Map())
  const seedLastOrdinal = shallowRef<Map<number, number>>(new Map())
  const introAudio = ref<L1BookendAudio | null>(null)
  const outroAudio = ref<L1BookendAudio | null>(null)

  const cfg = (): Layer1Config => ({ ...DEFAULT_LAYER1_CONFIG, ...(unwrap(options.config) || {}) })

  /** Load seeds + catalogue ordinals + listening bookends. Idempotent. */
  const initialize = async (): Promise<void> => {
    const supabase = unwrap(options.supabase)
    const courseCode = unwrap(options.courseCode)
    if (!supabase || !courseCode) return

    isLoading.value = true
    try {
      const [seedsResult, catalogueResult, bookendsResult] = await Promise.all([
        supabase
          .from('course_seeds')
          .select('seed_number, known_text, target_text, target_text_roman, known_audio_id, target1_audio_id')
          .eq('course_code', courseCode)
          .order('seed_number', { ascending: true })
          .limit(5000),
        // .limit(10000) is REQUIRED — Supabase defaults to 1000 rows, which
        // truncates the LEGO catalogue on any course with >1000 LEGOs (~200+
        // seeds), giving later seeds wrong/missing ordinals so they never
        // drain. Mirrors generateLearningScript.ts's catalogue query.
        supabase
          .from('course_legos')
          .select('seed_number, lego_index')
          .eq('course_code', courseCode)
          .order('seed_number', { ascending: true })
          .order('lego_index', { ascending: true })
          .limit(10000),
        supabase
          .from('course_audio')
          .select('role, text, id, duration_ms')
          .eq('course_code', courseCode)
          .in('role', ['bookend_listen_intro', 'bookend_listen_outro']),
      ])

      if (seedsResult.error) throw new Error(`seeds: ${seedsResult.error.message}`)
      if (catalogueResult.error) throw new Error(`catalogue: ${catalogueResult.error.message}`)
      if (bookendsResult.error) throw new Error(`bookends: ${bookendsResult.error.message}`)

      const seedMap = new Map<number, L1SeedRow>()
      for (const row of (seedsResult.data || []) as L1SeedRow[]) seedMap.set(row.seed_number, row)
      seeds.value = seedMap

      seedLastOrdinal.value = computeSeedLastOrdinals(
        (catalogueResult.data || []) as Array<{ seed_number: number; lego_index: number }>,
      )

      const byRole = new Map<string, L1BookendAudio>()
      for (const row of (bookendsResult.data || []) as Array<{ role: string; text: string; id: string; duration_ms?: number }>) {
        byRole.set(row.role, { id: row.id, text: row.text, duration_ms: row.duration_ms })
      }
      introAudio.value = byRole.get('bookend_listen_intro') || null
      outroAudio.value = byRole.get('bookend_listen_outro') || null

      isInitialized.value = true
    } catch (err) {
      console.warn('[layer1Scheduler] init failed:', err)
    } finally {
      isLoading.value = false
    }
  }

  /** Seeds drained by this main round (graduation order, oldest first). */
  const drainedAt = (mainRound: number): number[] =>
    drainedSeedsAt(seedLastOrdinal.value, mainRound, cfg().offset)

  /**
   * Cadence gate. Caller still applies adjacency (clean main round each side,
   * no pod/encouragement adjacent). Returns false if no seed is drained yet.
   */
  const shouldFireLapAt = (mainRound: number): boolean => {
    if (!isInitialized.value) return false
    if (!shouldFireAtRound(mainRound, cfg())) return false
    return drainedAt(mainRound).length > 0
  }

  /**
   * Compose the lap due at `mainRound`: bookend intro → every bucket seed at
   * 1.0× → the same list at 2.0× → bookend outro. Null when nothing's drained
   * or no audio is available. Pure function of (catalogue, round, learner).
   */
  const nextLap = (mainRound: number): L1Lap | null => {
    const drained = drainedAt(mainRound)
    if (drained.length === 0) return null

    const courseCode = String(unwrap(options.courseCode) || '')
    const learnerId = String(unwrap(options.learnerId) || 'guest')
    const rng = seededRng(`${courseCode}:${learnerId}:L1:${mainRound}`)
    const bucket = composeBucket(drained, cfg(), rng, seedLastOrdinal.value)

    const seedMap = seeds.value
    const playable = bucket.filter((sNum) => seedMap.get(sNum)?.target1_audio_id)
    if (playable.length === 0) return null

    const plays: L1Play[] = []
    for (const role of ['ps', 'ps2x'] as const) {
      const speed = L1_ROLE_SPEED[role]
      for (const sNum of playable) {
        const seed = seedMap.get(sNum)!
        plays.push({
          seedNumber: sNum,
          audioId: seed.target1_audio_id!,
          text: seed.target_text_roman || seed.target_text,
          playbackSpeed: speed,
        })
      }
    }

    const hasBookends = !!(introAudio.value && outroAudio.value)
    return {
      mainRound,
      bucketSize: playable.length,
      intro: hasBookends ? introAudio.value : null,
      plays,
      outro: hasBookends ? outroAudio.value : null,
    }
  }

  /** Fire-and-forget warm-up of a lap's audio (mirror of pod prefetchLap). */
  const prefetchLap = (mainRound: number, ensureFn?: (audioId: string) => Promise<void>): void => {
    const lap = nextLap(mainRound)
    if (!lap) return
    const ids = new Set<string>()
    if (lap.intro?.id) ids.add(lap.intro.id)
    if (lap.outro?.id) ids.add(lap.outro.id)
    for (const p of lap.plays) if (p.audioId) ids.add(p.audioId)
    for (const id of ids) {
      if (ensureFn) ensureFn(id).catch(() => undefined)
      else fetch(`/api/audio/${id}`, { priority: 'low' as any }).catch(() => undefined)
    }
  }

  return {
    isInitialized,
    isLoading,
    seeds,
    seedLastOrdinal,
    introAudio,
    outroAudio,
    initialize,
    drainedAt,
    shouldFireLapAt,
    nextLap,
    prefetchLap,
  }
}
