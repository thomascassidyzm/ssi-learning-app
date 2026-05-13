/**
 * Brain view v2 — *living timelapse* types.
 *
 * V1 was a static distinction-network with a tour mode. V2 reframes the
 * brain as a continuous, scrubbable timelapse: every node has an
 * introducedAt timestamp, every edge has first_fired_at + a fire_count
 * synapse-strength counter. The renderer reads (data, visibleAt) and
 * draws only the slice of the brain that existed at that moment.
 *
 * Three components work against this contract:
 *   - useBrainTimelapseData.ts   (Agent A — data composable)
 *   - useBrainRenderer.ts        (Agent B — PIXI + d3-force renderer)
 *   - BrainView.vue              (Agent B — chrome + scrubber)
 *
 * Locked v2 design rules:
 *   1. The brain grows. Un-introduced LEGOs do not appear (no ghost nodes).
 *   2. Synapses thicken with use. Edges scale on log(fire_count + 1).
 *   3. Mastery → 4-tier opacity + glow ladder.
 *   4. Forward-only firing data. No retconning.
 *   5. Target text only — no L1 / translation on the canvas.
 *   6. Scrubbable. Scrubber drives setVisibleAt(t).
 *   7. No live updates while open. Load-time snapshot only.
 *
 * User-facing vocabulary: NEVER expose "lego", "seed", "round" to the
 * learner. Nodes are *words and phrases*. Belts are belts.
 */

/**
 * 4-tier mastery ladder — drives node opacity AND glow halo strength.
 * 'acquisition'   - first encounter, just introduced
 * 'consolidating' - few correct repetitions, still rough
 * 'confident'     - regularly produced, occasional gaps
 * 'mastered'      - eternal-rotation grade, ratchet has locked in
 */
export type MasteryTier =
  | 'acquisition'
  | 'consolidating'
  | 'confident'
  | 'mastered'

export interface TimelapseNode {
  /** Internal id — never shown to the user. Used for tap routing + audio lookup. */
  legoId: string
  /** Visual shape hint: 'atom' = single word, 'molecule' = phrase. */
  type: 'atom' | 'molecule'
  /** Target word or phrase — shown as the node label. */
  text: string
  /** Tap-to-play audio id (target voice 1 by default). */
  audioId: string
  /** 0-7, drives node colour from the belt palette. */
  beltIndex: number
  /** Same-seed nodes cluster — drives the radial-cluster force. Not shown to user. */
  seedNumber: number
  /**
   * Pre-computed (x, y) seed centroid from Agent A's
   * `course_lego_positions` table — used as INITIAL conditions for the
   * live force-sim. The sim then drifts these naturally.
   */
  position: { x: number; y: number }
  /**
   * Forward-only debut timestamp (ISO 8601). Node enters the canvas
   * the moment scrubber crosses this. Never null — un-introduced
   * LEGOs simply aren't in `data.nodes`.
   */
  introducedAt: string
  /** Current mastery level for this learner. Drives opacity + glow. */
  mastery: MasteryTier
}

/**
 * Synapse — a pair of LEGOs that have fired together in at least one
 * cycle. Forward-only: no decay, fire_count only goes up.
 */
export interface TimelapseEdge {
  /** legoId of source. */
  source: string
  /** legoId of target. */
  target: string
  /**
   * Number of times this pair has co-occurred in a cycle. Edge
   * thickness + alpha = log(fire_count + 1). Min 1 by definition
   * (otherwise the pair wouldn't be in the data).
   */
  fireCount: number
  /**
   * First-fired timestamp (ISO 8601). Edge enters the canvas the
   * moment scrubber crosses this. Forward-only.
   */
  firstFiredAt: string
  /**
   * Optional structural flag — true for methodology-derived links
   * (M→A component-of). False / absent for pure context co-occurrence.
   * Structural edges draw on the back layer; context edges over them.
   */
  structural?: boolean
}

/**
 * Timeline event — one entry per "something appeared" moment. The
 * scrubber's play-button advances event-by-event, so this is the
 * canonical list of moments worth scrubbing to.
 *
 * `kind: 'node'` → a LEGO debuted.
 * `kind: 'edge'` → a synapse fired for the first time.
 * `kind: 'mastery'` → a LEGO advanced a mastery tier.
 *
 * `at` is the ISO timestamp; the scrubber lerps continuously between
 * events and reveals each as visibleAt crosses it.
 */
export interface TimelapseEvent {
  at: string
  kind: 'node' | 'edge' | 'mastery'
  /** legoId for 'node' / 'mastery', `${source}|${target}` for 'edge'. */
  ref: string
}

export interface BrainTimelapseData {
  courseCode: string
  /** Display name for the header — e.g. "Italian". */
  languageName: string
  /** Current belt — used for header accent colour. */
  currentBelt: { name: string; color: string; index: number }
  nodes: TimelapseNode[]
  edges: TimelapseEdge[]
  /**
   * Sorted (asc) timeline events derived from nodes + edges. The
   * scrubber's playhead snaps to / advances through these.
   * `events[0].at` is the scrubber's MIN bound; `now` is its MAX.
   */
  events: TimelapseEvent[]
}
