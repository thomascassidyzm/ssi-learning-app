/**
 * Synthetic difficulty series — the CANONICAL, tested calibration of the demo
 * learning-curve shapes.
 *
 * The demo-data suite (`scripts/demo-data/generate-demo-suite.cjs`) needs to
 * populate `learner_lego_metrics.recent_latency_samples` with normalized-latency
 * series (ms/char, oldest→newest) that classify correctly through the REAL
 * local-difficulty sensor (`assessLocalDifficulty`, B4 over the curvature engine
 * B1). Those shapes used to live as magic numbers inside the generator, guarded
 * only by an offline one-shot. They live here now so a regression test
 * (`syntheticSeries.test.ts`) can lock them against the sensor's DEFAULT options
 * — the same no-options call the Insight resolver
 * (`player-vue/src/insight/data/difficultyTurns.ts`) makes in production.
 *
 * WHY THESE SHAPES CLASSIFY (against the sensor's default window 7 / minSamples 5
 * / noiseWindow 10 / threshold 2σ):
 *
 *  - The sensor reads the SECOND derivative (acceleration) at the trailing edge,
 *    expressed as a z-score against the unit's OWN recent acceleration noise. A
 *    flag fires when |z| ≥ 2 — i.e. a turn that stands out against the learner's
 *    own quiet background, not against any absolute cutoff.
 *
 *  - struggling / easing: a long QUIET stretch (flat baseline + tiny drift +
 *    small jitter) builds a low-variance acceleration baseline, then the trailing
 *    4 samples form an *accelerating break* — gaps that grow ([0.5, 1.3, 2.4, 4.0]
 *    up for struggling, [0.5, 1.4, 2.6, 4.2] down for easing). Growing gaps =
 *    large positive/negative acceleration → a multi-σ excursion against the quiet
 *    baseline → flagged, with the sign of acceleration choosing struggling (up) vs
 *    easing (down).
 *
 *  - steady: a flat line with a tiny baseline-free slope (±0.05/sample) and modest
 *    noise (±0.25). Differentiating twice removes both the level and the steady
 *    slope by construction, so acceleration reads ~0 with low variance → never a
 *    multi-σ excursion → never flags → 'steady'. (A small fraction (~5–11%,
 *    measured across seed bases) flags on its own noise — a flat line has
 *    near-zero acceleration-noise, so the z-score denominator is tiny and a single
 *    bump can cross 2σ. The regression test floors steady at ≥85%, not 100%.)
 *
 * PURE & DETERMINISTIC given the injected rng. Callers (the generator, the test)
 * supply their own PRNG so per-student / per-seed reproducibility is preserved.
 */

export type SyntheticSeriesKind = 'struggling' | 'easing' | 'steady';

export interface MakeLatencySeriesOptions {
  /**
   * Uniform random source in [0, 1). Inject a seeded PRNG for reproducibility;
   * defaults to Math.random.
   */
  rng?: () => number;
  /**
   * Total series length (samples, oldest→newest). Clamped to a minimum of 8 (the
   * floor the consuming RPC requires and enough to clear the curvature gate plus
   * leave a 4-sample break). Default: a random 12–16 drawn from `rng`.
   */
  length?: number;
}

/** ms/char jitter applied across the quiet stretch. */
const QUIET_NOISE = 0.2;
/** Accelerating climb at the trailing edge (struggling): gaps grow each step. */
const BREAK_STEPS_UP = [0.5, 1.3, 2.4, 4.0];
/** Accelerating fall at the trailing edge (easing): gaps grow each step. */
const BREAK_STEPS_DOWN = [0.5, 1.4, 2.6, 4.2];
/** Samples at the trailing edge that form the "turn" for struggling/easing. */
const BREAK_LEN = 4;
/** Hard floor on length (RPC min + room for the break). */
const MIN_LENGTH = 8;

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Build a normalized-latency (ms/char) series, oldest→newest, whose shape trips
 * the local-difficulty sensor into the requested `kind` under DEFAULT options.
 *
 * @param kind     'struggling' | 'easing' | 'steady'
 * @param opts     optional injected `rng` and `length`
 * @returns        the series (numbers rounded to 2dp)
 */
export function makeLatencySeries(
  kind: SyntheticSeriesKind,
  opts: MakeLatencySeriesOptions = {}
): number[] {
  const rng = opts.rng ?? Math.random;
  const noiseAmt = (scale: number): number => (rng() * 2 - 1) * scale;

  // Length: explicit (clamped) or a random 12–16. Drawing 12–16 keeps the
  // generator's prior distribution; the rng draw also preserves its PRNG cadence.
  const n =
    opts.length != null
      ? Math.max(MIN_LENGTH, Math.floor(opts.length))
      : 12 + Math.floor(rng() * 5); // 12..16

  const out: number[] = [];

  if (kind === 'struggling') {
    const quiet = n - BREAK_LEN;
    const base = 7 + rng() * 5; // 7–12 ms/char baseline
    for (let i = 0; i < quiet; i++) {
      out.push(round2(base + 0.02 * i + noiseAmt(QUIET_NOISE)));
    }
    const b0 = base + 0.02 * quiet;
    for (const s of BREAK_STEPS_UP) out.push(round2(b0 + s + noiseAmt(0.15)));
  } else if (kind === 'easing') {
    const quiet = n - BREAK_LEN;
    const base = 14 + rng() * 5; // 14–19 ms/char baseline (was slow, now resolving)
    for (let i = 0; i < quiet; i++) {
      out.push(round2(base - 0.02 * i + noiseAmt(QUIET_NOISE)));
    }
    const b0 = base - 0.02 * quiet;
    for (const s of BREAK_STEPS_DOWN) out.push(round2(b0 - s + noiseAmt(0.15)));
  } else {
    // steady
    const base = 8 + rng() * 8; // 8–16 ms/char baseline
    const slope = (rng() * 2 - 1) * 0.05; // gentle, baseline-free slope
    for (let i = 0; i < n; i++) {
      out.push(round2(base + slope * i + noiseAmt(0.25)));
    }
  }

  return out;
}
