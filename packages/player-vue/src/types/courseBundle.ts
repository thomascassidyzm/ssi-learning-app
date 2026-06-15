/**
 * CourseBundle — wire format for GET /api/courses/:code/bundle
 *
 * One-shot, versioned payload containing EVERY LEGO and EVERY phrase in
 * the course, with each audio reference classified as `ephemeral` or
 * `persistent`. The single source of truth for client-side script
 * generation, audio prefetching, and the background bundle downloader.
 *
 * Replaces the JIT model where the backend assembled cycles per request
 * (/cycles and /infplay-cycles). Now the backend just ships the raw
 * structure once; the client owns assembly, sampling and caching.
 *
 * Size budget (typical 600-LEGO course):
 *   - ~600 legos × ~500 bytes  = ~300KB
 *   - ~600 × 5 phrases × ~300B = ~900KB
 *   - ~300 seeds × ~150 bytes  = ~45KB
 *   Total: ~1.3MB uncompressed, ~300KB gzipped.
 *
 * Cacheable per (course_code, version) — fetched once at session
 * start, then served from IndexedDB until the server's version bumps.
 *
 * Lifecycle classification (see `AudioLifecycle` below):
 *   - `ephemeral`: only ever consumed during a LEGO's introduction round
 *     (intro presentation, LEGO debut, build phrases). Evicted the
 *     moment that round completes.
 *   - `persistent`: reused across the whole course — USE phrases
 *     participate in spaced repetition and INF PLAY indefinitely.
 *
 * Endpoint contract (see api/courses/[code]/bundle.ts):
 *   GET /api/courses/:code/bundle
 *   - 200: CourseBundle (Cache-Control: private, max-age=300, s-maxage=86400)
 *   - 404: course_code unknown
 *   - 503: round-index materialised view empty (operator action needed)
 */

// ============================================================================
// LIFECYCLE
// ============================================================================

/**
 * `ephemeral` — audio only used during a LEGO's intro round. After the
 *   round completes the working-set audio for that LEGO can be evicted.
 *   Includes: presentation narration, LEGO's own k/t1/t2, BUILD phrase
 *   k/t1/t2 trios.
 *
 * `persistent` — audio reused for the lifetime of the course (spaced
 *   rep + INF PLAY). Includes: USE phrase k/t1/t2 trios.
 *
 * The classification lives on the bundle (not computed client-side) so
 * the server is the single source of truth and frontend logic stays
 * dumb. Future-proofs additions like listening-mode audio without
 * forcing the client to learn new role rules.
 */
export type AudioLifecycle = 'ephemeral' | 'persistent'

// ============================================================================
// AUDIO REFERENCES
// ============================================================================

/**
 * Pointer to one audio file. The URL is constructed by the client as
 * `/api/audio/{id}` — only the id, lifecycle and (optional) duration
 * travel in the bundle. Duration is kept in ms because the playback
 * config and pause-duration math already use ms.
 */
export interface BundleAudioRef {
  id: string
  lifecycle: AudioLifecycle
  durationMs?: number
}

// ============================================================================
// LEGOS
// ============================================================================

/**
 * One LEGO (Atomic or Molecular) and the audio used during its intro
 * round. Phrases are kept separate (see `BundlePhrase`) and linked by
 * `legoId` so the bundle stays normalised — phrases-per-LEGO can vary
 * widely and inlining them produces a much chunkier payload.
 */
export interface BundleLego {
  /** Composite key — same format as everywhere else in the codebase: "S0042L01". */
  legoId: string
  seedNumber: number
  legoIndex: number
  /** "S0042" — the parent seed id used as a grouping key. */
  seedId: string
  /** Atomic vs Molecular. Some old courses pre-date the column → null. */
  type: 'A' | 'M' | null
  knownText: string
  targetText: string
  /** When the target is romanised, the native-script version lives here. */
  targetTextNative?: string
  /** M-LEGO component breakdown — empty/undefined for A-LEGOs. */
  components?: Array<{ known: string; target: string }>
  /** Whether the LEGO is fresh material for the learner (false = already-known carry-over). */
  isNew: boolean

