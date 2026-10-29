#!/bin/bash
# VPS Status - Kiểm tra trạng thái test

SESSION_NAME="k6-thanhhuyreal"

echo "===================================="
echo "k6 Load Test Status"
echo "===================================="
echo ""

# Check tmux session
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "✓ Test is RUNNING"
    
    # Get session info
    CREATED=$(tmux display-message -t "$SESSION_NAME" -p '#{session_created}')
    CURRENT=$(date +%s)
    RUNTIME=$((CURRENT - CREATED))
    HOURS=$((RUNTIME / 3600))
    MINUTES=$(((RUNTIME % 3600) / 60))
    
    echo "  Runtime: ${HOURS}h ${MINUTES}m"
    echo "  Session: $SESSION_NAME"
else
    echo "✗ Test is NOT running"
fi

echo ""

# Check FlareSolverr
if docker ps | grep -q flaresolverr; then
    echo "✓ FlareSolverr is running"
else
    echo "✗ FlareSolverr is NOT running"
fi

echo ""

# Check cookie refresh daemon
if [ -f /tmp/cookie-refresh.pid ]; then
    PID=$(cat /tmp/cookie-refresh.pid)
    if ps -p $PID > /dev/null 2>&1; then
        echo "✓ Cookie refresh daemon is running (PID: $PID)"
        
        # Show last refresh
        if [ -f /tmp/cookie-refresh.log ]; then
            LAST_REFRESH=$(tail -n 1 /tmp/cookie-refresh.log | grep -oP '\[.*?\]' || echo "N/A")
            echo "  Last refresh: $LAST_REFRESH"
        fi
    else
        echo "✗ Cookie refresh daemon is NOT running (stale PID)"
    fi
else
    echo "✗ Cookie refresh daemon is NOT running"
fi

echo ""

# System resources
echo "System Resources:"
echo "  CPU usage: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}')%"
echo "  RAM free:  $(free -h | awk '/Mem:/{print $4}')"
echo "  Disk free: $(df -h . | awk 'NR==2{print $4}')"

echo ""

# Network connections
CONNECTIONS=$(ss -tan | grep ESTAB | wc -l)
echo "  Active connections: $CONNECTIONS"

echo ""

# Latest results file
if ls results-*.json 1> /dev/null 2>&1; then
    LATEST=$(ls -t results-*.json | head -n1)
    SIZE=$(du -h "$LATEST" | cut -f1)
    echo "Latest results: $LATEST ($SIZE)"
fi

echo ""
echo "===================================="
echo ""
echo "Commands:"
echo "  View logs:  bash vps-logs.sh"
echo "  Stop test:  bash vps-stop.sh"
echo "  Attach:     tmux attach -t $SESSION_NAME"
