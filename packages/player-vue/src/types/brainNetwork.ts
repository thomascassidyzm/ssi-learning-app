/**
 * Shared types for the brain view ("Your brain on Italian") — a 2D
 * distinction-network visualisation of every word/phrase the learner
 * has encountered on a given course.
 *
 * v1 components (static graph + side panel):
 *   - useBrainNetwork.ts        (v1 data composable, still used by edges)
 *   - BrainView.vue             (PIXI renderer + interaction)
 *   - BrainSidePanel.vue        (node detail + audio)
 *
 * v2 components (living timelapse):
 *   - useBrainTimelapseData.ts  (data composable — chronological events)
 *   - usePairingsTelemetry.ts   (writes co-firing rows during play)
 *   - useBrainRenderer.ts       (PIXI renderer — synapse thickness from
 *                                log(fire_count + 1), 4-tier brightness)
 *   - BrainView.vue / BrainScreen.vue (v2 rewrites by Agent B / C)
 *
 * User-facing vocabulary: NEVER expose "lego", "seed", "round" to the
 * learner. Nodes are *words and phrases*. Belts are belts.
 */

/** v2 — 4-tier discrete brightness ladder. Mirrors learner_lego_metrics.mastery_state. */
export type MasteryState = 'acquisition' | 'consolidating' | 'confident' | 'mastered'

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
  /**
   * v2 — drives node brightness on the 4-tier discrete ladder. Defaults to
   * 'acquisition' when a learner_lego_metrics row exists but no advancement
   * has occurred. Undefined / not-yet-introduced nodes don't appear at all.
   */
  masteryState: MasteryState
  /**
   * v2 — ISO timestamp of when the learner first debuted this node
   * (learner_lego_metrics.last_seen_at). Null = not yet introduced; the v2
   * timelapse composable filters those out (no ghost nodes). Drives the
   * `node_introduced` events on the scrubber.
   */
  introducedAt: string | null
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

// ============================================================================
// v2 — Living timelapse types
// ============================================================================

/**
 * v2 — a single chronologically-ordered event that drives the timelapse
 * scrubber. The scrubber position is a timestamp; the renderer plays back
 * every event with `at <= scrubberPosition`.
 *
 * `pairing_strengthened` is reserved for a future iteration — we do not
 * have per-fire timestamps in v2, so re-firings show up as a higher
 * `fire_count` on the existing `pairing_first_fired` event rather than as
 * additional events.
 */
export interface BrainTimelapseEvent {
  type: 'node_introduced' | 'pairing_first_fired' | 'pairing_strengthened'
  /** ISO timestamp the event occurred at. */
  at: string
  /** For `node_introduced`. */
  legoId?: string
  /** For `pairing_*`. Canonical order (legoA < legoB). */
  pair?: [string, string]
  /** For `pairing_strengthened`. Current fire_count after the bump. */
  fireCount?: number
}

/** v2 — one pair row, ready for the renderer to draw a synapse line. */
export interface BrainPairing {
  legoA: string
  legoB: string
  fireCount: number
  /** ISO timestamp — edge fades in from this point on the scrubber. */
  firstFiredAt: string
  /**
   * ISO timestamp — informational only in v2 (no per-fire scrubber events).
   * The renderer can use this to fade edges that haven't been used in a
   * while if/when decay lands.
   */
  lastFiredAt: string
}

/**
 * v2 — full payload for the timelapse view. The scrubber drives playback;
 * `events` is the chronological script. `nodes` and `pairings` are the
 * final-state lookup tables the renderer indexes into as events fire.
 */
export interface BrainTimelapseData {
  courseCode: string
  languageName: string
  /** All introduced nodes (no ghosts). Final state. */
  nodes: NetworkNode[]
  /** All pairings the learner has fired. Final state. */
  pairings: BrainPairing[]
  /** Chronologically ordered. Drives the scrubber timeline. */
  events: BrainTimelapseEvent[]
}
