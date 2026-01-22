#!/bin/bash
# ralph-once.sh - Run one iteration of Ralph (HITL mode)
# Watch the output, learn from it, refine the prompt

set -e

cd /Users/tomcassidy/SSi/ssi-learning-app

echo "=== Ralph Single Iteration ==="
echo "Working directory: $(pwd)"
echo "Starting at: $(date)"
echo ""

# Run Claude Code with the prompt
claude -p "
@CLAUDE.md @ralph-prd.json @progress.txt @ralph-prompt.md

Follow the instructions in ralph-prompt.md.

Read progress.txt for current status, then pick the next task from ralph-prd.json.

After completing your work:
1. Update progress.txt with what you did
2. Update ralph-prd.json if you completed a task
3. Commit your changes

If ALL items in ralph-prd.json have passes: true, output <promise>CYCLE_REFACTOR_COMPLETE</promise>
"

echo ""
echo "=== Iteration Complete ==="
echo "Finished at: $(date)"
echo ""
echo "Check progress.txt and ralph-prd.json for status"
echo "Run './ralph-once.sh' again for next iteration, or use /ralph-loop for AFK mode"
