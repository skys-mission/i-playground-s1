#!/bin/sh
# 启动 AI 竞技游乐场。
#
# Node.js 22+ 的获取顺序：
#   1. 系统里已有且版本 >= 22 → 直接使用；
#   2. 包内 runtime/ 已有便携版 → 直接使用；
#   3. 都没有 → 自动下载便携版 Node 到包内 runtime/（仅此一次；先用官方源，
#      连不上自动切国内镜像 npmmirror，也可用 NODE_MIRROR 环境变量强制指定）。
# 不修改系统、不需要管理员权限。
#
# 端口默认 3000（PORT 可改）；默认只监听本机（BIND 可改，如 BIND=0.0.0.0
# 允许局域网访问）。不直接用 HOSTNAME 是因为登录 shell 常常自带同名环境变量，
# 会把 standalone 服务器的监听地址劫持成机器主机名。
set -eu

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

NODE_VERSION="22.23.3"
RUNTIME_DIR="$APP_DIR/runtime"

node_ok() { # $1=node 可执行文件；v22+ 返回 0
  "$1" -e 'process.exit(parseInt(process.versions.node, 10) >= 22 ? 0 : 1)' >/dev/null 2>&1
}

USE_NODE=""

if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
  USE_NODE="$(command -v node)"
elif [ -x "$RUNTIME_DIR/bin/node" ]; then
  USE_NODE="$RUNTIME_DIR/bin/node"
else
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      echo ">> 检测到 Windows 类环境，请运行 start.bat" >&2
      exit 1
      ;;
  esac
  case "$(uname -s)/$(uname -m)" in
    Darwin/arm64)   NODE_DIST="darwin-arm64" ;;
    Darwin/x86_64)  NODE_DIST="darwin-x64" ;;
    Linux/x86_64)   NODE_DIST="linux-x64" ;;
    Linux/aarch64)  NODE_DIST="linux-arm64" ;;
    *)
      echo ">> 不支持的平台：$(uname -s) $(uname -m)，请手动安装 Node 22+：https://nodejs.org" >&2
      exit 1
      ;;
  esac
  if [ "$NODE_DIST" != "${NODE_DIST#linux}" ] && ldd --version 2>&1 | grep -qi musl; then
    echo ">> 检测到 musl (Alpine)：自动下载暂不支持，请先 sudo apk add nodejs 再运行本脚本" >&2
    exit 1
  fi

  FILE="node-v$NODE_VERSION-$NODE_DIST.tar.gz"
  echo ">> 未找到 Node.js 22+，正在下载便携版运行时（约 30–50MB，仅此一次）..."
  mkdir -p "$RUNTIME_DIR"
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  got=""
  for base in "${NODE_MIRROR:-}" "https://nodejs.org/dist" "https://cdn.npmmirror.com/binaries/node"; do
    [ -n "$base" ] || continue
    echo ">> 尝试下载源：$base"
    if curl -fSL --connect-timeout 10 -o "$TMP_DIR/$FILE" "$base/v$NODE_VERSION/$FILE"; then
      got=1
      break
    fi
  done
  if [ -z "$got" ]; then
    echo ">> 下载失败。请检查网络后重试，或手动安装 Node 22+：https://nodejs.org" >&2
    exit 1
  fi
  tar -xzf "$TMP_DIR/$FILE" -C "$RUNTIME_DIR" --strip-components=1
  rm -rf "$RUNTIME_DIR/include" "$RUNTIME_DIR/share"   # 头文件与文档用不到，省约 50MB
  if [ ! -x "$RUNTIME_DIR/bin/node" ]; then
    echo ">> 解压结果异常：未找到 runtime/bin/node" >&2
    exit 1
  fi
  USE_NODE="$RUNTIME_DIR/bin/node"
fi

PORT="${PORT:-3000}"
BIND="${BIND:-127.0.0.1}"
echo ">> 使用 Node：$USE_NODE ($("$USE_NODE" -v))"
HOSTNAME="$BIND" PORT="$PORT" exec "$USE_NODE" server.js
