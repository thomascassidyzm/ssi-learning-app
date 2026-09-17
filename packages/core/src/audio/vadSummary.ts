/**
 * VAD SUMMARY — one analysis of the voice-and-pause tables, behind two doors.
 *
 * `summariseVad` was born in the player's admin board and lived in
 * `packages/player-vue/src/insight/data/vadUptake.ts`. It lives HERE because
 * the server needs it too: since job #32 the teacher's and leader's Insights
 * pages are answered with AGGREGATES ONLY — no roster, no names, no
 * learner-keyed rows cross the wire — which means the summary has to be taken
 * on the server, over rows the browser will never see.
 *
 * WHY CORE AND NOT A SECOND COPY. Two implementations of an average are two
 * numbers waiting to disagree; and one copy of the code is the whole point of
 * "hide, don't zero" holding identically on both doors. `api/**` imports
 * `packages/core/src/**` directly in a dozen places, which the serverless
 * builder handles; it CANNOT import `packages/player-vue/src/**`, whose
 * package.json declares `"type": "module"` — a function that tried returned
 * FUNCTION_INVOCATION_FAILED at runtime, on every request, named or not.
 *
 * HIDE, DON'T ZERO is the invariant every caller depends on: `learnerIds` is
 * the FULL roster and the metric/prosody maps hold only those who have data.
 * A learner with no rows counts in `total` and in nothing else — absent, never
 * a zero dragging an average down.
 *
 * The per-learner `learners` rows are built for the admin board, which is
 * allowed to name people. The Insights door drops them before answering.
 */
import type { MasteryState } from '../learning/types';

export interface MetricRow {
  learner_id: string
  lego_id: string
  course_code: string | null
  mastery_state: MasteryState
  /**
   * MISNAMED COLUMN, kept honest here: the value is NORMALISED latency —
   * milliseconds per character of the target phrase (@ssi/core MetricsTracker
   * normalizeLatency), not raw milliseconds. Live values run ~0.6–183.
   * Everything user-facing must say "ms per character".
   */
  mean_latency_ms: number | null
  n_samples: number | null
  last_seen_at: string | null
}

/**
 * One learner's cycle_prosody read, already folded server-side.
 *
 * WHY NOT A CLIENT READ like everything else here: player_events is own-row
 * under RLS for EVERYONE, admins included — verified live 2026-08-12 with a
 * real ssi_admin JWT (learner_lego_metrics returns another learner's rows;
 * player_events returns 0 of their 321). So prosody comes through the
 * admin-gated GET /api/admin/vad-prosody, which reads it with the service role
 * and hands back aggregates only. Nothing per-event, no envelope contour.
 *
 * Every mean carries the base it was taken over, so any scope can be rolled up
 * from these and still state its own denominator.
 */
export interface ProsodyAgg {
  events: number
  peakEnergyDbSum: number
  peakEnergyDbBase: number
  averageEnergyDbSum: number
  averageEnergyDbBase: number
  peakCountSum: number
  peakCountBase: number
  startedDuringPrompt: number
  startedDuringPromptBase: number
  stillSpeakingAtVoice1: number
  stillSpeakingAtVoice1Base: number
}

// ---- scope tree ------------------------------------------------------------

export interface MasteryCounts {
  acquisition: number
  consolidating: number
  confident: number
  mastered: number
}

export interface ProsodySummary {
  events: number
  learners: number
  meanPeakEnergyDb: number | null
  meanAverageEnergyDb: number | null
  meanPeakCount: number | null
  startedDuringPromptRate: number | null   // 0..1, over events that carry the flag
  startedDuringPromptBase: number
  stillSpeakingRate: number | null         // 0..1, over events that carry the flag
  stillSpeakingBase: number
  /** false when the prosody endpoint was unreachable — the panel says so rather than showing dashes. */
  available: boolean
}

export interface LearnerVadRow {
  learnerId: string
  name: string
  legos: number
  mastered: number
  meanLatency: number | null               // ms per character
  prosodyEvents: number
  lastSeenAt: string | null
}

export interface VadSummary {
  /** Every learner on the roster for this scope — the honest denominator. */
  total: number
  /** Learners carrying at least one learner_lego_metrics row. */
  withData: number
  /** Learners carrying at least one cycle_prosody event. */
  withProsody: number
  /** withData / total, 0..1. null when total === 0. */
  uptake: number | null
  mastery: MasteryCounts
  /** learner_lego_metrics rows behind the mastery counts. */
  legoSeries: number
  /** Per-LEARNER mean normalised latency (ms/char), over learners with data. */
  learnerLatencies: number[]
  medianLatency: number | null
  prosody: ProsodySummary
  learners: LearnerVadRow[]
}

