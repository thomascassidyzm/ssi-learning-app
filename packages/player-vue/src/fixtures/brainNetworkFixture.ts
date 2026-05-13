/**
 * brainNetworkFixture — hand-built BrainViewData for renderer development
 * before Agent A's useBrainNetwork composable is wired up.
 *
 * Shape:
 *  - 3 seeds (one per belt: white / yellow / orange)
 *  - ~10 nodes per seed = 30 nodes total (atoms + molecules)
 *  - A mix of revealed and not-yet-revealed nodes so the alpha gating is
 *    visible without any session data
 *  - Both structural and context edges
 *
 * Positions are laid out in three loose clusters so the seed-cohort bias
 * shows clearly in the renderer (one cluster per seed, slight overlap so
 * cross-seed context edges have something to do).
 *
 * Audio ids are placeholder strings — the renderer does not consume them.
 */

import type { BrainViewData } from '../types/brainNetwork'

interface ClusterSpec {
  seedNumber: number
  beltIndex: number
  centerX: number
  centerY: number
  words: Array<{
    text: string
    knownText: string
    type: 'atom' | 'molecule'
    isRevealed: boolean
  }>
}

const CLUSTERS: ClusterSpec[] = [
  {
    seedNumber: 1,
    beltIndex: 0, // white
    centerX: 0,
    centerY: 0,
    words: [
      { text: 'io',           knownText: 'I',           type: 'atom',     isRevealed: true  },
      { text: 'voglio',       knownText: 'want',        type: 'atom',     isRevealed: true  },
      { text: 'imparare',     knownText: 'learn',       type: 'atom',     isRevealed: true  },
      { text: "l'italiano",   knownText: 'Italian',     type: 'molecule', isRevealed: true  },
      { text: 'voglio imparare', knownText: 'I want to learn', type: 'molecule', isRevealed: true  },
      { text: 'parlare',      knownText: 'to speak',    type: 'atom',     isRevealed: true  },
      { text: 'capire',       knownText: 'to understand', type: 'atom',   isRevealed: false },
      { text: 'un poco',      knownText: 'a little',    type: 'molecule', isRevealed: false },
      { text: 'come',         knownText: 'how',         type: 'atom',     isRevealed: false },
      { text: 'parlare italiano', knownText: 'speak Italian', type: 'molecule', isRevealed: false },
    ],
  },
  {
    seedNumber: 2,
    beltIndex: 1, // yellow
    centerX: 900,
    centerY: 120,
    words: [
      { text: 'non',          knownText: 'not',          type: 'atom',     isRevealed: true  },
      { text: 'ancora',       knownText: 'yet',          type: 'atom',     isRevealed: true  },
      { text: 'molto bene',   knownText: 'very well',    type: 'molecule', isRevealed: true  },
      { text: 'non ancora',   knownText: 'not yet',      type: 'molecule', isRevealed: true  },
      { text: 'ma',           knownText: 'but',          type: 'atom',     isRevealed: true  },
      { text: 'sto',          knownText: 'I am',         type: 'atom',     isRevealed: false },
      { text: 'imparando',    knownText: 'learning',     type: 'atom',     isRevealed: false },
      { text: 'sto imparando', knownText: "I'm learning", type: 'molecule', isRevealed: false },
      { text: 'ogni giorno',  knownText: 'every day',    type: 'molecule', isRevealed: false },
      { text: 'piano piano',  knownText: 'slowly',       type: 'molecule', isRevealed: false },
    ],
  },
  {
    seedNumber: 3,
    beltIndex: 2, // orange
    centerX: 450,
    centerY: 850,
    words: [
      { text: 'mi piace',     knownText: 'I like',       type: 'molecule', isRevealed: false },
      { text: 'questa',       knownText: 'this',         type: 'atom',     isRevealed: false },
      { text: 'lingua',       knownText: 'language',     type: 'atom',     isRevealed: false },
      { text: 'questa lingua', knownText: 'this language', type: 'molecule', isRevealed: false },
      { text: 'è',            knownText: 'is',           type: 'atom',     isRevealed: false },
      { text: 'bella',        knownText: 'beautiful',    type: 'atom',     isRevealed: false },
      { text: 'è bella',      knownText: 'is beautiful', type: 'molecule', isRevealed: false },
      { text: 'molto',        knownText: 'very',         type: 'atom',     isRevealed: false },
      { text: 'davvero',      knownText: 'really',       type: 'atom',     isRevealed: false },
      { text: 'mi piace molto', knownText: 'I really like it', type: 'molecule', isRevealed: false },
    ],
  },
]