  /**
   * Audio used during the LEGO's intro round (all `ephemeral`).
   *
   *   - `known`         — LEGO's known-language audio (DEBUT prompt)
   *   - `target1`       — LEGO's target voice 1 (DEBUT voice1, INTRO voice1)
   *   - `target2`       — LEGO's target voice 2 (DEBUT voice2, INTRO voice2)
   *   - `presentation`  — "The X for Y is..." narration (INTRO prompt only)
   *
   * Any field may be absent if the upstream content build skipped it
   * (the player tolerates missing roles per existing convention).
   */
  ephemeralAudio: {
    known?: BundleAudioRef
    target1?: BundleAudioRef
    target2?: BundleAudioRef
    presentation?: BundleAudioRef
  }
}

// ============================================================================
// PHRASES
// ============================================================================

/**
 * `build` — practice phrase introduced during the LEGO's intro round
 *   to drill the LEGO in context. Plays only in that round.
 * `use`   — phrase that reuses the LEGO in a longer, meaningful
 *   sentence. Plays in the LEGO's intro round AND every subsequent
 *   spaced-rep / INF PLAY round that touches this LEGO.
 *
 * The legacy schema also has `practice` and `eternal_eligible` roles
 * — the server normalises both to one of these two before emitting.
 */
export type PhraseRole = 'build' | 'use'

/**
 * One practice phrase. Audio lifecycle follows the role:
 *   - `build`  phrases → `ephemeral`
 *   - `use`    phrases → `persistent`
 *
 * Decomposition (per-token alignment to LEGO ids) is preserved for
 * the player's tile-rendering path. Unused if the phrase wasn't
 * decomposed at content-build time.
 */
export interface BundlePhrase {
  /**
   * Stable phrase id. Format: `${legoId}_${role}_${position}`, e.g.
   * "S0042L01_use_03". Synthetic because the DB row doesn't have a
   * natural primary key — but stable across versions for a given
   * (legoId, role, position).
   */
  phraseId: string
  legoId: string
  /** 1-based within (legoId, role); preserves DB row ordering. */
  position: number
  role: PhraseRole
  knownText: string
  targetText: string
  targetTextNative?: string
  decomposition?: Array<{
    legoId: string | null
    target: string
    known: string
    isGhost: boolean
    isSalient?: boolean
  }>
  /** Authored display tiles ({n: native, r: roman, salient}) from
   * course_practice_phrases.display_tiling — rendered verbatim by the player
   * when present (native primary, roman ruby); absent → runtime segmenter. */
  displayTiling?: Array<{ n: string; r: string; salient?: boolean }>
  audio: {
    known?: BundleAudioRef
    target1?: BundleAudioRef
    target2?: BundleAudioRef
  }
}

// ============================================================================
// SEEDS
// ============================================================================

/**
 * One seed — the full source sentence from which LEGOs are extracted.
 * Today the bundle just exposes the seed id + number; future audio
 * (listening-mode seed playback) will hang off this shape.
 */
export interface BundleSeed {
  seedId: string
  seedNumber: number
}

// ============================================================================
// ROUND MAP
// ============================================================================

/**
 * Main-loop ordering. Round 1 = first LEGO the learner ever sees.
 * Used by the script generator to walk LEGOs in script order, and by
 * spaced-rep math (Fibonacci offsets back from the current round).
 *
 * Sorted by `roundIndex` ascending. INF PLAY rounds are NOT in this
 * list — they're generated client-side by sampling the main loop.
 */
export interface BundleRoundMapEntry {
  roundIndex: number
  legoId: string
  seedNumber: number
}

// ============================================================================
// LISTENING PODS (Layer 2)
// ============================================================================

/**
 * One sentence inside a listening pod. Pod sentences play in
 * `globalOrder` ascending, possibly multiple times per pod-round, with
 * speed + role variations driven by the stage playlist (see
 * `usePodLapScheduler`). Audio is reused thousands of times across a
 * learner's pod-rounds — always `lifecycle: 'persistent'`.
 *
 * Either audio ref may be absent if the upstream content build hasn't
 * mastered it yet; the runtime tolerates missing slots.
 */
