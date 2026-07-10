#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${BASE_DIR}/server/bin/weblens-server"

cd "${BASE_DIR}"

ENV_FILE="${BASE_DIR}/config/weblens.env"
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [[ ! -x "${BIN}" ]]; then
  echo "weblens-server binary not found at ${BIN}. Please build it first." >&2
  exit 1
fi

if "${BIN}" is-initialized >/dev/null 2>&1; then
  echo "WebLens has already been initialized."
  exit 0
fi

read -r -s -p "Set admin password: " password1
echo
read -r -s -p "Confirm admin password: " password2
echo

if [[ "${password1}" != "${password2}" ]]; then
  echo "Passwords do not match." >&2
  exit 1
fi

if [[ -z "${password1}" ]]; then
  echo "Password cannot be empty." >&2
  exit 1
fi

printf "%s" "${password1}" | "${BIN}" init-admin
