#!/usr/bin/env bash
# WebLens 冒烟测试：构建前端、启动后端、校验关键接口与静态资源，然后停止服务。
# 用法：在项目根目录执行 ./scripts/smoke-test.sh
# 可选：WEBLENS_HTTP_ADDR=0.0.0.0:18080 已写死端口，避免与默认 8080 冲突。

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT=18080
BASE="http://127.0.0.1:${PORT}"
PID=""

cleanup() {
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "[smoke] Building frontend (web) ..."
(cd web && npm run build --silent)

echo "[smoke] Starting backend on :${PORT} ..."
WEBLENS_HTTP_ADDR="0.0.0.0:${PORT}" ./server/bin/weblens-server &
PID=$!
for i in {1..15}; do
  if curl -s -o /dev/null "$BASE/healthz" 2>/dev/null; then break; fi
  [[ $i -eq 15 ]] && { echo "[smoke] timeout waiting for server"; exit 1; }
  sleep 1
done

echo "[smoke] GET /healthz"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/healthz")
[[ "$code" == "200" ]] || { echo "expected 200, got $code"; exit 1; }

echo "[smoke] GET /api/clusters"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/clusters")
[[ "$code" == "200" ]] || { echo "expected 200, got $code"; exit 1; }

echo "[smoke] POST /api/clusters/reload"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/clusters/reload")
[[ "$code" == "200" ]] || { echo "expected 200, got $code"; exit 1; }

echo "[smoke] GET /api/clusters/__no_such__/namespaces (expect 404)"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/clusters/__no_such__/namespaces")
[[ "$code" == "404" ]] || { echo "expected 404, got $code"; exit 1; }

echo "[smoke] GET / (index)"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/")
[[ "$code" == "200" ]] || { echo "expected 200, got $code"; exit 1; }

# 若存在集群，抽查资源接口
items=$(curl -s "$BASE/api/clusters" | grep -o '"id":"[^"]*"' | head -1)
if [[ -n "$items" ]]; then
  cid="${items#\"id\":\"}"
  cid="${cid%\"}"
  echo "[smoke] GET /api/clusters/<id>/namespaces (cluster=$cid)"
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/clusters/$cid/namespaces")
  [[ "$code" == "200" ]] || { echo "expected 200, got $code"; exit 1; }
  echo "[smoke] GET /api/clusters/<id>/deployments"
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/clusters/$cid/deployments")
  [[ "$code" == "200" ]] || { echo "expected 200, got $code"; exit 1; }
fi

echo "[smoke] All checks passed."
