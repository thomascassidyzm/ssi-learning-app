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

  result=$(claude -p "
@CLAUDE.md @ralph-prd.json @progress.txt @ralph-prompt.md

Follow the instructions in ralph-prompt.md.

After completing your work:
1. Update progress.txt with what you did
2. Update ralph-prd.json if you completed a task
3. Commit your changes

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
