/**
 * useCanvasNetwork - Canvas-based Network Rendering
 *
 * Renders the constellation network to a Canvas element for butter-smooth pan/zoom.
 * This replaces the SVG rendering for the static network (3000+ elements caused lag).
 *
 * Key design decisions:
 * - Canvas draws at 1:1 scale (no internal transforms)
 * - Pan/zoom is handled via CSS transform on the canvas element itself
 * - devicePixelRatio support for crisp retina rendering
 * - Matches visual style of ConstellationNetworkView exactly
 *
 * Usage:
 *   const canvas = document.querySelector('canvas')
 *   renderNetwork(canvas, nodes, edges, revealedNodeIds, { hideUnrevealed: false })
 */

import type { NetworkNode, NetworkEdge } from './usePrebuiltNetwork'

// ============================================================================
// BELT COLOR PALETTES
// ============================================================================

export const BELT_PALETTES: Record<string, {
  glow: string
  core: string
  inner: string
  label: string
}> = {
  white: { glow: '#9ca3af', core: '#2a2a35', inner: '#ffffff', label: '#ffffffcc' },
  yellow: { glow: '#fbbf24', core: '#2a2518', inner: '#fbbf24', label: '#fbbf24cc' },
  orange: { glow: '#f97316', core: '#2a1a10', inner: '#f97316', label: '#f97316cc' },
  green: { glow: '#22c55e', core: '#102a1a', inner: '#22c55e', label: '#22c55ecc' },
  blue: { glow: '#3b82f6', core: '#101a2a', inner: '#3b82f6', label: '#3b82f6cc' },
  purple: { glow: '#8b5cf6', core: '#1a102a', inner: '#8b5cf6', label: '#8b5cf6cc' },
  brown: { glow: '#a87848', core: '#2a1a10', inner: '#a87848', label: '#a87848cc' },
  black: { glow: '#d4a853', core: '#2a2518', inner: '#d4a853', label: '#d4a853cc' },
}

// ============================================================================
// TYPES
// ============================================================================

export interface CanvasNetworkOptions {
  /** When true, unrevealed nodes are completely hidden (not ghost) */
  hideUnrevealed?: boolean
  /** Base opacity for unrevealed ghost nodes (default: 0.15) */
  ghostOpacity?: number
  /** Opacity for revealed nodes (default: 0.4-0.5 depending on type) */
  revealedOpacity?: number
  /** Edge stroke color (default: rgba(255, 255, 255, 0.1)) */
  edgeColor?: string
}

