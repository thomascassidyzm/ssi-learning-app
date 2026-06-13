/**
 * Curvature engine — read the trend's turn, not its level.
 *
 * Implements Principle 3 of the metrics architecture (`docs/methodology/
 * metrics-architecture.md` §3, §4): the information in a learner signal lives
 * in its *rate of change of the rate of change* — the second derivative — not
 * in its absolute value. Differentiating twice removes, by construction, both
 * the constant (the level) and the steady slope (a learner improving at an even
 * pace), leaving only the *inflection* — the moment the trend itself turns.
 *
 * Two disciplines from the spec are baked in here:
 *  1. **Smooth before differentiating.** A single cycle has no curvature, so we
 *     never differentiate raw samples. We fit a low-order polynomial to a local
 *     window (a Savitzky-Golay-style local least-squares fit) and read the
 *     derivatives off the fit. The fit *is* the smoothing.
 *  2. **Stop at the second order.** Jerk (the third derivative) is noise for
 *     human behaviour. We fit a quadratic and read level / velocity /
 *     acceleration only.
 *
 * The fit is evaluated at the **most recent** sample (the trailing edge), not
 * the window centre: this is an online leading indicator answering "is this
 * learner turning *now*?", so a centred fit (which lags by half a window) would
 * be the wrong tool.
 *
 * Pure functions over `number[]`. No app, storage, or metric coupling — the
 * consumer (local difficulty sensing B4, the adaptation controller C2, the
 * dashboard "who just changed" overlay D3) supplies the series for whatever
 * metric it cares about and sets the window/gate.
 */

export interface CurvaturePoint {
  /** Smoothed value — the local quadratic fit evaluated at this sample. Context, per Principle 3. */
  level: number;
  /** First derivative (value per cycle): direction and speed of change. A mild signal. */
  velocity: number;
  /**
   * Second derivative (value per cycle²): whether the movement is itself
   * turning. The leading indicator — baseline-free by construction, so a
   * stable-but-slow learner reads ~0 and a turning trend lights up.
   */
  acceleration: number;
  /** How many samples contributed to this fit. */
  samples: number;
}

export interface CurvatureOptions {
  /**
   * Trailing window length (in cycles) for the local fit. Larger = smoother and
   * more lag; smaller = more responsive and noisier. Default 7.
   */
  window?: number;
  /**
   * Minimum samples before curvature is considered established. A quadratic
   * needs at least 3 distinct points; below `minSamples` the series is "warming
   * up" and `computeCurvature` returns null (Principle 3's min-cycle gate).
   * Clamped to >= 3. Default 5.
   */
  minSamples?: number;
  /**
   * Optional x-coordinates (cycle indices, or timestamps in any consistent
   * unit). Omit for an evenly-spaced per-cycle series (x = 0, 1, 2, …) — the
   * common case. When provided, length must equal `values.length`; derivatives
   * are then expressed per unit-x.
   */
  x?: number[];
}

const DEFAULT_WINDOW = 7;
const DEFAULT_MIN_SAMPLES = 5;

/**
 * Fit a quadratic y = c0 + c1·u + c2·u² to the trailing `window` samples by
 * ordinary least squares (u = x − x_last, so the fit is centred on the most
 * recent sample for numerical stability and direct read-off) and return its
 * level / velocity / acceleration at that most recent sample.
 *
 * Returns null when there are fewer than `minSamples` samples, or when the
 * windowed x-values are degenerate (e.g. duplicates) so no quadratic is
 * determined.
 */
export function computeCurvature(
  values: number[],
  options: CurvatureOptions = {}
): CurvaturePoint | null {
  const window = Math.max(3, options.window ?? DEFAULT_WINDOW);
  const minSamples = Math.max(3, options.minSamples ?? DEFAULT_MIN_SAMPLES);
  const n = values.length;

  if (n < minSamples) return null;

  const xs = options.x;
  if (xs && xs.length !== n) {
    throw new Error(
      `curvature: x length (${xs.length}) must equal values length (${n})`
    );
  }

  // Trailing window: the last `window` samples (or all of them if fewer).
  const start = Math.max(0, n - window);
  const count = n - start;
  if (count < minSamples) return null;

  const xLast = xs ? xs[n - 1] : n - 1;

  // Normal equations for basis [1, u, u²]. Symmetric 3x3 system M·c = b,
  // with moments S_k = Σ uⁱ and the cross terms T_k = Σ uⁱ·y.
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0; // Σ u^0..u^4
  let t0 = 0, t1 = 0, t2 = 0; // Σ y·u^0..u^2
  for (let i = start; i < n; i++) {
    const u = (xs ? xs[i] : i) - xLast;
    const y = values[i];
    const u2 = u * u;
    s0 += 1;
    s1 += u;
    s2 += u2;
    s3 += u2 * u;
    s4 += u2 * u2;
    t0 += y;
    t1 += y * u;
    t2 += y * u2;
  }

  // M = [[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]]; solve for c = [c0, c1, c2].
  const c = solve3(
    [
      [s0, s1, s2],
      [s1, s2, s3],
      [s2, s3, s4],
    ],
    [t0, t1, t2]
  );
  if (!c) return null;

  // At u = 0 (the most recent sample): level = c0, velocity = c1, accel = 2·c2.
  return {
    level: c[0],
    velocity: c[1],
    acceleration: 2 * c[2],
    samples: count,
  };
}

