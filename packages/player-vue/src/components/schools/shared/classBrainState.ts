// ============================================================================
// classBrainState — the brain at a point in time, and how it is drawn.
//
// Pure, so the drawing can be tested without a browser. The state model is the
// replaying-brain specimen's, unchanged: apply the first k cycles, and each
// cycle lights every chunk it said and thickens every pair it said together.
// ============================================================================
import type { BrainEvent, BrainLego } from './classBrainData'

export interface BrainState {
  /** hearings per axis position */
  node: number[]
  /** "a|b" (axis positions, a < b) -> hearings */
  edge: Map<string, number>
  /** phrase id -> hearings */
  phraseCounts: Map<string, number>
  /** highest seed reached at this point */
  reach: number
  last: BrainEvent | null
}

/**
 * The brain after the first `k` cycles. `axisFrom` is the course ordinal of
 * the first chunk on the axis: an event naming a chunk off the drawn stretch
 * still counts as a cycle, it simply lights nothing.
 */
export function stateAt(events: BrainEvent[], legos: BrainLego[], axisFrom: number, k: number): BrainState {
  const n = legos.length
  const node = new Array<number>(n).fill(0)
  const edge = new Map<string, number>()
  const phraseCounts = new Map<string, number>()
  let reach = 0
  let last: BrainEvent | null = null
  const on = (ordinal: number): number => ordinal - axisFrom
  for (let i = 0; i < Math.min(k, events.length); i++) {
    const e = events[i]
    const h = e.hearings == null ? 2 : e.hearings
    last = e
    for (const f of e.fires) {
      const x = on(f)
      if (x >= 0 && x < n) { node[x] += h; reach = Math.max(reach, legos[x].seed) }
    }
    if (e.phrase) phraseCounts.set(e.phrase, (phraseCounts.get(e.phrase) || 0) + h)
    const fs = e.fires.map(on).filter((x) => x >= 0 && x < n).sort((a, b) => a - b)
    for (let a = 0; a < fs.length; a++) {
      for (let b = a + 1; b < fs.length; b++) {
        const key = `${fs[a]}|${fs[b]}`
        edge.set(key, (edge.get(key) || 0) + h)
      }
    }
  }
  return { node, edge, phraseCounts, reach, last }
}

/**
 * Arc weight is on an ABSOLUTE scale, fixed for the whole replay, never
 * renormalised against the busiest pair seen so far — so a pair that keeps
 * recurring visibly thickens as the replay goes on.
 */
export const edgeWidth = (n: number): number => Math.min(0.8 + 1.1 * Math.sqrt(n), 6)
export const edgeOpacity = (n: number): number => Math.min(0.32 + 0.14 * Math.sqrt(n), 0.95)
/** A dot grows with repetition, on a log scale so the first few hearings show most. */
export const dotRadius = (n: number, max: number): number => (n ? 3.5 + 4 * (Math.log1p(n) / Math.log1p(Math.max(max, 1))) : 2.4)
