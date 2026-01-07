<script setup lang="ts">
/**
 * DistinctionNetworkView.vue - Config-Driven Network Visualization
 *
 * Renders a distinction network as an interactive, zoomable visualization.
 * All visual and behavioral aspects are parameterized for APML compatibility.
 *
 * Based on distinction physics:
 * - Nodes are distinctions (LEGOs)
 * - Edges are directional pathways (language is temporal)
 * - Clustering reflects connection strength (fire together → cluster together)
 *
 * Usage:
 *   <DistinctionNetworkView
 *     :network="distinctionNetwork"
 *     :simulation="networkSimulation"
 *     :config="networkConfig"
 *     :belt-level="currentBelt"
 *     @node-tap="handleNodeTap"
 *   />
 */

import { ref, computed, watch, onMounted, onUnmounted, nextTick, type PropType } from 'vue'
import * as d3 from 'd3'
import type { DistinctionNode, DirectionalEdge, PathHighlight } from '../composables/useDistinctionNetwork'

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface NodeConfig {
  baseRadius: number          // Base node radius
  heroScale: number           // Scale multiplier for hero node
  activeScale: number         // Scale when node is in active path
  glowRadius: number          // Outer glow radius
  glowOpacity: number         // Glow opacity (0-1)
  strokeWidth: number         // Border stroke width
  labelOffset: number         // Distance of label below node
}

export interface EdgeConfig {
  minWidth: number            // Minimum edge width (strength=1)
  maxWidth: number            // Maximum edge width (high strength)
  widthExponent: number       // How quickly width grows with strength
  arrowSize: number           // Arrowhead size
  directionIndicator: 'arrow' | 'gradient' | 'both' | 'none'
  opacity: number             // Base edge opacity
  activeOpacity: number       // Opacity when in active path
  glowWidth: number           // Glow effect width for active edges
}

export interface ClusteringConfig {
  maxDistance: number         // Max link distance (weak connections)
  minDistance: number         // Min link distance (strong connections)
  strengthExponent: number    // Clustering curve (0.5=gradual, 1=linear)
  orbitalRadius: number       // Default orbital radius for non-hero nodes
  orbitalStrength: number     // How strongly nodes orbit (0-1)
}

export interface AnimationConfig {
  pathStepDuration: number    // ms between path animation steps
  nodeEnterDuration: number   // ms for new node fade-in
  nodeExitDuration: number    // ms for node removal
  heroTransitionDuration: number // ms for hero change animation
  pulseAnimationDuration: number // ms for edge pulse effect
}

export interface InteractionConfig {
  zoomMin: number             // Minimum zoom level
  zoomMax: number             // Maximum zoom level
  panEnabled: boolean         // Allow panning
  zoomEnabled: boolean        // Allow zooming
  tapToSelect: boolean        // Tap node to select/emit event
  doubleTapToZoom: boolean    // Double-tap to zoom in
  labelZoomThreshold: number  // Zoom level where labels appear
}

