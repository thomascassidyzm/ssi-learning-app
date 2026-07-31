import { describe, it, expect } from 'vitest';
import {
  RatePolicyEngine,
  createRatePolicyEngine,
  DEFAULT_RATE_POLICY_BOUNDS,
  type RoundBoundaryInput,
} from './ratePolicy';
import type { LocalDifficulty, LocalDifficultyState } from './localDifficulty';
import { assessLocalDifficulty } from './localDifficulty';
import { makeLatencySeries } from './syntheticSeries';

const BASE_PAUSE = 1.0;
const basePause = () => BASE_PAUSE;

function read(
  unitId: string,
  state: LocalDifficultyState,
  unitKind: 'lego' | 'boundary' = 'lego'
): LocalDifficulty {
  return {
    unitId,
    unitKind,
    curvature: null,
    accelerationZ: state === 'struggling' ? 3 : state === 'easing' ? -3 : 0,
    flagged: state === 'struggling' || state === 'easing',
    state,
    samples: 10,
  };
}

function boundary(overrides: Partial<RoundBoundaryInput> = {}): RoundBoundaryInput {
  return {
    roundLegoId: 'S0100L01',
    roundLegoOrdinal: 500, // non-critical by default (course of 1000, cutoff 150)
    courseLegoCount: 1000,
    difficulty: [],
    unitOrdinals: {},
    manualOverrideActive: false,
    basePauseMultiplier: basePause,
    ...overrides,
  };
}

describe('RatePolicyEngine — bounds are structural, never breakable', () => {
  it('never exceeds buildCount/consolidateCount/spacedRepCap bounds under sustained struggle from all angles', () => {
    const engine = createRatePolicyEngine();
    for (let i = 0; i < 200; i++) {
      const plan = engine.planRound(
        boundary({
          roundLegoId: 'S0100L01',
          roundLegoOrdinal: 500,
          unitOrdinals: { S0100L01: 500, other: 600 },
          difficulty: [read('S0100L01', 'struggling'), read('other', 'struggling')],
        })
      );
      expect(plan.buildCount).toBeGreaterThanOrEqual(DEFAULT_RATE_POLICY_BOUNDS.buildCount.floor);
      expect(plan.buildCount).toBeLessThanOrEqual(DEFAULT_RATE_POLICY_BOUNDS.buildCount.ceiling);
      expect(plan.consolidateCount).toBeGreaterThanOrEqual(DEFAULT_RATE_POLICY_BOUNDS.consolidateCount.floor);
      expect(plan.consolidateCount).toBeLessThanOrEqual(DEFAULT_RATE_POLICY_BOUNDS.consolidateCount.ceiling);
      expect(plan.spacedRepCap).toBeGreaterThanOrEqual(DEFAULT_RATE_POLICY_BOUNDS.spacedRepCap.floor);
      expect(plan.spacedRepCap).toBeLessThanOrEqual(DEFAULT_RATE_POLICY_BOUNDS.spacedRepCap.ceiling);
    }
  });

  it('never exceeds pauseMultiplier bounds under sustained struggle', () => {
    const engine = createRatePolicyEngine();
    let plan;
    for (let i = 0; i < 200; i++) {
      plan = engine.planRound(
        boundary({
          unitOrdinals: { L1: 500 },
          difficulty: [read('L1', 'struggling')],
        })
      );
    }
    const p = plan!.pauseMultiplier('L1');
    expect(p).toBeLessThanOrEqual(DEFAULT_RATE_POLICY_BOUNDS.pauseMultiplier.ceiling);
    expect(p).toBeGreaterThanOrEqual(DEFAULT_RATE_POLICY_BOUNDS.pauseMultiplier.floor);
  });

  it('moves at most one lever-step per round boundary, even under sustained struggle', () => {
    const engine = createRatePolicyEngine();
    const input = () =>
      boundary({
        roundLegoId: 'other', // struggling unit is NOT the round's own lego -> defer path
        unitOrdinals: { other2: 600 },
        difficulty: [read('other2', 'struggling')],
      });

    let previous = engine.planRound(input()).buildCount;
    for (let i = 0; i < 10; i++) {
      const plan = engine.planRound(input());
      expect(previous - plan.buildCount).toBeLessThanOrEqual(DEFAULT_RATE_POLICY_BOUNDS.buildCount.step);
      previous = plan.buildCount;
    }
  });
});

