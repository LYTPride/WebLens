#!/usr/bin/env bash
# 用法：
#   ./scripts/build-release.sh            # 使用当天日期作为版本号，例如 weblens-20260309.tar.gz
#   ./scripts/build-release.sh v1.0.0     # 指定版本号，生成 weblens-v1.0.0.tar.gz
# 打包内容包含启动 WebLens 所需的 server/bin/weblens-server、web/dist 和 weblens-*.sh 启停脚本，
# 排除测试脚本、源码、node_modules 和已有日志等，仅用于部署。
# 构建并打包 WebLens 部署包 .tar.gz（包含启动服务所需文件，排除测试与日志）
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${BASE_DIR}"

RELEASE_NAME="weblens"
STAGING="${BASE_DIR}/release/.staging-${RELEASE_NAME}"
OUT_DIR="${BASE_DIR}/release"
# 可指定版本标签，默认日期
VERSION="${1:-$(date +%Y%m%d)}"
TARBALL="${OUT_DIR}/${RELEASE_NAME}-${VERSION}.tar.gz"

echo "=== WebLens 部署包构建 ==="

# 1. 构建后端（Linux amd64 静态二进制）
echo ">> 构建 server/bin/weblens-server ..."
mkdir -p server/bin
(
  cd server
  export CGO_ENABLED=0
  export GOOS=linux
  export GOARCH=amd64
  if command -v go &>/dev/null; then
    go build -trimpath -o bin/weblens-server ./cmd/weblens
  else
    echo "go not found, using existing binary if present" >&2
  fi
)
if [[ ! -f server/bin/weblens-server ]]; then
  echo "Error: server/bin/weblens-server not found. Install Go and run build, or copy binary." >&2
  exit 1
fi
chmod +x server/bin/weblens-server

# 2. 构建前端（先清空旧的 web/dist，避免历史遗留文件混入）
echo ">> 清空 web/dist 并重新构建前端 ..."
rm -rf web/dist
(cd web && npm run build)
if [[ ! -f web/dist/index.html ]]; then
  echo "Error: web/dist/index.html not found. Run: cd web && npm run build" >&2
  exit 1
fi

# 3. 准备打包目录（仅包含部署必要文件，先清空临时打包空间）
echo ">> 准备打包目录（清理旧的 staging） ..."
rm -rf "${STAGING}"
mkdir -p "${STAGING}/${RELEASE_NAME}"

# 后端二进制
mkdir -p "${STAGING}/${RELEASE_NAME}/server/bin"
cp -a server/bin/weblens-server "${STAGING}/${RELEASE_NAME}/server/bin/"
chmod +x "${STAGING}/${RELEASE_NAME}/server/bin/weblens-server"

# 前端静态资源
mkdir -p "${STAGING}/${RELEASE_NAME}/web/dist"
cp -a web/dist/. "${STAGING}/${RELEASE_NAME}/web/dist/"

# 启停脚本（排除测试脚本）
mkdir -p "${STAGING}/${RELEASE_NAME}/scripts"
for f in weblens-start.sh weblens-stop.sh weblens-restart.sh; do
  cp -a "scripts/${f}" "${STAGING}/${RELEASE_NAME}/scripts/"
  chmod +x "${STAGING}/${RELEASE_NAME}/scripts/${f}"
done

# config 目录（占位 + 示例配置，不包含实际密钥与日志）
mkdir -p "${STAGING}/${RELEASE_NAME}/config"
if [[ ! -f config/weblens.env.example ]]; then
  cat > "${STAGING}/${RELEASE_NAME}/config/weblens.env.example" << 'EOF'
# WebLens 环境变量示例（复制为 weblens.env 后按需修改）
# WEBLENS_HTTP_ADDR=0.0.0.0:8080
# WEBLENS_KUBECONFIG_DIR=/path/to/kubeconfigs
# WEBLENS_WEB_DIST_DIR=  # 可选，默认 ./web/dist
# WEBLENS_DEFAULT_NAMESPACE=  # 可选
# WEBLENS_AUTH_USER=     # 可选，与 AUTH_PASSWORD 同时设置启用 Basic 鉴权
# WEBLENS_AUTH_PASSWORD=
EOF
else
  cp -a config/weblens.env.example "${STAGING}/${RELEASE_NAME}/config/" 2>/dev/null || true
fi

# 4. 打 tar.gz
mkdir -p "${OUT_DIR}"
echo ">> 打包 ${TARBALL} ..."
tar -czf "${TARBALL}" -C "${STAGING}" "${RELEASE_NAME}"
rm -rf "${STAGING}"

echo ""
echo "=== 完成 ==="
echo "部署包: ${TARBALL}"
echo "解压后目录结构:"
tar -tzf "${TARBALL}" | head -20
echo "..."
echo "部署: tar -xzf ${RELEASE_NAME}-${VERSION}.tar.gz && cd ${RELEASE_NAME} && ./scripts/weblens-start.sh"
