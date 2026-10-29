#!/bin/bash
# VPS Start - Chạy k6 test trong tmux session (persistent)

set -e

SESSION_NAME="k6-thanhhuyreal"

echo "===================================="
echo "Starting k6 Load Test (persistent)"
echo "===================================="
echo ""

# Check if tmux is installed
if ! command -v tmux &> /dev/null; then
    echo "❌ tmux not installed!"
    echo "Install with: sudo apt install tmux -y"
    exit 1
fi

# Check if session already exists
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "⚠ Session '$SESSION_NAME' already running!"
    echo ""
    echo "Options:"
    echo "  1. View logs:   bash vps-logs.sh"
    echo "  2. Attach:      tmux attach -t $SESSION_NAME"
    echo "  3. Stop:        bash vps-stop.sh"
    echo "  4. Restart:     bash vps-stop.sh && bash vps-start.sh"
    exit 1
fi

# Create new tmux session and run test
echo "Creating tmux session: $SESSION_NAME"
tmux new-session -d -s "$SESSION_NAME" "bash vps-run.sh"

echo ""
echo "✓ Test started in background!"
echo ""
echo "Management commands:"
echo "  View logs:   bash vps-logs.sh"
echo "  Attach:      tmux attach -t $SESSION_NAME"
echo "  Detach:      Ctrl+B then D"
echo "  Stop:        bash vps-stop.sh"
echo "  Status:      bash vps-status.sh"
echo ""
echo "Session persists even if you disconnect SSH!"
echo "===================================="
