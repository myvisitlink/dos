#!/bin/bash
# VPS Run Script - Start k6 load test with local FlareSolverr

set -e

# Config
TARGET_URL="https://thanhhuyreal.com"
USERNAME="lonussystem"
PASSWORD="lonussystem123@"
FLARESOLVERR_URL="http://localhost:8191"

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
echo ""

# Check FlareSolverr
echo "[1/3] Checking FlareSolverr..."
if ! curl -sf http://localhost:8191/health > /dev/null 2>&1; then
  echo "❌ FlareSolverr not running!"
  echo "Start it with: docker start flaresolverr"
  exit 1
fi
echo "✓ FlareSolverr running"

# Get cf_clearance
echo ""
echo "[2/3] Getting cf_clearance cookie..."
RESPONSE=$(curl -s -X POST http://localhost:8191/v1 \
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
CF_CLEARANCE="$CF_CLEARANCE" \
CF_UA="$CF_UA" \
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
echo "===================================="
