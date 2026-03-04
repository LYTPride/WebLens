#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${BASE_DIR}/weblens.pid"
LOG_DIR="${BASE_DIR}/logs"
BIN="${BASE_DIR}/server/bin/weblens-server"

cd "${BASE_DIR}"

# Optional: load env file if present
ENV_FILE="${BASE_DIR}/config/weblens.env"
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

mkdir -p "${LOG_DIR}"

if [[ ! -x "${BIN}" ]]; then
  echo "weblens-server binary not found at ${BIN}. Please build it first." >&2
  exit 1
fi

if [[ -f "${PID_FILE}" ]] && kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
  echo "WebLens is already running with PID $(cat "${PID_FILE}")"
  exit 0
fi

echo "Starting WebLens..."
nohup "${BIN}" >>"${LOG_DIR}/weblens.log" 2>&1 &
echo $! >"${PID_FILE}"
echo "WebLens started with PID $(cat "${PID_FILE}")"

