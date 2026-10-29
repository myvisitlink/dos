#!/bin/bash
# Test FlareSolverr session creation

echo "=== Testing FlareSolverr session-based approach ==="

# Create a session
echo "Creating FlareSolverr session..."
SESSION_RESPONSE=$(curl -s -X POST http://localhost:8191/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "cmd": "sessions.create"
  }')

SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.session')
echo "Session ID: $SESSION_ID"

# Use session to get page
echo ""
echo "Getting page with session..."
PAGE_RESPONSE=$(curl -s -X POST http://localhost:8191/v1 \
  -H "Content-Type: application/json" \
  -d "{
    \"cmd\": \"request.get\",
    \"url\": \"https://thanhhuyreal.com/?auth=login\",
    \"session\": \"$SESSION_ID\",
    \"maxTimeout\": 60000
  }")

STATUS=$(echo "$PAGE_RESPONSE" | jq -r '.status')
echo "Status: $STATUS"

if [ "$STATUS" = "ok" ]; then
  echo "✓ Page loaded successfully"
  
  # Extract all cookies
  echo ""
  echo "Cookies from FlareSolverr:"
  echo "$PAGE_RESPONSE" | jq -r '.solution.cookies[] | "\(.name)=\(.value)"'
  
  # Try to use these cookies directly with curl
  echo ""
  echo "Testing cookies with direct curl..."
  
  COOKIE_STRING=$(echo "$PAGE_RESPONSE" | jq -r '.solution.cookies[] | "\(.name)=\(.value)"' | paste -sd ';' -)
  USER_AGENT=$(echo "$PAGE_RESPONSE" | jq -r '.solution.userAgent')
  
  TEST_RESPONSE=$(curl -s "https://thanhhuyreal.com/?auth=login" \
    -H "User-Agent: $USER_AGENT" \
    -H "Cookie: $COOKIE_STRING")
  
  if echo "$TEST_RESPONSE" | grep -q "csrf_token"; then
    echo "✅ Cookies work with direct curl!"
    echo "CSRF found in response"
  else
    echo "❌ Cookies don't work with direct curl"
    echo "Response preview:"
    echo "$TEST_RESPONSE" | head -n 20
  fi
else
  echo "❌ Failed to load page"
  echo "$PAGE_RESPONSE" | jq '.'
fi

# Cleanup
echo ""
echo "Destroying session..."
curl -s -X POST http://localhost:8191/v1 \
  -H "Content-Type: application/json" \
  -d "{
    \"cmd\": \"sessions.destroy\",
    \"session\": \"$SESSION_ID\"
  }" > /dev/null

echo "Done"
