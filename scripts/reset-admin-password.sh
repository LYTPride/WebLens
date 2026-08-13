#!/usr/bin/env bash
set -euo pipefail
umask 077

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${BASE_DIR}/server/bin/weblens-server"
ENV_FILE="${BASE_DIR}/config/weblens.env"

cd "${BASE_DIR}"

password1=""
password2=""
confirmation=""
cleanup() {
  unset password1 password2 confirmation
}
trap cleanup EXIT

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

if [[ ! -t 0 || ! -t 1 ]]; then
  echo "This command must be run from an interactive terminal." >&2
  exit 1
fi

if ! "${BIN}" is-initialized >/dev/null 2>&1; then
  echo "WebLens is not initialized or the authentication database is unavailable." >&2
  exit 1
fi

echo
echo "=== WebLens admin 密码恢复 ==="
echo
echo "即将重置根管理员 admin 的密码。"
echo
echo "该操作将："
echo "  - 立即注销 admin 的全部现有会话"
echo "  - 关闭 admin 的活动 Shell / Watch 连接"
echo "  - 要求 admin 下次登录后立即设置永久密码"
echo "  - 写入 root.password.recovery 审计记录"
echo
echo "平台管理员和普通用户不会受到影响。"
echo

read -r -p "请输入 RESET admin 以继续：" confirmation
if [[ "${confirmation}" != "RESET admin" ]]; then
  echo "操作已取消。"
  exit 1
fi

echo
read -r -s -p "请输入 admin 临时密码：" password1
echo
read -r -s -p "请再次输入 admin 临时密码：" password2
echo

if [[ -z "${password1}" ]]; then
  echo "临时密码不能为空。" >&2
  exit 1
fi
if [[ "${password1}" != "${password2}" ]]; then
  echo "两次输入的密码不一致。" >&2
  exit 1
fi

echo
printf "%s" "${password1}" | "${BIN}" reset-admin-password
