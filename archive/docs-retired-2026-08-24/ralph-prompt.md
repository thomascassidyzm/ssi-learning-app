# Ralph Prompt: Cycle Refactor

## Context

You are refactoring the SSi Learning App to use **Cycles** as atomic units.

**Working directory:** /Users/tomcassidy/SSi/ssi-learning-app

**The Problem:** Text and audio can desync. The current architecture has separate `currentScriptItem` and `currentPlayableItem` that can diverge. Audio is sometimes looked up by text string, which is fragile.

**The Solution:** A Cycle is a complete, pre-validated learning unit:
```typescript
interface Cycle {
  id: string
  seedId: string
  legoId: string
  type: 'intro' | 'debut' | 'practice' | 'review'
  known: {
    text: string
    audioId: string
    durationMs: number
  }
  target: {
    text: string
    voice1AudioId: string
    voice1DurationMs: number
    voice2AudioId: string
    voice2DurationMs: number
  }
  pauseDurationMs: number
}
```

Audio is bound by **ID**, never by text lookup. A Cycle is complete or doesn't exist.

## Quality Standards

This is production code for schools. Teachers and students have **zero tolerance** for bugs.

**Non-Negotiable:**
- Text and audio MUST come from the same Cycle object
- No audio lookup by text string - always use IDs
- Keep changes small and focused
- One commit per logical change

## Each Iteration

1. **Read progress.txt** - What's been done?
2. **Read ralph-prd.json** - What's needed?
3. **Pick the highest-priority incomplete task** - Prefer high-risk items first
4. **Implement ONE small piece**
5. **Run feedback loops:**
   ```bash
   pnpm --filter player-vue typecheck
   pnpm --filter player-vue test
   pnpm --filter player-vue lint
   ```
6. **If all pass:** Commit with clear message
7. **Update progress.txt** - What did you do? Any blockers?
8. **Update ralph-prd.json** - Set `passes: true` if task complete

## Completion

When ALL items in ralph-prd.json have `passes: true`, output:

```
<promise>CYCLE_REFACTOR_COMPLETE</promise>
```

## Do NOT

- Commit if any feedback loop fails
- Work on multiple tasks at once
- Skip tests for "simple" changes
- Look up audio by text string - always use IDs
- Create components over 300 lines
- Make changes outside the scope of ralph-prd.json
