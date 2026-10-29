#!/bin/bash
# VPS Logs - Xem logs của k6 test đang chạy

SESSION_NAME="k6-thanhhuyreal"

echo "===================================="
echo "k6 Load Test Logs (live)"
echo "===================================="
echo ""

# Check if session exists
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "❌ No running session found"
    echo ""
    echo "Start test with: bash vps-start.sh"
    exit 1
fi

echo "Showing live logs from tmux session..."
echo "Press Ctrl+C to exit (test continues running)"
echo ""
echo "===================================="
echo ""

# Capture and show tmux pane content
tmux capture-pane -t "$SESSION_NAME" -p -S -100

echo ""
echo "===================================="
echo ""
echo "For full attach: tmux attach -t $SESSION_NAME"
echo "For cookie logs: tail -f /tmp/cookie-refresh.log"
