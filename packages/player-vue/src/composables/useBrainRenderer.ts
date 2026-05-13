/**
 * useBrainRenderer — PIXI-backed renderer for the brain view.
 *
 * Owns the PIXI.Application + pixi-viewport instance. Draws structural and
 * context edges into two Graphics layers behind a node layer of Container
 * nodes (one circle + one BitmapText label each).
 *
 * Visibility rules:
 *  - revealed nodes draw at full opacity; unrevealed at 0.25.
 *  - labels are hidden by default and shown only when the viewport is zoomed
 *    in past LABEL_ZOOM_THRESHOLD, OR when the node is focused / a direct
 *    neighbour of the focused node.
 *
 * Performance notes (target: 60fps with ~623 nodes on iPhone Safari):
 *  - One Graphics per edge type (not per edge) — re-drawn once at init.
 *  - BitmapText for labels (no per-glyph texture upload at runtime).
 *  - Node containers use `eventMode: 'static'` so hit-test only walks
 *    interactive nodes, not the edge layers.
 *  - Label visibility is updated only on zoom-change and focus-change, not
 *    every frame.
 *
 * User-facing vocabulary: NEVER expose "lego" / "seed" / "round" from any
 * label, tooltip or callback payload. Callers identify nodes by legoId
 * internally but render text from NetworkNode.text.
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
import type {
  BrainViewData,
  BrainViewStats,
  NetworkNode,
  NetworkEdge,
} from '../types/brainNetwork'

// ============================================================================
// CONSTANTS
// ============================================================================

const ATOM_RADIUS = 8
const MOLECULE_RADIUS = 12

const REVEALED_ALPHA = 1.0
const HIDDEN_ALPHA = 0.25

const STRUCTURAL_EDGE_ALPHA = 0.55
const CONTEXT_EDGE_ALPHA = 0.18

const STRUCTURAL_EDGE_COLOUR = 0x6b7280 // slate-500
const CONTEXT_EDGE_COLOUR = 0x4b5563 // slate-600

const BACKGROUND_COLOUR = 0x0a0a0f
const LABEL_COLOUR = 0xe8e4df
const LABEL_FONT_NAME = 'SsiBrainLabel'
const LABEL_FONT_SIZE = 12

// Show labels when the viewport scale exceeds this multiplier.
const LABEL_ZOOM_THRESHOLD = 1.35

// World bounds — pre-computed positions are expected to fit roughly inside.
// Final clamp is set from data bounds at init time.
const DEFAULT_WORLD_SIZE = 4000

// Belt palette (mirrors BELTS in useBeltProgress, kept local so this
// composable stays self-contained / framework-agnostic).
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
  data: BrainViewData
  stats: BrainViewStats
  onNodeTap?: (legoId: string) => void
}

export interface UseBrainRendererHandle {
  /** Centres + emphasises a node by legoId. Pass null to clear. */
  setFocus: (legoId: string | null) => void
  /** Currently focused legoId, or null. Reactive for callers that need it. */
  focusedLegoId: Ref<string | null>
  /** Tear down PIXI + viewport. Idempotent. */
  destroy: () => void
  /** Resize the renderer to the canvas's CSS size. Call on viewport changes. */
  resize: (width: number, height: number) => void
  /** Initialise the renderer. Returns a promise — Pixi v8 init is async. */
  ready: Promise<void>
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

