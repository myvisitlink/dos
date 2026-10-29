#!/bin/bash
# VPS Run Script - Start k6 load test with local FlareSolverr

set -e

# Mode selection
MODE="${MODE:-auth_api_flood}"  # auth_api_flood | login_flood

# Config (override với env vars nếu cần)
TARGET_URL="${TARGET_URL:-https://thanhhuyreal.com}"
USERNAME="${USERNAME:-lonussystem}"
PASSWORD="${PASSWORD:-lonussystem123@}"
FLARESOLVERR_URL="${FLARESOLVERR_URL:-http://localhost:8191}"

# Test config
STAGES="${STAGES:-30s:500,60s:2000,120s:5000,360m:5000}"
START_RATE="${START_RATE:-100}"
PRE_VUS="${PRE_VUS:-500}"
MAX_VUS="${MAX_VUS:-10000}"
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-30s}"
MAX_ERR_RATE="${MAX_ERR_RATE:-0.9}"

echo "===================================="
echo "k6 Load Test - thanhhuyreal.com"
echo "===================================="
echo "Mode: $MODE"
echo ""

# Check FlareSolverr
echo "[1/3] Checking FlareSolverr..."
echo "  URL: $FLARESOLVERR_URL"
if ! curl -sf ${FLARESOLVERR_URL}/health > /dev/null 2>&1; then
  echo "❌ FlareSolverr not running at $FLARESOLVERR_URL!"
  if [ "$FLARESOLVERR_URL" = "http://localhost:8191" ]; then
    echo "Start it with: docker start flaresolverr"
  fi
  exit 1
fi
echo "✓ FlareSolverr running"

# Get cf_clearance
echo ""
echo "[2/3] Getting cf_clearance cookie..."
RESPONSE=$(curl -s -X POST ${FLARESOLVERR_URL}/v1 \
  -H "Content-Type: application/json" \
  -d "{
    \"cmd\": \"request.get\",
    \"url\": \"${TARGET_URL}\",
    \"maxTimeout\": 60000
  }")

STATUS=$(echo "$RESPONSE" | jq -r '.status // "error"')
if [ "$STATUS" != "ok" ]; then
  echo "❌ FlareSolverr failed!"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

CF_CLEARANCE=$(echo "$RESPONSE" | jq -r '.solution.cookies[]? | select(.name=="cf_clearance") | .value // empty')
CF_UA=$(echo "$RESPONSE" | jq -r '.solution.userAgent // "Mozilla/5.0"')

if [ -z "$CF_CLEARANCE" ]; then
  echo "⚠ No cf_clearance cookie (maybe no Cloudflare challenge)"
  CF_CLEARANCE="none"
else
  echo "✓ cf_clearance: ${CF_CLEARANCE:0:50}..."
fi

echo "✓ User-Agent: ${CF_UA:0:80}..."

# Write cookies to files for k6
echo "$CF_CLEARANCE" > /tmp/cf_clearance.txt
echo "$CF_UA" > /tmp/cf_ua.txt

# Start background daemon to refresh cookie every 25 minutes
echo ""
echo "Starting cookie refresh daemon..."

cat > /tmp/refresh-cookie.sh << DAEMON_SCRIPT
#!/bin/bash
FLARESOLVERR_URL="${FLARESOLVERR_URL}"
TARGET_URL="${TARGET_URL}"

while true; do
  sleep 1500  # 25 minutes
  
  echo "[$(date)] Refreshing cf_clearance cookie..."
  
  RESPONSE=\$(curl -s -X POST \${FLARESOLVERR_URL}/v1 \\
    -H "Content-Type: application/json" \\
    -d "{
      \"cmd\": \"request.get\",
      \"url\": \"\${TARGET_URL}\",
      \"maxTimeout\": 60000
    }")
  
  STATUS=\$(echo "\$RESPONSE" | jq -r '.status // "error"')
  if [ "\$STATUS" = "ok" ]; then
    NEW_CF_CLEARANCE=\$(echo "\$RESPONSE" | jq -r '.solution.cookies[]? | select(.name=="cf_clearance") | .value // empty')
    NEW_CF_UA=\$(echo "\$RESPONSE" | jq -r '.solution.userAgent // ""')
    
    if [ -n "\$NEW_CF_CLEARANCE" ]; then
      echo "\$NEW_CF_CLEARANCE" > /tmp/cf_clearance.txt
      echo "\$NEW_CF_UA" > /tmp/cf_ua.txt
      echo "[\$(date)] ✓ Cookie refreshed: \${NEW_CF_CLEARANCE:0:50}..."
    else
      echo "[\$(date)] ⚠ No cf_clearance in response"
    fi
  else
    echo "[\$(date)] ✗ FlareSolverr request failed: \$STATUS"
  fi
done
DAEMON_SCRIPT

chmod +x /tmp/refresh-cookie.sh
nohup /tmp/refresh-cookie.sh > /tmp/cookie-refresh.log 2>&1 &
echo $! > /tmp/cookie-refresh.pid

echo "✓ Cookie refresh daemon started (PID: $(cat /tmp/cookie-refresh.pid))"
echo "  - Refresh interval: 25 minutes"
echo "  - Log file: /tmp/cookie-refresh.log"

# System info
echo ""
echo "[3/3] System info:"
echo "  VPS IP: $(curl -sf https://api.ipify.org || echo 'unknown')"
echo "  CPU cores: $(nproc)"
echo "  RAM free: $(free -m | awk '/Mem:/{print $4}') MB"
echo "  ulimit -n: $(ulimit -n)"
echo ""
echo "Test config:"
echo "  Target: $TARGET_URL"
echo "  Stages: $STAGES"
echo "  Max VUs: $MAX_VUS"
echo ""

# Cleanup function
cleanup() {
  echo ""
  echo "Cleaning up..."
  if [ -f /tmp/cookie-refresh.pid ]; then
    kill $(cat /tmp/cookie-refresh.pid) 2>/dev/null || true
    rm /tmp/cookie-refresh.pid
  fi
  echo "✓ Cleanup done"
}

trap cleanup EXIT INT TERM

# Run k6
echo "===================================="
echo "Starting k6 load test..."
echo "===================================="
echo ""

K6_OUT_JSON=results-$(date +%Y%m%d-%H%M%S).json

IP_URL="$TARGET_URL" \
SITE_HOST="thanhhuyreal.com" \
PHP_IDENTIFIER="$USERNAME" \
PHP_PASSWORD="$PASSWORD" \
CF_CLEARANCE_FILE="/tmp/cf_clearance.txt" \
CF_UA_FILE="/tmp/cf_ua.txt" \
STAGES="$STAGES" \
START_RATE="$START_RATE" \
PRE_VUS="$PRE_VUS" \
MAX_VUS="$MAX_VUS" \
REQUEST_TIMEOUT="$REQUEST_TIMEOUT" \
MAX_ERR_RATE="$MAX_ERR_RATE" \
k6 run \
  --no-usage-report \
  --out json=$K6_OUT_JSON \
  test-script-auth.js

echo ""
echo "===================================="
echo "✓ Test completed!"
echo "Results saved to: $K6_OUT_JSON"
echo ""
if [ -f /tmp/cookie-refresh.log ]; then
  echo "Cookie refresh log (last 20 lines):"
  tail -n 20 /tmp/cookie-refresh.log
fi
echo "===================================="