interface NodeSizes {
  glow: number
  core: number
  inner: number
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the color palette for a belt
 */
function getPalette(belt: string): { glow: string; core: string; inner: string; label: string } {
  return BELT_PALETTES[belt] || BELT_PALETTES.white
}

/**
 * Get node size based on whether it's a component and its active state
 */
function getNodeSize(node: NetworkNode, isActive: boolean): NodeSizes {
  // Component nodes are 60% the size of regular nodes
  const scale = node.isComponent ? 0.6 : 1

  if (isActive) {
    return {
      glow: 22 * scale,
      core: 14 * scale,
      inner: 5 * scale,
    }
  }
  return {
    glow: 18 * scale,
    core: 12 * scale,
    inner: 4 * scale,
  }
}

/**
 * Get node opacity based on revealed state
 */
function getNodeOpacity(
  node: NetworkNode,
  revealedNodeIds: Set<string>,
  options: CanvasNetworkOptions
): number {
  const isRevealed = revealedNodeIds.has(node.id)

  if (!isRevealed) {
    // Unrevealed: hide completely or show as faint ghost
    return options.hideUnrevealed ? 0 : (options.ghostOpacity ?? 0.15)
  }

  // Revealed nodes: visible but not distracting
  // Component nodes are slightly dimmer
  if (node.isComponent) {
    return options.revealedOpacity ?? 0.4
  }
  return options.revealedOpacity ?? 0.5
}

/**
 * Get edge opacity based on endpoint visibility and strength
 */
function getEdgeOpacity(
  edge: NetworkEdge,
  revealedNodeIds: Set<string>,
  nodeMap: Map<string, NetworkNode>,
  options: CanvasNetworkOptions
): number {
  const sourceId = getEdgeNodeId(edge.source)
  const targetId = getEdgeNodeId(edge.target)

  // Check if both endpoints should be visible
  const sourceRevealed = isNodeEffectivelyRevealed(sourceId, revealedNodeIds, nodeMap)
  const targetRevealed = isNodeEffectivelyRevealed(targetId, revealedNodeIds, nodeMap)

  if (options.hideUnrevealed) {
    // Hide edges connected to unrevealed nodes
    if (!sourceRevealed || !targetRevealed) {
      return 0
    }
  }

  // Background edges: visible but subtle, Hebbian strength increases opacity
  // Range: ~0.15 to ~0.4 for better visibility
  return Math.min(0.4, 0.15 + Math.sqrt(edge.strength) * 0.025)
}

/**
 * Get edge stroke width based on strength
 */
function getEdgeWidth(edge: NetworkEdge): number {
  // Background edges: visible, Hebbian strength increases width slightly
  // Range: ~0.8 to ~2.0 for better visibility
  return Math.min(2.0, 0.8 + Math.sqrt(edge.strength) * 0.1)
}

/**
 * Helper to extract ID from edge source/target
 * D3's forceLink mutates edges, replacing string IDs with node object references
 */
function getEdgeNodeId(ref: string | { id: string } | NetworkNode): string {
  if (typeof ref === 'string') return ref
  return (ref as { id: string }).id
}

/**
 * Check if a node should be considered revealed
 * Regular nodes: check revealedNodeIds
 * Component nodes: revealed if any parent is revealed
 */
function isNodeEffectivelyRevealed(
  nodeId: string,
  revealedNodeIds: Set<string>,
  nodeMap: Map<string, NetworkNode>
): boolean {
  if (revealedNodeIds.has(nodeId)) return true

  const node = nodeMap.get(nodeId)
  if (node?.isComponent && node.parentLegoIds) {
    return node.parentLegoIds.some(parentId => revealedNodeIds.has(parentId))
  }
  return false
}

/**
 * Calculate curved path control point for quadratic bezier
 * Uses same algorithm as ConstellationNetworkView for visual consistency
 */
function getEdgeControlPoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  edgeId: string
): { cpX: number; cpY: number } {
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)

  if (len === 0) {
    return { cpX: midX, cpY: midY }
  }

  const curveAmount = Math.min(25, len * 0.12)
  const perpX = -dy / len
  const perpY = dx / len

  // Consistent curve direction based on edge ID hash
  const hash = edgeId.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const direction = hash % 2 === 0 ? 1 : -1

  return {
    cpX: midX + perpX * curveAmount * direction,
    cpY: midY + perpY * curveAmount * direction,
  }
}

/**
 * Parse a hex color to RGB components
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null
}

/**
 * Convert hex color to rgba string
 */
function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return `rgba(255, 255, 255, ${alpha})`
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

// ============================================================================
// RENDERING FUNCTIONS
// ============================================================================

/**
 * Draw a single edge (curved path with quadratic bezier)
 */
function drawEdge(
  ctx: CanvasRenderingContext2D,
  edge: NetworkEdge,
  nodeMap: Map<string, NetworkNode>,
  revealedNodeIds: Set<string>,
  options: CanvasNetworkOptions
): void {
  const sourceId = getEdgeNodeId(edge.source)
  const targetId = getEdgeNodeId(edge.target)
  const source = nodeMap.get(sourceId)
  const target = nodeMap.get(targetId)

  if (!source || !target) return

  const opacity = getEdgeOpacity(edge, revealedNodeIds, nodeMap, options)
  if (opacity <= 0) return

  const width = getEdgeWidth(edge)
  const { cpX, cpY } = getEdgeControlPoint(source.x, source.y, target.x, target.y, edge.id)

  ctx.beginPath()
  ctx.moveTo(source.x, source.y)
  ctx.quadraticCurveTo(cpX, cpY, target.x, target.y)

  ctx.strokeStyle = options.edgeColor ?? `rgba(255, 255, 255, ${opacity})`
  ctx.globalAlpha = opacity
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.stroke()
  ctx.globalAlpha = 1
}

