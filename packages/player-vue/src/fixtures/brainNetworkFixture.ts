/**
 * brainNetworkFixture v2 — hand-built BrainTimelapseData for renderer
 * development against the live force-sim + scrubber.
 *
 * Shape:
 *   - 4 belts (white, yellow, orange, green)
 *   - 4 seeds per belt = ~40 nodes (mix of atoms + molecules)
 *   - ~60 pairings with fire counts spanning 1 → 50 so the scrubber
 *     has visible synapse-strength variation
 *   - introducedAt timestamps spread over a 30-day window so dragging
 *     the playhead reveals nodes in waves
 *   - mastery distributed across all 4 tiers so the renderer's opacity
 *     + glow ladder is visible
 *
 * Positions are loosely laid out as 4 clusters (one per belt) — the
 * force-sim uses these as initial conditions and drifts from there.
 *
 * This fixture is also reachable via /test/brain-view-v2 (a temporary
 * dev route Agent C will remove when real integration lands).
 */

import type {
  BrainTimelapseData,
  TimelapseNode,
  TimelapseEdge,
  TimelapseEvent,
  MasteryTier,
} from '../types/brainTimelapse'

interface SeedSpec {
  seedNumber: number
  beltIndex: number
  centerX: number
  centerY: number
  words: Array<{
    text: string
    type: 'atom' | 'molecule'
    mastery: MasteryTier
    /** Days before "now" that this LEGO debuted. */
    introducedDaysAgo: number
  }>
}

// 4 belts × 4 seeds per belt, ~2-3 LEGOs each = ~40 nodes total.
const SEEDS: SeedSpec[] = [
  // ---- White belt (seeds 1-4) -------------------------------------------
  {
    seedNumber: 1, beltIndex: 0, centerX: -600, centerY: -400,
    words: [
      { text: 'io',              type: 'atom',     mastery: 'mastered',     introducedDaysAgo: 28 },
      { text: 'voglio',          type: 'atom',     mastery: 'mastered',     introducedDaysAgo: 28 },
      { text: 'imparare',        type: 'atom',     mastery: 'confident',    introducedDaysAgo: 27 },
      { text: "l'italiano",      type: 'molecule', mastery: 'confident',    introducedDaysAgo: 27 },
    ],
  },
  {
    seedNumber: 2, beltIndex: 0, centerX: -300, centerY: -500,
    words: [
      { text: 'parlare',         type: 'atom',     mastery: 'confident',    introducedDaysAgo: 26 },
      { text: 'un poco',         type: 'molecule', mastery: 'confident',    introducedDaysAgo: 25 },
      { text: 'parlare un poco', type: 'molecule', mastery: 'consolidating', introducedDaysAgo: 25 },
    ],
  },
  {
    seedNumber: 3, beltIndex: 0, centerX: -500, centerY: -150,
    words: [
      { text: 'capire',          type: 'atom',     mastery: 'consolidating', introducedDaysAgo: 23 },
      { text: 'come',            type: 'atom',     mastery: 'consolidating', introducedDaysAgo: 22 },
      { text: 'come parlare',    type: 'molecule', mastery: 'acquisition',   introducedDaysAgo: 22 },
    ],
  },
  {
    seedNumber: 4, beltIndex: 0, centerX: -200, centerY: -200,
    words: [
      { text: 'lentamente',      type: 'atom',     mastery: 'acquisition',   introducedDaysAgo: 20 },
      { text: 'parlo lentamente', type: 'molecule', mastery: 'acquisition',  introducedDaysAgo: 20 },
    ],
  },
  // ---- Yellow belt (seeds 5-8) -------------------------------------------
  {
    seedNumber: 5, beltIndex: 1, centerX: 300, centerY: -500,
    words: [
      { text: 'non',             type: 'atom',     mastery: 'confident',    introducedDaysAgo: 18 },
      { text: 'ancora',          type: 'atom',     mastery: 'confident',    introducedDaysAgo: 17 },
      { text: 'non ancora',      type: 'molecule', mastery: 'consolidating', introducedDaysAgo: 17 },
    ],
  },
  {
    seedNumber: 6, beltIndex: 1, centerX: 550, centerY: -350,
    words: [
      { text: 'molto bene',      type: 'molecule', mastery: 'consolidating', introducedDaysAgo: 15 },
      { text: 'ma',              type: 'atom',     mastery: 'consolidating', introducedDaysAgo: 14 },
      { text: 'sto imparando',   type: 'molecule', mastery: 'consolidating', introducedDaysAgo: 14 },
    ],
  },
  {
    seedNumber: 7, beltIndex: 1, centerX: 400, centerY: -100,
    words: [
      { text: 'ogni',            type: 'atom',     mastery: 'consolidating', introducedDaysAgo: 12 },
      { text: 'giorno',          type: 'atom',     mastery: 'acquisition',   introducedDaysAgo: 12 },
      { text: 'ogni giorno',     type: 'molecule', mastery: 'acquisition',   introducedDaysAgo: 11 },
    ],
  },
  {
    seedNumber: 8, beltIndex: 1, centerX: 650, centerY: -50,
    words: [
      { text: 'piano piano',     type: 'molecule', mastery: 'acquisition',   introducedDaysAgo: 10 },
      { text: 'pratico',         type: 'atom',     mastery: 'acquisition',   introducedDaysAgo: 10 },
    ],
  },
  // ---- Orange belt (seeds 9-12) ------------------------------------------
  {
    seedNumber: 9, beltIndex: 2, centerX: -650, centerY: 350,
    words: [
      { text: 'mi piace',        type: 'molecule', mastery: 'consolidating', introducedDaysAgo: 8 },
      { text: 'questa',          type: 'atom',     mastery: 'consolidating', introducedDaysAgo: 8 },
      { text: 'lingua',          type: 'atom',     mastery: 'consolidating', introducedDaysAgo: 7 },
    ],
  },
  {
    seedNumber: 10, beltIndex: 2, centerX: -350, centerY: 500,
    words: [
      { text: 'è',               type: 'atom',     mastery: 'acquisition',   introducedDaysAgo: 6 },
      { text: 'bella',           type: 'atom',     mastery: 'acquisition',   introducedDaysAgo: 6 },
      { text: 'è bella',         type: 'molecule', mastery: 'acquisition',   introducedDaysAgo: 5 },
    ],
  },
  {
    seedNumber: 11, beltIndex: 2, centerX: -100, centerY: 350,
    words: [
      { text: 'molto',           type: 'atom',     mastery: 'acquisition',   introducedDaysAgo: 5 },
      { text: 'davvero',         type: 'atom',     mastery: 'acquisition',   introducedDaysAgo: 4 },
    ],
  },
  {
    seedNumber: 12, beltIndex: 2, centerX: -400, centerY: 200,
    words: [
      { text: 'mi piace molto',  type: 'molecule', mastery: 'acquisition',   introducedDaysAgo: 4 },
    ],
  },
  // ---- Green belt (seeds 13-16) ------------------------------------------
  {
    seedNumber: 13, beltIndex: 3, centerX: 350, centerY: 350,
    words: [
      { text: 'penso',           type: 'atom',     mastery: 'acquisition',   introducedDaysAgo: 3 },
      { text: 'che',             type: 'atom',     mastery: 'acquisition',   introducedDaysAgo: 3 },
      { text: 'penso che',       type: 'molecule', mastery: 'acquisition',   introducedDaysAgo: 2 },
    ],
  },
  {
    seedNumber: 14, beltIndex: 3, centerX: 600, centerY: 500,
    words: [
      { text: 'forse',           type: 'atom',     mastery: 'acquisition',   introducedDaysAgo: 2 },
      { text: 'magari',          type: 'atom',     mastery: 'acquisition',   introducedDaysAgo: 1 },
    ],
  },
  {
    seedNumber: 15, beltIndex: 3, centerX: 750, centerY: 250,
    words: [
      { text: 'domani',          type: 'atom',     mastery: 'acquisition',   introducedDaysAgo: 1 },
      { text: 'forse domani',    type: 'molecule', mastery: 'acquisition',   introducedDaysAgo: 1 },
    ],
  },
  {
    seedNumber: 16, beltIndex: 3, centerX: 400, centerY: 600,
    words: [
      { text: 'va bene',         type: 'molecule', mastery: 'acquisition',   introducedDaysAgo: 0.5 },
    ],
  },
]

