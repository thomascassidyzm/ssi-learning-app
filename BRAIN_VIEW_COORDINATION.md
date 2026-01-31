# Brain View Coordination Notes

## How the Brain Visualization Integrates with Main Player

### Data Flow

The main player (`LearningPlayer.vue`) passes data to `PlayerBrain.vue`:

```vue
<PlayerBrain
  :nodes="networkViewProps.nodes"
  :edges="networkViewProps.edges"
  :revealed-node-ids="introducedLegoIds"
  :current-path="networkViewProps.currentPath"
  :belt-level="currentBelt.name"
/>
```

### When Nodes Are Added

Nodes are added to the brain when a LEGO introduction completes:

```typescript
// In LearningPlayer.vue ~line 3142
// After playing "The Spanish for X is Y" introduction audio
addNetworkNode(legoId, targetText, knownText, currentBelt.value?.name || 'white')
```

This calls `introduceLegoNode()` from `useDistinctionNetwork` composable.

### Key Types

**ConstellationNode** (what PlayerBrain receives):
```typescript
interface ConstellationNode {
  id: string           // LEGO ID like "S0001L01"
  targetText: string   // "quiero"
  knownText: string    // "I want"
  belt: string         // "white", "yellow", etc.
  x: number            // Pre-computed position
  y: number
  z?: number
  isComponent?: boolean
  parentLegoIds?: string[]
}
```

**ConstellationEdge** (connections between nodes):
```typescript
interface ConstellationEdge {
  id: string
  source: string | { id: string }
  target: string | { id: string }
  strength: number     // How often these words appear together (1-100)
}
```

### Where Edges Come From

Edges are computed based on which LEGOs appear together in phrases. The data comes from:
1. `course_legos.components` - M-type LEGOs list their component LEGOs
2. `practice_cycles` view - practice phrases that contain multiple LEGOs

### Key Files for Brain View

| File | Purpose |
|------|---------|
| `components/PlayerBrain.vue` | Lightweight Three.js brain for playback |
| `components/Brain3DView.vue` | Full-featured brain view (standalone) |
| `composables/useBrainScene.ts` | Three.js scene setup |
| `composables/useBrainNodes.ts` | Node rendering (spheres) |
| `composables/useBrainEdges.ts` | Edge rendering (curved tubes) |
| `composables/useBrainFirePath.ts` | Animation of current phrase path |
| `composables/useDistinctionNetwork.ts` | Network state management |

### The Connections Issue

The edges (connections) between nodes may not be showing properly because:
1. Edge data might not be populated correctly
2. Edge rendering in `useBrainEdges.ts` might have issues
3. Edge visibility might be too low (opacity is very subtle: 0.15-0.25)

Check:
- Are edges being passed to PlayerBrain? Log `networkViewProps.edges`
- Are edges being rendered? Check `useBrainEdges.createEdges()`
- Are edges visible? Increase `baseOpacity` in edge options

### Building As It Goes

The brain should "build" as the learner progresses:
1. Start with 0 nodes visible
2. Each time a LEGO introduction plays, that node appears
3. Edges connect nodes that share phrases
4. `revealedNodeIds` controls which nodes are visible

The network is pre-computed but nodes are revealed incrementally via `introducedLegoIds`.
