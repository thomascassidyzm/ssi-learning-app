// ============================================================================
// classBrainFold — the LENS the course journey is drawn through.
//
// Tom's ruling, 2026-09-17: "log-fold plus cloth". The rules of the brain are
// the server's and are untouched; this is only how the line is spaced and how
// old ink is rendered.
//
// THE FOLD. A class three hundred chunks into a course cannot have three
// hundred chunks drawn at even spacing — the arcs collapse into one blue
// smear, and the old answer of throwing the past away threw away the read Tom
// values most, how far into the course the class has got. So the axis is
// folded instead: the frontier keeps the spacing a short course gets, and
// distance in course order compresses logarithmically going back, so chunk 3
// and chunk 290 both stand on one screen. Recent is vivid, the past is dense
// but present.
//
// THE CLOTH. Where the fold has squeezed chunks closer than a dot is wide, an
// arc between two of them cannot be a legible line, so those arcs stop being
// lines and become a density field — a woven band over the past whose weight
// is how much the class has recombined there. The class's brain looks more
// myelinated the further back you look. An arc with one end still out at the
// legible frontier is ALWAYS drawn as a line however old its other end is:
// that arc, the course reaching back for old material, is the whole point.
//
// Pure, so every number here is tested without a browser.
// ============================================================================

/**
 * The spacing a short course gets, in chunks across the drawn span. Below this
 * many chunks nothing is folded, because nothing needs to be; above it, the
 * newest FULL_SCALE_CHUNKS keep exactly this pitch and everything older gives
 * way.
 */
export const FULL_SCALE_CHUNKS = 60
/** Closer than this many units and a dot is wider than its own gap: cloth. */
export const CLOTH_MIN_PITCH = 5
/** A rotated label needs about this much horizontal room to be read. */
export const LABEL_MIN_PITCH = 20
/** The unfolded line in the full-screen expand: true spacing, scroll it. */
export const UNFOLDED_PITCH = 24

export interface Axis {
  /** How many chunks stand on it. */
  n: number
  /** Drawn width, in viewBox units, from x(0) to x(n-1). */
  span: number
  /** Left edge of the drawn line. */
  pad: number
  /** null when the axis is short enough to be drawn straight. */
  lambda: number | null
  /** Course-order index -> x. */
  x: (i: number) => number
  /** The gap in units between chunk i-1 and chunk i. */
  pitch: (i: number) => number
  /** The oldest index still drawn at legible spacing — cloth is everything before it. */
  legibleFrom: number
  /** Chunks from `labelFrom` on have room for a label under them. */
  labelFrom: number
}

/**
 * The fold constant for `n` chunks: the λ that makes the newest chunk's gap
 * exactly the gap a FULL_SCALE_CHUNKS-long axis would give it. The ratio
 * falls monotonically from 1 to 1/(n-1) as λ grows, so a bisection finds it
 * in a fixed twenty steps and there is no curve to hand-tune.
 */
export function foldLambda(n: number, fullScale: number = FULL_SCALE_CHUNKS): number | null {
  const A = n - 1
  if (A <= fullScale) return null
  const want = 1 / fullScale
  const ratio = (lam: number): number => Math.log1p(1 / lam) / Math.log1p(A / lam)
  let lo = 1e-3
  let hi = 1e6
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi)
    if (ratio(mid) > want) lo = mid
    else hi = mid
  }
  return Math.sqrt(lo * hi)
}

/**
 * The axis for `n` chunks across `span` units. Folded above
 * FULL_SCALE_CHUNKS, dead straight below it — a class in its first term must
 * not be shown a curve it has no need of.
 */
