/**
 * useBrainRenderer (v2) — PIXI + d3-force LIVE renderer for the brain
 * timelapse view.
 *
 * V1 was a static-position renderer with reveal-state opacity gating.
 * V2 is a continuous force-sim: nodes drift gently under d3-force, edges
 * scale with synapse strength (fire_count), opacity tracks the 4-tier
 * mastery ladder, and a scrubber filters the visible slice through
 * setVisibleAt().
 *
 * Forces:
 *   - link        — pulls connected nodes together
 *   - charge      — many-body repulsion so things don't pile up
 *   - centre      — soft pull toward the canvas centre
 *   - seedCluster — custom radial force pulling same-seed nodes toward
 *                   their pre-computed centroid (initial-condition only;
 *                   the sim relaxes from there).
 *
 * Sim runs continuously at alphaTarget ~0.01 — gentle "settling". When
 * the visible slice changes (scrubber moves, new nodes appear), alpha
 * is bumped to 0.3 so the system re-energises and integrates the
 * deltas, then decays back to the low target.
 *
 * Rendering:
 *   - 1 PIXI.Container per node (circle + optional glow halo + label).
 *   - 2 Graphics layers for edges: structural (back), context (front).
 *   - Edges redrawn on every visible-tick of the sim (cheap — small N).
 *   - BitmapText labels (no per-glyph upload at runtime).
 *
 * User-facing vocabulary: NEVER expose "lego" / "seed" / "round" — node
 * label is always `text` (target only), no L1 anywhere.
 */

import { ref, type Ref } from 'vue'
import {
  Application,
  Container,
  Graphics,
  BitmapText,
  BitmapFont,
  EventSystem,
  type FederatedPointerEvent,
} from 'pixi.js'
import { Viewport } from 'pixi-viewport'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
  type ForceLink,
} from 'd3-force'
import type {
  BrainTimelapseData,
  TimelapseNode,
  TimelapseEdge,
  MasteryTier,
} from '../types/brainTimelapse'

// ============================================================================
// CONSTANTS
// ============================================================================

const ATOM_RADIUS = 6
const MOLECULE_RADIUS = 10

const BACKGROUND_COLOUR = 0x0a0a0f
const LABEL_COLOUR = 0xe8e4df
const LABEL_FONT_NAME = 'SsiBrainLabelV2'
const LABEL_FONT_SIZE = 11

// Show labels when the viewport scale exceeds this multiplier (or for
// focused / neighbour-of-focused nodes even when zoomed out).
const LABEL_ZOOM_THRESHOLD = 1.25

// World defaults — force sim will shape the actual layout.
const DEFAULT_WORLD_SIZE = 4000

// Mastery → opacity ladder.
const MASTERY_ALPHA: Record<MasteryTier, number> = {
  acquisition: 0.4,
  consolidating: 0.6,
  confident: 0.8,
  mastered: 1.0,
}
// Mastery → glow halo strength (0 = off).
const MASTERY_GLOW: Record<MasteryTier, number> = {
  acquisition: 0,
  consolidating: 0.12,
  confident: 0.22,
  mastered: 0.35,
}

// Edge thickness cap (px) and minimum visible alpha so first-time pairs
// stay readable.
const MAX_EDGE_WIDTH = 6
const MIN_EDGE_ALPHA = 0.15

// Belt palette (mirrors useBeltProgress).
const BELT_COLOURS: number[] = [
  0xffffff, // 0 white
  0xfcd34d, // 1 yellow
  0xfb923c, // 2 orange
  0x4ade80, // 3 green
  0x60a5fa, // 4 blue
  0xa78bfa, // 5 purple
  0xa8856c, // 6 brown
  0xd1d5db, // 7 black (lifted so it reads on dark bg)
]

function beltColour(beltIndex: number): number {
  return BELT_COLOURS[Math.max(0, Math.min(BELT_COLOURS.length - 1, beltIndex))]
}

// ============================================================================
// PUBLIC API
// ============================================================================

export interface UseBrainRendererArgs {
  canvas: HTMLCanvasElement
  data: BrainTimelapseData
  /**
   * ISO timestamp — only render state up to here. If undefined, render
   * everything (= "now"). The scrubber updates this via setVisibleAt.
   */
  initiallyVisibleAt?: string
  onNodeTap?: (legoId: string) => void
}

