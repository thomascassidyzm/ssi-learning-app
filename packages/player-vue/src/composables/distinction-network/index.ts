/**
 * Distinction Network Module
 *
 * Complete system for visualizing learner's growing distinction network.
 * Based on distinction physics principles - "fire together, wire together".
 *
 * Architecture:
 *
 *   useDistinctionNetwork        - Data model (nodes, directional edges, state)
 *   useDistinctionNetworkSimulation - Physics (D3 forces, clustering)
 *   useDistinctionNetworkIntegration - Glue (learning events → network updates)
 *   DistinctionNetworkView.vue  - Rendering (SVG, zoom/pan, interactions)
 *
 * Quick Start:
 *
 *   // In your component setup:
 *   import { useDistinctionNetworkIntegration } from '@/composables/distinction-network'
 *
 *   const {
 *     viewRef,
 *     viewProps,
 *     initialize,
 *     setCenter,
 *     introduceLegoNode,
 *     completePhraseWithAnimation,
 *   } = useDistinctionNetworkIntegration()
 *
 *   onMounted(() => {
 *     setCenter(window.innerWidth / 2, window.innerHeight * 0.45)
 *     initialize()
 *   })
 *
 *   // When new LEGO round starts:
 *   introduceLegoNode('L001', 'quiero', 'I want')
 *
 *   // When phrase is practiced (Voice 2):
 *   await completePhraseWithAnimation(['L001', 'L002', 'L003'])
 *
 *   // In template:
 *   <DistinctionNetworkView
 *     ref="viewRef"
 *     v-bind="viewProps"
 *     @node-tap="handleNodeTap"
 *   />
 */

// Data model
export {
  useDistinctionNetwork,
  type DistinctionNode,
  type DirectionalEdge,
  type PathHighlight,
  type NetworkStats,
} from '../useDistinctionNetwork'

// Physics simulation
export {
  useDistinctionNetworkSimulation,
  type SimulationConfig,
} from '../useDistinctionNetworkSimulation'

// Integration layer
export {
  useDistinctionNetworkIntegration,
  type IntegrationConfig,
} from '../useDistinctionNetworkIntegration'

// Re-export view config types
export type {
  NodeConfig,
  EdgeConfig,
  ClusteringConfig,
  AnimationConfig,
  InteractionConfig,
  DistinctionNetworkConfig,
} from '../../components/DistinctionNetworkView.vue'