describe('RatePolicyEngine — criticality guard (never defer a critical unit)', () => {
  it('holds buildCount/consolidateCount/spacedRepCap at scripted defaults when the struggling unit is critical', () => {
    const engine = createRatePolicyEngine();
    let plan;
    // ordinal 10 of 1000, cutoff = ceil(1000*0.15) = 150 -> critical
    for (let i = 0; i < 10; i++) {
      plan = engine.planRound(
        boundary({
          roundLegoId: 'S0001L01',
          roundLegoOrdinal: 10,
          unitOrdinals: { S0001L01: 10 },
          difficulty: [read('S0001L01', 'struggling')],
        })
      );
    }
    expect(plan!.buildCount).toBe(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
    expect(plan!.consolidateCount).toBe(DEFAULT_RATE_POLICY_BOUNDS.consolidateCount.scripted);
    expect(plan!.spacedRepCap).toBe(DEFAULT_RATE_POLICY_BOUNDS.spacedRepCap.scripted);
  });

  it('still nudges the pause multiplier for a critical struggling unit (drill = pause + existing N-1 review, no new machinery)', () => {
    const engine = createRatePolicyEngine();
    let plan;
    for (let i = 0; i < 6; i++) {
      plan = engine.planRound(
        boundary({
          roundLegoId: 'S0001L01',
          roundLegoOrdinal: 10,
          unitOrdinals: { S0001L01: 10 },
          difficulty: [read('S0001L01', 'struggling')],
        })
      );
    }
    expect(plan!.pauseMultiplier('S0001L01')).toBeGreaterThan(BASE_PAUSE);
  });

  it('a non-critical unit past the frontload cutoff DOES defer (contrast case)', () => {
    const engine = createRatePolicyEngine();
    let plan;
    // ordinal 200 of 1000, cutoff 150 -> non-critical
    for (let i = 0; i < 6; i++) {
      plan = engine.planRound(
        boundary({
          roundLegoId: 'other',
          roundLegoOrdinal: 900,
          unitOrdinals: { S0200L01: 200 },
          difficulty: [read('S0200L01', 'struggling')],
        })
      );
    }
    expect(plan!.buildCount).toBeLessThan(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
  });
});

describe('RatePolicyEngine — the consolidate/defer lean (structural, not just default numbers)', () => {
  it('own-LEGO struggle (non-critical): buildCount HOLDS full, consolidateCount rises, breather is scheduled', () => {
    const engine = createRatePolicyEngine();
    let plan;
    for (let i = 0; i < 6; i++) {
      plan = engine.planRound(
        boundary({
          roundLegoId: 'S0500L01',
          roundLegoOrdinal: 500,
          unitOrdinals: { S0500L01: 500 },
          difficulty: [read('S0500L01', 'struggling')],
        })
      );
    }
    expect(plan!.buildCount).toBe(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
    expect(plan!.consolidateCount).toBeGreaterThan(DEFAULT_RATE_POLICY_BOUNDS.consolidateCount.scripted);
    expect(plan!.insertBreather).toBe(true);
  });

  it('a different non-critical unit struggling defers: buildCount + spacedRepCap trim toward floor, consolidateCount rises', () => {
    const engine = createRatePolicyEngine();
    let plan;
    for (let i = 0; i < 6; i++) {
      plan = engine.planRound(
        boundary({
          roundLegoId: 'S0500L01', // the round's own new lego is fine
          roundLegoOrdinal: 500,
          unitOrdinals: { S0500L01: 500, S0300L02: 300 },
          difficulty: [read('S0300L02', 'struggling')], // an OLDER unit is the one struggling
        })
      );
    }
    expect(plan!.buildCount).toBeLessThan(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
    expect(plan!.spacedRepCap).toBeLessThan(DEFAULT_RATE_POLICY_BOUNDS.spacedRepCap.scripted);
    expect(plan!.consolidateCount).toBeGreaterThan(DEFAULT_RATE_POLICY_BOUNDS.consolidateCount.scripted);
  });

  it('no struggle signal ever RAISES buildCount or spacedRepCap above scripted default (no drill-by-increase path)', () => {
    const engine = createRatePolicyEngine();
    for (let i = 0; i < 50; i++) {
      const plan = engine.planRound(
        boundary({
          roundLegoId: 'S0500L01',
          roundLegoOrdinal: 500,
          unitOrdinals: { S0500L01: 500, other: 600 },
          difficulty: [read('S0500L01', 'struggling'), read('other', 'struggling')],
        })
      );
      expect(plan.buildCount).toBeLessThanOrEqual(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
      expect(plan.spacedRepCap).toBeLessThanOrEqual(DEFAULT_RATE_POLICY_BOUNDS.spacedRepCap.scripted);
    }
  });

  it('breather cadence: at most one insertBreather per breatherMinRoundGap rounds even under sustained own-lego struggle', () => {
    const engine = createRatePolicyEngine();
    let breathers = 0;
    const N = 30;
    for (let i = 0; i < N; i++) {
      const plan = engine.planRound(
        boundary({
          roundLegoId: 'S0500L01',
          roundLegoOrdinal: 500,
          unitOrdinals: { S0500L01: 500 },
          difficulty: [read('S0500L01', 'struggling')],
        })
      );
      if (plan.insertBreather) breathers++;
    }
    expect(breathers).toBeLessThanOrEqual(Math.ceil(N / DEFAULT_RATE_POLICY_BOUNDS.breatherMinRoundGap));
  });
});

describe('RatePolicyEngine — hysteresis (>= 2 consecutive confirming reads before any movement)', () => {
  it('a single struggling read does not move any lever', () => {
    const engine = createRatePolicyEngine();
    const plan = engine.planRound(
      boundary({
        roundLegoId: 'other',
        unitOrdinals: { L1: 600 },
        difficulty: [read('L1', 'struggling')],
      })
    );
    expect(plan.buildCount).toBe(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
    expect(plan.pauseMultiplier('L1')).toBe(BASE_PAUSE);
  });

  it('two consecutive struggling reads confirm and move the pause lever', () => {
    const engine = createRatePolicyEngine();
    engine.planRound(boundary({ roundLegoId: 'other', unitOrdinals: { L1: 600 }, difficulty: [read('L1', 'struggling')] }));
    const plan = engine.planRound(
      boundary({ roundLegoId: 'other', unitOrdinals: { L1: 600 }, difficulty: [read('L1', 'struggling')] })
    );
    expect(plan.pauseMultiplier('L1')).toBeGreaterThan(BASE_PAUSE);
  });

  it('a steady read in between resets the confirmation count (no movement)', () => {
    const engine = createRatePolicyEngine();
    engine.planRound(boundary({ roundLegoId: 'other', unitOrdinals: { L1: 600 }, difficulty: [read('L1', 'struggling')] }));
    engine.planRound(boundary({ roundLegoId: 'other', unitOrdinals: { L1: 600 }, difficulty: [read('L1', 'steady')] }));
    const plan = engine.planRound(
      boundary({ roundLegoId: 'other', unitOrdinals: { L1: 600 }, difficulty: [read('L1', 'struggling')] })
    );
    expect(plan.pauseMultiplier('L1')).toBe(BASE_PAUSE); // only one fresh consecutive read so far
  });

  it('manualOverrideActive doubles the confirmation requirement', () => {
    const engine = createRatePolicyEngine();
    // Two consecutive struggling reads would normally confirm; under manual override it should not yet.
    engine.planRound(
      boundary({ roundLegoId: 'other', unitOrdinals: { L1: 600 }, manualOverrideActive: true, difficulty: [read('L1', 'struggling')] })
    );
    const afterTwo = engine.planRound(
      boundary({ roundLegoId: 'other', unitOrdinals: { L1: 600 }, manualOverrideActive: true, difficulty: [read('L1', 'struggling')] })
    );
    expect(afterTwo.pauseMultiplier('L1')).toBe(BASE_PAUSE);

    engine.planRound(
      boundary({ roundLegoId: 'other', unitOrdinals: { L1: 600 }, manualOverrideActive: true, difficulty: [read('L1', 'struggling')] })
    );
    const afterFour = engine.planRound(
      boundary({ roundLegoId: 'other', unitOrdinals: { L1: 600 }, manualOverrideActive: true, difficulty: [read('L1', 'struggling')] })
    );
    expect(afterFour.pauseMultiplier('L1')).toBeGreaterThan(BASE_PAUSE);
  });
});

describe('RatePolicyEngine — decay to scripted defaults over quiet rounds (invisibility)', () => {
  it('a lever nudged by struggle decays back toward default once the unit reads steady', () => {
    const engine = createRatePolicyEngine();
    for (let i = 0; i < 4; i++) {
      engine.planRound(
        boundary({ roundLegoId: 'other2', unitOrdinals: { L1: 600 }, difficulty: [read('L1', 'struggling')] })
      );
    }
    const struggling = engine.planRound(
      boundary({ roundLegoId: 'other2', unitOrdinals: { L1: 600 }, difficulty: [read('L1', 'struggling')] })
    );
    const nudgedPause = struggling.pauseMultiplier('L1');
    expect(nudgedPause).toBeGreaterThan(BASE_PAUSE);

    let plan = struggling;
    for (let i = 0; i < 10; i++) {
      plan = engine.planRound(
        boundary({ roundLegoId: 'other2', unitOrdinals: { L1: 600 }, difficulty: [read('L1', 'steady')] })
      );
    }
    expect(plan.pauseMultiplier('L1')).toBeCloseTo(BASE_PAUSE, 5);
  });

  it('round-level buildCount decays back to scripted after the struggling signal stops', () => {
    const engine = createRatePolicyEngine();
    let plan;
    for (let i = 0; i < 6; i++) {
      plan = engine.planRound(
        boundary({ roundLegoId: 'x', unitOrdinals: { other: 600 }, difficulty: [read('other', 'struggling')] })
      );
    }
    expect(plan!.buildCount).toBeLessThan(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);

    for (let i = 0; i < 20; i++) {
      plan = engine.planRound(boundary({ roundLegoId: 'x', unitOrdinals: { other: 600 }, difficulty: [read('other', 'steady')] }));
    }
    expect(plan!.buildCount).toBe(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
  });
});

describe('RatePolicyEngine — golden scenario traces on syntheticSeries (real curvature + local-difficulty machinery)', () => {
  function seededRng(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  it('a real struggling latency series (non-critical, not the round own lego) drives the engine to defer', () => {
    const rng = seededRng(42);
    const series = makeLatencySeries('struggling', { rng, length: 16 });
    const engine = createRatePolicyEngine();

    let plan;
    // Replay the series growth prefix-by-prefix as if each were a round boundary's read.
    for (let n = 5; n <= series.length; n++) {
      const prefix = series.slice(0, n);
      const d = assessLocalDifficulty({ unitId: 'S0300L02', unitKind: 'lego', values: prefix });
      plan = engine.planRound(
        boundary({
          roundLegoId: 'S0500L01',
          roundLegoOrdinal: 500,
          unitOrdinals: { S0500L01: 500, S0300L02: 300 },
          difficulty: [d],
        })
      );
    }

    expect(plan!.buildCount).toBeLessThan(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
    expect(plan!.consolidateCount).toBeGreaterThan(DEFAULT_RATE_POLICY_BOUNDS.consolidateCount.scripted);
  });

  it('a real steady latency series never moves any lever', () => {
    const rng = seededRng(7);
    const series = makeLatencySeries('steady', { rng, length: 16 });
    const engine = createRatePolicyEngine();

    let plan;
    for (let n = 5; n <= series.length; n++) {
      const prefix = series.slice(0, n);
      const d = assessLocalDifficulty({ unitId: 'S0300L02', unitKind: 'lego', values: prefix });
      plan = engine.planRound(
        boundary({
          roundLegoId: 'S0500L01',
          roundLegoOrdinal: 500,
          unitOrdinals: { S0500L01: 500, S0300L02: 300 },
          difficulty: [d],
        })
      );
    }

    expect(plan!.buildCount).toBe(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
    expect(plan!.consolidateCount).toBe(DEFAULT_RATE_POLICY_BOUNDS.consolidateCount.scripted);
    expect(plan!.spacedRepCap).toBe(DEFAULT_RATE_POLICY_BOUNDS.spacedRepCap.scripted);
  });

  it('a real easing latency series settles the engine at scripted defaults (no deferral)', () => {
    const rng = seededRng(99);
    const series = makeLatencySeries('easing', { rng, length: 16 });
    const engine = createRatePolicyEngine();

    let plan;
    for (let n = 5; n <= series.length; n++) {
      const prefix = series.slice(0, n);
      const d = assessLocalDifficulty({ unitId: 'S0300L02', unitKind: 'lego', values: prefix });
      plan = engine.planRound(
        boundary({
          roundLegoId: 'S0500L01',
          roundLegoOrdinal: 500,
          unitOrdinals: { S0500L01: 500, S0300L02: 300 },
          difficulty: [d],
        })
      );
    }

    expect(plan!.buildCount).toBe(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
  });
});

describe('RatePolicyEngine — config is honoured', () => {
  it('a custom criticalFrontloadFraction shifts the cutoff', () => {
    const engine = new RatePolicyEngine({ criticalFrontloadFraction: 0.5 });
    let plan;
    // ordinal 400 of 1000: non-critical at 0.15 default, but critical at 0.5.
    for (let i = 0; i < 6; i++) {
      plan = engine.planRound(
        boundary({
          roundLegoId: 'x',
          unitOrdinals: { L1: 400 },
          difficulty: [read('L1', 'struggling')],
          courseLegoCount: 1000,
        })
      );
    }
    expect(plan!.buildCount).toBe(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
  });

  it('a custom bounds override is respected and stays clamped', () => {
    const engine = new RatePolicyEngine({ bounds: { buildCount: { floor: 5, ceiling: 6, scripted: 6, step: 1 } } });
    let plan;
    for (let i = 0; i < 20; i++) {
      plan = engine.planRound(
        boundary({
          roundLegoId: 'x',
          unitOrdinals: { other: 600 },
          difficulty: [read('other', 'struggling')],
        })
      );
    }
    expect(plan!.buildCount).toBeGreaterThanOrEqual(5);
    expect(plan!.buildCount).toBeLessThanOrEqual(6);
  });
});

describe('RatePolicyEngine — centrality criticality (founder ruling 2026-07-31, supersedes intro-order)', () => {
  it('a late-course HUB (high centrality percentile) resists deferral even though intro-order calls it peripheral', () => {
    const engine = createRatePolicyEngine();
    let plan;
    // ordinal 900/1000 → non-critical under the intro-order fallback; the
    // centrality read says hub (0.95 >= 1 - 0.15) → critical → its struggle
    // must never move the budget levers.
    for (let i = 0; i < 6; i++) {
      plan = engine.planRound(
        boundary({
          roundLegoId: 'x',
          unitOrdinals: { hub: 900 },
          unitCentralityPercentile: { hub: 0.95 },
          difficulty: [read('hub', 'struggling')],
        })
      );
    }
    expect(plan!.buildCount).toBe(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
    expect(plan!.spacedRepCap).toBe(DEFAULT_RATE_POLICY_BOUNDS.spacedRepCap.scripted);
    // The pause lever (the only "drill" a critical unit gets) still moved.
    expect(plan!.pauseMultiplier('hub')).toBeGreaterThan(BASE_PAUSE);
  });

  it('an early-ordinal LEAF (low centrality percentile) becomes deferrable — centrality overrides the frontload rule', () => {
    const engine = createRatePolicyEngine();
    let plan;
    // ordinal 10/1000 → critical under the old frontload rule; the centrality
    // read says leaf (0.1) → NOT critical → confirmed struggle defers.
    for (let i = 0; i < 6; i++) {
      plan = engine.planRound(
        boundary({
          roundLegoId: 'x',
          unitOrdinals: { leaf: 10 },
          unitCentralityPercentile: { leaf: 0.1 },
          difficulty: [read('leaf', 'struggling')],
        })
      );
    }
    expect(plan!.buildCount).toBeLessThan(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
  });

  it('a unit ABSENT from the centrality map falls back to intro-order criticality', () => {
    const engine = createRatePolicyEngine();
    let plan;
    // Map is present but does not cover "early" (ordinal 10/1000 → frontload-critical).
    for (let i = 0; i < 6; i++) {
      plan = engine.planRound(
        boundary({
          roundLegoId: 'x',
          unitOrdinals: { early: 10 },
          unitCentralityPercentile: { somethingElse: 0.5 },
          difficulty: [read('early', 'struggling')],
        })
      );
    }
    expect(plan!.buildCount).toBe(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
  });

  it('criticalCentralityFraction config is honoured', () => {
    const engine = createRatePolicyEngine({ criticalCentralityFraction: 0.5 });
    let plan;
    // percentile 0.6 >= 1 - 0.5 → critical under the widened fraction.
    for (let i = 0; i < 6; i++) {
      plan = engine.planRound(
        boundary({
          roundLegoId: 'x',
          unitOrdinals: { mid: 600 },
          unitCentralityPercentile: { mid: 0.6 },
          difficulty: [read('mid', 'struggling')],
        })
      );
    }
    expect(plan!.buildCount).toBe(DEFAULT_RATE_POLICY_BOUNDS.buildCount.scripted);
  });
});

describe('RatePolicyEngine — deferred-return trigger (neighbourhood easing; Fibonacci stays the mechanism)', () => {
  /** Confirm a defer of `deferred` (ordinal 500) over two boundaries. */
  function deferUnit(engine: RatePolicyEngine, ordinals: Record<string, number>) {
    for (let i = 0; i < 2; i++) {
      engine.planRound(
        boundary({
          roundLegoId: 'x',
          unitOrdinals: ordinals,
          difficulty: [read('deferred', 'struggling')],
        })
      );
    }
  }

  it('signals returnReady when a neighbour eases and none struggles — once, then stops watching', () => {
    const engine = createRatePolicyEngine();
    const ordinals = { deferred: 500, neighbour: 502 };
    deferUnit(engine, ordinals);
    const plan = engine.planRound(
      boundary({
        roundLegoId: 'x',
        unitOrdinals: ordinals,
        difficulty: [read('neighbour', 'easing')],
      })
    );
    expect(plan.returnReady).toEqual(['deferred']);
    // Signal fires once; the unit has left the watch.
    const next = engine.planRound(
      boundary({
        roundLegoId: 'x',
        unitOrdinals: ordinals,
        difficulty: [read('neighbour', 'easing')],
      })
    );
    expect(next.returnReady).toEqual([]);
  });

  it('a struggling neighbour vetoes the signal', () => {
    const engine = createRatePolicyEngine();
    const ordinals = { deferred: 500, n1: 502, n2: 499 };
    deferUnit(engine, ordinals);
    const plan = engine.planRound(
      boundary({
        roundLegoId: 'x',
        unitOrdinals: ordinals,
        difficulty: [read('n1', 'easing'), read('n2', 'struggling')],
      })
    );
    expect(plan.returnReady).toEqual([]);
  });

  it('units outside the neighbourhood window are not neighbours', () => {
    const engine = createRatePolicyEngine(); // window default 3
    const ordinals = { deferred: 500, far: 510 };
    deferUnit(engine, ordinals);
    const plan = engine.planRound(
      boundary({
        roundLegoId: 'x',
        unitOrdinals: ordinals,
        difficulty: [read('far', 'easing')],
      })
    );
    expect(plan.returnReady).toEqual([]);
  });

  it('a deferred unit easing by itself leaves the watch silently (the Fibonacci return already worked)', () => {
    const engine = createRatePolicyEngine();
    const ordinals = { deferred: 500, neighbour: 502 };
    deferUnit(engine, ordinals);
    engine.planRound(
      boundary({
        roundLegoId: 'x',
        unitOrdinals: ordinals,
        difficulty: [read('deferred', 'easing')],
      })
    );
    // Even with the neighbourhood now reading ready, no signal — it recovered.
    const plan = engine.planRound(
      boundary({
        roundLegoId: 'x',
        unitOrdinals: ordinals,
        difficulty: [read('neighbour', 'easing')],
      })
    );
    expect(plan.returnReady).toEqual([]);
  });

  it('returnReady is empty when nothing was ever deferred', () => {
    const engine = createRatePolicyEngine();
    const plan = engine.planRound(boundary({}));
    expect(plan.returnReady).toEqual([]);
  });
});
