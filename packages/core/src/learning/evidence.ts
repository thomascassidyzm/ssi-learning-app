/**
 * The evidence stream (adaptation v2, workstream C — WP-0).
 *
 * One narrow, typed wire is the ONLY way any observation about the learner
 * reaches the scheduler. Stage 1 (behavioural: taps, skips, replays) and
 * stage 2 (voice-envelope metadata) are just two producers on this wire — the
 * scheduler cannot tell them apart, and needs zero changes when stage 2 lands.
 * That property (a second producer plugs in with no scheduler edits) is this
 * module's acceptance test.
 *
 * `docs/adaptation/adaptation-v2-build-spec.md` §2 is the design authority;
 * `packages/player-vue/public/docs/metrics-vision.html` wins on conflict.
 *
 * INPUT CONVENTION (matches `localDifficulty.ts`): higher `value` = more
 * struggle. Producers normalise into a common ~[0..3] band so series from
 * different sources mix sanely once merged for one unit.
 *
 * Pure, no Vue/Supabase coupling — persistence (snapshot/hydrate) is the
 * caller's job (WP-4 wires this into `LegoMetricsStore`).
 */

/** One observation about one unit. The ONLY way evidence reaches the scheduler. */
export interface MasteryEvidence {
  /** LEGO id (canonical) today; boundary key (`boundary:{legoId}:{gapIndex}`) later. */
  unitId: string;
  /** Matches `localDifficulty.UnitKind`'s grain, minus 'word' (not an evidence source). */
  unitKind: 'lego' | 'boundary';
  source: 'latency' | 'behaviour' | 'envelope';
  /**
   * The difficulty-bearing value, HIGHER = MORE STRUGGLE — the localDifficulty
   * input convention, enforced at the producer. Producers normalise into a
   * common [0..~3] band so series mix sanely once merged.
   */
  value: number;
  /** Producer's confidence in this observation, [0..1]. Weights the series merge. */
  weight: number;
  /** Ties same-cycle evidence together for the collapse rule below. */
  cycleId?: string;
  /** `performance.now()` epoch of the session — the series' time axis. */
  occurredAtMs: number;
}

export interface EvidenceSink {
  record(e: MasteryEvidence): void;
}

/** A unit's merged difficulty series, ready for `computeLocalDifficulty`/`computeCurvature`. */
export interface EvidenceSeries {
  values: number[];
  x: number[];
}

export interface EvidenceAggregator extends EvidenceSink {
  /** Time-ordered merged difficulty series for a unit (for computeLocalDifficulty). */
  getSeries(unitId: string): EvidenceSeries;
  /** All units with ≥ minSamples, for the per-round policy sweep. */
  readyUnits(minSamples: number): string[];
  /** Snapshot for persistence (WP-4). */
  snapshot(): Map<string, EvidenceSeries>;
  hydrate(data: Map<string, EvidenceSeries>): void;
}

/** Ring cap per unit — matches `recent_latency_samples`'s existing bound. */
export const EVIDENCE_SERIES_RING_CAP = 20;

/**
 * One collapsed sample: a weighted-merge of every observation that landed in
 * the same cycle for the same unit, plus the running weight total needed to
 * fold in one more same-cycle observation correctly.
 */
interface RingEntry {
  value: number;
  x: number;
  cycleId: string | undefined;
  /** Sum of weights collapsed into `value` so far — the merge-rule denominator. */
  weightSum: number;
}

class EvidenceAggregatorImpl implements EvidenceAggregator {
  private series = new Map<string, RingEntry[]>();

  record(e: MasteryEvidence): void {
    const ring = this.series.get(e.unitId) ?? [];
    const last = ring[ring.length - 1];

    // Merge rule: evidence landing within the same cycle for the same unit
    // collapses into one sample, value = Σ(vᵢ·wᵢ)/Σwᵢ. Across cycles (or when
    // no cycleId is given, so collapse can't be established), samples append
    // in time order.
    if (last !== undefined && e.cycleId !== undefined && last.cycleId === e.cycleId) {
      const newWeightSum = last.weightSum + e.weight;
      last.value = newWeightSum > 0 ? (last.value * last.weightSum + e.value * e.weight) / newWeightSum : last.value;
      last.weightSum = newWeightSum;
      last.x = e.occurredAtMs;
    } else {
      ring.push({ value: e.value, x: e.occurredAtMs, cycleId: e.cycleId, weightSum: e.weight });
      while (ring.length > EVIDENCE_SERIES_RING_CAP) {
        ring.shift();
      }
    }

    this.series.set(e.unitId, ring);
  }

  getSeries(unitId: string): EvidenceSeries {
    const ring = this.series.get(unitId) ?? [];
    return { values: ring.map((r) => r.value), x: ring.map((r) => r.x) };
  }

  readyUnits(minSamples: number): string[] {
    const ready: string[] = [];
    for (const [unitId, ring] of this.series) {
      if (ring.length >= minSamples) ready.push(unitId);
    }
    return ready;
  }

  snapshot(): Map<string, EvidenceSeries> {
    const out = new Map<string, EvidenceSeries>();
    for (const [unitId, ring] of this.series) {
      out.set(unitId, { values: ring.map((r) => r.value), x: ring.map((r) => r.x) });
    }
    return out;
  }

  hydrate(data: Map<string, EvidenceSeries>): void {
    for (const [unitId, { values, x }] of data) {
      const ring: RingEntry[] = values.map((value, i) => ({
        value,
        x: x[i],
        cycleId: undefined,
        weightSum: 1,
      }));
      this.series.set(unitId, ring.slice(-EVIDENCE_SERIES_RING_CAP));
    }
  }
}

/** Construct a fresh, empty evidence aggregator. */
export function createEvidenceAggregator(): EvidenceAggregator {
  return new EvidenceAggregatorImpl();
}
