/**
 * useDistinctionNetworkSimulation - D3 Force Simulation for Distinction Networks
 *
 * Configures the physics of the network visualization:
 * - Connection strength → spatial clustering (fire together → cluster together)
 * - Hero node stays centered
 * - Smooth animations when network changes
 *
 * This is the "physics engine" that makes the visualization feel alive.
 */

import { ref, watch, onUnmounted, type Ref, type ComputedRef } from 'vue'
import * as d3 from 'd3'
import type { DistinctionNode, DirectionalEdge } from './useDistinctionNetwork'

// ============================================================================
// TYPES
// ============================================================================

export interface SimulationConfig {
  // Link forces (connection-based clustering)
  link: {
    strengthMultiplier: number   // How strongly links pull (0-1)
  }

  // Charge (node repulsion)
  charge: {
    strength: number            // Repulsion force (negative = repel)
    distanceMax: number         // Max range of repulsion
  }

  // Radial (orbital tendency for non-hero nodes)
  radial: {
    radius: number              // Target orbital radius
    strength: number            // How strongly nodes are pulled to orbit
  }

  // Collision (prevent overlap)
  collision: {
    radius: number              // Collision radius per node
    strength: number            // Collision resolution strength
  }

  // Centering
  center: {
    x: number
    y: number
  }

  // Animation
  alpha: {
    initial: number             // Starting alpha (energy)
    decay: number               // How quickly simulation settles
    min: number                 // Minimum alpha before stopping
    restart: number             // Alpha when restarting after change
  }
}