export interface UseBrainRendererHandle {
  /** Filter to the slice of the brain that existed at or before `t`. */
  setVisibleAt: (timestamp: string) => void
  /** Highlight a node + its direct neighbours. Pass null to clear. */
  setFocus: (legoId: string | null) => void
  /** Currently focused legoId. Reactive for callers that want to mirror it. */
  focusedLegoId: Ref<string | null>
  /** Resize the renderer to a new canvas size. */
  resize: (width: number, height: number) => void
  /** Tear down PIXI + sim. Idempotent. */
  destroy: () => void
  /** Pixi v8 init is async — await this before driving the renderer. */
  ready: Promise<void>
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface SimNode extends SimulationNodeDatum {
  legoId: string
  /** Same-seed centroid for the radial-cluster force. */
  cx: number
  cy: number
  /** Source data — kept for fast lookup during render. */
  node: TimelapseNode
}

type SimLink = SimulationLinkDatum<SimNode> & {
  edge: TimelapseEdge
}

interface NodeView {
  container: Container
  circle: Graphics
  glow: Graphics
  label: BitmapText | null
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

export function useBrainRenderer(args: UseBrainRendererArgs): UseBrainRendererHandle {
  const { canvas, data, initiallyVisibleAt, onNodeTap } = args

  const focusedLegoId = ref<string | null>(null)

  // Pixi state
  let app: Application | null = null
  let viewport: Viewport | null = null
  let nodeLayer: Container | null = null
  let structuralEdgeLayer: Graphics | null = null
  let contextEdgeLayer: Graphics | null = null

  // Sim state
  let sim: Simulation<SimNode, SimLink> | null = null
  const simNodeById = new Map<string, SimNode>()
  // Stable links keyed by "src|tgt".
  const simLinkByKey = new Map<string, SimLink>()

  // View state
  const nodeViewById = new Map<string, NodeView>()
  const adjacency = new Map<string, Set<string>>()

  // Per-seed centroids derived from pre-computed positions.
  const seedCentroids = new Map<number, { x: number; y: number; count: number }>()

  // Visibility slice — null = "render everything".
  let visibleAt: number | null = initiallyVisibleAt ? parseTime(initiallyVisibleAt) : null

  let destroyed = false
  let currentZoom = 1

  // Pre-compute seed centroids from the source data.
  for (const n of data.nodes) {
    const existing = seedCentroids.get(n.seedNumber)
    if (existing) {
      existing.x += n.position.x
      existing.y += n.position.y
      existing.count += 1
    } else {
      seedCentroids.set(n.seedNumber, { x: n.position.x, y: n.position.y, count: 1 })
    }
  }
  for (const entry of seedCentroids.values()) {
    entry.x /= entry.count
    entry.y /= entry.count
  }

  // Build adjacency for focus/neighbour ops (uses ALL edges — visibility
  // gating happens at render time).
  for (const edge of data.edges) {
    addAdjacent(adjacency, edge.source, edge.target)
    addAdjacent(adjacency, edge.target, edge.source)
  }

  // --- async init -----------------------------------------------------------
  const ready = (async () => {
    const application = new Application()
    await application.init({
      canvas,
      width: canvas.clientWidth || 800,
      height: canvas.clientHeight || 600,
      background: BACKGROUND_COLOUR,
      antialias: true,
      autoDensity: true,
      resolution:
        typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    })
    if (destroyed) {
      application.destroy(true, { children: true })
      return
    }
    app = application

    installBrainLabelFont()

    const events = application.renderer.events as unknown as EventSystem
    const vp = new Viewport({
      screenWidth: application.renderer.width,
      screenHeight: application.renderer.height,
      worldWidth: DEFAULT_WORLD_SIZE,
      worldHeight: DEFAULT_WORLD_SIZE,
      events,
    })
    vp.drag().pinch().wheel({ smooth: 4 }).decelerate({ friction: 0.92 })
    vp.clampZoom({ minScale: 0.25, maxScale: 4 })
    application.stage.addChild(vp)
    viewport = vp

    // Layers — structural edges behind, context edges over, nodes on top.
    const structuralLayer = new Graphics()
    const contextLayer = new Graphics()
    const nodes = new Container()
    nodes.eventMode = 'passive'
    vp.addChild(structuralLayer)
    vp.addChild(contextLayer)
    vp.addChild(nodes)

    structuralEdgeLayer = structuralLayer
    contextEdgeLayer = contextLayer
    nodeLayer = nodes

    // Build all sim nodes/links once. Visibility gates them later — we
    // never destroy/recreate, we just hide via the alpha/visible toggle
    // on the views.
    initSimDataset()

    // Build views for every node.
    for (const sn of simNodeById.values()) {
      const view = buildNodeView(sn.node, (legoId) => {
        setFocus(legoId)
        onNodeTap?.(legoId)
      })
      nodes.addChild(view.container)
      nodeViewById.set(sn.legoId, view)
    }

    // Centre viewport on bounds of the initial node set.
    const bounds = computeBounds(Array.from(simNodeById.values()))
    vp.worldWidth = Math.max(DEFAULT_WORLD_SIZE, bounds.width + 800)
    vp.worldHeight = Math.max(DEFAULT_WORLD_SIZE, bounds.height + 800)
    vp.moveCenter(bounds.centerX, bounds.centerY)
    vp.setZoom(
      Math.min(1, fitScale(bounds, application.renderer.width, application.renderer.height)),
      true,
    )

    currentZoom = vp.scale.x
    vp.on('zoomed', () => {
      const z = vp.scale.x
      if (Math.abs(z - currentZoom) > 0.05) {
        currentZoom = z
        updateLabelVisibility()
      }
    })

    // Kick the sim.
    startSimulation()

    // Initial visibility / label pass.
    applyVisibility()
    updateLabelVisibility()
  })()

  // --- helpers --------------------------------------------------------------

  function initSimDataset(): void {
    for (const n of data.nodes) {
      const centroid =
        seedCentroids.get(n.seedNumber) ?? { x: n.position.x, y: n.position.y, count: 1 }
      // Jitter the initial position slightly so the sim doesn't start
      // with stacked nodes (same seed = identical centroid otherwise).
      const jitterAngle = hash(n.legoId) * Math.PI * 2
      const jitterR = 12 + (hash(n.legoId + 'r') * 20)
      const sn: SimNode = {
        legoId: n.legoId,
        x: n.position.x + Math.cos(jitterAngle) * jitterR,
        y: n.position.y + Math.sin(jitterAngle) * jitterR,
        cx: centroid.x,
        cy: centroid.y,
        node: n,
      }
      simNodeById.set(n.legoId, sn)
    }
    for (const e of data.edges) {
      const src = simNodeById.get(e.source)
      const tgt = simNodeById.get(e.target)
      if (!src || !tgt) continue
      const link: SimLink = { source: src, target: tgt, edge: e }
      simLinkByKey.set(`${e.source}|${e.target}`, link)
    }
  }

  function startSimulation(): void {
    const allNodes = Array.from(simNodeById.values())
    const allLinks = Array.from(simLinkByKey.values())

    sim = forceSimulation<SimNode, SimLink>(allNodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(allLinks)
          .id((d) => d.legoId)
          .distance((l) => {
            // Stronger fire-counts pull pairs closer together (Hebbian-ish).
            const strength = Math.log(l.edge.fireCount + 1)
            return Math.max(40, 110 - strength * 8)
          })
          .strength(0.25),
      )
      .force('charge', forceManyBody<SimNode>().strength(-90).distanceMax(420))
      .force('center', forceCenter(0, 0).strength(0.04))
      .force('seedCluster', seedClusterForce(0.05))
      .alpha(0.6)
      .alphaTarget(0.01)
      .alphaDecay(0.012)
      .velocityDecay(0.55)
      .on('tick', () => {
        renderFrame()
      })
  }

  /**
   * Custom radial force pulling each node toward its seed centroid.
   * Keeps cohorts loosely clustered without freezing the layout.
   */
  function seedClusterForce(strength: number) {
    let nodes: SimNode[] = []
    function force(alpha: number) {
      const k = strength * alpha
      for (const n of nodes) {
        if (n.x == null || n.y == null) continue
        n.vx = (n.vx ?? 0) + (n.cx - n.x) * k
        n.vy = (n.vy ?? 0) + (n.cy - n.y) * k
      }
    }
    force.initialize = (ns: SimNode[]) => {
      nodes = ns
    }
    return force
  }

  function renderFrame(): void {
    drawEdges()
    syncNodePositions()
  }

  function drawEdges(): void {
    if (!structuralEdgeLayer || !contextEdgeLayer) return
    structuralEdgeLayer.clear()
    contextEdgeLayer.clear()

    for (const link of simLinkByKey.values()) {
      if (!isEdgeVisible(link.edge)) continue
      const src = link.source as SimNode
      const tgt = link.target as SimNode
      if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) continue

      const intensity = Math.log(link.edge.fireCount + 1)
      const width = Math.min(MAX_EDGE_WIDTH, 0.6 + intensity * 0.9)
      const alpha = Math.max(MIN_EDGE_ALPHA, Math.min(0.85, 0.18 + intensity * 0.13))

      const target = link.edge.structural ? structuralEdgeLayer : contextEdgeLayer
      target.moveTo(src.x, src.y)
      target.lineTo(tgt.x, tgt.y)
      target.stroke({
        width,
        color: 0xffffff,
        alpha,
      })
    }
  }

