#!/bin/bash
# VPS Stop - Dừng k6 test và cleanup

set -e

SESSION_NAME="k6-thanhhuyreal"

echo "===================================="
echo "Stopping k6 Load Test"
echo "===================================="
echo ""

# Check if session exists
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "⚠ No running session found"
    exit 0
fi

# Kill tmux session
echo "Killing tmux session: $SESSION_NAME"
tmux kill-session -t "$SESSION_NAME"

# Kill cookie refresh daemon if exists
if [ -f /tmp/cookie-refresh.pid ]; then
    echo "Stopping cookie refresh daemon..."
    kill $(cat /tmp/cookie-refresh.pid) 2>/dev/null || true
    rm /tmp/cookie-refresh.pid
fi

echo ""
echo "✓ Test stopped!"
echo ""
echo "Cleanup:"
rm -f /tmp/cf_clearance.txt
rm -f /tmp/cf_ua.txt
rm -f /tmp/refresh-cookie.sh

echo "  - Removed cookie files"
echo "  - Stopped daemon"
echo ""
echo "To view results: ls -lh results-*.json"
echo "===================================="
