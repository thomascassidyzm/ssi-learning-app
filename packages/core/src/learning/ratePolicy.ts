/**
 * The rate policy — consolidate / defer / drill over the session budget
 * (adaptation v2, workstream C — WP-2).
 *
 * This is the pedagogical core: the controller that spends a session's finite
 * practice budget across three moves (`docs/adaptation/adaptation-v2-build-spec.md`
 * §4; `packages/player-vue/public/docs/metrics-vision.html` §03, the design
 * authority — wins on conflict):
 *
 *   - CONSOLIDATE — reinforce what the learner is already good at.
 *   - DEFER       — reduce a hard item now; let it rest until the surrounding
 *                    map is richer, and let the existing Fibonacci spaced-rep
 *                    schedule be the return trigger (no new scheduling
 *                    machinery — reuse, don't build).
 *   - DRILL       — reserved for the structurally critical few. "Drill" here
 *                    is never a bespoke repetition loop; it is: hold phrase
 *                    counts at scripted values and let pause + the existing
 *                    N-1 spaced-rep multiplier (3x) do the work.
 *
 * BINDING PEDAGOGY (owner decision, do not invert): the default lean is
 * consolidate + defer. Drill is reserved for the structurally critical few —
 * never for units that are merely corpus-frequent. A struggling non-critical
 * unit gets DEFERRED while its surrounding map thickens, never ground harder
 * in isolation. This is enforced structurally below (§ "structural
 * enforcement"), not just by the default numbers — see that section for how
 * a caller cannot accidentally invert the lean even by misconfiguring bounds.
 *
 * CRITICALITY (founder ruling 2026-07-31, supersedes criticality =
 * introduction order — see `centrality.ts` and docs/DECISIONS.md): a unit is
 * critical when it is a HUB in the distinction network — high forward-reuse
 * centrality, i.e. many subsequent phrases / M-LEGO compositions contain it,
 * so struggling on it blocks the path forward. The caller supplies the
 * per-unit centrality percentile via `unitCentralityPercentile` (computed
 * offline by `computeLegoCentrality`); a unit in the top
 * `criticalCentralityFraction` resists deferral. When no centrality read is
 * available for a unit, the old introduction-order frontload rule is the
 * fallback — intro-order is the degenerate case of forward reuse (early
 * LEGOs have the whole course ahead of them), so absent data degrades to the
 * previous behaviour, never to "nothing is critical".
 *
 * DEFERRED RETURN (same ruling's companion): deferral's return trigger stays
 * the existing Fibonacci spaced-rep schedule (reuse, don't build), but the
 * policy now additionally SIGNALS when a deferred unit's neighbourhood reads
 * ready — neighbouring units (by introduction ordinal, within
 * `neighbourhoodWindow`) easing and none struggling means the surrounding map
 * has thickened, the measured version of "the island is known". That signal
 * is `RoundPlan.returnReady`: advisory, shadow-logged, applied by no one yet.
 *
 * Every lever moves at most one step per round boundary, only after the B4
 * local-difficulty signal has persisted across >= `hysteresisReads`
 * consecutive round boundaries, and decays back to scripted defaults over
 * `decayRounds` of quiet (owner decision D — invisibility, no discontinuity
 * a learner could feel). `manualOverrideActive` (the learner exercising the
 * belt/pace dial) widens the confirmation requirement, per the design
 * authority's Principle 1 — the engine yields to the learner's own judgement.
 *
 * Pure, no Vue/Supabase/player coupling. Consumes `LocalDifficulty` reads
 * (B4, `localDifficulty.ts`) and introduction-order criticality; produces one
 * `RoundPlan` per round boundary. WP-3 (player wiring) is the only consumer
 * that applies a `RoundPlan` — this module decides, never applies.
 */

import type { LocalDifficulty } from './localDifficulty';

// ---------------------------------------------------------------------------
// Bounds & config (§4.6 of the build spec — hard safety rails)
// ---------------------------------------------------------------------------

/** One integer-valued lever's floor/ceiling/scripted-default/per-boundary step. */
export interface LeverBounds {
  floor: number;
  ceiling: number;
  scripted: number;
  step: number;
}