  function syncNodePositions(): void {
    for (const sn of simNodeById.values()) {
      const view = nodeViewById.get(sn.legoId)
      if (!view) continue
      if (sn.x == null || sn.y == null) continue
      view.container.x = sn.x
      view.container.y = sn.y
    }
  }

  function buildNodeView(
    node: TimelapseNode,
    onTap: (legoId: string) => void,
  ): NodeView {
    const container = new Container()
    container.eventMode = 'static'
    container.cursor = 'pointer'
    const radius = node.type === 'molecule' ? MOLECULE_RADIUS : ATOM_RADIUS
    const colour = beltColour(node.beltIndex)
    const mastery = node.mastery

    // Glow halo (drawn behind the main circle).
    const glow = new Graphics()
    const glowStrength = MASTERY_GLOW[mastery]
    if (glowStrength > 0) {
      glow.circle(0, 0, radius * 2.4)
      glow.fill({ color: colour, alpha: glowStrength })
    }
    container.addChild(glow)

    // Main circle.
    const circle = new Graphics()
    circle.circle(0, 0, radius)
    circle.fill({ color: colour, alpha: 1 })
    circle.circle(0, 0, radius)
    circle.stroke({ color: 0x111118, alpha: 0.9, width: 1 })
    container.addChild(circle)

    container.alpha = MASTERY_ALPHA[mastery]

    // Label.
    let label: BitmapText | null = null
    if (node.text && node.text.length > 0) {
      label = new BitmapText({
        text: node.text,
        style: {
          fontFamily: LABEL_FONT_NAME,
          fontSize: LABEL_FONT_SIZE,
          align: 'center',
          fill: LABEL_COLOUR,
        },
      })
      label.anchor.set(0.5, 0)
      label.y = radius + 4
      label.scale.set(0.5)
      label.visible = false
      container.addChild(label)
    }

    container.on('pointertap', (e: FederatedPointerEvent) => {
      e.stopPropagation()
      onTap(node.legoId)
    })

    return { container, circle, glow, label }
  }

