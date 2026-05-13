/**
 * Network Engine — Brain View Network Calculation
 *
 * Framework-agnostic helpers for the "Your brain on Italian" view.
 *
 * The network represents how LEGOs connect:
 *   - Nodes  = LEGOs (vocabulary items)
 *   - Edges  = relationships between LEGOs, split into two kinds:
 *
 *       structural — methodology relationships (drawn solid):
 *         (a) every pair of LEGOs that share a seed_number → one edge each pair
 *         (b) every reference from an M-LEGO to one of its A-LEGO components
 *             (via the `components` field) → one edge (M → A)
 *         Strength is always 1.0 for structural edges.
 *
 *       context — phrase co-occurrence (drawn thin, low alpha):
 *         For each practice phrase, find every LEGO whose `target_text` appears
 *         in the phrase via a greedy longest-match scan; pairs that end up in
 *         the same phrase get a co-occurrence count. Strength = count
 *         normalised to [0, 1] across all context edges.
 *
 * Positions are NOT computed here — they come from the precompute script that
 * writes into `course_lego_positions`. This engine only builds nodes + edges.
 */

import * as d3 from 'd3'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Minimal LEGO shape the engine needs. The composable adapts the DB row into
 * this shape before calling buildBrainNetwork().
 */
export interface NetworkLego {
  legoId: string
  seedNumber: number
  /** A-LEGO = atomic (single word), M-LEGO = molecule (multi-word). */
  type: 'A' | 'M'
  /** Target-language text, used both as label and for context-edge matching. */
  targetText: string
  /**
   * For M-LEGOs only — the `components` JSON column from `course_legos`.
   *
   * Shape on disk is `[{ known: string, target: string }, …]`. The engine
   * resolves each component's `target` against the LEGO list's `targetText`
   * and creates an M→A structural edge for every match. Components that don't
   * resolve are silently skipped (they're orphan particles like articles).
   */
  components?: Array<{ known?: string; target?: string }> | null
}

/** Practice phrase for context-edge co-occurrence counting. */
export interface NetworkPhrase {
  /** Phrase text in target language; we greedy-match LEGO `targetText`s against this. */
  targetText: string
}

export interface StructuralEdge {
  source: string
  target: string
  /** Always 1.0 for structural. */
  strength: 1
  /** Subtype kept for debugging — renderers don't need to distinguish. */
  kind: 'seed-cohort' | 'component'
}

export interface ContextEdge {
  source: string
  target: string
  /** Normalised co-occurrence count, in [0, 1]. */
  strength: number
  /** Raw co-occurrence count, useful for stats / debugging. */
  count: number
}

export interface BrainNetwork {
  structural: StructuralEdge[]
  context: ContextEdge[]
}

// ============================================================================
// BELT THRESHOLDS (mirror of useBeltProgress.BELTS)
// ============================================================================

export const BELT_THRESHOLDS = [
  { belt: 'black',  threshold: 400 },
  { belt: 'brown',  threshold: 280 },
  { belt: 'purple', threshold: 150 },
  { belt: 'blue',   threshold: 80  },
  { belt: 'green',  threshold: 40  },
  { belt: 'orange', threshold: 20  },
  { belt: 'yellow', threshold: 8   },
  { belt: 'white',  threshold: 0   },
] as const

export function getBeltForSeed(seedNumber: number): string {
  for (const { belt, threshold } of BELT_THRESHOLDS) {
    if (seedNumber >= threshold) return belt
  }
  return 'white'
}

export function getBeltIndexForSeed(seedNumber: number): number {
  // Index 0 = white, 7 = black. Mirrors useBeltProgress.getBeltIndexForSeed.
  const ordered = [...BELT_THRESHOLDS].reverse() // ascending threshold
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (seedNumber >= ordered[i].threshold) return i
  }
  return 0
}

// ============================================================================
// STRUCTURAL EDGES
// ============================================================================

/**
 * Build the (a) + (b) structural-edge set.
 *
 *   (a) seed-cohort: every pair of LEGOs sharing a `seed_number` → one edge.
 *       Bidirectional sense, but emitted with a canonical source/target order
 *       (lexicographic) so downstream dedup is trivial.
 *
 *   (b) component:   for every M-LEGO, resolve each entry in `components` to
 *       an A-LEGO by matching `component.target` against `lego.targetText`
 *       (case-insensitive, whitespace-trimmed) within the same course. Each
 *       resolved component yields one M → A edge.
 */