export interface RatePolicyBounds {
  /** BUILD phrases played this round (of the <=7 in the script). */
  buildCount: LeverBounds;
  /** CONSOLIDATE/USE phrases played this round (of the scripted 2, +injected repeats). */
  consolidateCount: LeverBounds;
  /** Spaced-rep review cap for this round (of the scripted <=12). */
  spacedRepCap: LeverBounds;
  /** Pause multiplier floor/ceiling/step; `scripted` is unused (base comes from the mastery ladder). */
  pauseMultiplier: LeverBounds;
  /** Minimum rounds between breather insertions ("at most 1 per 3 rounds"). */
  breatherMinRoundGap: number;
}

/** §4.6 PROPOSED values, verbatim from the build spec. All Tom-tunable via `algorithm_config.adaptation_v2.bounds`. */
export const DEFAULT_RATE_POLICY_BOUNDS: RatePolicyBounds = {
  buildCount: { floor: 3, ceiling: 7, scripted: 7, step: 1 },
  consolidateCount: { floor: 1, ceiling: 4, scripted: 2, step: 1 },
  spacedRepCap: { floor: 6, ceiling: 12, scripted: 12, step: 1 },
  pauseMultiplier: { floor: 0.7, ceiling: 1.4, scripted: 1.0, step: 0.05 },
  breatherMinRoundGap: 3,
};

export interface RatePolicyConfig {
  bounds: RatePolicyBounds;
  /** Earliest fraction of course LEGO ordinals that "resist deferral" — the FALLBACK criticality when a unit has no centrality read. PROPOSED 0.15. */
  criticalFrontloadFraction: number;
  /** Top fraction of the course by forward-reuse centrality percentile that "resists deferral" (founder ruling 2026-07-31). Default 0.15, mirroring the frontload fraction. */
  criticalCentralityFraction: number;
  /** Ordinal half-width of a deferred unit's neighbourhood for the return-ready signal. Default 3. */
  neighbourhoodWindow: number;
  /** Consecutive confirming round-boundary reads required before a lever moves (§4.5). Default 2. */
  hysteresisReads: number;
  /** Rounds of quiet (no confirming signal) for a one-step nudge to fully decay to default (§4.5). Default 5. */
  decayRounds: number;
  /** Multiplier applied to `hysteresisReads` while `manualOverrideActive` (§3 "widens the dead-zone x2"). Default 2. */
  manualOverrideDeadZoneMultiplier: number;
}

export const DEFAULT_RATE_POLICY_CONFIG: RatePolicyConfig = {
  bounds: DEFAULT_RATE_POLICY_BOUNDS,
  criticalFrontloadFraction: 0.15,
  criticalCentralityFraction: 0.15,
  neighbourhoodWindow: 3,
  hysteresisReads: 2,
  decayRounds: 5,
  manualOverrideDeadZoneMultiplier: 2,
};

function mergeBounds(partial?: Partial<RatePolicyBounds>): RatePolicyBounds {
  if (!partial) return DEFAULT_RATE_POLICY_BOUNDS;
  return {
    buildCount: { ...DEFAULT_RATE_POLICY_BOUNDS.buildCount, ...partial.buildCount },
    consolidateCount: { ...DEFAULT_RATE_POLICY_BOUNDS.consolidateCount, ...partial.consolidateCount },
    spacedRepCap: { ...DEFAULT_RATE_POLICY_BOUNDS.spacedRepCap, ...partial.spacedRepCap },
    pauseMultiplier: { ...DEFAULT_RATE_POLICY_BOUNDS.pauseMultiplier, ...partial.pauseMultiplier },
    breatherMinRoundGap: partial.breatherMinRoundGap ?? DEFAULT_RATE_POLICY_BOUNDS.breatherMinRoundGap,
  };
}

function clamp(value: number, floor: number, ceiling: number): number {
  return Math.min(ceiling, Math.max(floor, value));
}

// ---------------------------------------------------------------------------
// Output — the lever surface (§4.2)
// ---------------------------------------------------------------------------