export function useBrainRenderer(args: UseBrainRendererArgs): UseBrainRendererHandle {
  const { canvas, data, stats, onNodeTap } = args

  const focusedLegoId = ref<string | null>(null)

  // Pixi state — assigned during init.
  let app: Application | null = null
  let viewport: Viewport | null = null
  let nodeLayer: Container | null = null
  let structuralEdgeLayer: Graphics | null = null
  let contextEdgeLayer: Graphics | null = null

  // Node lookups for fast focus / neighbour resolution.
  const nodeById = new Map<string, NetworkNode>()
  const nodeContainerById = new Map<string, NodeView>()
  const adjacency = new Map<string, Set<string>>()

  let destroyed = false
  let currentZoom = 1

  // Build lookups synchronously so callers can resolve neighbours even
  // before the async PIXI init resolves.
  for (const node of data.nodes) {
    nodeById.set(node.legoId, node)
  }
  for (const edge of data.edges) {
    addAdjacent(adjacency, edge.source, edge.target)
    addAdjacent(adjacency, edge.target, edge.source)
  }

  // --- async init ---
  const ready = (async () => {
    const application = new Application()
    await application.init({
      canvas,
      width: canvas.clientWidth || 800,
      height: canvas.clientHeight || 600,
      background: BACKGROUND_COLOUR,
      antialias: true,
      autoDensity: true,
      resolution: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    })
    if (destroyed) {
      application.destroy(true, { children: true })
      return
    }
    app = application

    // Bitmap font — install once per page lifetime.
    installBrainLabelFont()

    // Viewport. Needs the EventSystem from the renderer.
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

    // World bounds derived from node positions (with padding) so the
    // network sits inside a sensible scrollable area.
    const bounds = computeBounds(data.nodes)
    vp.worldWidth = Math.max(DEFAULT_WORLD_SIZE, bounds.width + 800)
    vp.worldHeight = Math.max(DEFAULT_WORLD_SIZE, bounds.height + 800)

    // Layers — edges behind nodes.
    const structuralLayer = new Graphics()
    const contextLayer = new Graphics()
    const nodes = new Container()
    nodes.eventMode = 'passive' // children opt in; container itself is just a parent
    vp.addChild(contextLayer)
    vp.addChild(structuralLayer)
    vp.addChild(nodes)

    structuralEdgeLayer = structuralLayer
    contextEdgeLayer = contextLayer
    nodeLayer = nodes

    drawEdges(structuralLayer, contextLayer, data.edges, nodeById)
    buildNodes(nodes, data.nodes, nodeContainerById, (legoId) => {
      setFocus(legoId)
      onNodeTap?.(legoId)
    })

    // Centre on the centre of mass of the network at start.
    vp.moveCenter(bounds.centerX, bounds.centerY)
    vp.setZoom(Math.min(1, fitScale(bounds, application.renderer.width, application.renderer.height)), true)

    // Track zoom for label visibility.
    currentZoom = vp.scale.x
    vp.on('zoomed', () => {
      const z = vp.scale.x
      if (Math.abs(z - currentZoom) > 0.05) {
        currentZoom = z
        updateLabelVisibility()
      }
    })

    // Initial paint of label visibility (everything starts hidden unless
    // zoom threshold is already crossed by the fit-scale).
    updateLabelVisibility()

    // Stats currently unused inside the renderer; the BrainView component
    // handles header copy. Keeping the param in the public contract so the
    // composable can grow into things like a "% revealed" minimap without
    // an API change.
    void stats
  })()

  function setFocus(legoId: string | null): void {
    focusedLegoId.value = legoId
    updateNodeEmphasis()
    updateLabelVisibility()

    if (!viewport || !legoId) return
    const node = nodeById.get(legoId)
    if (!node) return
    // Smoothly pan to the focused node without changing zoom level.
    viewport.animate({
      time: 350,
      position: { x: node.position.x, y: node.position.y },
      ease: 'easeInOutSine',
    })
  }

  function resize(width: number, height: number): void {
    if (!app || !viewport) return
    app.renderer.resize(width, height)
    viewport.resize(width, height, viewport.worldWidth, viewport.worldHeight)
  }

  function destroy(): void {
    destroyed = true
    if (viewport) {
      viewport.destroy({ children: true })
      viewport = null
    }
    if (app) {
      // canvas:false because the caller owns the <canvas> element.
      app.destroy(false, { children: true, texture: false })
      app = null
    }
    nodeContainerById.clear()
    nodeById.clear()
    adjacency.clear()
  }

  // ---- internal: per-frame-ish DOM updates ----------------------------------

  function updateNodeEmphasis(): void {
    const focusId = focusedLegoId.value
    const neighbours = focusId ? adjacency.get(focusId) ?? new Set<string>() : new Set<string>()

    nodeContainerById.forEach((view, legoId) => {
      const node = nodeById.get(legoId)!
      const baseAlpha = node.isRevealed ? REVEALED_ALPHA : HIDDEN_ALPHA
      let alpha = baseAlpha
      if (focusId) {
        if (legoId === focusId) alpha = 1
        else if (neighbours.has(legoId)) alpha = Math.max(baseAlpha, 0.85)
        else alpha = baseAlpha * 0.4
      }
      view.container.alpha = alpha
      view.circle.scale.set(legoId === focusId ? 1.25 : 1)
    })
  }

  function updateLabelVisibility(): void {
    const focusId = focusedLegoId.value
    const neighbours = focusId ? adjacency.get(focusId) ?? new Set<string>() : new Set<string>()
    const zoomedIn = currentZoom >= LABEL_ZOOM_THRESHOLD

    nodeContainerById.forEach((view, legoId) => {
      const node = nodeById.get(legoId)!
      if (!view.label) return
      const isFocus = legoId === focusId
      const isNeighbourOfFocus = neighbours.has(legoId)
      const eligible = node.isRevealed && (zoomedIn || isFocus || isNeighbourOfFocus)
      view.label.visible = eligible
    })
  }

  return {
    setFocus,
    focusedLegoId,
    destroy,
    resize,
    ready,
  }
}

