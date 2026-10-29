#!/bin/bash
# Manual login test

echo "=== Testing manual login flow ==="

# Get cookie from file
CF_CLEARANCE=$(cat /tmp/cf_clearance.txt 2>/dev/null || echo "")
CF_UA=$(cat /tmp/cf_ua.txt 2>/dev/null || echo "Mozilla/5.0")

echo "cf_clearance: ${CF_CLEARANCE:0:50}..."
echo "User-Agent: ${CF_UA:0:80}..."
echo ""

# Step 1: GET login page
echo "Step 1: GET login page..."
LOGIN_PAGE=$(curl -s -L "https://thanhhuyreal.com/?auth=login" \
  -H "User-Agent: $CF_UA" \
  -H "Cookie: cf_clearance=$CF_CLEARANCE" \
  -c /tmp/login-cookies.txt)

echo "Response length: ${#LOGIN_PAGE} chars"
echo ""

# Extract CSRF
CSRF=$(echo "$LOGIN_PAGE" | grep -oP 'name="csrf_token"\s+value="\K[^"]+' | head -n1)
if [ -z "$CSRF" ]; then
  echo "❌ CSRF token not found!"
  echo "HTML preview:"
  echo "$LOGIN_PAGE" | head -n 50
  exit 1
fi
echo "✓ CSRF token: ${CSRF:0:30}..."

# Extract PHPSESSID
PHPSESSID=$(grep PHPSESSID /tmp/login-cookies.txt | awk '{print $7}')
if [ -z "$PHPSESSID" ]; then
  echo "❌ PHPSESSID not found!"
  cat /tmp/login-cookies.txt
  exit 1
fi
echo "✓ PHPSESSID: ${PHPSESSID:0:16}..."
echo ""

# Step 2: POST login
echo "Step 2: POST login..."
LOGIN_RESPONSE=$(curl -s -X POST "https://thanhhuyreal.com/model/login" \
  -H "User-Agent: $CF_UA" \
  -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
  -H "Accept: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -H "Cookie: PHPSESSID=$PHPSESSID; cf_clearance=$CF_CLEARANCE" \
  -H "Referer: https://thanhhuyreal.com/?auth=login" \
  -H "Origin: https://thanhhuyreal.com" \
  -d "csrf_token=$(echo $CSRF | jq -rR @uri)&identifier=lonussystem&password=lonussystem123%40")

echo "Login response:"
echo "$LOGIN_RESPONSE" | jq '.' 2>/dev/null || echo "$LOGIN_RESPONSE"
echo ""

# Check if success
STATUS=$(echo "$LOGIN_RESPONSE" | jq -r '.status // false')
if [ "$STATUS" = "true" ]; then
  echo "✅ LOGIN SUCCESS!"
else
  echo "❌ LOGIN FAILED!"
  echo "Full response: $LOGIN_RESPONSE"
fi
