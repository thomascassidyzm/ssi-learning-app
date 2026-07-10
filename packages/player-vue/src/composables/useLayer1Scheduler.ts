/**
 * useLayer1Scheduler — runtime scheduler for Layer-1 listening exercises.
 *
 * THE 30-CUP MODEL (Tom, 2026-06-16). Full spec + worked trace:
 *   docs/methodology/layer1-listening-cups.md
 *
 * Layer-1 is fluency maintenance through pure INPUT — replaying seed sentences
 * you've already been *introduced* to, so the listening channel stays warm on
 * material you've stopped *producing*. Instead of one big block every 50 rounds,
 * it's a little dose at the end of EVERY round: a 30-slot "cup" wheel, one cup
 * poured per round, each ≈ a minute of target audio.
 *
 * Sibling to usePodLapScheduler (Layer-2 pods) but deliberately SIMPLER: no
 * stages, no per-seed decay state, no persisted ratchet. A lap is a PURE function
 * of (course catalogue, main round, learner, cluster templates) — same position
 * always produces the same cup, so it's resume-safe by construction with no DB
 * state to keep in sync.
 *
 * THE SPINE (see the doc for the full table + invariants):
 *   • Wheel: 30 cups, one poured per round; cupIndex = (round − activation) mod 30.
 *   • Fill: nothing until 30 *introduced* seeds; then every +30 introduced adds one
 *     seed to every cup. seedsPerCup = min(20, floor(introduced / 30)). Caps at
 *     600 introduced → 20/cup (longer courses maintain only the first 600).
 *   • Clusters: at every multiple-of-5 seeds/cup the whole cup is re-formed into an
 *     authored, ordered LINGUISTIC grouping (injected via clusterProvider; a
 *     deterministic fallback ships until Aran's templates land). Templates: 5/10/15/20.
 *   • Per-seed sandwich — comprehensible input (Tom 2026-06-21): each seed in
 *     the poured cup plays a fixed four-slot playlist —
 *       target @1× (voice 1) → known @1× → target @1× (voice 2) → target @2×
 *     — so the learner hears the sentence, then its MEANING, then the sentence
 *     again now understood, then a stretch rep at 2×. The cup's seeds play their
 *     sandwiches in cup order (cluster then loose); no per-seed decay/tier state.
 *     (History: a per-seed decay ladder (→2026-06-18), then a flat 1×/2× pour,
 *     then 1×,1× slow-only (06-20). All were TARGET-ONLY and road-tests showed
 *     they delivered no comprehensible input for disconnected seeds — a seed out
 *     of dialogue has no flow to infer meaning from. The known clip supplies it.)
 *   • Carries known-language audio in the `trans` slot — mirrors Layer-2 pods
 *     (target → known → target → target). A seed with no known audio skips the
 *     trans slot (target, target, target@2×); the slot is never silenced.
 *   • Forever loop: once a course stops introducing seeds (the 600 cap, or its own
 *     end), cup membership stops changing, so each cup just keeps pouring its fixed
 *     set (each seed's sandwich) — steady background maintenance.
 *
 * The ≈1-minute-per-cup is an APPROXIMATE feel target, not a hard cap — we never
 * measure audio durations; length falls out of the pattern (≈4 plays per seed).
 *
 * Placement (fire every round, adjacency, pod-wins-priority) is owned by the
 * caller in LearningPlayer's round-boundary handler — this composable only decides
 * WHETHER a lap is due and WHAT cup it contains.
 */

import { ref, shallowRef, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCachedListeningMeta } from './listeningMetaCache'

// ============================================================================
// Pure logic (exported for unit testing — no Vue/Supabase here)
// ============================================================================

/** Audio role for one Layer-1 play slot.
 *  ps = target @ 1.0×, ps2x = target @ 2.0×, trans = known-language @ 1.0×. */
export type Layer1PlayRole = 'ps' | 'ps2x' | 'trans'

/** Role → playback rate. Single source of truth. trans (the known clip) is
 *  reference material → always 1.0×, like in the pods. */
export const L1_ROLE_SPEED: Record<Layer1PlayRole, number> = { ps: 1.0, ps2x: 2.0, trans: 1.0 }

/** The audio a single seed exposes for its Layer-1 sandwich. */
export interface L1SeedAudio {
  seedNumber: number
  target1Id: string
  target2Id: string | null
  knownId: string | null
  targetText: string
  knownText: string
}

/**
 * One slot of the per-seed Layer-1 sandwich (admin-tunable playlist).
 *   t1   = target voice 1 @1×   t2   = target voice 2 @1× (falls back to v1)
 *   t1x2 = target voice 1 @2×   t2x2 = target voice 2 @2×
 *   known = known-language clip @1× (the meaning anchor; skipped if no audio)
 */
