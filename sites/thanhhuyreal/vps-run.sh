#!/usr/bin/env bash
# =============================================================
#  vps-run.sh — Chạy k6 native trên Linux VPS với tmux
#  Session tồn tại sau khi đóng SSH.
#
#  Usage:
#    chmod +x vps-run.sh
#    ./vps-run.sh          # start (hoặc restart nếu đang chạy)
#    ./vps-run.sh stop     # dừng
#    ./vps-run.sh status   # xem logs live
#    ./vps-run.sh attach   # vào session tmux
# =============================================================

SESSION="flood"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/test-script.js"

# ---- Load .env ----
set -a
source "$SCRIPT_DIR/.env"
set +a

# ---- Tăng ulimit cho process hiện tại ----
ulimit -n 131072 2>/dev/null || true

# ---- k6 env vars ----
K6_ENV_ARGS=(
  -e TARGET_URL="$TARGET_URL"
  -e STAGES="$STAGES"
  -e START_RATE="$START_RATE"
  -e PRE_VUS="$PRE_VUS"
  -e MAX_VUS="$MAX_VUS"
  -e REQUEST_TIMEOUT="$REQUEST_TIMEOUT"
  -e REQUEST_DELAY="$REQUEST_DELAY"
  -e MAX_5XX_RATE="$MAX_5XX_RATE"
  -e MAX_TIMEOUT_RATE="$MAX_TIMEOUT_RATE"
)

K6_CMD="k6 run --no-usage-report ${K6_ENV_ARGS[*]} $SCRIPT 2>&1 | tee /tmp/k6-flood.log"

case "${1:-start}" in
  start)
    # Cài k6 nếu chưa có
    if ! command -v k6 &>/dev/null; then
      echo ">>> Cài k6..."
      sudo gpg -k &>/dev/null
      sudo gpg --no-default-keyring \
        --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
        --keyserver hkp://keyserver.ubuntu.com:80 \
        --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
      echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
        | sudo tee /etc/apt/sources.list.d/k6.list
      sudo apt-get update -qq && sudo apt-get install -y k6
    fi

    # Cài tmux nếu chưa có
    if ! command -v tmux &>/dev/null; then
      sudo apt-get install -y tmux
    fi

    # Nếu session đang chạy thì kill trước
    tmux has-session -t "$SESSION" 2>/dev/null && tmux kill-session -t "$SESSION"

    # Tạo session mới và chạy k6
    tmux new-session -d -s "$SESSION" -x 220 -y 50
    tmux send-keys -t "$SESSION" "ulimit -n 131072; $K6_CMD" Enter

    echo "k6 dang chay trong tmux session '$SESSION'"
    echo ""
    echo "   Vao xem live:  tmux attach -t $SESSION"
    echo "   Detach:        Ctrl+B roi D"
    echo "   Xem log:       tail -f /tmp/k6-flood.log"
    echo "   Dung:          ./vps-run.sh stop"
    ;;

  stop)
    tmux kill-session -t "$SESSION" 2>/dev/null && echo "Da dung session '$SESSION'" || echo "Session khong ton tai"
    ;;

  status)
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      echo "Session '$SESSION' dang chay"
      echo "--- Log cuoi ---"
      tail -n 30 /tmp/k6-flood.log 2>/dev/null || echo "(chua co log)"
    else
      echo "Session '$SESSION' khong ton tai"
    fi
    ;;

  attach)
    tmux attach -t "$SESSION" || echo "Session khong ton tai. Chay ./vps-run.sh start truoc."
    ;;

  *)
    echo "Usage: $0 {start|stop|status|attach}"
    exit 1
    ;;
esac