  // --- visibility gating ----------------------------------------------------

  function isNodeVisible(n: TimelapseNode): boolean {
    if (visibleAt == null) return true
    return parseTime(n.introducedAt) <= visibleAt
  }
  function isEdgeVisible(e: TimelapseEdge): boolean {
    if (visibleAt == null) return true
    // Both endpoints must also be visible (defensive — the data
    // contract says edges can't predate their nodes, but cheap to check).
    const src = simNodeById.get(e.source)?.node
    const tgt = simNodeById.get(e.target)?.node
    if (!src || !tgt) return false
    return (
      parseTime(e.firstFiredAt) <= visibleAt &&
      parseTime(src.introducedAt) <= visibleAt &&
      parseTime(tgt.introducedAt) <= visibleAt
    )
  }

  function applyVisibility(): void {
    for (const sn of simNodeById.values()) {
      const view = nodeViewById.get(sn.legoId)
      if (!view) continue
      view.container.visible = isNodeVisible(sn.node)
    }
    // Edges are drawn into the Graphics layers each tick — visibility
    // gates inside drawEdges. Force a redraw so we don't wait for the
    // next tick to reflect the change.
    drawEdges()
  }

  function setVisibleAt(timestamp: string): void {
    const t = parseTime(timestamp)
    if (visibleAt === t) return
    visibleAt = t
    applyVisibility()
    // Re-energise so the sim integrates the deltas naturally.
    if (sim) sim.alpha(0.3).restart()
    updateLabelVisibility()
  }