export type Layer1SlotRole = 't1' | 't2' | 'known' | 't1x2' | 't2x2'

/** The default per-seed sandwich (Tom 2026-06-21) — comprehensible input:
 *   target v1 @1× → known @1× → target v2 @1× → target v1 @2×
 * Used when no seedPlaylist is configured. */
export const DEFAULT_SEED_PLAYLIST: Layer1SlotRole[] = ['t1', 'known', 't2', 't1x2']

/**
 * Build a seed's Layer-1 plays from a slot playlist. Order/contents are
 * admin-tunable via algorithm_config['listening'].seedPlaylist (Listening
 * config page); absent/empty → DEFAULT_SEED_PLAYLIST (the original sandwich,
 * which mirrors the Layer-2 pods: target → known → target → target@2×, so the
 * runtime gap matrix already handles these transitions). A seed with no known
 * audio drops `known` slots; t2 falls back to voice 1 when there's no second
 * voice. Pure + exported so it's unit-tested directly.
 */
export function buildSeedPlays(seed: L1SeedAudio, playlist: Layer1SlotRole[] = DEFAULT_SEED_PLAYLIST): L1Play[] {
  const { seedNumber, target1Id, target2Id, knownId, targetText, knownText } = seed
  const voice2 = target2Id || target1Id
  const list = playlist && playlist.length ? playlist : DEFAULT_SEED_PLAYLIST
  const plays: L1Play[] = []
  for (const slot of list) {
    switch (slot) {
      case 't1':   plays.push({ seedNumber, audioId: target1Id, text: targetText, role: 'ps',   playbackSpeed: L1_ROLE_SPEED.ps }); break
      case 't2':   plays.push({ seedNumber, audioId: voice2,    text: targetText, role: 'ps',   playbackSpeed: L1_ROLE_SPEED.ps }); break
      case 't1x2': plays.push({ seedNumber, audioId: target1Id, text: targetText, role: 'ps2x', playbackSpeed: L1_ROLE_SPEED.ps2x }); break
      case 't2x2': plays.push({ seedNumber, audioId: voice2,    text: targetText, role: 'ps2x', playbackSpeed: L1_ROLE_SPEED.ps2x }); break
      case 'known': if (knownId) plays.push({ seedNumber, audioId: knownId, text: knownText, role: 'trans', playbackSpeed: L1_ROLE_SPEED.trans }); break
    }
  }
  return plays
}

export interface Layer1Config {
  /** Number of cups in the wheel (one poured per round). Batch size == cups. */
  cups: number
  /** Introduced-seed count before the first lap fires (also one-seed-per-cup point). */
  activationCount: number
  /** Hard cap on seeds per cup (cup-fill stops at `cups × maxSeedsPerCup` introduced). */
  maxSeedsPerCup: number
  /** Re-cluster every multiple of this many seeds/cup (templates: 5,10,15,20). */
  clusterStep: number
  /** Per-seed sandwich playlist (admin-tunable). Empty/absent → the default
   *  sandwich. See buildSeedPlays / Layer1SlotRole. */
  seedPlaylist: Layer1SlotRole[]
}

export const DEFAULT_LAYER1_CONFIG: Layer1Config = {
  cups: 30,
  activationCount: 30,
  maxSeedsPerCup: 20, // → caps at 600 introduced seeds
  clusterStep: 5,
  seedPlaylist: DEFAULT_SEED_PLAYLIST,
}

/**
 * Deterministic [0,1) RNG seeded on a string. mulberry32 over a cyrb-style
 * 32-bit string hash. Same string ⇒ same stream, every session/regeneration —
 * this is what keeps cup assembly resume-safe. Never use unseeded Math.random
 * for placement/selection.
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

/** A copy of `arr` shuffled with an injectable rng (full Fisher–Yates). Never
 *  mutates the input. Used to scatter each batch's seeds across the 30 cups. */
export function shuffleSeeded<T>(arr: readonly T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp
  }
  return a
}

/**
 * Build seedNum → ordinal-of-its-last-LEGO from the course catalogue
 * (course_legos rows ORDERED BY seed_number, lego_index). Last write per seed
 * wins = that seed's highest-index LEGO's absolute course ordinal. A seed is
 * "introduced" once its last LEGO has debuted — i.e. at this ordinal (≈ the
 * round, one new LEGO per main round).
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
 * The order seeds are *introduced* in: seed numbers sorted ascending by their
 * last-LEGO ordinal (ties broken by seed number). introductionOrder[i] is the
 * (i+1)-th seed to be fully introduced. Skips seeds with ordinal ≤ 0.
 */