export interface RoundPlan {
  /** BUILD phrases to actually play this round (of the <=7 in the script). */
  buildCount: number;
  /** CONSOLIDATE/USE phrases to play (of the scripted 2, +injected repeats). */
  consolidateCount: number;
  /** Spaced-rep review cap for this round (of the scripted <=12). */
  spacedRepCap: number;
  /** Insert a consolidation-only breather round BEFORE the next debut? (§4.4) */
  insertBreather: boolean;
  /**
   * Deferred units whose neighbourhood reads ready this boundary (neighbours
   * easing, none struggling) — the measured early-return signal. ADVISORY:
   * the Fibonacci spaced-rep schedule remains the actual return mechanism;
   * this is shadow-logged so the signal's usefulness can be judged before
   * anything consumes it.
   */
  returnReady: string[];
  /** Per-LEGO pause multipliers (existing ladder, now curvature-nudged). */
  pauseMultiplier: (legoId: string) => number;
}

// ---------------------------------------------------------------------------
// Input — one round boundary (§4.1)
// ---------------------------------------------------------------------------

export interface RoundBoundaryInput {
  /** LEGO id of the round about to play (the round's own, possibly-new, LEGO). */
  roundLegoId: string;
  /** 1-based introduction ordinal of `roundLegoId` in the course walk (criticality guard, §04 of the paper). */
  roundLegoOrdinal: number;
  /** Total LEGOs in the course — the criticality-fraction denominator. */
  courseLegoCount: number;
  /** This boundary's local-difficulty reads (B4), one per unit with enough evidence to read. */
  difficulty: LocalDifficulty[];
  /** Introduction ordinal per unit id (LEGO ordinal; a boundary unit inherits its own LEGO's ordinal). */
  unitOrdinals: Record<string, number>;
  /**
   * Forward-reuse centrality percentile per unit id (0..1, 1 = biggest hub),
   * from `computeLegoCentrality`. PRIMARY criticality signal (founder ruling
   * 2026-07-31); a unit absent from the map — or the map absent entirely —
   * falls back to the introduction-order frontload rule.
   */
  unitCentralityPercentile?: Record<string, number>;
  /** True once the learner has exercised a manual dial (belt_skip/mode_toggle) this session (§3). */
  manualOverrideActive: boolean;
  /**
   * The existing mastery-ladder pause multiplier per LEGO (1.2/1.0/0.85/0.7 —
   * `MasteryStateMachine`), BEFORE the curvature nudge this policy adds. The
   * policy never re-derives mastery state; it only nudges what the ladder says.
   */
  basePauseMultiplier: (legoId: string) => number;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

interface UnitLeverState {
  consecutiveStruggling: number;
  consecutiveEasing: number;
  /** Accumulated pause nudge for this unit, added to the ladder's base value. */
  pauseNudge: number;
}

/**
 * Stateful per-session engine. One instance per learner session (mirrors
 * `createEvidenceAggregator`/`EvidenceAggregator` and `MasteryStateMachine` —
 * the existing stateful-engine-over-pure-primitives pattern in this module).
 * `planRound` is the only mutating entry point; it advances internal
 * hysteresis/decay state by exactly one round boundary and returns the plan
 * for the round about to play.
 */
export class RatePolicyEngine {
  private readonly config: RatePolicyConfig;
  private readonly units = new Map<string, UnitLeverState>();

  /**
   * Units deferred by the budget decision (non-critical, confirmed
   * struggling, not the round's own LEGO) and not yet signalled as
   * return-ready — the population the neighbourhood return trigger watches.
   */
  private readonly deferredUnits = new Set<string>();

  /** Round-level lever offsets from scripted defaults, in step units (fractional while decaying). */
  private buildOffset = 0;
  private consolidateOffset = 0;
  private spacedRepOffset = 0;
  private roundsSinceBreather = Infinity; // never gated on session start

