/**
 * podCohorts.ts — group a pod's flat, ordered sentence list into intake
 * COHORTS: the 2-3 sentence chunks a lap introduces together (product ruling,
 * Tom 2026-07-23). A lap no longer debuts one orphan line — it debuts a
 * coherent piece of dialogue (an exchange), and every sentence introduced in
 * the same lap stays at the SAME stage as its cohort-mates forever (stage
 * cohesion: the cohort moves through the DK sequence as one unit).
 *
 * Cohort formation uses the structure that exists in the data:
 *   • TURNS — maximal glue_to_next chains (computed speaker-aware by
 *     flattenPodRows: split siblings always glue, same-speaker paragraphs
 *     glue, a speaker change breathes). A turn is never split mid-thought
 *     unless it alone exceeds the cohort cap (then it splits into balanced
 *     chunks of ≤3 — unavoidable).
 *   • SCENES — a cohort never straddles a scene_number boundary; a new scene
 *     starts a new cohort even if that leaves a cohort of 1-2.
 *   • PACKING — consecutive turns within a scene pack greedily up to 3
 *     sentences (a 1-line turn + its 1-2 line reply = an adjacency pair).
 *
 * The pod stays ONE organism: laps still replay the full accumulated content
 * with no explicit scene markers — the cohort unit itself is the punctuation.
 *
 * The intake pointer (`course_enrollments.completed_pod_rounds`) keeps its
 * historical unit — SENTENCES covered — so legacy values migrate in place
 * with no write-time transform and old/new clients interoperate on the same
 * row (see podCohortRoundFor / podRatchetAfterLap).
 */

export interface PodCohortRow {
  glue_to_next?: boolean | null
  scene_number?: number | null
}

export interface PodCohort {
  /** 0-based start index into the sentence array. */
  start: number
  /** Number of sentences (1-3; 1 only when the data forces it). */
  size: number
}

/** Max sentences per cohort (the ruling's "2-3"). */
export const POD_COHORT_MAX = 3

/** Same-scene test: rows with a missing scene_number never force a break. */
const sameScene = (a: number | null | undefined, b: number | null | undefined): boolean =>
  a == null || b == null || a === b

/** Split an oversized turn into balanced chunks of ≤POD_COHORT_MAX
 *  (4 → 2+2, 5 → 3+2, 7 → 3+2+2). */
const balancedChunks = (n: number): number[] => {
  const k = Math.ceil(n / POD_COHORT_MAX)
  const base = Math.floor(n / k)
  const rem = n % k
  return Array.from({ length: k }, (_, i) => base + (i < rem ? 1 : 0))
}

/**
 * Compute the cohort partition over an ordered sentence list. Pure — the
 * partition depends only on the course content, never on learner state, so
 * every client derives the identical cohorts from the same rows.
 */
export function buildPodCohorts(rows: readonly PodCohortRow[]): PodCohort[] {
  // 1. Turns: maximal glue chains that never cross a scene boundary.
  const turns: Array<{ start: number; size: number; scene: number | null }> = []
  let start = 0
  for (let i = 0; i < rows.length; i++) {
    const next = rows[i + 1]
    const chains = !!rows[i].glue_to_next && !!next &&
      sameScene(rows[i].scene_number, next.scene_number)
    if (!chains) {
      turns.push({ start, size: i - start + 1, scene: rows[start].scene_number ?? null })
      start = i + 1
    }
  }

  // 2. Pack turns into cohorts of ≤3 sentences, scenes never straddled.
  const cohorts: PodCohort[] = []
  let cur: { start: number; size: number; scene: number | null } | null = null
  let cursor = 0
  const flush = () => { if (cur) { cohorts.push({ start: cur.start, size: cur.size }); cur = null } }
  for (const turn of turns) {
    cursor = turn.start
    for (const size of balancedChunks(turn.size)) {
      if (cur && cur.scene === turn.scene && cur.size + size <= POD_COHORT_MAX) {
        cur.size += size
      } else {
        flush()
        cur = { start: cursor, size, scene: turn.scene }
      }
      cursor += size
    }
  }
  flush()
  return cohorts
}

/** 0-based ordinal of the cohort containing sentence index `idx`, or -1. */
export function podCohortOrdinalForIndex(cohorts: readonly PodCohort[], idx: number): number {
  return cohorts.findIndex((c) => idx >= c.start && idx < c.start + c.size)
}

const totalSentences = (cohorts: readonly PodCohort[]): number => {
  const last = cohorts[cohorts.length - 1]
  return last ? last.start + last.size : 0
}

/**
 * The cohort-round in play for a stored sentence-ratchet value.
 *
 * `stored` is `completed_pod_rounds` — historically "laps completed", where
 * one lap introduced one sentence, so its value ≡ sentences covered. That
 * unit is KEPT: going forward each completed lap advances it by the size of
 * the cohort it introduced, so legacy values need no migration write and an
 * old client incrementing by 1 just re-plays part of a cohort (monotonic,
 * never a regression, dev/staging/prod share one DB).
 *
 * Round semantics: round N introduces cohort N (intake window = cohorts
 * 1..N, capped at the cohort count) and is the aging clock for stage maths
 * (cohort c's alive = round - c + 1). A partially-covered cohort counts as
 * started — its remaining sentences enter with it at its stage (one-cohort
 * migration fuzz, bounded). Past the last cohort the round keeps ticking +1
 * per lap so eternal-stage aging never freezes.
 */
export function podCohortRoundFor(cohorts: readonly PodCohort[], stored: number): number {
  const started = cohorts.filter((c) => c.start < stored).length
  return started + 1 + Math.max(0, stored - totalSentences(cohorts))
}

/**
 * The stored ratchet value after completing the current round's lap: snaps
 * to the end of the cohort that round introduced (so mid-cohort legacy
 * values land on a boundary), or ticks +1 once every cohort is introduced.
 * Always > `stored` (the ratchet never stalls).
 */
export function podRatchetAfterLap(cohorts: readonly PodCohort[], stored: number): number {
  if (cohorts.length === 0) return stored + 1
  const started = cohorts.filter((c) => c.start < stored).length
  const completing = cohorts[Math.min(started, cohorts.length - 1)]
  return Math.max(completing.start + completing.size, stored + 1)
}