export function buildIntroductionOrder(
  seedLastOrdinal: ReadonlyMap<number, number>,
): { order: number[]; ordinals: number[] } {
  const rows: Array<{ seed: number; ord: number }> = []
  for (const [seed, ord] of seedLastOrdinal) {
    if (ord > 0) rows.push({ seed, ord })
  }
  rows.sort((a, b) => a.ord - b.ord || a.seed - b.seed)
  return { order: rows.map((r) => r.seed), ordinals: rows.map((r) => r.ord) }
}

/** How many seeds are fully introduced by `round` (count of last-ordinals ≤ round). */
export function introducedCountAt(sortedOrdinals: readonly number[], round: number): number {
  // sortedOrdinals ascending → linear scan is fine (called O(1)/boundary).
  let n = 0
  for (const ord of sortedOrdinals) {
    if (ord <= round) n++
    else break
  }
  return n
}

/** seeds/cup at a given introduced count: min(maxSeedsPerCup, floor(count / cups)). */
export function seedsPerCup(introducedCount: number, cfg: Pick<Layer1Config, 'cups' | 'maxSeedsPerCup'>): number {
  if (introducedCount < cfg.cups) return 0
  return Math.min(cfg.maxSeedsPerCup, Math.floor(introducedCount / cfg.cups))
}

/** Current cluster size = largest multiple of clusterStep ≤ p (0 while p < step). */
export function clusterSizeFor(p: number, clusterStep: number): number {
  if (p < clusterStep) return 0
  return Math.floor(p / clusterStep) * clusterStep
}

/** The cup poured at `round` (0-based). Caller guarantees round ≥ activationRound. */
export function cupIndexFor(round: number, activationRound: number, cups: number): number {
  return (((round - activationRound) % cups) + cups) % cups
}

/**
 * Has the course stopped introducing seeds by `round`? True once the introduced
 * count reaches its final value — min(cap, totalSeeds) — after which no more
 * batches drive the decay, so the wheel settles to the 2× floor and loops.
 */
export function isFrozenAt(
  sortedOrdinals: readonly number[],
  round: number,
  cfg: Pick<Layer1Config, 'cups' | 'maxSeedsPerCup'>,
): boolean {
  const finalCount = Math.min(cfg.cups * cfg.maxSeedsPerCup, sortedOrdinals.length)
  if (finalCount <= 0) return false
  return introducedCountAt(sortedOrdinals, round) >= finalCount
}

/** Deterministic FALLBACK cluster: contiguous block of the introduction order
 *  (cup c gets introducedOrder[c·C … c·C+C)). Replaced by Aran's authored,
 *  linguistically-ordered templates via clusterProvider once they land. */
export function fallbackCluster(
  size: number,
  cupIndex: number,
  introductionOrder: readonly number[],
): number[] {
  if (size <= 0) return []
  const start = cupIndex * size
  return introductionOrder.slice(start, start + size)
}

/** Provider hook: ordered seed numbers for one cup of a cluster of `size`. */
export type Layer1ClusterProvider = (size: number, cupIndex: number) => number[]

/**
 * Compose one cup's ordered seed list — the heart of the model. Pure.
 *
 *   p = seedsPerCup; C = cluster size.
 *   • Cluster part (C ≥ clusterStep): clusterProvider(C, cupIndex), in order.
 *   • Loose part: one seed per batch in (C+1 … p), scattered per cup via
 *     looseProvider(batch, cupIndex); ordered oldest → newest.
 *   Returns the seeds in cup order: cluster first (template order), then the
 *   loose tail (oldest → newest). No tiers/decay — every seed is played the same
 *   way (its four-slot sandwich; see buildSeedPlays / nextLap).
 */
export function composeCupSeeds(params: {
  seedsPerCup: number
  cupIndex: number
  cfg: Pick<Layer1Config, 'clusterStep'>
  clusterProvider: Layer1ClusterProvider
  /** seed assigned to `cupIndex` from 1-based batch `batch`, or null if none. */
  looseProvider: (batch: number, cupIndex: number) => number | null
}): number[] {
  const { seedsPerCup: p, cupIndex, cfg, clusterProvider, looseProvider } = params
  if (p <= 0) return []

  const C = clusterSizeFor(p, cfg.clusterStep)
  const clusterSeeds = C >= cfg.clusterStep ? clusterProvider(C, cupIndex).slice(0, C) : []

  const looseSeeds: number[] = []
  for (let batch = C + 1; batch <= p; batch++) {
    const s = looseProvider(batch, cupIndex)
    if (s != null) looseSeeds.push(s) // oldest (C+1) → newest (p)
  }

  return [...clusterSeeds, ...looseSeeds]
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
  target2_audio_id: string | null
}

