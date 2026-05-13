/**
 * Shared types for the brain view ("Your brain on Italian") — a 2D
 * distinction-network visualisation of every word/phrase the learner
 * has encountered on a given course.
 *
 * Three components work against this contract:
 *   - useBrainNetwork.ts        (data composable)
 *   - BrainView.vue             (PIXI renderer + interaction)
 *   - BrainSidePanel.vue        (node detail + audio)
 *
 * User-facing vocabulary: NEVER expose "lego", "seed", "round" to the
 * learner. Nodes are *words and phrases*. Belts are belts.
 */

export interface NetworkNode {
  /** Internal id — never shown to the user. Used for tap routing + audio lookup. */
  legoId: string
  /** Visual shape hint: 'atom' = small circle, 'molecule' = larger / squircle. */
  type: 'atom' | 'molecule'
  /** Target word or phrase — shown as the node label. */
  text: string
  /** Translation of `text` in the learner's known language. Side-panel only. */
  knownText: string
  /** Tap-to-play audio id (target voice 1 by default). */
  audioId: string
  /** 0-7, drives node colour from the belt palette. */
  beltIndex: number
  /** For force-cluster bias — same seed = pulled together. NEVER labelled to the user. */
  seedNumber: number
  /** Pre-computed by `precompute-lego-positions.cjs`, persisted in `course_lego_positions`. */
  position: { x: number; y: number }
  /** True once the learner has debuted this node (any row in learner_lego_metrics). */
  isRevealed: boolean
}

export interface NetworkEdge {
  /** legoId of the source node. */
  source: string
  /** legoId of the target node. */
  target: string
  /**
   * 'structural' = methodology relationship (seed-cohort, M→A component-of). Drawn solid.
   * 'context'    = phrase co-occurrence. Drawn thin, low alpha.
   */
  type: 'structural' | 'context'
  /** 0-1, scales edge opacity. For context edges, derived from co-occurrence count. */
  strength: number
}

export interface BrainViewData {
  courseCode: string
  /** Display name for the header — e.g. "Italian". */
  languageName: string
  nodes: NetworkNode[]
  edges: NetworkEdge[]
}

export interface BrainViewStats {
  /** Count of nodes where isRevealed === true. Drives the "X things you can say" subline. */
  revealedCount: number
  totalCount: number
  /** For header accent — comes from useBeltProgress. */
  currentBelt: { name: string; color: string; index: number }
}