export interface BundlePodSentence {
  /** 1-based position within the pod, matching `listening_pod_sentences.global_order`. */
  globalOrder: number
  knownText: string
  targetText: string
  /** True iff this sentence's utterance flows directly into the next one (no breath). */
  glueToNext: boolean
  targetAudio?: BundleAudioRef
  knownAudio?: BundleAudioRef
  /** Tom-voiced bilingual chunk-by-chunk explainer for this sentence
   *  ("'X' means Y. 'A' means B."). Optional — populated for sentences
   *  Popty's pod-explainer pipeline has rendered, omitted otherwise (one-
   *  chunk intentional skips, upstream gaps). The lap scheduler drops the
   *  'explainer' slot from a sentence's playlist when this is missing. */
  explainerAudio?: BundleAudioRef
}

/**
 * One listening pod — the Layer-2 unit. Today (2026-05) every course
 * has exactly one pod (`pod-0`); the array shape future-proofs the
 * downloader and runtime for multiple pods per course without further
 * wire-format changes.
 */
export interface BundlePod {
  /** `listening_pods.id` — composite key like `${courseCode}:pod-0`. */
  podId: string
  /** `listening_pods.pod_order` — 0-based authoring index, drives download priority. */
  podOrder: number
  /** Author-facing label; nullable in DB. */
  title: string | null
  /** Bookend played before every lap. */
  introAudio?: BundleAudioRef
  /** Bookend played after every lap. */
  outroAudio?: BundleAudioRef
  /** Sentences in `globalOrder` ascending. */
  sentences: BundlePodSentence[]
}

// ============================================================================
// BUNDLE
// ============================================================================

export interface CourseBundle {
  courseCode: string
  /**
   * `courses.content_version` at fetch time. Stored as text in the DB
   * (semver like "0.5.1") for some courses, integer for others — we
   * accept either type and use !== comparison for change detection.
   * The client compares its cached version against a tiny `/round-map`
   * (or `/bundle` head) call on session start and re-fetches if the
   * server has bumped.
   */
  version: string | number
  /** Total LEGOs in the main loop — used by INF PLAY math to compute absolute round numbers. */
  mainLoopCount: number

  legos: BundleLego[]
  phrases: BundlePhrase[]
  seeds: BundleSeed[]
  roundMap: BundleRoundMapEntry[]
  /** Listening pods (Layer 2) — empty array if the course has none. */
  pods: BundlePod[]
}

// ============================================================================
// HELPERS
// ============================================================================

/** Group phrases by legoId — common pattern for the script generator. */
export function phrasesByLego(bundle: CourseBundle): Map<string, BundlePhrase[]> {
  const map = new Map<string, BundlePhrase[]>()
  for (const phrase of bundle.phrases) {
    const list = map.get(phrase.legoId)
    if (list) list.push(phrase)
    else map.set(phrase.legoId, [phrase])
  }
  return map
}

/** Group phrases by (legoId, role) — script generator needs both buckets. */
export function phrasesByLegoAndRole(
  bundle: CourseBundle,
): Map<string, { build: BundlePhrase[]; use: BundlePhrase[] }> {
  const map = new Map<string, { build: BundlePhrase[]; use: BundlePhrase[] }>()
  for (const phrase of bundle.phrases) {
    let bucket = map.get(phrase.legoId)
    if (!bucket) {
      bucket = { build: [], use: [] }
      map.set(phrase.legoId, bucket)
    }
    bucket[phrase.role].push(phrase)
  }
  return map
}

/** O(1) lookup by legoId — preserves array iteration order. */
export function legosById(bundle: CourseBundle): Map<string, BundleLego> {
  const map = new Map<string, BundleLego>()
  for (const lego of bundle.legos) {
    map.set(lego.legoId, lego)
  }
  return map
}