export interface L1BookendAudio {
  id: string
  text: string
  duration_ms?: number
}

export interface L1Play {
  seedNumber: number
  /** Audio to play: target sentence for ps/ps2x, known-language clip for trans. */
  audioId: string
  /** Display text — target sentence (roman when present) for ps/ps2x; known
   *  sentence for trans. */
  text: string
  /** What plays in this slot: 'ps' = target @1×, 'ps2x' = target @2×,
   *  'trans' = known-language clip @1×. Drives the runtime gap matrix. */
  role: Layer1PlayRole
  /** Playback rate (mirror of L1_ROLE_SPEED[role]): 1.0 for ps/trans, 2.0 for ps2x. */
  playbackSpeed: number
}

export interface L1Lap {
  mainRound: number
  /** 0-based index of the cup poured this round. */
  cupIndex: number
  /** Number of distinct seeds in the cup. */
  bucketSize: number
  intro: L1BookendAudio | null
  /** The cup's plays: each seed's sandwich (target → known → target → target@2×)
   *  in cup order (cluster then loose). */
  plays: L1Play[]
  outro: L1BookendAudio | null
}

export interface UseLayer1SchedulerOptions {
  supabase: Ref<SupabaseClient | null> | SupabaseClient | null
  courseCode: Ref<string> | string
  learnerId: Ref<string | null | undefined> | string | null | undefined
  /** Optional config override (e.g. from algorithm_config). Reactive. */
  config?: Ref<Partial<Layer1Config>> | Partial<Layer1Config>
  /** Optional authored cluster provider (Aran's templates). Falls back to the
   *  deterministic contiguous grouping when absent or it returns an empty cup. */
  clusterProvider?: Layer1ClusterProvider
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
  const introductionOrder = shallowRef<number[]>([])
  const sortedOrdinals = shallowRef<number[]>([])
  const introAudio = ref<L1BookendAudio | null>(null)
  const outroAudio = ref<L1BookendAudio | null>(null)

  const cfg = (): Layer1Config => ({ ...DEFAULT_LAYER1_CONFIG, ...(unwrap(options.config) || {}) })

  /** Round at which the first lap may fire = ordinal of the `activationCount`-th
   *  introduced seed. Infinity when the course has fewer seeds than that. */
  const activationRound = (): number => {
    const n = cfg().activationCount
    const ords = sortedOrdinals.value
    return ords.length >= n ? ords[n - 1] : Number.POSITIVE_INFINITY
  }

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
          .select('seed_number, known_text, target_text, target_text_roman, known_audio_id, target1_audio_id, target2_audio_id')
          .eq('course_code', courseCode)
          .order('seed_number', { ascending: true })
          .limit(5000),
        // .limit(10000) is REQUIRED — Supabase defaults to 1000 rows, which
        // truncates the LEGO catalogue on any course with >1000 LEGOs (~200+
        // seeds), giving later seeds wrong/missing ordinals so they never
        // get introduced. Mirrors generateLearningScript.ts's catalogue query.
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

      // Offline fallback (Tom's airplane-mode test 2026-07-09): when the live
      // metadata queries fail, serve the rows persisted by the deliberate
      // offline download. Never-downloaded + offline keeps the old failure
      // path (init warns, L1 laps just don't fire).
      let seedRows = seedsResult.data as L1SeedRow[] | null
      let catalogueRows = catalogueResult.data as Array<{ seed_number: number; lego_index: number }> | null
      let bookendRows = bookendsResult.data as Array<{ role: string; text: string; id: string; duration_ms?: number }> | null
      if (seedsResult.error || catalogueResult.error || bookendsResult.error) {
        const cached = await getCachedListeningMeta(courseCode)
        if (cached) {
          console.warn('[layer1Scheduler] live metadata fetch failed — using offline cache')
          if (seedsResult.error) seedRows = cached.coreSeeds as unknown as L1SeedRow[]
          if (catalogueResult.error) catalogueRows = cached.legoCatalogue
          if (bookendsResult.error) bookendRows = cached.bookends
        } else {
          if (seedsResult.error) throw new Error(`seeds: ${seedsResult.error.message}`)
          if (catalogueResult.error) throw new Error(`catalogue: ${catalogueResult.error.message}`)
          throw new Error(`bookends: ${bookendsResult.error!.message}`)
        }
      }

      const seedMap = new Map<number, L1SeedRow>()
      for (const row of (seedRows || []) as L1SeedRow[]) seedMap.set(row.seed_number, row)
      seeds.value = seedMap

