#!/bin/bash
# ralph-afk.sh - Run Ralph in AFK mode (overnight)
# Usage: ./ralph-afk.sh [max_iterations]

set -e

MAX_ITERATIONS=${1:-30}
cd /Users/tomcassidy/SSi/ssi-learning-app

echo "=== Ralph AFK Mode ==="
echo "Working directory: $(pwd)"
echo "Max iterations: $MAX_ITERATIONS"
echo "Starting at: $(date)"
echo ""

for ((i=1; i<=$MAX_ITERATIONS; i++)); do
  echo "--- Iteration $i of $MAX_ITERATIONS ---"

  result=$(claude --dangerously-skip-permissions -p "
@CLAUDE.md @ralph-prd.json @progress.txt

You are in autonomous mode. Do not ask for permission. Just do the work.

RULES:
- Pick the next incomplete item from ralph-prd.json (passes: false)
- Implement it with small, focused changes
- Run feedback loops: pnpm --filter player-vue typecheck && pnpm --filter player-vue test
- If feedback passes, update ralph-prd.json (set passes: true) and progress.txt
- Commit your changes with a clear message
- DO NOT explain what you're going to do. Just do it.

If ALL items in ralph-prd.json have passes: true, output <promise>CYCLE_REFACTOR_COMPLETE</promise>
")

  echo "$result"

  # Check for completion promise
  if [[ "$result" == *"<promise>CYCLE_REFACTOR_COMPLETE</promise>"* ]]; then
    echo ""
    echo "=== COMPLETE ==="
    echo "All PRD items passed!"
    echo "Finished at: $(date)"
    exit 0
  fi

  echo ""
done

echo "=== Max iterations reached ==="
echo "Finished at: $(date)"
echo "Check progress.txt for status"
