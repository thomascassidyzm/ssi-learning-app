/**
 * podCohorts.ts — group a pod's flat, ordered sentence list into intake
 * COHORTS: the chunk of dialogue a lap introduces together. Product ruling
 * (Tom 2026-07-23 afternoon): a cohort is one ENTIRE scene (scene_number
 * group). The earlier 2-3 sentence greedy packing split adjacency pairs —
 * a cohort could end on the question and deliver the reply next lap — so
 * the cap and all turn-splitting logic are gone. Scenes are authored to
 * start simple, so early cohorts are naturally small.
 *
 * Every sentence introduced in the same lap stays at the SAME stage as its
 * cohort-mates forever (stage cohesion: the cohort moves through the DK
 * sequence as one unit). The partition stays PURE — it depends only on the
 * course content, never on learner state, so every client derives the
 * identical cohorts from the same rows.
 *
 * Rows with a missing scene_number (legacy cached content) never force a
 * break: they join the scene run in progress, and an all-null list is one
 * cohort.
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
  scene_number?: number | null
}

export interface PodCohort {
  /** 0-based start index into the sentence array. */
  start: number
  /** Number of sentences in the scene. */
  size: number
}

/** Same-scene test: rows with a missing scene_number never force a break. */
const sameScene = (a: number | null | undefined, b: number | null | undefined): boolean =>
  a == null || b == null || a === b

/**
 * Compute the cohort partition over an ordered sentence list: one cohort per
 * scene (maximal run of rows whose scene_number agrees, nulls joining the
 * run in progress).
 */
export function buildPodCohorts(rows: readonly PodCohortRow[]): PodCohort[] {
  const cohorts: PodCohort[] = []
  let start = 0
  // Scene identity of the current run — the last non-null scene_number seen,
  // so a null row bridges rather than resets (…1, null, 1… stays one scene,
  // …1, null, 2… breaks at the 2).
  let scene: number | null = null
  for (let i = 0; i < rows.length; i++) {
    const sc = rows[i].scene_number ?? null
    if (i > start && !sameScene(scene, sc)) {
      cohorts.push({ start, size: i - start })
      start = i
    }
    if (sc != null) scene = sc
    else if (i === start) scene = null
  }
  if (rows.length > start) cohorts.push({ start, size: rows.length - start })
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
