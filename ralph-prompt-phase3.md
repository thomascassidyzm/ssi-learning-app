# Ralph Prompt: Cycle Integration (Phase 3)

## Context

You are integrating the new **Cycle playback system** into LearningPlayer.vue. This is NOT a replacement - it's swapping the internal playback engine.

**Working directory:** /Users/tomcassidy/SSi/ssi-learning-app

**What's Already Done:**
- RoundEngine updated (BUILD capped at 7, components skipped, LEGO validation)
- Cycle type created (text+audio locked by ID) - see types/Cycle.ts
- useCyclePlayback composable (4-phase state machine) - see composables/useCyclePlayback.ts
- CyclePlayer component (renders one Cycle) - see components/CyclePlayer.vue
- scriptItemToCycle bridge - see utils/scriptItemToCycle.ts
- Test routes at /test/cycle and /test/session validate the new system works

**Phase 3 Goal:**
Swap LearningPlayer's internal playback from old `CycleOrchestrator` to new `useCyclePlayback`. Everything else stays the same - audio fetching, belt progress, network visualization, listening mode.

## PRD File

**Use ralph-prd-phase3.json** (6 focused tasks)

## Key Insight

LearningPlayer.vue already works fantastically. We're only changing:
1. **Script generation** - already updated (RoundEngine changes)
2. **Cycle playback** - swap from CycleOrchestrator to useCyclePlayback

The Cycle system ensures text+audio are LOCKED together by ID. No more separate lookups.

## Architecture

```
LearningPlayer.vue (5000 lines - KEEP ALL OF IT)
├── generateLearningScript() → scriptItems (already works)
├── Audio fetching from S3 (keep as-is)
├── Belt progress (keep as-is)
├── Network visualization (keep as-is, add fire-path event)
├── Listening mode (keep as-is)
└── Playback engine (SWAP THIS)
    ├── OLD: CycleOrchestrator from @ssi/core
    └── NEW: useCyclePlayback + scriptItemToCycle bridge
```

## Key Files

| File | Purpose |
|------|---------|
| `/packages/player-vue/src/components/LearningPlayer.vue` | Main player - swap playback engine here |
| `/packages/player-vue/src/composables/useCyclePlayback.ts` | NEW playback engine |
| `/packages/player-vue/src/utils/scriptItemToCycle.ts` | Bridge: ScriptItem → Cycle |
| `/packages/player-vue/src/types/Cycle.ts` | Cycle type definition |
| `/packages/core/src/engine/CycleOrchestrator.ts` | OLD engine (will be removed) |

## Each Iteration

1. **Read progress.txt** - Check current status
2. **Read ralph-prd-phase3.json** - Find incomplete tasks
3. **Pick the highest-priority incomplete task**
4. **Implement ONE task**
5. **Run feedback loops:**
   ```bash
   pnpm --filter player-vue typecheck
   pnpm --filter player-vue test
   pnpm --filter player-vue lint
   ```
6. **If all pass:** Commit with clear message
7. **Update progress.txt** - What did you do?
8. **Update ralph-prd-phase3.json** - Set `passes: true` if task complete

## Completion

When ALL items in ralph-prd-phase3.json have `passes: true`, output:

```
<promise>CYCLE_INTEGRATION_COMPLETE</promise>
```

## Do NOT

- Rewrite LearningPlayer from scratch
- Create a new component to replace LearningPlayer
- Break existing features (belt, network, listening mode, offline)
- Commit if any feedback loop fails
- Work on multiple tasks at once
- Look up audio by text string - always use IDs from Cycle object

## Brain View Integration

For p3-3 (fire-path), use the NEW Brain3DView system:
- useBrainNodes.ts - GPU-accelerated particles
- useBrainFirePath.ts - playFirePath({ nodeIds, durationMs })
- NOT the old ConstellationNetworkView
