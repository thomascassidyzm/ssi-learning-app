/**
 * podCohorts.ts — group a pod's flat, ordered sentence list into intake
 * COHORTS: the chunk of dialogue a lap introduces together. Product ruling
 * (Tom 2026-07-24, superseding the 2026-07-23 whole-scene-per-lap ruling):
 * the SCENE stays the wall, but a scene DEBUTS BY EXCHANGE within it. An
 * EXCHANGE is a speaker turn plus its reply — two consecutive turns, where a
 * turn is a maximal run of sentences connected by `glue_to_next` (computed
 * speaker-aware by flattenPodRows; same definition as podTurns.ts's display
 * spans). The first lap of a new scene introduces its opening exchange; each
 * subsequent lap extends the SAME scene by its next exchange until the scene
 * is complete; only then does the next scene begin. An adjacency pair can
 * never straddle a lap: a pair IS two consecutive turns, and turns pair off
 * in order — a scene with an odd turn count leaves its closing turn (e.g. a
 * narrator coda) as its own cohort.
 *
 * One exception, at the cold start only (Tom, T-13, 2026-08-07): a FIRST
 * cohort that isn't a full exchange absorbs the ones after it until it is,
 * so a learner's first lap is never a single line played on repeat — and
 * nothing more is ever merged, so it is never a whole scene either. See
 * applyPodColdStartWindow for the ruling and the evidence.
 *
 * Why not whole-scene cohorts (the 2026-07-23 model): measured on
 * ita_for_eng:pod-0, scenes 6+ run 17-36 sentences — a whole-scene debut
 * there is ~110+ plays in one lap, and Tom's staging test found even scene 1
 * (8 sentences) too much for a first exposure.
 *
 * Every sentence introduced in the same lap stays at the SAME stage as its
 * cohort-mates forever (stage cohesion: the exchange-cohort moves through the
 * DK sequence as one unit; the shared two-doors drill counter lifts a cohort
 * only as far as its least-drilled member). The partition stays PURE — it
 * depends only on the course content, never on learner state, so every client
 * derives the identical cohorts from the same rows.
 *
 * Rows with a missing scene_number (legacy cached content) never force a
 * scene break: they join the scene run in progress, and an all-null list is
 * partitioned by exchange alone. Rows with no glue/speaker info (legacy
 * cache) each read as their own turn, so they pair off two sentences at a
 * time — small, safe cohorts.
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
  /** True iff this row's natural utterance continues into the next row —
   *  speaker-aware when the rows came through flattenPodRows. Missing/null
   *  reads as a turn boundary (legacy cache → 2-sentence exchanges). */
  glue_to_next?: boolean | null
}

export interface PodCohort {
  /** 0-based start index into the sentence array. */
  start: number
  /** Number of sentences in the exchange. */
  size: number
}

/**
 * COLD-START FLOOR — the "not a lone line" half of the window. A cohort of a
 * single sentence is not a conversation: measured on live telemetry, a Hebrew
 * learner's first pod held exactly one sentence, and because every lap
 * restarts from sentence one, that one clip played 19 times across 7 laps —
 * indistinguishable from a broken app (A-52, Tom 2026-08-07).
 *
 * Two sentences is the smallest thing that is still an EXCHANGE — a turn and
 * its reply — which is what the cold start is supposed to be. The ceiling
 * half of the window lives in applyPodColdStartWindow: nothing beyond that
 * one exchange is ever merged in.
 */
export const POD_COLD_START_MIN_SENTENCES = 2

/** Same-scene test: rows with a missing scene_number never force a break. */
const sameScene = (a: number | null | undefined, b: number | null | undefined): boolean =>
  a == null || b == null || a === b

/**
 * Compute the cohort partition over an ordered sentence list: scenes are the
 * walls (maximal run of rows whose scene_number agrees, nulls joining the run
 * in progress); within each scene, turns (maximal glue_to_next runs) pair off
 * in order into EXCHANGES — each cohort is one exchange, a trailing lone turn
 * standing alone.
 *
 * This is the PURE exchange partition, without the cold-start window —
 * `buildPodCohorts` is this plus `applyPodColdStartWindow`, and is what
 * callers want.
 */