  // --- focus / highlight ----------------------------------------------------

  function setFocus(legoId: string | null): void {
    focusedLegoId.value = legoId
    updateNodeEmphasis()
    updateLabelVisibility()
    if (!viewport || !legoId) return
    const sn = simNodeById.get(legoId)
    if (!sn || sn.x == null || sn.y == null) return
    viewport.animate({
      time: 350,
      position: { x: sn.x, y: sn.y },
      ease: 'easeInOutSine',
    })
  }

  function updateNodeEmphasis(): void {
    const focusId = focusedLegoId.value
    const neighbours = focusId
      ? adjacency.get(focusId) ?? new Set<string>()
      : new Set<string>()

    nodeViewById.forEach((view, legoId) => {
      const sn = simNodeById.get(legoId)
      if (!sn) return
      const base = MASTERY_ALPHA[sn.node.mastery]
      let alpha = base
      if (focusId) {
        if (legoId === focusId) alpha = 1
        else if (neighbours.has(legoId)) alpha = Math.max(base, 0.85)
        else alpha = base * 0.4
      }
      view.container.alpha = alpha
      view.circle.scale.set(legoId === focusId ? 1.25 : 1)
    })
  }

  function updateLabelVisibility(): void {
    const focusId = focusedLegoId.value
    const neighbours = focusId
      ? adjacency.get(focusId) ?? new Set<string>()
      : new Set<string>()
    const zoomedIn = currentZoom >= LABEL_ZOOM_THRESHOLD

    nodeViewById.forEach((view, legoId) => {
      if (!view.label) return
      const sn = simNodeById.get(legoId)
      if (!sn) return
      if (!isNodeVisible(sn.node)) {
        view.label.visible = false
        return
      }
      const isFocus = legoId === focusId
      const isNeighbourOfFocus = neighbours.has(legoId)
      view.label.visible = zoomedIn || isFocus || isNeighbourOfFocus
    })
  }

  // --- lifecycle ------------------------------------------------------------

  function resize(width: number, height: number): void {
    if (!app || !viewport) return
    app.renderer.resize(width, height)
    viewport.resize(width, height, viewport.worldWidth, viewport.worldHeight)
  }

  function destroy(): void {
    destroyed = true
    if (sim) {
      sim.stop()
      sim = null
    }
    if (viewport) {
      viewport.destroy({ children: true })
      viewport = null
    }
    if (app) {
      app.destroy(false, { children: true, texture: false })
      app = null
    }
    nodeViewById.clear()
    simNodeById.clear()
    simLinkByKey.clear()
    adjacency.clear()
    seedCentroids.clear()
  }

  return {
    setVisibleAt,
    setFocus,
    focusedLegoId,
    resize,
    destroy,
    ready,
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function addAdjacent(map: Map<string, Set<string>>, a: string, b: string): void {
  let set = map.get(a)
  if (!set) {
    set = new Set()
    map.set(a, set)
  }
  set.add(b)
}

function parseTime(iso: string): number {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

function computeBounds(simNodes: SimNode[]): {
  width: number
  height: number
  centerX: number
  centerY: number
} {
  if (simNodes.length === 0) {
    return { width: 0, height: 0, centerX: 0, centerY: 0 }
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const sn of simNodes) {
    const x = sn.x ?? 0
    const y = sn.y ?? 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const width = maxX - minX
  const height = maxY - minY
  return {
    width,
    height,
    centerX: minX + width / 2,
    centerY: minY + height / 2,
  }
}

function fitScale(
  bounds: { width: number; height: number },
  screenW: number,
  screenH: number,
): number {
  if (bounds.width === 0 || bounds.height === 0) return 1
  const padding = 1.3
  return Math.min(screenW / (bounds.width * padding), screenH / (bounds.height * padding))
}

let _fontInstalled = false
function installBrainLabelFont(): void {
  if (_fontInstalled) return
  _fontInstalled = true
  BitmapFont.install({
    name: LABEL_FONT_NAME,
    style: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      fontSize: LABEL_FONT_SIZE * 2, // generate at 2x then scale down for crispness
      fill: LABEL_COLOUR,
    },
    resolution: 2,
  })
}

/** Deterministic float in [0, 1) keyed by a string — used for layout jitter. */
function hash(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return (h % 10000) / 10000
}
