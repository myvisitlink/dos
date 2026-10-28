#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

SCALE=1
DOWN=0
EXTRA_ENV=()

usage() {
  cat <<'EOF'
Usage: ./run.sh [options]

  -s, --scale N       Số container chạy song song (mặc định 1)
  -e, --env KEY=VAL   Override biến môi trường (lặp lại được)
  -d, --down          Dừng và xoá container
  -h, --help          Trợ giúp

Ví dụ:
  ./run.sh
  ./run.sh -e STAGES=30s:100,60s:500 -e MAX_VUS=500
  ./run.sh --scale 4
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--scale) SCALE="${2:?Thiếu giá trị cho --scale}"; shift 2 ;;
    -e|--env)   EXTRA_ENV+=("${2:?Thiếu giá trị cho --env}"); shift 2 ;;
    -d|--down)  DOWN=1; shift ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "Tham số không hợp lệ: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ $DOWN -eq 1 ]]; then
  docker compose down
  exit 0
fi

if [[ ! -f .env ]]; then
  echo "Chưa có .env. Chạy: cp .env.example .env  rồi điền giá trị." >&2
  exit 1
fi

echo "[!] Chỉ chạy trên hạ tầng bạn sở hữu."

args=(compose run --rm)
if [[ ${#EXTRA_ENV[@]} -gt 0 ]]; then
  for kv in "${EXTRA_ENV[@]}"; do
    args+=(-e "$kv")
  done
fi

if [[ $SCALE -gt 1 ]]; then
  if [[ ${#EXTRA_ENV[@]} -gt 0 ]]; then
    echo "Cảnh báo: --scale > 1 chỉ đọc cấu hình từ .env, bỏ qua -e." >&2
  fi
  docker compose up --scale k6="$SCALE"
  docker compose down
else
  args+=(k6)
  docker "${args[@]}"
fi