/**
 * Slide the trailing fit across the whole series, yielding a per-sample
 * trajectory. Entries before the min-cycle gate is met are null ("warming up").
 * This is the trajectory the dashboards read and the source for the alarm's
 * own-noise baseline.
 */
export function curvatureSeries(
  values: number[],
  options: CurvatureOptions = {}
): Array<CurvaturePoint | null> {
  const xs = options.x;
  if (xs && xs.length !== values.length) {
    throw new Error(
      `curvature: x length (${xs.length}) must equal values length (${values.length})`
    );
  }
  const out: Array<CurvaturePoint | null> = [];
  for (let end = 1; end <= values.length; end++) {
    out.push(
      computeCurvature(values.slice(0, end), {
        ...options,
        x: xs ? xs.slice(0, end) : undefined,
      })
    );
  }
  return out;
}

export interface AlarmPoint {
  /** Index into the original series. */
  index: number;
  /** Acceleration at this sample (null while warming up). */
  acceleration: number | null;
  /**
   * Acceleration expressed in units of this learner's own recent acceleration
   * noise (a z-score). Null until enough ready points exist to estimate noise.
   */
  z: number | null;
  /** True when |z| >= `threshold` — the "dig deeper here" flag. */
  flagged: boolean;
}

export interface AlarmOptions extends CurvatureOptions {
  /**
   * Trailing number of *ready* acceleration values used to estimate the
   * learner's own noise (mean + stddev). Default 10.
   */
  noiseWindow?: number;
  /** |z| at or above which a sample is flagged. Default 2. */
  threshold?: number;
}

/**
 * The §4 "dig deeper here" detector: flag the samples where |acceleration| is
 * high *relative to that learner's own noise*, not against any absolute cutoff.
 * Because acceleration is baseline-free, a steady (even if slow) learner sits
 * near zero with low variance and never flags; a genuine turn stands out as a
 * multi-sigma excursion against their own quiet background.
 */
export function accelerationAlarm(
  values: number[],
  options: AlarmOptions = {}
): AlarmPoint[] {
  const noiseWindow = Math.max(2, options.noiseWindow ?? 10);
  const threshold = options.threshold ?? 2;
  const series = curvatureSeries(values, options);

  const recent: number[] = []; // trailing ready accelerations (the noise sample)
  return series.map((pt, index) => {
    if (!pt) return { index, acceleration: null, z: null, flagged: false };

    const accel = pt.acceleration;
    let z: number | null = null;
    let flagged = false;

    if (recent.length >= 2) {
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const variance =
        recent.reduce((a, b) => a + (b - mean) * (b - mean), 0) / recent.length;
      const std = Math.sqrt(variance);
      // With negligible own-noise, any real deviation is "infinitely" surprising;
      // fall back to the raw deviation so a flat-then-turn series still flags.
      z = std > 1e-9 ? (accel - mean) / std : accel - mean;
      flagged = Math.abs(z) >= threshold;
    }

    recent.push(accel);
    if (recent.length > noiseWindow) recent.shift();

    return { index, acceleration: accel, z, flagged };
  });
}

/**
 * Solve a 3x3 linear system M·c = b by Gaussian elimination with partial
 * pivoting. Returns null if the matrix is singular to working precision
 * (degenerate window — e.g. duplicate x-values — has no determined quadratic).
 */
function solve3(
  M: [number, number, number][],
  b: [number, number, number]
): [number, number, number] | null {
  // Augmented matrix.
  const a = [
    [M[0][0], M[0][1], M[0][2], b[0]],
    [M[1][0], M[1][1], M[1][2], b[1]],
    [M[2][0], M[2][1], M[2][2], b[2]],
  ];

  for (let col = 0; col < 3; col++) {
    // Partial pivot: largest magnitude in this column at or below the diagonal.
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = a[col];
      a[col] = a[pivot];
      a[pivot] = tmp;
    }
    // Eliminate below.
    for (let r = col + 1; r < 3; r++) {
      const factor = a[r][col] / a[col][col];
      for (let k = col; k < 4; k++) a[r][k] -= factor * a[col][k];
    }
  }

  // Back-substitution.
  const c: number[] = [0, 0, 0];
  for (let row = 2; row >= 0; row--) {
    let sum = a[row][3];
    for (let k = row + 1; k < 3; k++) sum -= a[row][k] * c[k];
    c[row] = sum / a[row][row];
  }
  return [c[0], c[1], c[2]];
}