  constructor(config: Partial<RatePolicyConfig> = {}) {
    this.config = {
      bounds: mergeBounds(config.bounds),
      criticalFrontloadFraction: config.criticalFrontloadFraction ?? DEFAULT_RATE_POLICY_CONFIG.criticalFrontloadFraction,
      criticalCentralityFraction:
        config.criticalCentralityFraction ?? DEFAULT_RATE_POLICY_CONFIG.criticalCentralityFraction,
      neighbourhoodWindow: config.neighbourhoodWindow ?? DEFAULT_RATE_POLICY_CONFIG.neighbourhoodWindow,
      hysteresisReads: config.hysteresisReads ?? DEFAULT_RATE_POLICY_CONFIG.hysteresisReads,
      decayRounds: Math.max(1, config.decayRounds ?? DEFAULT_RATE_POLICY_CONFIG.decayRounds),
      manualOverrideDeadZoneMultiplier:
        config.manualOverrideDeadZoneMultiplier ?? DEFAULT_RATE_POLICY_CONFIG.manualOverrideDeadZoneMultiplier,
    };
  }

  private unitState(unitId: string): UnitLeverState {
    let s = this.units.get(unitId);
    if (!s) {
      s = { consecutiveStruggling: 0, consecutiveEasing: 0, pauseNudge: 0 };
      this.units.set(unitId, s);
    }
    return s;
  }

  private isCritical(unitId: string, input: RoundBoundaryInput): boolean {
    // PRIMARY: forward-reuse centrality — is this unit a hub that blocks the
    // path forward? (Founder ruling 2026-07-31, supersedes intro-order.)
    const centrality = input.unitCentralityPercentile?.[unitId];
    if (centrality !== undefined) {
      return centrality >= 1 - this.config.criticalCentralityFraction;
    }
    // FALLBACK: introduction-order frontload — the degenerate case of forward
    // reuse; keeps behaviour identical for callers with no centrality map.
    const ordinal = input.unitOrdinals[unitId];
    if (ordinal === undefined) return false; // unknown unit never resists deferral by accident
    const cutoff = Math.ceil(input.courseLegoCount * this.config.criticalFrontloadFraction);
    return ordinal <= cutoff;
  }

  /** Decay one lever offset a `step`-fraction of the way back to 0, never overshooting past 0. */
  private static decayOffset(offset: number, step: number, decayRounds: number): number {
    if (offset === 0) return 0;
    const decayAmount = step / decayRounds;
    if (offset > 0) return Math.max(0, offset - decayAmount);
    return Math.min(0, offset + decayAmount);
  }

