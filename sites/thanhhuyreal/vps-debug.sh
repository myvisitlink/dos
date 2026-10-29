#!/bin/bash
# Debug script - check what's wrong

echo "=== Checking tmux sessions ==="
tmux ls 2>&1 || echo "No sessions"

echo ""
echo "=== Checking last tmux output ==="
if tmux has-session -t k6-thanhhuyreal 2>/dev/null; then
    tmux capture-pane -t k6-thanhhuyreal -p -S -50
else
    echo "Session not found"
fi

echo ""
echo "=== Checking FlareSolverr ==="
curl -sf http://localhost:8191/health || echo "FlareSolverr not responding"

echo ""
echo "=== Testing FlareSolverr request ==="
curl -s -X POST http://localhost:8191/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "cmd": "request.get",
    "url": "https://thanhhuyreal.com",
    "maxTimeout": 60000
  }' | jq '.status, .message' || echo "FlareSolverr request failed"

echo ""
echo "=== Checking jq ==="
which jq || echo "jq not installed!"

echo ""
echo "=== Try running vps-run.sh directly ==="
echo "Run: bash vps-run.sh"