const EMPTY_MASTERY = (): MasteryCounts => ({ acquisition: 0, consolidating: 0, confident: 0, mastered: 0 })

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Summarise one scope. `learnerIds` is the FULL roster; the metric/prosody maps
 * hold only the learners who have data. The gap between them is the insight.
 */
export function summariseVad(
  learnerIds: string[],
  names: Map<string, string>,
  metricsByLearner: Map<string, MetricRow[]>,
  prosodyByLearner: Map<string, ProsodyAgg>,
  prosodyAvailable = true,
): VadSummary {
  const mastery = EMPTY_MASTERY()
  const learnerLatencies: number[] = []
  const rows: LearnerVadRow[] = []
  let legoSeries = 0
  let withData = 0
  let withProsody = 0

  let peakSum = 0, peakBase = 0
  let avgSum = 0, avgBase = 0
  let peakCountSum = 0, peakCountBase = 0
  let promptStarts = 0, promptBase = 0
  let overruns = 0, overrunBase = 0
  let prosodyEvents = 0

  for (const learnerId of learnerIds) {
    const metrics = metricsByLearner.get(learnerId) ?? []
    const prosody = prosodyByLearner.get(learnerId) ?? null
    if (metrics.length > 0) withData++
    if (prosody && prosody.events > 0) withProsody++
    if (metrics.length === 0 && !prosody) continue   // no rows at all — not a zero

    legoSeries += metrics.length
    for (const m of metrics) {
      if (m.mastery_state in mastery) mastery[m.mastery_state]++
    }

    const latencies = metrics.map(m => m.mean_latency_ms).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    const learnerMean = mean(latencies)
    if (learnerMean !== null) learnerLatencies.push(learnerMean)

    if (prosody) {
      prosodyEvents += prosody.events
      peakSum += prosody.peakEnergyDbSum; peakBase += prosody.peakEnergyDbBase
      avgSum += prosody.averageEnergyDbSum; avgBase += prosody.averageEnergyDbBase
      peakCountSum += prosody.peakCountSum; peakCountBase += prosody.peakCountBase
      promptStarts += prosody.startedDuringPrompt; promptBase += prosody.startedDuringPromptBase
      overruns += prosody.stillSpeakingAtVoice1; overrunBase += prosody.stillSpeakingAtVoice1Base
    }

    const lastSeen = metrics
      .map(m => m.last_seen_at)
      .filter((v): v is string => !!v)
      .sort()
      .pop() ?? null

    rows.push({
      learnerId,
      name: names.get(learnerId) ?? 'Unnamed learner',
      legos: metrics.length,
      mastered: metrics.filter(m => m.mastery_state === 'mastered').length,
      meanLatency: learnerMean,
      prosodyEvents: prosody?.events ?? 0,
      lastSeenAt: lastSeen,
    })
  }

  rows.sort((a, b) => b.legos - a.legos || a.name.localeCompare(b.name))

  return {
    total: learnerIds.length,
    withData,
    withProsody,
    uptake: learnerIds.length > 0 ? withData / learnerIds.length : null,
    mastery,
    legoSeries,
    learnerLatencies,
    medianLatency: median(learnerLatencies),
    prosody: {
      events: prosodyEvents,
      learners: withProsody,
      meanPeakEnergyDb: peakBase > 0 ? peakSum / peakBase : null,
      meanAverageEnergyDb: avgBase > 0 ? avgSum / avgBase : null,
      meanPeakCount: peakCountBase > 0 ? peakCountSum / peakCountBase : null,
      startedDuringPromptRate: promptBase > 0 ? promptStarts / promptBase : null,
      startedDuringPromptBase: promptBase,
      stillSpeakingRate: overrunBase > 0 ? overruns / overrunBase : null,
      stillSpeakingBase: overrunBase,
      available: prosodyAvailable,
    },
    learners: rows,
  }
}

/**
 * Bin the per-learner mean latencies for the Distribution widget. Fixed-width
 * bins over the observed range; returns [] when there is nothing to bin (the
 * board renders its own empty state rather than an empty chart).
 */