  planRound(input: RoundBoundaryInput): RoundPlan {
    const { bounds } = this.config;
    const requiredReads = input.manualOverrideActive
      ? this.config.hysteresisReads * this.config.manualOverrideDeadZoneMultiplier
      : this.config.hysteresisReads;

    let ownLegoConfirmedStruggling = false;
    let otherNonCriticalConfirmedStruggling = false;

    // --- Per-unit hysteresis + pause nudge (unit-level axis, independent of the round budget). ---
    for (const read of input.difficulty) {
      const u = this.unitState(read.unitId);

      if (read.state === 'struggling') {
        u.consecutiveStruggling++;
        u.consecutiveEasing = 0;
      } else if (read.state === 'easing') {
        u.consecutiveEasing++;
        u.consecutiveStruggling = 0;
      } else {
        // steady / warming_up: the B1/B4 own-noise dead-zone already gated this
        // read to "no turn worth attention" — reset the confirmation trend.
        u.consecutiveStruggling = 0;
        u.consecutiveEasing = 0;
      }

      let unitMovedStruggling = false;
      let unitMovedEasing = false;

      if (u.consecutiveStruggling >= requiredReads) {
        u.pauseNudge = u.pauseNudge + bounds.pauseMultiplier.step;
        u.consecutiveStruggling = 0; // re-arm: needs a fresh confirmation run before moving again
        unitMovedStruggling = true;
      } else if (u.consecutiveEasing >= requiredReads) {
        u.pauseNudge = u.pauseNudge - bounds.pauseMultiplier.step;
        u.consecutiveEasing = 0;
        unitMovedEasing = true;
      } else if (read.state === 'steady') {
        // Resting state is "do nothing" — decay any standing nudge back to 0.
        u.pauseNudge = RatePolicyEngine.decayOffset(u.pauseNudge, bounds.pauseMultiplier.step, this.config.decayRounds);
      }

      // Clamp the raw nudge so a pathologically long struggle can't accumulate
      // an unbounded value that only gets clamped cosmetically at read time —
      // the offset itself respects the lever's travel.
      const maxTravel = bounds.pauseMultiplier.ceiling - bounds.pauseMultiplier.floor;
      u.pauseNudge = clamp(u.pauseNudge, -maxTravel, maxTravel);

      if (unitMovedStruggling || unitMovedEasing) {
        const isCritical = this.isCritical(read.unitId, input);
        const isOwnLego = read.unitId === input.roundLegoId && read.unitKind === 'lego';

        // STRUCTURAL ENFORCEMENT of the binding pedagogy (do not invert):
        // a critical unit's struggle NEVER reaches the round-budget decision
        // below — it can only nudge its own pause multiplier, above. There is
        // no code path from "critical + struggling" to buildCount/
        // consolidateCount/spacedRepCap movement, by construction, so a
        // misconfigured bound cannot accidentally drill a critical unit via
        // the budget levers; "drill" for a critical unit is *only* ever the
        // existing pause + N-1 spaced-rep multiplier, unchanged.
        if (unitMovedStruggling && !isCritical) {
          if (isOwnLego) {
            ownLegoConfirmedStruggling = true;
          } else {
            otherNonCriticalConfirmedStruggling = true;
            // This unit is the one being deferred — start watching its
            // neighbourhood for the measured return signal below.
            this.deferredUnits.add(read.unitId);
          }
        }
      }
    }

    // --- Round-level budget decision (§4.3). ---
    // STRUCTURAL ENFORCEMENT continued: the two branches below are the ONLY
    // way buildCount/spacedRepCap ever move, and both directions lean
    // consolidate+defer, never drill —
    //   - own-LEGO struggling (non-critical): buildCount HOLDS (never drops
    //     below scripted; new material is never starved of its own practice),
    //     consolidateCount RISES, a breather is scheduled before the *next*
    //     debut (slows the wholesale rate, never grinds the current item).
    //   - some OTHER non-critical unit struggling: buildCount and
    //     spacedRepCap DEFER (trim toward floor — less new-material load,
    //     lighter review load), freeing budget into consolidateCount.
    // There is no branch that raises buildCount/spacedRepCap on a struggle
    // signal — the lean toward drill (increase) simply has no code path here;
    // the only thing that can raise buildCount back up is decay-to-default
    // during quiet rounds, never a struggle event.
    let buildMoved = false;
    let consolidateMoved = false;
    let spacedRepMoved = false;
    let wantBreather = false;

    if (ownLegoConfirmedStruggling) {
      this.consolidateOffset += bounds.consolidateCount.step;
      consolidateMoved = true;
      wantBreather = true;
    } else if (otherNonCriticalConfirmedStruggling) {
      this.buildOffset -= bounds.buildCount.step;
      this.spacedRepOffset -= bounds.spacedRepCap.step;
      this.consolidateOffset += bounds.consolidateCount.step;
      buildMoved = true;
      spacedRepMoved = true;
      consolidateMoved = true;
    }

    if (!buildMoved) {
      this.buildOffset = RatePolicyEngine.decayOffset(this.buildOffset, bounds.buildCount.step, this.config.decayRounds);
    }
    if (!consolidateMoved) {
      this.consolidateOffset = RatePolicyEngine.decayOffset(
        this.consolidateOffset,
        bounds.consolidateCount.step,
        this.config.decayRounds
      );
    }
    if (!spacedRepMoved) {
      this.spacedRepOffset = RatePolicyEngine.decayOffset(
        this.spacedRepOffset,
        bounds.spacedRepCap.step,
        this.config.decayRounds
      );
    }

    // Clamp offsets to each lever's own travel — belt-and-braces alongside the
    // final clamp below (§6.3 "bounds enforcement is structural").
    this.buildOffset = clamp(this.buildOffset, bounds.buildCount.floor - bounds.buildCount.scripted, bounds.buildCount.ceiling - bounds.buildCount.scripted);
    this.consolidateOffset = clamp(
      this.consolidateOffset,
      bounds.consolidateCount.floor - bounds.consolidateCount.scripted,
      bounds.consolidateCount.ceiling - bounds.consolidateCount.scripted
    );
    this.spacedRepOffset = clamp(this.spacedRepOffset, bounds.spacedRepCap.floor - bounds.spacedRepCap.scripted, bounds.spacedRepCap.ceiling - bounds.spacedRepCap.scripted);

    // --- Deferred-return trigger (founder ruling 2026-07-31 companion). ---
    // A deferred unit reads return-ready when its neighbourhood (units within
    // `neighbourhoodWindow` introduction ordinals, read this boundary) shows
    // the surrounding map thickening: at least one neighbour easing and none
    // struggling. A deferred unit that reads easing ITSELF simply leaves the
    // watch — the Fibonacci schedule (still the actual return mechanism)
    // already brought it back and it recovered; no signal needed.
    const returnReady: string[] = [];
    if (this.deferredUnits.size > 0) {
      const stateByUnit = new Map(input.difficulty.map((d) => [d.unitId, d.state]));
      for (const deferredId of [...this.deferredUnits]) {
        if (stateByUnit.get(deferredId) === 'easing') {
          this.deferredUnits.delete(deferredId);
          continue;
        }
        const deferredOrdinal = input.unitOrdinals[deferredId];
        if (deferredOrdinal === undefined) continue; // no ordinal → no measurable neighbourhood
        let neighbourEasing = false;
        let neighbourStruggling = false;
        for (const [unitId, state] of stateByUnit) {
          if (unitId === deferredId) continue;
          const ordinal = input.unitOrdinals[unitId];
          if (ordinal === undefined) continue;
          if (Math.abs(ordinal - deferredOrdinal) > this.config.neighbourhoodWindow) continue;
          if (state === 'easing') neighbourEasing = true;
          else if (state === 'struggling') neighbourStruggling = true;
        }
        if (neighbourEasing && !neighbourStruggling) {
          returnReady.push(deferredId);
          this.deferredUnits.delete(deferredId);
        }
      }
    }

    // --- Breather cadence (§4.4: at most 1 per breatherMinRoundGap rounds). ---
    this.roundsSinceBreather += 1; // Infinity + 1 === Infinity, so the first boundary is always eligible.
    let insertBreather = false;
    if (wantBreather && this.roundsSinceBreather >= bounds.breatherMinRoundGap) {
      insertBreather = true;
      this.roundsSinceBreather = 0;
    }

    const buildCount = clamp(
      Math.round(bounds.buildCount.scripted + this.buildOffset),
      bounds.buildCount.floor,
      bounds.buildCount.ceiling
    );
    const consolidateCount = clamp(
      Math.round(bounds.consolidateCount.scripted + this.consolidateOffset),
      bounds.consolidateCount.floor,
      bounds.consolidateCount.ceiling
    );
    const spacedRepCap = clamp(
      Math.round(bounds.spacedRepCap.scripted + this.spacedRepOffset),
      bounds.spacedRepCap.floor,
      bounds.spacedRepCap.ceiling
    );

    const units = this.units;
    const pauseFloor = bounds.pauseMultiplier.floor;
    const pauseCeiling = bounds.pauseMultiplier.ceiling;
    const pauseMultiplier = (legoId: string): number => {
      const base = input.basePauseMultiplier(legoId);
      const nudge = units.get(legoId)?.pauseNudge ?? 0;
      return clamp(base + nudge, pauseFloor, pauseCeiling);
    };

    return { buildCount, consolidateCount, spacedRepCap, insertBreather, returnReady, pauseMultiplier };
  }
}

/** Construct a fresh rate-policy engine for one learner session. */
export function createRatePolicyEngine(config: Partial<RatePolicyConfig> = {}): RatePolicyEngine {
  return new RatePolicyEngine(config);
}