export function buildStructuralEdges(legos: NetworkLego[]): StructuralEdge[] {
  const edges: StructuralEdge[] = []
  const seen = new Set<string>()

  const addEdge = (
    source: string,
    target: string,
    kind: StructuralEdge['kind'],
  ) => {
    if (source === target) return
    // Component edges are directional (M → A). Seed-cohort edges are
    // symmetric, so we canonicalise to avoid duplicates.
    const [a, b] = kind === 'seed-cohort' && source > target
      ? [target, source]
      : [source, target]
    const key = `${kind}:${a}->${b}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ source: a, target: b, strength: 1, kind })
  }

  // (a) seed-cohort: group by seed_number, fully connect within each group.
  const bySeed = new Map<number, NetworkLego[]>()
  for (const lego of legos) {
    const arr = bySeed.get(lego.seedNumber)
    if (arr) arr.push(lego)
    else bySeed.set(lego.seedNumber, [lego])
  }
  for (const group of bySeed.values()) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        addEdge(group[i].legoId, group[j].legoId, 'seed-cohort')
      }
    }
  }

  // (b) component: resolve M-LEGO `components[].target` → A-LEGO `targetText`.
  // Build a target-text → legoId index over A-LEGOs first.
  const norm = (s: string) => s.trim().toLowerCase()
  const aByText = new Map<string, string>()
  for (const lego of legos) {
    if (lego.type !== 'A') continue
    if (!lego.targetText) continue
    aByText.set(norm(lego.targetText), lego.legoId)
  }

  for (const lego of legos) {
    if (lego.type !== 'M') continue
    if (!Array.isArray(lego.components)) continue
    for (const comp of lego.components) {
      const target = comp?.target
      if (!target || typeof target !== 'string') continue
      const resolved = aByText.get(norm(target))
      if (!resolved) continue // orphan particle — silently skip
      addEdge(lego.legoId, resolved, 'component')
    }
  }

  return edges
}

// ============================================================================
// CONTEXT EDGES (phrase co-occurrence via greedy longest-match)
// ============================================================================

/**
 * For every practice phrase, find every LEGO whose `targetText` occurs in the
 * phrase via a greedy longest-match scan, then increment a co-occurrence
 * counter for every unordered pair of LEGOs that ended up in the same phrase.
 *
 * Greedy longest-match: at each cursor position, try the longest LEGO text
 * first. On a hit, consume those characters and advance the cursor past them.
 * Mirrors the original archive engine's intent (LEGOs tile phrases without
 * overlap) but is independent of phrase-item ordering metadata.
 *
 * Strength is the raw count normalised to [0, 1] across all returned edges.
 */
export function buildContextEdges(
  legos: NetworkLego[],
  phrases: NetworkPhrase[],
): ContextEdge[] {
  if (legos.length === 0 || phrases.length === 0) return []

  // Sort LEGO texts by length descending so greedy match picks the longest hit.
  const norm = (s: string) => s.toLowerCase()
  const sorted = legos
    .filter(l => l.targetText && l.targetText.trim().length > 0)
    .map(l => ({ legoId: l.legoId, text: norm(l.targetText.trim()) }))
    .sort((a, b) => b.text.length - a.text.length)

  // Co-occurrence count keyed by canonical "a|b" with a < b lexicographically.
  const counts = new Map<string, number>()
  const bump = (a: string, b: string) => {
    if (a === b) return
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  for (const phrase of phrases) {
    if (!phrase.targetText) continue
    const text = norm(phrase.targetText)
    const matched = new Set<string>()

    let cursor = 0
    while (cursor < text.length) {
      // Skip whitespace
      if (/\s/.test(text[cursor])) {
        cursor++
        continue
      }
      let hit: { legoId: string; len: number } | null = null
      for (const cand of sorted) {
        if (cand.text.length === 0) continue
        // Word-boundary aware: match must either start at cursor 0 / preceded
        // by whitespace, AND end at text.length / followed by whitespace.
        // (Approximation — punctuation handling is intentionally permissive.)
        if (text.startsWith(cand.text, cursor)) {
          const before = cursor === 0 ? ' ' : text[cursor - 1]
          const afterIdx = cursor + cand.text.length
          const after = afterIdx >= text.length ? ' ' : text[afterIdx]
          if (/[\s.,!?;:'"`()]/.test(before) && /[\s.,!?;:'"`()]/.test(after)) {
            hit = { legoId: cand.legoId, len: cand.text.length }
            break
          }
        }
      }
      if (hit) {
        matched.add(hit.legoId)
        cursor += hit.len
      } else {
        cursor++
      }
    }

    // Bump every unordered pair of LEGOs that co-occurred.
    const ids = Array.from(matched)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        bump(ids[i], ids[j])
      }
    }
  }

  if (counts.size === 0) return []

  // Normalise counts to [0, 1] across edge set.
  const maxCount = Math.max(...counts.values())
  const edges: ContextEdge[] = []
  for (const [key, count] of counts.entries()) {
    const [source, target] = key.split('|')
    edges.push({
      source,
      target,
      count,
      strength: maxCount > 0 ? count / maxCount : 0,
    })
  }
  return edges
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Build the complete brain network (both edge sets). Positions are not
 * computed here — fetch them from `course_lego_positions`.
 */
