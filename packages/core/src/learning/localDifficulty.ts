/**
 * Local difficulty sensing (metrics workstream B4).
 *
 * Difficulty is not a property of a phrase — it is a property of *(this learner
 * × this unit), now*, and it moves as the learner's map fills in (Principle 4,
 * `docs/methodology/metrics-architecture.md` §4 "Sensing difficulty locally").
 * We discern it by running the curvature sensor (B1) **locally** — per LEGO,
 * per word, and especially per *boundary* (the join between units, where
 * retrieval-while-still-producing tends to catch people).
 *
 * This module is the local application of `curvature.ts`: given a per-unit
 * time-series of a difficulty-bearing metric, it reads whether that unit is
 * steady, a *developing* struggle, or easing — the leading-indicator signal the
 * adaptation controller (workstream C, `adaptation-budget.md`) spends as a
 * consolidate/defer/drill budget, and the dashboard renders as "dig deeper here".
 *
 * INPUT CONVENTION: higher value = more difficulty/struggle (e.g. normalised
 * latency, or |length-delta|). With that convention, **positive acceleration =
 * a struggle developing**; negative = easing. The sign is only interpretable if
 * the caller honours the convention.
 *
 * SENSING ONLY — no policy. This decides nothing about drill-vs-defer or return
 * timing; that is C1, which combines this read with criticality (introduction
 * order) and the spaced-repetition schedule. Keeping the layer boundary clean is
 * the point: the sensor senses; the controller decides.
 *
 * Pure functions over the B1 primitive; no app/storage coupling. The live wiring
 * to persisted per-(learner, unit) series (Layer 1 / A3) is the caller's job.
 */

import {
  computeCurvature,
  accelerationAlarm,
  type CurvaturePoint,
  type AlarmOptions,
} from './curvature';

export type UnitKind = 'lego' | 'word' | 'boundary';

export interface UnitSeries {
  /** Stable identifier for the unit (LEGO id, word, or boundary key). */
  unitId: string;
  /** Optional label for which grain this is — passed through, not interpreted. */
  unitKind?: UnitKind;
  /**
   * Time-ordered samples of the difficulty-bearing metric for this unit.
   * Convention: higher = harder/slower (see module header).
   */
  values: number[];
  /** Optional x-coordinates (cycle indices / timestamps) matching `values`. */
  x?: number[];
}

export type LocalDifficultyState =
  | 'warming_up' // below the min-cycle gate — not enough data to read curvature
  | 'steady' // no significant turn relative to the unit's own noise
  | 'struggling' // a developing struggle: acceleration up, flagged against own noise
  | 'easing'; // the struggle is resolving: acceleration down, flagged

export interface LocalDifficulty {
  unitId: string;
  unitKind?: UnitKind;
  /** The curvature read at the most recent sample; null while warming up. */
  curvature: CurvaturePoint | null;
  /** Acceleration in units of this unit's own recent noise (z); null until a baseline exists. */
  accelerationZ: number | null;
  /** Whether |z| crossed the alarm threshold — a turn worth attention. */
  flagged: boolean;
  /** Classification combining the gate, the flag, and the sign of acceleration. */
  state: LocalDifficultyState;
  /** How many samples fed the read. */
  samples: number;
}

/**
 * Read one unit's local difficulty by running the curvature sensor over its
 * series and classifying the most recent point.
 */
export function assessLocalDifficulty(
  series: UnitSeries,
  options: AlarmOptions = {}
): LocalDifficulty {
  const { unitId, unitKind, values, x } = series;
  const opts: AlarmOptions = { ...options, x };

  const curvature = computeCurvature(values, opts);
  const alarms = accelerationAlarm(values, opts);
  const last = alarms.length > 0 ? alarms[alarms.length - 1] : undefined;

  const accelerationZ = last?.z ?? null;
  const flagged = last?.flagged ?? false;
  const samples = curvature?.samples ?? 0;

  let state: LocalDifficultyState;
  if (!curvature || !last || last.acceleration === null) {
    state = 'warming_up';
  } else if (flagged && curvature.acceleration > 0) {
    state = 'struggling';
  } else if (flagged && curvature.acceleration < 0) {
    state = 'easing';
  } else {
    state = 'steady';
  }

  return { unitId, unitKind, curvature, accelerationZ, flagged, samples, state };
}

/**
 * Assess a set of units and return them most-struggling-first: developing
 * struggles (by how far acceleration stands out against each unit's own noise)
 * ahead of steady units, with warming-up units last. This is the raw severity
 * order the controller and the dashboard read — it is NOT a drill/defer
 * decision (that needs criticality, which lives in C1).
 */
export function rankLocalDifficulty(
  seriesList: UnitSeries[],
  options: AlarmOptions = {}
): LocalDifficulty[] {
  const assessed = seriesList.map((s) => assessLocalDifficulty(s, options));

  const rank: Record<LocalDifficultyState, number> = {
    struggling: 0,
    easing: 1,
    steady: 2,
    warming_up: 3,
  };

  return assessed.sort((a, b) => {
    if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    // Within the same state, the larger own-noise excursion comes first.
    const za = a.accelerationZ ?? 0;
    const zb = b.accelerationZ ?? 0;
    return Math.abs(zb) - Math.abs(za);
  });
}
