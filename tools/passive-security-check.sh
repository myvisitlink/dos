#!/usr/bin/env bash
# =====================================================================
# Passive security check - CHỈ ĐỌC, không gửi payload khai thác.
# Chỉ dùng cho hệ thống bạn sở hữu hoặc có văn bản cho phép.
#
#   ./passive-security-check.sh https://thanhhuyreal.com
#
# Nguyên tắc: mỗi request cách nhau 200ms, không gửi dữ liệu vào,
# không thử mật khẩu, không upload. An toàn với site đang chạy.
# =====================================================================
set -uo pipefail

BASE="${1:-https://thanhhuyreal.com}"
BASE="${BASE%/}"
UA='Mozilla/5.0 (compatible; own-site-audit)'
ISSUES=0

ok()   { printf '  \033[32m[ok]\033[0m   %s\n' "$*"; }
warn() { printf '  \033[33m[warn]\033[0m %s\n' "$*"; ISSUES=$((ISSUES + 1)); }
bad()  { printf '  \033[31m[FAIL]\033[0m %s\n' "$*"; ISSUES=$((ISSUES + 1)); }
sec()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }

hdrs() {
  curl -sS -A "$UA" -D - -o /dev/null --max-time 15 "$1" 2>/dev/null
}

HOST="${BASE#https://}"
HOST="${HOST%%/*}"
DOMAIN="${HOST#www.}"

sec "0. Mục tiêu"
echo "  URL    : $BASE"
echo "  Host   : $HOST"
echo "  Domain : $DOMAIN"

# ---------------------------------------------------------------- 1
sec "1. Header phản hồi & lộ phiên bản"
H="$(hdrs "$BASE/")"
printf '%s\n' "$H" | sed -n '1,20p' | sed 's/^/  /'

for h in server x-powered-by x-aspnet-version x-generator x-drupal-cache; do
  v="$(printf '%s\n' "$H" | grep -i "^$h:" | head -1 | tr -d '\r')"
  [ -n "$v" ] && warn "lộ thông tin: $v"
done

# ---------------------------------------------------------------- 2
sec "2. Security headers"
declare -A NEED=(
  [strict-transport-security]="HSTS"
  [content-security-policy]="Content-Security-Policy"
  [x-content-type-options]="X-Content-Type-Options"
  [x-frame-options]="X-Frame-Options"
  [referrer-policy]="Referrer-Policy"
  [permissions-policy]="Permissions-Policy"
)
for k in "${!NEED[@]}"; do
  if printf '%s\n' "$H" | grep -qi "^$k:"; then
    ok "${NEED[$k]}"
  else
    bad "thiếu ${NEED[$k]}"
  fi
done

# ---------------------------------------------------------------- 3
sec "3. Cookie phiên"
CH="$(hdrs "$BASE/?auth=login")"
SC="$(printf '%s\n' "$CH" | grep -i '^set-cookie:' | tr -d '\r')"
if [ -z "$SC" ]; then
  warn "không thấy Set-Cookie ở trang login"
else
  printf '%s\n' "$SC" | sed 's/^/  /'
  printf '%s\n' "$SC" | grep -qi 'httponly' || bad "cookie thiếu HttpOnly (XSS đọc được session)"
  printf '%s\n' "$SC" | grep -qi 'secure'   || bad "cookie thiếu Secure (lộ qua HTTP)"
  printf '%s\n' "$SC" | grep -qi 'samesite' || warn "cookie thiếu SameSite (CSRF dễ hơn)"
fi