/**
 * Draw a single node (outer glow ring, core circle, inner dot)
 */
function drawNode(
  ctx: CanvasRenderingContext2D,
  node: NetworkNode,
  revealedNodeIds: Set<string>,
  options: CanvasNetworkOptions
): void {
  const opacity = getNodeOpacity(node, revealedNodeIds, options)
  if (opacity <= 0) return

  const palette = getPalette(node.belt)
  const sizes = getNodeSize(node, false) // Not active (active state handled by SVG overlay)

  ctx.save()
  ctx.globalAlpha = opacity

  // Outer glow ring
  const glowOpacity = node.isComponent ? 0.65 : 0.75
  ctx.beginPath()
  ctx.arc(node.x, node.y, sizes.glow, 0, Math.PI * 2)
  ctx.strokeStyle = hexToRgba(palette.glow, glowOpacity)
  ctx.lineWidth = 2
  ctx.stroke()

  // Core circle (filled with stroke)
  ctx.beginPath()
  ctx.arc(node.x, node.y, sizes.core, 0, Math.PI * 2)
  ctx.fillStyle = palette.core
  ctx.fill()
  ctx.strokeStyle = hexToRgba(palette.glow, 0.85)
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Inner dot
  ctx.beginPath()
  ctx.arc(node.x, node.y, sizes.inner, 0, Math.PI * 2)
  ctx.fillStyle = hexToRgba(palette.inner, 0.85)
  ctx.fill()

  ctx.restore()
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Clear the canvas
 */
export function clear(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Account for devicePixelRatio
  const dpr = window.devicePixelRatio || 1
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
}

/**
 * Render the network to a canvas element
 *
 * @param canvas - The canvas element to render to
 * @param nodes - Array of constellation nodes (with x, y positions)
 * @param edges - Array of constellation edges
 * @param revealedNodeIds - Set of node IDs that are "learned"/revealed
 * @param options - Rendering options
 */
export function renderNetwork(
  canvas: HTMLCanvasElement,
  nodes: NetworkNode[],
  edges: NetworkEdge[],
  revealedNodeIds: Set<string>,
  options: CanvasNetworkOptions = {}
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    console.warn('[useCanvasNetwork] Could not get 2d context from canvas')
    return
  }

  // Handle devicePixelRatio for crisp rendering on retina displays
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()

  // Only resize if needed (avoid layout thrashing)
  const targetWidth = rect.width * dpr
  const targetHeight = rect.height * dpr
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth
    canvas.height = targetHeight
    // Scale the context to account for dpr
    ctx.scale(dpr, dpr)
  }

  // Clear canvas
  ctx.clearRect(0, 0, rect.width, rect.height)

  // Build node map for quick lookup
  const nodeMap = new Map<string, NetworkNode>()
  for (const node of nodes) {
    nodeMap.set(node.id, node)
  }

  // Draw edges first (underneath nodes)
  for (const edge of edges) {
    drawEdge(ctx, edge, nodeMap, revealedNodeIds, options)
  }

  // Draw nodes on top
  for (const node of nodes) {
    drawNode(ctx, node, revealedNodeIds, options)
  }
}

/**
 * Set up canvas for high-DPI rendering
 * Call this once when the canvas is created or resized
 *
 * @param canvas - The canvas element
 * @param width - Logical width in CSS pixels
 * @param height - Logical height in CSS pixels
 */
export function setupCanvasForRetina(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): void {
  const dpr = window.devicePixelRatio || 1

  // Set the canvas internal dimensions (scaled for DPI)
  canvas.width = width * dpr
  canvas.height = height * dpr

  // Set the CSS dimensions (logical pixels)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  // Scale the context so we can draw in logical pixels
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.scale(dpr, dpr)
  }
}

/**
 * Composable wrapper for reactive usage in Vue
 * Returns render functions that can be called when data changes
 */
export function useCanvasNetwork() {
  return {
    renderNetwork,
    clear,
    setupCanvasForRetina,
    BELT_PALETTES,
  }
}