// Deterministic per-string hash so jittered positions stay stable across reloads.
function hash(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return (h % 10000) / 10000
}

function positionsForSeed(seed: SeedSpec): Array<{ x: number; y: number }> {
  const n = seed.words.length
  const radius = 90
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i < n; i++) {
    const angle = (i / Math.max(1, n)) * Math.PI * 2 + hash(`${seed.seedNumber}-base`) * Math.PI
    const r = radius * (0.7 + hash(`${seed.seedNumber}-${i}`) * 0.5)
    out.push({
      x: seed.centerX + Math.cos(angle) * r,
      y: seed.centerY + Math.sin(angle) * r,
    })
  }
  return out
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
// Use a stable epoch reference for the fixture (not Date.now()) so the
// fixture is deterministic across reloads. The brain view consumes
// `events[0].at` and the renderer's own visibleAt — both are absolute.
// We pick "today at 00:00 UTC" as the fixture's "now" anchor.
const FIXTURE_NOW = (() => {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime()
})()

function daysAgoToIso(daysAgo: number): string {
  return new Date(FIXTURE_NOW - daysAgo * MS_PER_DAY).toISOString()
}

export const brainNetworkFixture: BrainTimelapseData = (() => {
  const nodes: TimelapseNode[] = []

  for (const seed of SEEDS) {
    const positions = positionsForSeed(seed)
    seed.words.forEach((w, i) => {
      const legoId = `S${String(seed.seedNumber).padStart(4, '0')}L${String(i + 1).padStart(2, '0')}`
      nodes.push({
        legoId,
        type: w.type,
        text: w.text,
        audioId: `fixture-audio-${legoId}`,
        beltIndex: seed.beltIndex,
        seedNumber: seed.seedNumber,
        position: positions[i],
        introducedAt: daysAgoToIso(w.introducedDaysAgo),
        mastery: w.mastery,
      })
    })
  }

  // Helper to fetch a node by (seedNumber, indexInSeed).
  const bySeedPos = (seedNumber: number, i: number) => {
    return nodes.find((n) => n.seedNumber === seedNumber && n.legoId.endsWith(`L${String(i + 1).padStart(2, '0')}`))
  }

  const edges: TimelapseEdge[] = []

  function addPair(a: TimelapseNode | undefined, b: TimelapseNode | undefined, fireCount: number, structural = false) {
    if (!a || !b || a.legoId === b.legoId) return
    // first_fired_at is the LATER of the two introducedAt values (the
    // pair can't fire before both ends exist).
    const latest = Math.max(Date.parse(a.introducedAt), Date.parse(b.introducedAt))
    edges.push({
      source: a.legoId,
      target: b.legoId,
      fireCount,
      firstFiredAt: new Date(latest).toISOString(),
      structural,
    })
  }

  // ---- Within-seed structural pairings (M → A "component-of"). --------
  for (const seed of SEEDS) {
    const cohort = nodes.filter((n) => n.seedNumber === seed.seedNumber)
    const atoms = cohort.filter((n) => n.type === 'atom')
    const molecules = cohort.filter((n) => n.type === 'molecule')
    // Chain atoms together (they tend to co-occur in the same seed's
    // BUILD-up). Higher fire counts for older seeds.
    const ageBoost = Math.max(0, 30 - seed.seedNumber * 2)
    for (let i = 0; i < atoms.length - 1; i++) {
      addPair(atoms[i], atoms[i + 1], 6 + ageBoost, true)
    }
    // Each molecule links back to a couple of atoms.
    molecules.forEach((m, i) => {
      const a = atoms[i % Math.max(1, atoms.length)]
      const b = atoms[(i + 1) % Math.max(1, atoms.length)]
      if (a) addPair(m, a, 4 + ageBoost, true)
      if (b && b.legoId !== a?.legoId) addPair(m, b, 3 + ageBoost, true)
    })
  }

  // ---- Cross-seed context pairings — sparse, with a range of strengths.
  // Recurring patterns the learner has actually practised across multiple
  // contexts get the highest fire counts.
  const cross: Array<[number, number, number, number, number]> = [
    // [seedA, idxA, seedB, idxB, fireCount]
    [1, 0, 2, 0, 42], // "io" fires alongside "parlare" loads of times
    [1, 1, 2, 0, 38], // "voglio" + "parlare"
    [1, 1, 2, 1, 30], // "voglio" + "un poco"
    [1, 1, 3, 1, 18], // "voglio" + "come"
    [1, 2, 2, 0, 25], // "imparare" + "parlare"
    [2, 0, 4, 0, 14], // "parlare" + "lentamente"
    [3, 0, 1, 1, 12], // "capire" + "voglio"
    [5, 0, 6, 1, 22], // "non" + "ma"
    [5, 0, 5, 2, 50], // "non" + "non ancora" — most-fired pair (very common neg)
    [6, 0, 6, 2, 20], // "molto bene" + "sto imparando"
    [7, 0, 7, 2, 16], // "ogni" + "ogni giorno"
    [7, 2, 8, 0, 8],  // "ogni giorno" + "piano piano"
    [8, 1, 1, 1, 9],  // "pratico" + "voglio"
    [9, 0, 9, 1, 11], // "mi piace" + "questa"
    [9, 1, 9, 2, 13], // "questa" + "lingua"
    [10, 0, 10, 2, 6], // "è" + "è bella"
    [11, 0, 12, 0, 7], // "molto" + "mi piace molto"
    [9, 0, 12, 0, 5],  // "mi piace" + "mi piace molto"
    [13, 0, 13, 2, 3], // "penso" + "penso che"
    [14, 0, 15, 1, 2], // "forse" + "forse domani"
    [15, 0, 14, 0, 1], // "domani" + "forse" — first-time pair
    [16, 0, 5, 0, 2],  // "va bene" + "non"
    // a couple more sprinkled across belts for visual texture
    [3, 1, 5, 0, 4],
    [4, 0, 7, 1, 3],
    [6, 0, 9, 0, 5],
    [10, 0, 13, 0, 1],
  ]

  for (const [sa, ia, sb, ib, fc] of cross) {
    addPair(bySeedPos(sa, ia), bySeedPos(sb, ib), fc, false)
  }

  // ---- Events — sorted asc by timestamp. Drives the scrubber. ----------
  const events: TimelapseEvent[] = []
  for (const node of nodes) {
    events.push({ at: node.introducedAt, kind: 'node', ref: node.legoId })
  }
  for (const edge of edges) {
    events.push({
      at: edge.firstFiredAt,
      kind: 'edge',
      ref: `${edge.source}|${edge.target}`,
    })
  }
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

  return {
    courseCode: 'fixture_ita_for_eng',
    languageName: 'Italian',
    currentBelt: { name: 'green', color: '#4ade80', index: 3 },
    nodes,
    edges,
    events,
  }
})()