const DEFAULT_CONFIG: SimulationConfig = {
  link: {
    strengthMultiplier: 0.4,     // Moderate: connected nodes cluster but not too tight
  },
  charge: {
    strength: -200,              // Stronger repulsion: spread nodes out more
    distanceMax: 500,
  },
  radial: {
    radius: 350,                 // Larger orbital radius: fill more screen space
    strength: 0.03,              // Very weak: organic scatter, not perfect orbit
  },
  collision: {
    radius: 40,                  // Slightly larger collision radius
    strength: 0.7,
  },
  center: {
    x: 0,
    y: 0,
  },
  alpha: {
    initial: 1,
    decay: 0.01,                 // Slower decay: more time to find organic positions
    min: 0.001,
    restart: 0.5,
  }
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useDistinctionNetworkSimulation(
  nodes: Ref<DistinctionNode[]> | ComputedRef<DistinctionNode[]>,
  links: Ref<DirectionalEdge[]> | ComputedRef<DirectionalEdge[]>,
  heroNodeId: Ref<string | null>,
  options: Partial<SimulationConfig> = {}
) {
  const config = { ...DEFAULT_CONFIG, ...options }

  // Simulation instance
  let simulation: d3.Simulation<DistinctionNode, DirectionalEdge> | null = null

  // State
  const isRunning = ref(false)
  const tickCount = ref(0)

  // Callbacks
  const onTickCallbacks: Set<() => void> = new Set()

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize the force simulation with current configuration
   */
  function initialize(): d3.Simulation<DistinctionNode, DirectionalEdge> {
    // Stop existing simulation
    if (simulation) {
      simulation.stop()
    }

    simulation = d3.forceSimulation<DistinctionNode, DirectionalEdge>(nodes.value)
      // Link force: distance is pre-calculated based on strength
      .force('link', d3.forceLink<DistinctionNode, DirectionalEdge>(links.value)
        .id(d => d.id)
        .distance(d => d.distance || 150)
        .strength(config.link.strengthMultiplier)
      )
      // Charge force: node repulsion
      .force('charge', d3.forceManyBody<DistinctionNode>()
        .strength(config.charge.strength)
        .distanceMax(config.charge.distanceMax)
      )
      // Radial force: non-hero nodes tend toward orbital ring
      .force('radial', d3.forceRadial<DistinctionNode>(
        config.radial.radius,
        config.center.x,
        config.center.y
      ).strength(d => d.id === heroNodeId.value ? 0 : config.radial.strength))
      // Collision: prevent overlap
      .force('collide', d3.forceCollide<DistinctionNode>()
        .radius(config.collision.radius)
        .strength(config.collision.strength)
      )
      // Alpha settings
      .alphaDecay(config.alpha.decay)
      .alphaMin(config.alpha.min)
      // Tick handler
      .on('tick', handleTick)
      .on('end', () => {
        isRunning.value = false
      })

    isRunning.value = true
    tickCount.value = 0

    return simulation
  }

  /**
   * Handle simulation tick
   */
  function handleTick(): void {
    tickCount.value++

    // Pin hero node to center
    if (heroNodeId.value) {
      const hero = nodes.value.find(n => n.id === heroNodeId.value)
      if (hero) {
        hero.x = config.center.x
        hero.y = config.center.y
      }
    }

    // Call registered callbacks
    onTickCallbacks.forEach(cb => cb())
  }

  // ============================================================================
  // CONTROL METHODS
  // ============================================================================

  /**
   * Update center position (e.g., when hero changes or layout shifts)
   */
  function setCenter(x: number, y: number): void {
    config.center.x = x
    config.center.y = y

    if (simulation) {
      // Update radial force center
      const radialForce = simulation.force('radial') as d3.ForceRadial<DistinctionNode> | undefined
      if (radialForce) {
        radialForce.x(x).y(y)
      }

      // Restart with low alpha for smooth transition
      simulation.alpha(config.alpha.restart).restart()
    }
  }

  /**
   * Update orbital radius (e.g., as more nodes are added)
   */
  function setOrbitalRadius(radius: number): void {
    config.radial.radius = radius

    if (simulation) {
      const radialForce = simulation.force('radial') as d3.ForceRadial<DistinctionNode> | undefined
      if (radialForce) {
        radialForce.radius(radius)
      }

      simulation.alpha(config.alpha.restart).restart()
    }
  }

  /**
   * Restart simulation with fresh energy (after adding nodes/edges)
   */
  function restart(alpha: number = config.alpha.restart): void {
    if (simulation) {
      // Update nodes and links
      simulation.nodes(nodes.value)

      const linkForce = simulation.force('link') as d3.ForceLink<DistinctionNode, DirectionalEdge> | undefined
      if (linkForce) {
        linkForce.links(links.value)
      }

      // Update radial force to exclude new hero
      const radialForce = simulation.force('radial') as d3.ForceRadial<DistinctionNode> | undefined
      if (radialForce) {
        radialForce.strength(d => d.id === heroNodeId.value ? 0 : config.radial.strength)
      }

      simulation.alpha(alpha).restart()
      isRunning.value = true
    }
  }

  /**
   * Gentle nudge - restart with very low alpha for minor adjustments
   */
  function nudge(): void {
    restart(0.1)
  }

  /**
   * Stop the simulation
   */
  function stop(): void {
    if (simulation) {
      simulation.stop()
      isRunning.value = false
    }
  }

  /**
   * Resume a stopped simulation
   */
  function resume(): void {
    if (simulation) {
      simulation.restart()
      isRunning.value = true
    }
  }

  // ============================================================================
  // CALLBACK REGISTRATION
  // ============================================================================

  /**
   * Register a callback to be called on each tick
   */
  function onTick(callback: () => void): () => void {
    onTickCallbacks.add(callback)
    return () => onTickCallbacks.delete(callback)
  }

  // ============================================================================
  // WATCHERS
  // ============================================================================

  // Watch for hero changes - update radial force
  watch(heroNodeId, (newHeroId, oldHeroId) => {
    if (simulation && newHeroId !== oldHeroId) {
      // Unpin old hero
      if (oldHeroId) {
        const oldHero = nodes.value.find(n => n.id === oldHeroId)
        if (oldHero) {
          oldHero.fx = null
          oldHero.fy = null
        }
      }

      // Pin new hero
      if (newHeroId) {
        const newHero = nodes.value.find(n => n.id === newHeroId)
        if (newHero) {
          newHero.fx = config.center.x
          newHero.fy = config.center.y
          newHero.x = config.center.x
          newHero.y = config.center.y
        }
      }

      // Update radial force strength
      const radialForce = simulation.force('radial') as d3.ForceRadial<DistinctionNode> | undefined
      if (radialForce) {
        radialForce.strength(d => d.id === newHeroId ? 0 : config.radial.strength)
      }

      restart()
    }
  })

  // ============================================================================
  // CLEANUP
  // ============================================================================

  onUnmounted(() => {
    if (simulation) {
      simulation.stop()
      simulation = null
    }
    onTickCallbacks.clear()
  })

  // ============================================================================
  // EXPORT
  // ============================================================================

  return {
    // State
    isRunning,
    tickCount,

    // Config
    config,

    // Methods
    initialize,
    setCenter,
    setOrbitalRadius,
    restart,
    nudge,
    stop,
    resume,
    onTick,

    // Direct access (for advanced use)
    get simulation() { return simulation }
  }
}