export function buildBrainNetwork(
  legos: NetworkLego[],
  phrases: NetworkPhrase[],
): BrainNetwork {
  return {
    structural: buildStructuralEdges(legos),
    context: buildContextEdges(legos, phrases),
  }
}

// ============================================================================
// FORCE-SIMULATION HELPER (for the precompute script — exported for reuse,
// not used by the runtime composable, which reads precomputed positions)
// ============================================================================

export interface ForceLayoutInput {
  legoId: string
  seedNumber: number
}

export interface ForceLayoutResult {
  legoId: string
  x: number
  y: number
}

/**
 * Run a D3 force simulation over LEGOs + structural edges and return final
 * positions. Used by `precompute-lego-positions.cjs`; kept here so the
 * algorithm is documented in TypeScript alongside the types it operates on.
 *
 * The CJS precompute script reimplements this so it doesn't have to load the
 * ESM core bundle — see the comment in that script.
 */
export function runForceLayout(
  nodes: ForceLayoutInput[],
  structuralEdges: Array<{ source: string; target: string }>,
  opts: {
    iterations?: number
    charge?: number
    linkDistance?: number
    radialStrength?: number
    canvas?: { width: number; height: number }
  } = {},
): ForceLayoutResult[] {
  const iterations = opts.iterations ?? 300
  const charge = opts.charge ?? -200
  const linkDistance = opts.linkDistance ?? 30
  const radialStrength = opts.radialStrength ?? 0.15
  const canvas = opts.canvas ?? { width: 1600, height: 1600 }

  if (nodes.length === 0) return []

  const center = { x: canvas.width / 2, y: canvas.height / 2 }

  // Build per-seed centroids on a ring around the centre, ordered by seedNumber.
  const seeds = Array.from(new Set(nodes.map(n => n.seedNumber))).sort((a, b) => a - b)
  const radius = Math.min(canvas.width, canvas.height) * 0.4
  const centroidBySeed = new Map<number, { x: number; y: number }>()
  seeds.forEach((seed, i) => {
    const angle = (i / seeds.length) * Math.PI * 2
    centroidBySeed.set(seed, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    })
  })

  const simNodes = nodes.map(n => {
    const c = centroidBySeed.get(n.seedNumber) || center
    return {
      id: n.legoId,
      seedNumber: n.seedNumber,
      x: c.x + (Math.random() - 0.5) * 40,
      y: c.y + (Math.random() - 0.5) * 40,
    } as d3.SimulationNodeDatum & { id: string; seedNumber: number }
  })

  const simulation = d3
    .forceSimulation(simNodes)
    .force(
      'link',
      d3
        .forceLink(structuralEdges.map(e => ({ ...e })))
        .id((d: any) => d.id)
        .distance(linkDistance)
        .strength(0.5),
    )
    .force('charge', d3.forceManyBody().strength(charge))
    .force('center', d3.forceCenter(center.x, center.y))
    .force('collide', d3.forceCollide(8))
    // Custom radial-cluster force: pull each node toward its seed's centroid.
    .force('radial', (alpha: number) => {
      for (const node of simNodes) {
        const c = centroidBySeed.get(node.seedNumber)
        if (!c) continue
        node.vx = (node.vx || 0) + (c.x - (node.x || 0)) * radialStrength * alpha
        node.vy = (node.vy || 0) + (c.y - (node.y || 0)) * radialStrength * alpha
      }
    })
    .stop()

  for (let i = 0; i < iterations; i++) simulation.tick()

  return simNodes.map(n => ({
    legoId: n.id,
    x: n.x ?? center.x,
    y: n.y ?? center.y,
  }))
}