      const lastOrd = computeSeedLastOrdinals(
        (catalogueRows || []) as Array<{ seed_number: number; lego_index: number }>,
      )
      seedLastOrdinal.value = lastOrd
      const intro = buildIntroductionOrder(lastOrd)
      introductionOrder.value = intro.order
      sortedOrdinals.value = intro.ordinals

      const byRole = new Map<string, L1BookendAudio>()
      for (const row of bookendRows || []) {
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

  /** Seeds/cup at this main round (0 before activation). */
  const seedsPerCupAt = (mainRound: number): number =>
    seedsPerCup(introducedCountAt(sortedOrdinals.value, mainRound), cfg())

  /**
   * Cadence gate: a lap is due EVERY round once ≥1 seed/cup is available. Caller
   * still applies adjacency (pod wins priority; clean boundary).
   */
  const shouldFireLapAt = (mainRound: number): boolean => {
    if (!isInitialized.value) return false
    return seedsPerCupAt(mainRound) >= 1
  }

  /** Resolve cluster for a cup: authored provider when it yields a full cup, else
   *  the deterministic fallback (so the wheel runs before Aran's templates land). */
  const resolveCluster = (size: number, cupIndex: number): number[] => {
    if (options.clusterProvider) {
      const authored = options.clusterProvider(size, cupIndex)
      if (authored && authored.length >= size) return authored.slice(0, size)
    }
    return fallbackCluster(size, cupIndex, introductionOrder.value)
  }

  /**
   * Compose the lap (cup) due at `mainRound`: bookend intro → the cup's plays
   * (whole cup at 1×, then whole cup at 2×) → bookend outro. Null
   * when nothing's introduced yet or no audio is available. Pure function of
   * (catalogue, round, learner, cluster templates).
   */
  const nextLap = (mainRound: number): L1Lap | null => {
    if (!isInitialized.value) return null
    const c = cfg()
    const p = seedsPerCupAt(mainRound)
    if (p < 1) return null

    const actRound = activationRound()
    if (!Number.isFinite(actRound) || mainRound < actRound) return null
    const cupIndex = cupIndexFor(mainRound, actRound, c.cups)

    const courseCode = String(unwrap(options.courseCode) || '')
    const learnerId = String(unwrap(options.learnerId) || 'guest')

    // Loose seeds: scatter each batch's `cups` seeds across the cups by a seeded
    // shuffle, so the per-cup assignment is arbitrary-but-stable. Memoised per batch.
    const batchCache = new Map<number, number[]>()
    const looseProvider = (batch: number, cup: number): number | null => {
      let scattered = batchCache.get(batch)
      if (!scattered) {
        const start = (batch - 1) * c.cups
        const slice = introductionOrder.value.slice(start, start + c.cups)
        if (slice.length < c.cups) return null // partial batch never plays
        scattered = shuffleSeeded(slice, seededRng(`${courseCode}:${learnerId}:L1batch:${batch}`))
        batchCache.set(batch, scattered)
      }
      return scattered[cup] ?? null
    }

    const cupSeeds = composeCupSeeds({
      seedsPerCup: p,
      cupIndex,
      cfg: c,
      clusterProvider: resolveCluster,
      looseProvider,
    })

    // Each cup seed plays its comprehensible-input sandwich in cup order — the
    // admin-tunable c.seedPlaylist (default: target → known → target(voice 2) →
    // target@2×; see buildSeedPlays). Seeds without target audio are skipped
    // entirely; a seed without known audio just drops the known slot.
    // Deterministic by construction (fixed playlist) → resume-safe, no RNG here.
    const seedMap = seeds.value
    const plays: L1Play[] = []
    for (const sNum of cupSeeds) {
      const seed = seedMap.get(sNum)
      if (!seed?.target1_audio_id) continue
      plays.push(...buildSeedPlays({
        seedNumber: sNum,
        target1Id: seed.target1_audio_id,
        target2Id: seed.target2_audio_id,
        knownId: seed.known_audio_id,
        targetText: seed.target_text_roman || seed.target_text,
        knownText: seed.known_text,
      }, c.seedPlaylist))
    }
    if (plays.length === 0) return null

    const playableSeeds = new Set(plays.map((pl) => pl.seedNumber)).size
    const hasBookends = !!(introAudio.value && outroAudio.value)
    return {
      mainRound,
      cupIndex,
      bucketSize: playableSeeds,
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
    introductionOrder,
    introAudio,
    outroAudio,
    initialize,
    seedsPerCupAt,
    shouldFireLapAt,
    nextLap,
    prefetchLap,
  }
}