// Lay nodes out around each cluster centre on a jittered grid.
function positionsForCluster(c: ClusterSpec): Array<{ x: number; y: number }> {
  const n = c.words.length
  const ringRadius = 180
  const result: Array<{ x: number; y: number }> = []
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2
    // Use a deterministic jitter so positions stay stable across reloads.
    const jitter = ((i * 37) % 60) - 30
    const r = ringRadius + jitter
    result.push({
      x: c.centerX + Math.cos(angle) * r,
      y: c.centerY + Math.sin(angle) * r,
    })
  }
  return result
}

export const brainNetworkFixture: BrainViewData = (() => {
  const nodes: BrainViewData['nodes'] = []

  // Build nodes.
  for (const cluster of CLUSTERS) {
    const positions = positionsForCluster(cluster)
    cluster.words.forEach((w, i) => {
      const legoId = `S000${cluster.seedNumber}L${String(i + 1).padStart(2, '0')}`
      nodes.push({
        legoId,
        type: w.type,
        text: w.text,
        knownText: w.knownText,
        audioId: `fixture-audio-${legoId}`,
        beltIndex: cluster.beltIndex,
        seedNumber: cluster.seedNumber,
        position: positions[i],
        isRevealed: w.isRevealed,
      })
    })
  }

  // Build edges:
  //   - Structural: chain atoms together inside each seed cohort, then
  //     join every molecule back to its component atoms (a rough stand-in
  //     for the methodology relationship).
  //   - Context: a sparser set of co-occurrence edges across seeds, biased
  //     toward revealed nodes so the fixture lights up sensibly.
  const edges: BrainViewData['edges'] = []
  const bySeed: Record<number, typeof nodes> = {}
  for (const n of nodes) {
    if (!bySeed[n.seedNumber]) bySeed[n.seedNumber] = []
    bySeed[n.seedNumber].push(n)
  }

  for (const seedNum of Object.keys(bySeed)) {
    const cohort = bySeed[Number(seedNum)]
    const atoms = cohort.filter((n) => n.type === 'atom')
    const molecules = cohort.filter((n) => n.type === 'molecule')

    // Chain atoms in cohort.
    for (let i = 0; i < atoms.length - 1; i++) {
      edges.push({
        source: atoms[i].legoId,
        target: atoms[i + 1].legoId,
        type: 'structural',
        strength: 0.9,
      })
    }
    // Connect each molecule to two atoms (rough component-of).
    molecules.forEach((m, i) => {
      const a = atoms[i % atoms.length]
      const b = atoms[(i + 1) % atoms.length]
      if (a && a.legoId !== m.legoId) {
        edges.push({ source: m.legoId, target: a.legoId, type: 'structural', strength: 1 })
      }
      if (b && b.legoId !== m.legoId && b.legoId !== a?.legoId) {
        edges.push({ source: m.legoId, target: b.legoId, type: 'structural', strength: 1 })
      }
    })
  }

  // Cross-seed context edges (sparse).
  const revealed = nodes.filter((n) => n.isRevealed)
  for (let i = 0; i < revealed.length; i++) {
    const a = revealed[i]
    const b = revealed[(i * 3 + 1) % revealed.length]
    if (a.seedNumber !== b.seedNumber && a.legoId !== b.legoId) {
      edges.push({
        source: a.legoId,
        target: b.legoId,
        type: 'context',
        strength: 0.4 + ((i * 7) % 40) / 100,
      })
    }
  }
  // A couple of context edges into unrevealed nodes too, so the gating is
  // obvious when the fixture is rendered.
  edges.push({ source: 'S0001L03', target: 'S0001L09', type: 'context', strength: 0.3 })
  edges.push({ source: 'S0002L03', target: 'S0003L01', type: 'context', strength: 0.25 })

  return {
    courseCode: 'fixture_ita_for_eng',
    languageName: 'Italian',
    nodes,
    edges,
  }
})()

export const brainNetworkFixtureStats = {
  revealedCount: brainNetworkFixture.nodes.filter((n) => n.isRevealed).length,
  totalCount: brainNetworkFixture.nodes.length,
  currentBelt: { name: 'yellow', color: '#fcd34d', index: 1 },
}