export function foldAxis(n: number, span: number, pad = 0, fullScale: number = FULL_SCALE_CHUNKS): Axis {
  const A = Math.max(n - 1, 1)
  const lambda = foldLambda(n, fullScale)
  let x: (i: number) => number
  if (lambda == null) {
    x = (i: number) => (n === 1 ? pad + span / 2 : pad + (i * span) / A)
  } else {
    const denom = Math.log1p(A / lambda)
    // age from the frontier, logged, measured back from the right-hand end
    x = (i: number) => pad + span * (1 - Math.log1p((A - i) / lambda) / denom)
  }
  const pitch = (i: number): number => (i <= 0 ? x(1) - x(0) : x(i) - x(i - 1))
  const firstWhere = (min: number): number => {
    for (let i = 1; i < n; i++) if (pitch(i) >= min) return i - 1
    return n
  }
  return { n, span, pad, lambda, x, pitch, legibleFrom: firstWhere(CLOTH_MIN_PITCH), labelFrom: firstWhere(LABEL_MIN_PITCH) }
}

/** A straight axis at a fixed pitch — the unfolded line the expand scrolls. */
export function unfoldedAxis(n: number, pitch: number = UNFOLDED_PITCH, pad = 0): Axis {
  const span = Math.max(n - 1, 1) * pitch
  return {
    n,
    span,
    pad,
    lambda: null,
    x: (i: number) => pad + i * pitch,
    pitch: () => pitch,
    legibleFrom: 0,
    labelFrom: pitch >= LABEL_MIN_PITCH ? 0 : n,
  }
}

export interface ArcInput { a: number; b: number; n: number }
export interface ClothBand { x: number; w: number; y: number; h: number; o: number }

/**
 * Is this pair still worth a line? Yes while either end stands in the legible
 * frontier — which is what keeps a chunk-3-to-chunk-290 recall visible — and
 * yes for the pair the class is saying right now, so the replay always has a
 * live stroke however deep in the compressed past it is drawing.
 */
export function isLineArc(a: number, b: number, axis: Axis): boolean {
  return Math.max(a, b) >= axis.legibleFrom
}

/**
 * The cloth: the arcs the fold has squeezed past legibility, resolved into a
 * band of `buckets` columns over the compressed stretch. A column's HEIGHT is
 * the tallest arc passing over it, so the reach of the old recombination is
 * still in the picture; its WEIGHT is how many hearings pass over it, which is
 * what "they have worn this in" looks like.
 */
export function clothBands(arcs: ArcInput[], axis: Axis, buckets = 72, maxHeight = 58): ClothBand[] {
  if (!arcs.length) return []
  const x0 = axis.x(0)
  const x1 = axis.x(Math.max(axis.legibleFrom, 0))
  const width = x1 - x0
  if (width <= 0) return []
  const w = width / buckets
  const weight = new Array<number>(buckets).fill(0)
  const height = new Array<number>(buckets).fill(0)
  for (const arc of arcs) {
    const ax = axis.x(Math.min(arc.a, arc.b))
    const bx = axis.x(Math.max(arc.a, arc.b))
    // The arc the drawing would have made: a half-ellipse of this radius.
    const apex = ((bx - ax) / 2) * 0.9
    const from = Math.max(0, Math.floor((ax - x0) / w))
    const to = Math.min(buckets - 1, Math.floor((Math.min(bx, x1) - x0) / w))
    for (let i = from; i <= to; i++) {
      weight[i] += arc.n
      if (apex > height[i]) height[i] = apex
    }
  }
  // A band is a band, not a block: the tallest column stands at maxHeight and
  // the rest fall away in proportion, so the reach of the old recombination is
  // still readable as topography rather than filling the card with blue.
  const maxWeight = Math.max(1, ...weight)
  const maxApex = Math.max(1, ...height)
  const out: ClothBand[] = []
  for (let i = 0; i < buckets; i++) {
    if (!weight[i]) continue
    // Height follows BOTH how far the old arcs reach over this column and how
    // hard the class has worked it, so the top of the band is topography
    // rather than a flat lid.
    const h = maxHeight * Math.sqrt(0.35 * (height[i] / maxApex) + 0.65 * (weight[i] / maxWeight))
    out.push({
      x: x0 + i * w,
      w: w + 0.4,
      y: -h,
      h,
      // Woven, not flat: the weight goes to opacity on a square root so the
      // first few hearings show, and neighbouring columns differ visibly.
      o: Math.min(0.05 + 0.34 * Math.sqrt(weight[i] / maxWeight), 0.42),
    })
  }
  return out
}
