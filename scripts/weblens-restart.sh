#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"${BASE_DIR}/scripts/weblens-stop.sh" || true
"${BASE_DIR}/scripts/weblens-start.sh"