# ---------------------------------------------------------------- 4
sec "4. File / thư mục thường bị lộ"
PATHS=(
  robots.txt sitemap.xml
  .git/HEAD .git/config .svn/entries
  .env .env.bak .env.local .DS_Store
  composer.json composer.lock package.json package-lock.json
  phpinfo.php info.php test.php adminer.php
  backup.zip backup.sql db.sql dump.sql
  config.php.bak wp-config.php.bak .htaccess server-status
  storage/logs/laravel.log
)
for p in "${PATHS[@]}"; do
  code="$(curl -sS -A "$UA" -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/$p" 2>/dev/null)"
  case "$code" in
    200) bad "200  /$p  <- truy cập được" ;;
    30[12378]) warn "$code  /$p  (redirect)" ;;
    401|403) ok "$code  /$p  (bị chặn)" ;;
    *) : ;;
  esac
  sleep 0.2
done

# ---------------------------------------------------------------- 5
sec "5. HTTP methods"
for m in OPTIONS TRACE PUT DELETE PATCH; do
  code="$(curl -sS -A "$UA" -o /dev/null -w '%{http_code}' -X "$m" --max-time 10 "$BASE/" 2>/dev/null)"
  case "$m:$code" in
    TRACE:200) bad "TRACE bật -> Cross-Site Tracing" ;;
    PUT:200|PUT:201|PUT:204) bad "PUT cho phép -> có thể ghi file" ;;
    DELETE:200|DELETE:204) bad "DELETE cho phép -> có thể xoá" ;;
    *) echo "  $m -> $code" ;;
  esac
  sleep 0.2
done

# ---------------------------------------------------------------- 6
sec "6. TLS"
if command -v openssl >/dev/null 2>&1; then
  echo | openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null \
    | openssl x509 -noout -subject -issuer -dates 2>/dev/null | sed 's/^/  /' \
    || warn "không đọc được certificate"
  for v in tls1 tls1_1; do
    if echo | openssl s_client -connect "$HOST:443" -servername "$HOST" "-$v" >/dev/null 2>&1; then
      bad "$v vẫn bật (phải tắt)"
    else
      ok "$v đã tắt"
    fi
  done
else
  warn "không có openssl, bỏ qua kiểm tra TLS"
fi

# ---------------------------------------------------------------- 7
sec "7. DNS / email auth"
if command -v dig >/dev/null 2>&1; then
  spf="$(dig +short TXT "$DOMAIN" | grep -i 'v=spf1' | head -1)"
  dmarc="$(dig +short TXT "_dmarc.$DOMAIN" | head -1)"
  [ -n "$spf" ]   && ok "SPF: $spf"     || warn "không có SPF (dễ giả mạo email)"
  [ -n "$dmarc" ] && ok "DMARC: $dmarc" || warn "không có DMARC"
else
  warn "không có dig, bỏ qua"
fi

# ---------------------------------------------------------------- 8
sec "8. Lộ phiên bản PHP"
PV="$(curl -sS -A "$UA" --max-time 10 \
  "$BASE/?=PHPB8B5F2A0-3C92-11d3-A3A9-4C7B08C10000" 2>/dev/null \
  | grep -oiE 'PHP/[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
if [ -n "$PV" ]; then
  warn "lộ $PV (nên đặt expose_php=Off)"
else
  ok "không lộ phiên bản PHP"
fi

# ---------------------------------------------------------------- 9
sec "9. Trang quản trị lộ diện"
for p in admin administrator admin/login login.php wp-admin wp-login.php dashboard panel cpanel; do
  code="$(curl -sS -A "$UA" -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/$p" 2>/dev/null)"
  case "$code" in
    200) warn "200  /$p" ;;
    30[12378]) echo "  $code  /$p (redirect)" ;;
    *) : ;;
  esac
  sleep 0.2
done

# ---------------------------------------------------------------- tong ket
sec "Tổng kết"
if [ "$ISSUES" -eq 0 ]; then
  ok "không phát hiện vấn đề ở mức thụ động"
else
  printf '  \033[33m%d vấn đề cần xem lại\033[0m\n' "$ISSUES"
fi
echo
echo "Lưu ý: script này chỉ kiểm tra cấu hình. Lỗi logic ứng dụng"
echo "(SQLi, XSS, IDOR, phân quyền) phải test thủ công hoặc trên staging."
