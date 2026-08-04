/**
 * COLD-START PINNING TEST (diagnosis, 2026-08-04 — Aran's "too much skipping,
 * beginnings of courses too fast, not enough repetition").
 *
 * The question this file answers, and pins so it can never silently change:
 * at the START of a course the learner has NO mastery evidence at all. Does
 * the rate policy read that absence as "doing fine" and start culling
 * repetition — or does it hold at the scripted defaults?
 *
 * The answer these tests pin: ABSENCE OF EVIDENCE IS CONSERVATIVE. With an
 * empty `difficulty` array the engine moves no lever, so the plan it emits is
 * byte-for-byte the scripted script shape (buildCount 7 / consolidateCount 2 /
 * spacedRepCap 12 under the LIVE bounds), no breather, and a pause multiplier
 * identical to the mastery ladder's own value. Nothing is culled, nothing is
 * shortened.
 *
 * The bounds asserted here are the LIVE values read from Supabase
 * `algorithm_config.adaptation_v2` on 2026-08-04, which are identical to
 * `DEFAULT_RATE_POLICY_BOUNDS` — the test asserts against both so a drift in
 * either is caught.
 */

import { describe, it, expect } from 'vitest';
import {
  createRatePolicyEngine,
  DEFAULT_RATE_POLICY_BOUNDS,
  type RatePolicyBounds,
  type RoundBoundaryInput,
} from './ratePolicy';

/**
 * Verbatim `bounds` from the live Supabase row `algorithm_config` key =
 * 'adaptation_v2' (updated_at 2026-07-16T22:41:02Z, read 2026-08-04).
 */
const LIVE_BOUNDS: RatePolicyBounds = {
  buildCount: { step: 1, floor: 3, ceiling: 7, scripted: 7 },
  spacedRepCap: { step: 1, floor: 6, ceiling: 12, scripted: 12 },
  pauseMultiplier: { step: 0.05, floor: 0.7, ceiling: 1.4, scripted: 1.0 },
  consolidateCount: { step: 1, floor: 1, ceiling: 4, scripted: 2 },
  breatherMinRoundGap: 3,
};

/** The mastery ladder's cold-start rung — `MASTERY_MULTIPLIER.acquisition` in useAdaptationEngine.ts. */
const ACQUISITION_PAUSE_MULTIPLIER = 1.2;

/**
 * Round N of a fresh course: the learner's first LEGOs, and — the point of the
 * test — an EMPTY difficulty array, because `useAdaptationEngine.planRound`
 * only reads units with >= EVIDENCE_MIN_SAMPLES_FOR_DIFFICULTY (5) samples,
 * and on the opening rounds no unit has five yet.
 */
function coldStartBoundary(roundOrdinal: number): RoundBoundaryInput {
  return {
    roundLegoId: `S${String(roundOrdinal).padStart(4, '0')}L01`,
    roundLegoOrdinal: roundOrdinal,
    courseLegoCount: 400,
    difficulty: [], // ← no evidence exists yet
    unitOrdinals: { [`S${String(roundOrdinal).padStart(4, '0')}L01`]: roundOrdinal },
    manualOverrideActive: false,
    basePauseMultiplier: () => ACQUISITION_PAUSE_MULTIPLIER,
  };
}

describe('RatePolicyEngine — cold start (no evidence) is conservative', () => {
  it('emits the scripted script shape for rounds 1-5, culling nothing (LIVE bounds)', () => {
    const engine = createRatePolicyEngine({ bounds: LIVE_BOUNDS });

    for (let round = 1; round <= 5; round++) {
      const plan = engine.planRound(coldStartBoundary(round));

      // The three levers that CULL cycles sit at their scripted values, so
      // computeAdaptOmitCycleIds has nothing to omit from a scripted round.
      expect(plan.buildCount).toBe(LIVE_BOUNDS.buildCount.scripted); // 7
      expect(plan.consolidateCount).toBe(LIVE_BOUNDS.consolidateCount.scripted); // 2
      expect(plan.spacedRepCap).toBe(LIVE_BOUNDS.spacedRepCap.scripted); // 12

      // No round is rearranged and no unit is signalled for early return.
      expect(plan.insertBreather).toBe(false);
      expect(plan.returnReady).toEqual([]);
    }
  });

  it('leaves the pause multiplier exactly at the mastery ladder value at cold start', () => {
    const engine = createRatePolicyEngine({ bounds: LIVE_BOUNDS });

    for (let round = 1; round <= 5; round++) {
      const plan = engine.planRound(coldStartBoundary(round));
      // No nudge accumulates without evidence, and the ladder's cold-start
      // rung (1.2) sits inside [floor 0.7, ceiling 1.4] so the clamp is a
      // no-op — pauses at the start of a course are NOT shortened by v2.
      expect(plan.pauseMultiplier(`S${String(round).padStart(4, '0')}L01`)).toBe(
        ACQUISITION_PAUSE_MULTIPLIER
      );
    }
  });

  it('holds the scripted shape for 50 consecutive evidence-free rounds', () => {
    // Guards against a slow drift/decay bug: "no evidence" must be a fixed
    // point of the engine, not a direction of travel.
    const engine = createRatePolicyEngine({ bounds: LIVE_BOUNDS });
    for (let round = 1; round <= 50; round++) {
      const plan = engine.planRound(coldStartBoundary(round));
      expect([plan.buildCount, plan.consolidateCount, plan.spacedRepCap]).toEqual([7, 2, 12]);
      expect(plan.pauseMultiplier('S0001L01')).toBe(ACQUISITION_PAUSE_MULTIPLIER);
    }
  });

  it('the live bounds are identical to the code defaults (drift canary)', () => {
    expect(LIVE_BOUNDS).toEqual(DEFAULT_RATE_POLICY_BOUNDS);
  });

  it('an "easing" read cannot shorten a pause on its first appearance (hysteresis holds)', () => {
    // The nearest cold-start hazard: a learner who answers fast on their very
    // first reads. `hysteresisReads` = 2 means one easing read moves nothing;
    // the shortening only starts on the SECOND consecutive confirming read,
    // and then only by one 0.05 step.
    const engine = createRatePolicyEngine({ bounds: LIVE_BOUNDS });
    const easing = {
      unitId: 'S0001L01',
      unitKind: 'lego' as const,
      curvature: null,
      accelerationZ: -3,
      flagged: true,
      state: 'easing' as const,
      samples: 5,
    };
    const input = { ...coldStartBoundary(1), difficulty: [easing] };

    const first = engine.planRound(input);
    expect(first.pauseMultiplier('S0001L01')).toBe(ACQUISITION_PAUSE_MULTIPLIER);

    const second = engine.planRound(input);
    expect(second.pauseMultiplier('S0001L01')).toBeCloseTo(ACQUISITION_PAUSE_MULTIPLIER - 0.05, 10);

    // And an easing signal NEVER touches the cycle-count levers — only pause.
    expect([second.buildCount, second.consolidateCount, second.spacedRepCap]).toEqual([7, 2, 12]);
  });
});