// ============================================================================
// HELPERS
// ============================================================================

interface NodeView {
  container: Container
  circle: Graphics
  label: BitmapText | null
}

function addAdjacent(map: Map<string, Set<string>>, a: string, b: string): void {
  let set = map.get(a)
  if (!set) {
    set = new Set()
    map.set(a, set)
  }
  set.add(b)
}

function computeBounds(nodes: NetworkNode[]): {
  minX: number; minY: number; maxX: number; maxY: number
  width: number; height: number; centerX: number; centerY: number
} {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    if (n.position.x < minX) minX = n.position.x
    if (n.position.x > maxX) maxX = n.position.x
    if (n.position.y < minY) minY = n.position.y
    if (n.position.y > maxY) maxY = n.position.y
  }
  const width = maxX - minX
  const height = maxY - minY
  return {
    minX, minY, maxX, maxY, width, height,
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
  const padding = 1.2
  return Math.min(
    screenW / (bounds.width * padding),
    screenH / (bounds.height * padding),
  )
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

function drawEdges(
  structural: Graphics,
  context: Graphics,
  edges: NetworkEdge[],
  nodeById: Map<string, NetworkNode>,
): void {
  structural.clear()
  context.clear()

  for (const edge of edges) {
    const src = nodeById.get(edge.source)
    const tgt = nodeById.get(edge.target)
    if (!src || !tgt) continue

    const target = edge.type === 'structural' ? structural : context
    const baseAlpha = edge.type === 'structural' ? STRUCTURAL_EDGE_ALPHA : CONTEXT_EDGE_ALPHA
    const colour = edge.type === 'structural' ? STRUCTURAL_EDGE_COLOUR : CONTEXT_EDGE_COLOUR
    const alpha = baseAlpha * clamp01(edge.strength)
    if (alpha <= 0) continue

    // Slight curve via quadratic control point so dense regions stay readable.
    const midX = (src.position.x + tgt.position.x) / 2
    const midY = (src.position.y + tgt.position.y) / 2
    const dx = tgt.position.x - src.position.x
    const dy = tgt.position.y - src.position.y
    const len = Math.hypot(dx, dy) || 1
    // Perpendicular offset, scaled with edge length so short edges aren't curved much.
    const curveAmount = edge.type === 'structural' ? 0.08 : 0.18
    const offset = len * curveAmount
    const ctrlX = midX + (-dy / len) * offset
    const ctrlY = midY + (dx / len) * offset

    target.moveTo(src.position.x, src.position.y)
    target.quadraticCurveTo(ctrlX, ctrlY, tgt.position.x, tgt.position.y)
    target.stroke({
      width: edge.type === 'structural' ? 1.5 : 1,
      color: colour,
      alpha,
    })
  }
}

function buildNodes(
  layer: Container,
  nodes: NetworkNode[],
  out: Map<string, NodeView>,
  onTap: (legoId: string) => void,
): void {
  for (const node of nodes) {
    const view = buildNode(node, onTap)
    layer.addChild(view.container)
    out.set(node.legoId, view)
  }
}

function buildNode(node: NetworkNode, onTap: (legoId: string) => void): NodeView {
  const container = new Container()
  container.x = node.position.x
  container.y = node.position.y
  container.eventMode = 'static'
  container.cursor = 'pointer'
  container.alpha = node.isRevealed ? REVEALED_ALPHA : HIDDEN_ALPHA

  const radius = node.type === 'molecule' ? MOLECULE_RADIUS : ATOM_RADIUS
  const colour = beltColour(node.beltIndex)

  const circle = new Graphics()
  if (node.type === 'molecule') {
    // Slightly larger, with a soft inner ring to read as "compound".
    circle.circle(0, 0, radius)
    circle.fill({ color: colour, alpha: 1 })
    circle.circle(0, 0, radius - 3)
    circle.fill({ color: BACKGROUND_COLOUR, alpha: 0.4 })
  } else {
    circle.circle(0, 0, radius)
    circle.fill({ color: colour, alpha: 1 })
  }
  // Subtle outline to anchor on dark bg.
  circle.circle(0, 0, radius)
  circle.stroke({ color: 0x111118, alpha: 0.9, width: 1 })

  container.addChild(circle)

  // Label — bitmap text, generated only if node has text content.
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
    label.scale.set(0.5) // counter the 2x font resolution
    label.visible = false
    container.addChild(label)
  }

  // Tap handler. `pointertap` fires for both mouse and touch.
  container.on('pointertap', (e: FederatedPointerEvent) => {
    e.stopPropagation()
    onTap(node.legoId)
  })

  return { container, circle, label }
}

function clamp01(v: number): number {
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v
}
