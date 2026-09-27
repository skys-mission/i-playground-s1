#!/bin/sh
# 启动 AI 竞技游乐场。需要 Node.js 22+。
# 端口默认 3000（PORT 环境变量可改）；默认只监听本机（BIND 环境变量可改，
# 如 BIND=0.0.0.0 允许局域网访问）。不直接用 HOSTNAME 是因为登录 shell
# 常常自带同名环境变量，会把 standalone 服务器的监听地址劫持成机器主机名。
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-3000}"
BIND="${BIND:-127.0.0.1}"
HOSTNAME="$BIND" PORT="$PORT" exec node server.js
