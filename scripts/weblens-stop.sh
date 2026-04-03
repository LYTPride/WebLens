#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${BASE_DIR}/weblens.pid"

if [[ ! -f "${PID_FILE}" ]]; then
  echo "WebLens is not running (no PID file)."
  exit 0
fi

PID="$(cat "${PID_FILE}")"
if ! kill -0 "${PID}" 2>/dev/null; then
  echo "WebLens process ${PID} not found, removing stale PID file."
  rm -f "${PID_FILE}"
  exit 0
fi

echo "Stopping WebLens (PID ${PID})..."
kill "${PID}"

for _ in {1..20}; do
  if ! kill -0 "${PID}" 2>/dev/null; then
    echo "Stopped."
    rm -f "${PID_FILE}"
    exit 0
  fi
  sleep 0.5
done

echo "Process did not exit in time, sending SIGKILL..."
kill -9 "${PID}" || true
rm -f "${PID_FILE}"
echo "Stopped forcefully."