export interface DistinctionNetworkConfig {
  node: NodeConfig
  edge: EdgeConfig
  clustering: ClusteringConfig
  animation: AnimationConfig
  interaction: InteractionConfig
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: DistinctionNetworkConfig = {
  node: {
    baseRadius: 7,            // Slightly larger dots for better ratio with thin edges
    heroScale: 1.0,           // No scaling - all nodes same size
    activeScale: 1.0,         // No scaling on active
    glowRadius: 0,            // No glow - clean dots only
    glowOpacity: 0,
    strokeWidth: 1,
    labelOffset: 14,
  },
  edge: {
    minWidth: 0.3,                    // Hairline for new edges
    maxWidth: 2,                      // Much thinner max
    widthExponent: 0.15,              // Extremely gradual growth
    arrowSize: 4,
    directionIndicator: 'gradient',  // Gradient flows from source to target
    opacity: 0.08,                    // Very faint - builds up slowly
    activeOpacity: 0.6,
    glowWidth: 6,
  },
  clustering: {
    maxDistance: 400,
    minDistance: 80,
    strengthExponent: 0.3,
    orbitalRadius: 300,
    orbitalStrength: 0.3,
  },
  animation: {
    pathStepDuration: 200,
    nodeEnterDuration: 400,
    nodeExitDuration: 200,
    heroTransitionDuration: 500,
    pulseAnimationDuration: 600,
  },
  interaction: {
    zoomMin: 0.3,
    zoomMax: 4,
    panEnabled: true,
    zoomEnabled: true,
    tapToSelect: true,
    doubleTapToZoom: true,
    labelZoomThreshold: 1.8,      // Labels only at high magnification
  },
}

// ============================================================================
// BELT PALETTES
// ============================================================================

const BELT_PALETTES = {
  white: {
    node: { fill: '#ffffff20', stroke: '#ffffff60', glow: '#ffffff' },
    edge: { stroke: '#ffffff80', active: '#ffffffcc' },  // Brighter edges
    label: '#ffffffcc',
    hero: '#c23a3a',
  },
  yellow: {
    node: { fill: '#fbbf2420', stroke: '#fbbf2470', glow: '#fbbf24' },
    edge: { stroke: '#fbbf2480', active: '#fbbf24cc' },
    label: '#fbbf24cc',
    hero: '#c23a3a',
  },
  orange: {
    node: { fill: '#f9731620', stroke: '#f9731670', glow: '#f97316' },
    edge: { stroke: '#f9731680', active: '#f97316cc' },
    label: '#f97316cc',
    hero: '#c23a3a',
  },
  green: {
    node: { fill: '#22c55e20', stroke: '#22c55e70', glow: '#22c55e' },
    edge: { stroke: '#22c55e80', active: '#22c55ecc' },
    label: '#22c55ecc',
    hero: '#c23a3a',
  },
  blue: {
    node: { fill: '#3b82f620', stroke: '#3b82f670', glow: '#3b82f6' },
    edge: { stroke: '#3b82f680', active: '#3b82f6cc' },
    label: '#3b82f6cc',
    hero: '#c23a3a',
  },
  purple: {
    node: { fill: '#8b5cf620', stroke: '#8b5cf670', glow: '#8b5cf6' },
    edge: { stroke: '#8b5cf680', active: '#8b5cf6cc' },
    label: '#8b5cf6cc',
    hero: '#c23a3a',
  },
  brown: {
    node: { fill: '#a8784820', stroke: '#a8784870', glow: '#a87848' },
    edge: { stroke: '#a8784880', active: '#a87848cc' },
    label: '#a87848cc',
    hero: '#c23a3a',
  },
  black: {
    node: { fill: '#d4a85320', stroke: '#d4a85370', glow: '#d4a853' },
    edge: { stroke: '#d4a85380', active: '#d4a853cc' },
    label: '#d4a853cc',
    hero: '#c23a3a',
  },
}

// ============================================================================
// PROPS & EMITS
// ============================================================================

const props = defineProps({
  // Network data
  nodes: {
    type: Array as PropType<DistinctionNode[]>,
    required: true,
  },
  edges: {
    type: Array as PropType<DirectionalEdge[]>,
    required: true,
  },

  // State
  heroNodeId: {
    type: String as PropType<string | null>,
    default: null,
  },
  currentPath: {
    type: Object as PropType<PathHighlight | null>,
    default: null,
  },
  selectedNodeId: {
    type: String as PropType<string | null>,
    default: null,
  },
  resonatingNodeIds: {
    type: Array as PropType<string[]>,
    default: () => [],
  },
  // Whether to show labels for nodes in the active path
  // Set to true during voice_2 phase to reveal target text
  showPathLabels: {
    type: Boolean,
    default: false,
  },

  // Positioning
  center: {
    type: Object as PropType<{ x: number; y: number }>,
    default: () => ({ x: 0, y: 0 }),
  },

  // Configuration
  config: {
    type: Object as PropType<Partial<DistinctionNetworkConfig>>,
    default: () => ({}),
  },

  // Appearance
  beltLevel: {
    type: String,
    default: 'white',
  },

  // Control
  simulationRunning: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits<{
  (e: 'node-tap', node: DistinctionNode): void  // Full node for phrase playback
  (e: 'node-double-tap', nodeId: string): void
  (e: 'node-hover', node: DistinctionNode | null): void
  (e: 'zoom-change', zoom: number): void
  (e: 'tick'): void
}>()

// ============================================================================
// MERGED CONFIG
// ============================================================================

const mergedConfig = computed<DistinctionNetworkConfig>(() => {
  return {
    node: { ...DEFAULT_CONFIG.node, ...props.config.node },
    edge: { ...DEFAULT_CONFIG.edge, ...props.config.edge },
    clustering: { ...DEFAULT_CONFIG.clustering, ...props.config.clustering },
    animation: { ...DEFAULT_CONFIG.animation, ...props.config.animation },
    interaction: { ...DEFAULT_CONFIG.interaction, ...props.config.interaction },
  }
})

const palette = computed(() => {
  return BELT_PALETTES[props.beltLevel as keyof typeof BELT_PALETTES] || BELT_PALETTES.white
})

// Helper to get palette for a specific node's introduction belt
function getNodePalette(node: DistinctionNode) {
  return BELT_PALETTES[node.belt as keyof typeof BELT_PALETTES] || BELT_PALETTES.white
}

// ============================================================================
// REFS
// ============================================================================

const containerRef = ref<HTMLDivElement | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)

// D3 selections
let svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null
let zoomGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null
let defsEl: d3.Selection<SVGDefsElement, unknown, null, undefined> | null = null
let edgesLayer: d3.Selection<SVGGElement, unknown, null, undefined> | null = null
let pulsesLayer: d3.Selection<SVGGElement, unknown, null, undefined> | null = null
let nodesLayer: d3.Selection<SVGGElement, unknown, null, undefined> | null = null
let labelsLayer: d3.Selection<SVGGElement, unknown, null, undefined> | null = null

// Zoom behavior
let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null
const currentZoom = ref(1)

// Dimensions
const width = ref(0)
const height = ref(0)

// ============================================================================
// INITIALIZATION
// ============================================================================

onMounted(() => {
  nextTick(() => {
    initializeSvg()
    setupZoom()
    updateDefs()
    render()
  })
})

onUnmounted(() => {
  // Cleanup
  if (zoomBehavior && svg) {
    svg.on('.zoom', null)
  }
})

function initializeSvg(): void {
  if (!containerRef.value) return

  const container = containerRef.value
  width.value = container.clientWidth
  height.value = container.clientHeight

  // Clear existing
  d3.select(container).selectAll('svg').remove()

  // Create SVG
  svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${width.value} ${height.value}`)
    .style('touch-action', 'none') // Enable touch handling

  // Create defs for filters and markers
  defsEl = svg.append('defs')

  // Create zoom group
  zoomGroup = svg.append('g').attr('class', 'zoom-group')

  // Create layers (order = z-index)
  edgesLayer = zoomGroup.append('g').attr('class', 'edges-layer')
  pulsesLayer = zoomGroup.append('g').attr('class', 'pulses-layer')
  nodesLayer = zoomGroup.append('g').attr('class', 'nodes-layer')
  labelsLayer = zoomGroup.append('g').attr('class', 'labels-layer')
}

function setupZoom(): void {
  if (!svg) return

  const config = mergedConfig.value.interaction

  zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([config.zoomMin, config.zoomMax])
    .on('zoom', (event) => {
      if (zoomGroup) {
        zoomGroup.attr('transform', event.transform)
      }
      currentZoom.value = event.transform.k
      emit('zoom-change', event.transform.k)
    })

  if (config.zoomEnabled || config.panEnabled) {
    svg.call(zoomBehavior)

    // Disable specific behaviors if needed
    if (!config.zoomEnabled) {
      svg.on('wheel.zoom', null)
      svg.on('dblclick.zoom', null)
    }
    if (!config.panEnabled) {
      svg.on('mousedown.zoom', null)
      svg.on('touchstart.zoom', null)
    }
  }

  // Center the view initially
  centerView()
}

function centerView(animate: boolean = false): void {
  if (!svg || !zoomBehavior) return

  const transform = d3.zoomIdentity
    .translate(width.value / 2, height.value / 2)
    .scale(currentZoom.value)
    .translate(-props.center.x, -props.center.y)

  if (animate) {
    svg.transition()
      .duration(mergedConfig.value.animation.heroTransitionDuration)
      .call(zoomBehavior.transform, transform)
  } else {
    svg.call(zoomBehavior.transform, transform)
  }
}

/**
 * Zoom to a specific level, maintaining current pan position
 */
function zoomTo(targetZoom: number, animate: boolean = true): void {
  if (!svg || !zoomBehavior) return

  const currentTransform = d3.zoomTransform(svg.node()!)
  const newTransform = d3.zoomIdentity
    .translate(currentTransform.x, currentTransform.y)
    .scale(targetZoom)

  if (animate) {
    svg.transition()
      .duration(300)
      .call(zoomBehavior.transform, newTransform)
  } else {
    svg.call(zoomBehavior.transform, newTransform)
  }
}

// ============================================================================
// DEFS (Filters, Markers, Gradients)
// ============================================================================

function updateDefs(): void {
  if (!defsEl) return

  // Clear existing
  defsEl.selectAll('*').remove()

  const config = mergedConfig.value
  const pal = palette.value

  // Glow filter for nodes
  const glowFilter = defsEl.append('filter')
    .attr('id', 'node-glow')
    .attr('x', '-100%')
    .attr('y', '-100%')
    .attr('width', '300%')
    .attr('height', '300%')

  glowFilter.append('feGaussianBlur')
    .attr('stdDeviation', '4')
    .attr('result', 'blur')

  const glowMerge = glowFilter.append('feMerge')
  glowMerge.append('feMergeNode').attr('in', 'blur')
  glowMerge.append('feMergeNode').attr('in', 'SourceGraphic')

  // Active glow filter (stronger)
  const activeGlowFilter = defsEl.append('filter')
    .attr('id', 'node-glow-active')
    .attr('x', '-150%')
    .attr('y', '-150%')
    .attr('width', '400%')
    .attr('height', '400%')

  activeGlowFilter.append('feGaussianBlur')
    .attr('stdDeviation', '8')
    .attr('result', 'blur')

  const activeGlowMerge = activeGlowFilter.append('feMerge')
  activeGlowMerge.append('feMergeNode').attr('in', 'blur')
  activeGlowMerge.append('feMergeNode').attr('in', 'SourceGraphic')

  // Resonating glow filter (for highlighted nodes during playback)
  const resonatingGlowFilter = defsEl.append('filter')
    .attr('id', 'resonating-glow')
    .attr('x', '-200%')
    .attr('y', '-200%')
    .attr('width', '500%')
    .attr('height', '500%')

  resonatingGlowFilter.append('feGaussianBlur')
    .attr('stdDeviation', '6')
    .attr('result', 'blur')

  resonatingGlowFilter.append('feFlood')
    .attr('flood-color', pal.node.stroke)
    .attr('flood-opacity', '0.6')
    .attr('result', 'flood')

  resonatingGlowFilter.append('feComposite')
    .attr('in', 'flood')
    .attr('in2', 'blur')
    .attr('operator', 'in')
    .attr('result', 'coloredBlur')

  const resonatingMerge = resonatingGlowFilter.append('feMerge')
  resonatingMerge.append('feMergeNode').attr('in', 'coloredBlur')
  resonatingMerge.append('feMergeNode').attr('in', 'coloredBlur')
  resonatingMerge.append('feMergeNode').attr('in', 'SourceGraphic')

  // Edge glow filter (subtle)
  const edgeGlowFilter = defsEl.append('filter')
    .attr('id', 'edge-glow')
    .attr('x', '-50%')
    .attr('y', '-50%')
    .attr('width', '200%')
    .attr('height', '200%')

  edgeGlowFilter.append('feGaussianBlur')
    .attr('stdDeviation', '3')
    .attr('result', 'blur')

  const edgeGlowMerge = edgeGlowFilter.append('feMerge')
  edgeGlowMerge.append('feMergeNode').attr('in', 'blur')
  edgeGlowMerge.append('feMergeNode').attr('in', 'SourceGraphic')

  // Active edge glow filter (intense, pulsing feel)
  const activeEdgeGlowFilter = defsEl.append('filter')
    .attr('id', 'edge-glow-active')
    .attr('x', '-100%')
    .attr('y', '-100%')
    .attr('width', '300%')
    .attr('height', '300%')

  activeEdgeGlowFilter.append('feGaussianBlur')
    .attr('stdDeviation', '6')
    .attr('result', 'blur')

  activeEdgeGlowFilter.append('feFlood')
    .attr('flood-color', pal.edge.active)
    .attr('flood-opacity', '0.8')
    .attr('result', 'flood')

  activeEdgeGlowFilter.append('feComposite')
    .attr('in', 'flood')
    .attr('in2', 'blur')
    .attr('operator', 'in')
    .attr('result', 'coloredBlur')

  const activeEdgeGlowMerge = activeEdgeGlowFilter.append('feMerge')
  activeEdgeGlowMerge.append('feMergeNode').attr('in', 'coloredBlur')
  activeEdgeGlowMerge.append('feMergeNode').attr('in', 'coloredBlur')
  activeEdgeGlowMerge.append('feMergeNode').attr('in', 'SourceGraphic')

  // Arrow marker for directional edges
  if (config.edge.directionIndicator === 'arrow' || config.edge.directionIndicator === 'both') {
    // Normal arrow
    defsEl.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', config.edge.arrowSize)
      .attr('markerHeight', config.edge.arrowSize)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L10,0L0,4')
      .attr('fill', pal.edge.stroke)

    // Active arrow
    defsEl.append('marker')
      .attr('id', 'arrow-active')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', config.edge.arrowSize * 1.2)
      .attr('markerHeight', config.edge.arrowSize * 1.2)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L10,0L0,4')
      .attr('fill', pal.edge.active)
  }

  // Gradient for directional indication
  if (config.edge.directionIndicator === 'gradient' || config.edge.directionIndicator === 'both') {
    const gradient = defsEl.append('linearGradient')
      .attr('id', 'edge-gradient')
      .attr('gradientUnits', 'userSpaceOnUse')

    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', pal.edge.stroke)
      .attr('stop-opacity', '0.3')

    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', pal.edge.stroke)
      .attr('stop-opacity', '1')
  }
}

// ============================================================================
// RENDERING
// ============================================================================

function render(): void {
  renderEdges()
  renderNodes()
  renderLabels()
  // Must call updatePositions to set initial path d attributes
  updatePositions()
}

function renderEdges(): void {
  if (!edgesLayer) return

  const config = mergedConfig.value.edge
  const pal = palette.value

  // Data join - using path for curved edges
  const edgeSelection = edgesLayer.selectAll<SVGPathElement, DirectionalEdge>('.edge')
    .data(props.edges, d => d.id)

  // Exit
  edgeSelection.exit()
    .transition()
    .duration(mergedConfig.value.animation.nodeExitDuration)
    .attr('opacity', 0)
    .remove()

  // Enter
  const edgeEnter = edgeSelection.enter()
    .append('path')
    .attr('class', 'edge')
    .attr('opacity', 0)
    .attr('stroke', pal.edge.stroke)
    .attr('stroke-width', config.minWidth)
    .attr('fill', 'none')
    .attr('stroke-linecap', 'round')

  // Add arrow marker if configured
  if (config.directionIndicator === 'arrow' || config.directionIndicator === 'both') {
    edgeEnter.attr('marker-end', 'url(#arrow)')
  }

  // Enter + Update
  const edgeMerge = edgeEnter.merge(edgeSelection)

  edgeMerge
    .transition()
    .duration(mergedConfig.value.animation.nodeEnterDuration)
    .attr('opacity', d => isEdgeInPath(d.id) ? config.activeOpacity : calculateEdgeOpacity(d.strength))
    .attr('stroke', d => isEdgeInPath(d.id) ? pal.edge.active : pal.edge.stroke)
    .attr('stroke-width', d => calculateEdgeWidth(d.strength))
    .attr('filter', d => isEdgeActive(d.id) ? 'url(#edge-glow-active)' : (isEdgeInPath(d.id) ? 'url(#edge-glow)' : null))

  // Update marker for active edges
  if (config.directionIndicator === 'arrow' || config.directionIndicator === 'both') {
    edgeMerge.attr('marker-end', d => isEdgeInPath(d.id) ? 'url(#arrow-active)' : 'url(#arrow)')
  }
}

function renderNodes(): void {
  if (!nodesLayer) return

  const config = mergedConfig.value.node
  const pal = palette.value

  // Include ALL nodes - hero node gets special styling
  const visibleNodes = props.nodes

  // Data join
  const nodeSelection = nodesLayer.selectAll<SVGGElement, DistinctionNode>('.node')
    .data(visibleNodes, d => d.id)

  // Exit
  nodeSelection.exit()
    .transition()
    .duration(mergedConfig.value.animation.nodeExitDuration)
    .attr('opacity', 0)
    .remove()

  // Enter - simple dots, no bells and whistles
  const nodeEnter = nodeSelection.enter()
    .append('g')
    .attr('class', 'node')
    .attr('opacity', 0)
    .style('cursor', mergedConfig.value.interaction.tapToSelect ? 'pointer' : 'default')
    .on('click', (event, d) => {
      if (mergedConfig.value.interaction.tapToSelect) {
        event.stopPropagation()
        emit('node-tap', d)  // Pass full node object for phrase playback
      }
    })
    .on('dblclick', (event, d) => {
      event.stopPropagation()
      emit('node-double-tap', d.id)
    })
    .on('mouseenter', (event, d) => {
      emit('node-hover', d)
    })
    .on('mouseleave', () => {
      emit('node-hover', null)
    })

  // Just a simple circle - the connections are what matter
  nodeEnter.append('circle')
    .attr('class', 'node-core')
    .attr('r', config.baseRadius)
    .attr('fill', pal.node.stroke)  // Solid fill, use stroke color for visibility
    .attr('stroke', 'none')

  // Enter + Update merge
  const nodeMerge = nodeEnter.merge(nodeSelection)

  nodeMerge
    .transition()
    .duration(mergedConfig.value.animation.nodeEnterDuration)
    .attr('opacity', 1)

  // Style nodes - resonating nodes get a glow effect
  nodeMerge.select('.node-core')
    .attr('r', d => {
      // Resonating nodes are slightly larger
      const isResonating = isNodeResonating(d.id)
      return isResonating ? config.baseRadius * 1.5 : config.baseRadius
    })
    .attr('fill', d => {
      // Use the node's introduction belt color
      const nodePal = getNodePalette(d)
      return nodePal.node.stroke
    })
    .attr('filter', d => {
      // Add glow filter to resonating nodes
      return isNodeResonating(d.id) ? 'url(#resonating-glow)' : 'none'
    })
    .attr('opacity', d => {
      // Resonating nodes are fully opaque
      return isNodeResonating(d.id) ? 1 : 0.8
    })
}

function renderLabels(): void {
  if (!labelsLayer) return

  const config = mergedConfig.value.node
  const interactionConfig = mergedConfig.value.interaction

  // Data join
  const labelSelection = labelsLayer.selectAll<SVGTextElement, DistinctionNode>('.label')
    .data(props.nodes, d => d.id)

  // Exit
  labelSelection.exit().remove()

  // Enter
  const labelEnter = labelSelection.enter()
    .append('text')
    .attr('class', 'label')
    .attr('text-anchor', 'middle')
    .attr('dy', config.baseRadius + config.labelOffset)
    .attr('font-size', '9px')
    .attr('font-family', 'system-ui, sans-serif')
    .attr('font-weight', '400')
    .attr('pointer-events', 'none')
    .text(d => d.targetText)

  // Enter + Update
  const labelMerge = labelEnter.merge(labelSelection)

  // Simple zoom-based visibility - labels fade in as you zoom
  const showLabels = currentZoom.value >= interactionConfig.labelZoomThreshold
  const labelOpacity = showLabels
    ? Math.min(0.7, (currentZoom.value - interactionConfig.labelZoomThreshold) / 0.5)
    : 0

  labelMerge
    .attr('opacity', labelOpacity)
    .attr('fill', d => {
      const nodePal = getNodePalette(d)
      return nodePal.label
    })
    .attr('dy', config.baseRadius + config.labelOffset)
}

// ============================================================================
// UPDATE POSITIONS (called on simulation tick)
// ============================================================================

function updatePositions(): void {
  if (!edgesLayer || !nodesLayer || !labelsLayer) return

  const center = props.center

  // Update edge positions with curved paths
  // Note: D3 force simulation replaces source/target strings with node objects
  edgesLayer.selectAll<SVGPathElement, DirectionalEdge>('.edge')
    .attr('d', d => {
      // Get source position
      const sourceId = typeof d.source === 'string' ? d.source : (d.source as any)?.id
      const sourceNode = typeof d.source === 'object' ? d.source as any : props.nodes.find(n => n.id === sourceId)
      const x1 = sourceId === props.heroNodeId ? center.x : (sourceNode?.x ?? 0)
      const y1 = sourceId === props.heroNodeId ? center.y : (sourceNode?.y ?? 0)

      // Get target position
      const targetId = typeof d.target === 'string' ? d.target : (d.target as any)?.id
      const targetNode = typeof d.target === 'object' ? d.target as any : props.nodes.find(n => n.id === targetId)
      const x2 = targetId === props.heroNodeId ? center.x : (targetNode?.x ?? 0)
      const y2 = targetId === props.heroNodeId ? center.y : (targetNode?.y ?? 0)

      // Generate quadratic Bezier curve with control point offset perpendicular to the line
      // This creates a gentle curve that makes edges visually distinct
      const midX = (x1 + x2) / 2
      const midY = (y1 + y2) / 2

      // Calculate perpendicular offset for control point
      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.sqrt(dx * dx + dy * dy)

      // Curve amount proportional to distance, but capped
      const curveAmount = Math.min(30, len * 0.15)

      // Perpendicular direction (rotate 90 degrees)
      const perpX = len > 0 ? -dy / len : 0
      const perpY = len > 0 ? dx / len : 0

      // Use edge ID hash to determine curve direction (consistent per edge)
      const hash = d.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
      const direction = hash % 2 === 0 ? 1 : -1

      // Control point
      const cpX = midX + perpX * curveAmount * direction
      const cpY = midY + perpY * curveAmount * direction

      return `M ${x1} ${y1} Q ${cpX} ${cpY} ${x2} ${y2}`
    })

  // Update node positions
  nodesLayer.selectAll<SVGGElement, DistinctionNode>('.node')
    .attr('transform', d => `translate(${d.x ?? 0}, ${d.y ?? 0})`)

  // Update label positions
  labelsLayer.selectAll<SVGTextElement, DistinctionNode>('.label')
    .attr('x', d => d.x ?? 0)
    .attr('y', d => d.y ?? 0)

  emit('tick')
}

// ============================================================================
// PULSE ANIMATION
// ============================================================================

/**
 * Animate a pulse traveling along an edge from source to target
 * Creates a glowing dot that moves along the curved path
 */
function animatePulseAlongEdge(edgeId: string, duration: number = 600): void {
  if (!pulsesLayer || !edgesLayer) return

  const pal = palette.value

  // Find the edge path
  const edgePath = edgesLayer.select<SVGPathElement>(`.edge[data-id="${edgeId}"]`)
  if (edgePath.empty()) {
    // Try to find by matching the edge data
    const edge = props.edges.find(e => e.id === edgeId)
    if (!edge) return

    // Get edge positions to create path manually
    const center = props.center
    const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as any)?.id
    const sourceNode = typeof edge.source === 'object' ? edge.source as any : props.nodes.find(n => n.id === sourceId)
    const x1 = sourceId === props.heroNodeId ? center.x : (sourceNode?.x ?? 0)
    const y1 = sourceId === props.heroNodeId ? center.y : (sourceNode?.y ?? 0)

    const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as any)?.id
    const targetNode = typeof edge.target === 'object' ? edge.target as any : props.nodes.find(n => n.id === targetId)
    const x2 = targetId === props.heroNodeId ? center.x : (targetNode?.x ?? 0)
    const y2 = targetId === props.heroNodeId ? center.y : (targetNode?.y ?? 0)

    // Calculate curve
    const midX = (x1 + x2) / 2
    const midY = (y1 + y2) / 2
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy)
    const curveAmount = Math.min(30, len * 0.15)
    const perpX = len > 0 ? -dy / len : 0
    const perpY = len > 0 ? dx / len : 0
    const hash = edgeId.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
    const direction = hash % 2 === 0 ? 1 : -1
    const cpX = midX + perpX * curveAmount * direction
    const cpY = midY + perpY * curveAmount * direction

    // Create temporary path for pulse
    const tempPath = pulsesLayer.append('path')
      .attr('d', `M ${x1} ${y1} Q ${cpX} ${cpY} ${x2} ${y2}`)
      .attr('fill', 'none')
      .attr('stroke', 'none')
      .attr('class', 'pulse-path')

    // Create pulse dot
    const pulseGroup = pulsesLayer.append('g').attr('class', 'pulse-group')

    // Outer glow
    pulseGroup.append('circle')
      .attr('r', 12)
      .attr('fill', pal.edge.active)
      .attr('opacity', 0.3)
      .attr('filter', 'url(#edge-glow-active)')

    // Inner bright core
    pulseGroup.append('circle')
      .attr('r', 5)
      .attr('fill', '#ffffff')
      .attr('opacity', 0.9)

    // Get path for animation
    const pathNode = tempPath.node()
    if (pathNode) {
      const pathLength = pathNode.getTotalLength()

      // Animate along path
      pulseGroup
        .attr('transform', () => {
          const point = pathNode.getPointAtLength(0)
          return `translate(${point.x}, ${point.y})`
        })
        .transition()
        .duration(duration)
        .ease(d3.easeQuadInOut)
        .attrTween('transform', function() {
          return function(t: number) {
            const point = pathNode.getPointAtLength(t * pathLength)
            return `translate(${point.x}, ${point.y})`
          }
        })
        .on('end', function() {
          // Expand and fade out at destination
          d3.select(this)
            .transition()
            .duration(200)
            .attr('opacity', 0)
            .remove()
          tempPath.remove()
        })
    }
    return
  }

  // Use existing edge path
  const pathNode = edgePath.node()
  if (!pathNode) return

  const pathLength = pathNode.getTotalLength()

  // Create pulse dot group
  const pulseGroup = pulsesLayer.append('g').attr('class', 'pulse-group')

  // Outer glow
  pulseGroup.append('circle')
    .attr('r', 12)
    .attr('fill', pal.edge.active)
    .attr('opacity', 0.3)
    .attr('filter', 'url(#edge-glow-active)')

  // Inner bright core
  pulseGroup.append('circle')
    .attr('r', 5)
    .attr('fill', '#ffffff')
    .attr('opacity', 0.9)

  // Animate along path
  pulseGroup
    .attr('transform', () => {
      const point = pathNode.getPointAtLength(0)
      return `translate(${point.x}, ${point.y})`
    })
    .transition()
    .duration(duration)
    .ease(d3.easeQuadInOut)
    .attrTween('transform', function() {
      return function(t: number) {
        const point = pathNode.getPointAtLength(t * pathLength)
        return `translate(${point.x}, ${point.y})`
      }
    })
    .on('end', function() {
      d3.select(this)
        .transition()
        .duration(200)
        .attr('opacity', 0)
        .remove()
    })
}

/**
 * Fire pulses along all edges in a path sequence
 */
function animatePathPulses(edgeIds: string[], stepDelay: number = 180): void {
  edgeIds.forEach((edgeId, index) => {
    setTimeout(() => {
      animatePulseAlongEdge(edgeId, 500)
    }, index * stepDelay)
  })
}

// ============================================================================
// HELPERS
// ============================================================================

function calculateEdgeWidth(strength: number): number {
  const config = mergedConfig.value.edge
  // Width grows very gradually with strength
  // At strength=1: 0.5 + 1*0.3 = 0.8 (thin)
  // At strength=10: 0.5 + 1.78*0.3 = 1.0
  // At strength=50: 0.5 + 2.66*0.3 = 1.3
  // Takes hundreds of firings to reach max width
  const normalized = Math.pow(strength, config.widthExponent)
  return Math.min(config.maxWidth, config.minWidth + normalized * 0.3)
}

function calculateEdgeOpacity(strength: number): number {
  const config = mergedConfig.value.edge
  // Opacity grows very slowly with strength - edges are subtle hints
  // At strength=1: 0.08 (barely visible)
  // At strength=10: 0.12
  // At strength=50: 0.16
  // At strength=200: 0.20
  // Never exceeds 0.25 except when active
  const normalized = Math.pow(strength, 0.2)
  return Math.min(0.25, config.opacity + normalized * 0.015)
}

function isNodeInPath(nodeId: string): boolean {
  return props.currentPath?.nodeIds.includes(nodeId) ?? false
}

function isNodeActive(nodeId: string): boolean {
  if (!props.currentPath || props.currentPath.activeIndex < 0) return false
  return props.currentPath.nodeIds[props.currentPath.activeIndex] === nodeId
}

function isEdgeInPath(edgeId: string): boolean {
  return props.currentPath?.edgeIds.includes(edgeId) ?? false
}

function isEdgeActive(edgeId: string): boolean {
  if (!props.currentPath || props.currentPath.activeIndex < 0) return false
  return props.currentPath.edgeIds[props.currentPath.activeIndex] === edgeId
}

function isNodeResonating(nodeId: string): boolean {
  return props.resonatingNodeIds.includes(nodeId)
}

// ============================================================================
// WATCHERS
// ============================================================================

// Re-render when data changes
watch([() => props.nodes, () => props.edges], () => {
  render()
}, { deep: true })

// Update styling when path changes
watch(() => props.currentPath, () => {
  renderEdges()
  renderNodes()
  renderLabels()
}, { deep: true })

// Update styling when resonating nodes change
watch(() => props.resonatingNodeIds, () => {
  renderNodes()
}, { deep: true })

// Update labels when showPathLabels changes (voice_2 reveal)
watch(() => props.showPathLabels, () => {
  renderLabels()
})

// Update palette when belt changes
watch(() => props.beltLevel, () => {
  updateDefs()
  render()
})

// Recenter when center changes
watch(() => props.center, () => {
  centerView(true)
}, { deep: true })

// Update labels on zoom change
watch(currentZoom, () => {
  renderLabels()
})

// ============================================================================
// EXPOSE FOR PARENT
// ============================================================================

defineExpose({
  updatePositions,
  centerView,
  zoomTo,
  render,
  currentZoom,
  animatePulseAlongEdge,
  animatePathPulses,
})
</script>

<template>
  <div
    ref="containerRef"
    class="distinction-network-view"
  >
    <!-- SVG will be created by D3 -->
  </div>
</template>

<style scoped>
.distinction-network-view {
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: none;
}

.distinction-network-view :deep(svg) {
  display: block;
}

/* Smooth transitions for interactive elements */
.distinction-network-view :deep(.node) {
  transition: opacity 0.3s ease;
}

.distinction-network-view :deep(.edge) {
  transition: stroke 0.2s ease, stroke-width 0.2s ease, opacity 0.2s ease;
}

.distinction-network-view :deep(.label) {
  transition: opacity 0.2s ease, fill 0.2s ease;
  user-select: none;
}
</style>
