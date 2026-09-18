// ============================================================================
// classBrainFigure — the course journey, turned into ink.
//
// Pure. Given the chunks on the axis, the brain's state at the scrubber and a
// lens — folded for the card, unfolded for the expand — this decides every
// number the SVG draws, so the drawing is testable without a browser and the
// card and the full-screen expand cannot disagree about what they show.
// ============================================================================
import type { BrainLego } from './classBrainData'
import type { BrainState } from './classBrainState'
import { edgeWidth, edgeOpacity, dotRadius } from './classBrainState'
import { type Axis, type ClothBand, clothBands, isLineArc } from './classBrainFold'

export interface FigureArc { d: string; w: number; o: number }
export interface FigureDot { key: string; cx: number; r: number; lit: boolean; text: string; label: boolean }
export interface Figure {
  w: number
  h: number
  y: number
  /** Set when the drawing is wider than the box and the box scrolls it. */
  scroll: boolean
  rule: { x1: number; x2: number }
  ink: { x1: number; x2: number } | null
  cloth: ClothBand[]
  arcs: FigureArc[]
  dots: FigureDot[]
  caption: { cx: number; t: string; k: string } | null
}

export interface CaptionSource {
  /** Axis positions the current phrase said. */
  fires: number[]
  t: string
  k: string
}

export interface FigureOptions {
  caption?: CaptionSource | null
  /** The chunks the current cycle said: their pairs are always drawn as lines. */
  live?: number[]
  /** The drawing is wider than its box and the box scrolls it sideways. */
  scroll?: boolean
  /** Room above the line for the arcs. The unfolded line needs far more. */
  topRoom?: number
}

/** Room under the line for the rotated labels, when there are any. */
const LABEL_ROOM = 130
const TOP_ROOM = 96
/** Past this many drawn arcs, ink at full opacity stops being a drawing. */
const ARC_CROWD = 400

export function buildFigure(
  axis: Axis,
  legos: BrainLego[],
  state: BrainState,
  options: FigureOptions = {},
): Figure {
  const { caption = null, live = [], scroll = false } = options
  const hasLabels = axis.labelFrom < legos.length
  const top = options.topRoom ?? TOP_ROOM
  const y = hasLabels ? Math.max(top, 150) : top
  const h = hasLabels ? y + LABEL_ROOM : y + 54
  // The labels lean right at 58°, so the last one runs past the last dot; the
  // box is wider than the line to hold it and the dots do not move.
  const w = axis.pad * 2 + axis.span + (hasLabels ? 80 : 0)

  // ── the arcs, sorted into ink and cloth ──
  // A pair is drawn as a line while either end still stands at legible
  // spacing. That is what keeps a chunk-3-to-chunk-290 recall a visible line
  // rather than a smudge, and it is the pedagogic point of the picture.
  //
  // The stroke the class is making RIGHT NOW is always a line too, however
  // deep in the compressed past the replay is drawing — otherwise the first
  // two thirds of a replay would have no moving ink at all.
  const liveKeys = new Set<string>()
  const ls = [...live].sort((a, b) => a - b)
  for (let a = 0; a < ls.length; a++) for (let b = a + 1; b < ls.length; b++) liveKeys.add(`${ls[a]}|${ls[b]}`)

  const drawn: { a: number; b: number; n: number }[] = []
  const woven: { a: number; b: number; n: number }[] = []
  for (const [key, n] of state.edge) {
    const [a, b] = key.split('|').map(Number)
    if (liveKeys.has(key) || isLineArc(a, b, axis)) drawn.push({ a, b, n })
    else woven.push({ a, b, n })
  }
  drawn.sort((p, q) => p.n - q.n)

  // An arc's height goes by the LOG of its reach, normalised so the longest
  // one in this picture just clears the ceiling. Without that every long arc
  // flattens against the top of the box and a two-hundred-chunk recall is
  // indistinguishable from its neighbour.
  const ceiling = y - 8
  const maxR = Math.max(1, ...drawn.map((e) => (axis.x(Math.max(e.a, e.b)) - axis.x(Math.min(e.a, e.b))) / 2))
  const logMax = Math.log1p(maxR)
  const lines: FigureArc[] = drawn.map(({ a, b, n }) => {
    const x1 = axis.x(Math.min(a, b))
    const x2 = axis.x(Math.max(a, b))
    const r = (x2 - x1) / 2
    const ry = Math.min(r * 0.9, logMax > 0 ? (ceiling * Math.log1p(r)) / logMax : ceiling, ceiling)
    return { d: `M${x1} ${y} A${r} ${ry} 0 0 1 ${x2} ${y}`, w: edgeWidth(n), o: edgeOpacity(n) }
  })
  // On the unfolded line nothing is woven, so every pair the class has ever
  // said is drawn; past a few hundred of them ink that dark simply fills in.
  // Thinning it keeps density readable as accumulation rather than as a wall.
  if (lines.length > ARC_CROWD) {
    const thin = Math.max(0.24, ARC_CROWD / lines.length)
    for (const arc of lines) arc.o *= thin
  }

  const cloth = clothBands(woven, axis, 72, Math.round(y * 0.6))

  // ── the dots, and how far the ink reaches ──
  const max = Math.max(1, ...state.node)
  let firstLit = -1
  let lastLit = -1
  const dots: FigureDot[] = legos.map((l, i) => {
    const lit = state.node[i] > 0
    if (lit) { if (firstLit < 0) firstLit = i; lastLit = i }
    // In the folded past a dot is wider than its own gap, so it gives way to
    // its gap: the chunks there read as the dense rule they are.
    const room = Math.max(0.5, axis.pitch(i) * 0.9)
    return {
      key: l.id,
      cx: axis.x(i),
      r: Math.min(dotRadius(state.node[i], max), room),
      lit,
      text: l.t,
      label: i >= axis.labelFrom,
    }
  })

  return {
    w,
    h,
    y,
    scroll,
    rule: { x1: axis.x(0), x2: axis.x(Math.max(legos.length - 1, 0)) },
    ink: firstLit >= 0 ? { x1: axis.x(firstLit), x2: axis.x(lastLit) } : null,
    cloth,
    arcs: lines,
    dots,
    caption: caption && caption.fires.length
      ? { cx: caption.fires.reduce((s, f) => s + axis.x(f), 0) / caption.fires.length, t: caption.t, k: caption.k }
      : null,
  }
}