export function buildPodExchangeCohorts(rows: readonly PodCohortRow[]): PodCohort[] {
  // Pass 1 — scene runs (the walls). Scene identity of the current run is the
  // last non-null scene_number seen, so a null row bridges rather than resets
  // (…1, null, 1… stays one scene, …1, null, 2… breaks at the 2).
  const sceneRuns: Array<{ start: number; end: number }> = []
  let start = 0
  let scene: number | null = null
  for (let i = 0; i < rows.length; i++) {
    const sc = rows[i].scene_number ?? null
    if (i > start && !sameScene(scene, sc)) {
      sceneRuns.push({ start, end: i })
      start = i
    }
    if (sc != null) scene = sc
    else if (i === start) scene = null
  }
  if (rows.length > start) sceneRuns.push({ start, end: rows.length })

  // Pass 2 — within each scene, split into turns (a turn ends at each row
  // whose glue_to_next is falsy; the scene wall always ends a turn), then
  // pair consecutive turns into exchanges.
  const cohorts: PodCohort[] = []
  for (const run of sceneRuns) {
    const turnStarts: number[] = []
    let turnStart = run.start
    for (let i = run.start; i < run.end; i++) {
      if (!rows[i].glue_to_next || i === run.end - 1) {
        turnStarts.push(turnStart)
        turnStart = i + 1
      }
    }
    for (let t = 0; t < turnStarts.length; t += 2) {
      const exStart = turnStarts[t]
      const exEnd = t + 2 < turnStarts.length ? turnStarts[t + 2] : run.end
      cohorts.push({ start: exStart, size: exEnd - exStart })
    }
  }
  return cohorts
}

/**
 * THE COLD-START WINDOW (Tom's ruling on T-13, 2026-08-07) — one policy with
 * two sides, because both failures are real and they bracket the same thing:
 *
 *   "the cold start must be ONE FULL EXCHANGE — a lone line ('Good morning,
 *    Sarah') is not enough, but the WHOLE SCENE arriving at once is too much."
 *
 * FLOOR: a first cohort below POD_COLD_START_MIN_SENTENCES is not yet an
 * exchange (it can only be a lone trailing turn — a scene whose whole content
 * is one line). It absorbs following WHOLE exchanges until it is one, or the
 * pod runs out. The merge may cross a scene wall in that case: the wall
 * governs the ramp, and a lone line outranks it for one cohort.
 *
 * CEILING: nothing else is ever merged. A cohort that is already an exchange
 * stands alone, however short — a turn plus its reply IS the intended first
 * serving. This is what the earlier floor-only rule (min 3) got wrong: it
 * stacked a second exchange onto any two-sentence opener, and on eus_for_spa
 * that pulled 2 + 5 = the entire opening scene into lap one, which is exactly
 * the "whole scene at once" Tom saw in Aran's session. Measured across all 70
 * live pods: 45 open on a 3-sentence exchange and are untouched either way;
 * the 25 that open on a 2-sentence exchange (every eng_for_* pod among them)
 * now serve that exchange alone instead of a merged 4 — eus_for_spa, 7. No
 * live pod currently opens on a lone line, so the floor is the safety net for
 * the shape A-52 measured rather than an everyday path.
 *
 * The window lives in the partition rather than in the scheduler on purpose:
 * the partition stays the single PURE source of truth, so the ratchet
 * (podCohortRoundFor / podRatchetAfterLap), stage cohesion and alive-counting
 * all follow it with no further change, and every client derives the same
 * cohorts from the same rows. That purity is also why the window is NOT
 * conditioned on the learner's easy/fast mode even though the ruling arose on
 * easy: a mode-dependent partition would have the two modes disagree about
 * where laps begin while sharing one sentence ratchet, so toggling mode would
 * shift a learner's cohort boundaries under them. One exchange is the right
 * first serving in either mode.
 *
 * Later cohorts are untouched in every case — this is about the cold start,
 * not about lap size in general.
 */
export function applyPodColdStartWindow(cohorts: readonly PodCohort[]): PodCohort[] {
  let size = 0
  let n = 0
  while (n < cohorts.length && size < POD_COLD_START_MIN_SENTENCES) {
    size += cohorts[n].size
    n++
  }
  return n > 1 ? [{ start: 0, size }, ...cohorts.slice(n)] : [...cohorts]
}

/**
 * The cohort partition callers use: exchange cohorts (scene walls, adjacency
 * pairs) with the cold-start window applied to the first one.
 */
export function buildPodCohorts(rows: readonly PodCohortRow[]): PodCohort[] {
  return applyPodColdStartWindow(buildPodExchangeCohorts(rows))
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
