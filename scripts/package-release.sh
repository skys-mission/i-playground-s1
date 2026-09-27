#!/usr/bin/env bash
# 把 .next/standalone 拼装成一个解压即用的发布目录并打成 zip。
# 前置：pnpm build（next.config.ts 需为 output: "standalone"）
# 用法：scripts/package-release.sh [产物名，默认 i-playground-s1-portable]
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${1:-i-playground-s1-portable}"
STAGE=".next/standalone"
NM="$STAGE/node_modules"

if [ ! -f "$STAGE/server.js" ]; then
  echo "error: $STAGE/server.js not found — run 'pnpm build' first" >&2
  exit 1
fi

# 幂等：清掉上次拼装残留
rm -rf "$STAGE/public" "$STAGE/.next/static" "$STAGE/drizzle" "$STAGE/data"

# standalone 不自动携带的运行时资产（静态资源 + drizzle 迁移目录）
cp -R public "$STAGE/public"
cp -R .next/static "$STAGE/.next/static"
cp -R drizzle "$STAGE/drizzle"

# 启动脚本（.bat 在仓库里是 LF，打进包时转成 CRLF）与运行说明
cp scripts/release/start.sh "$STAGE/start.sh"
chmod +x "$STAGE/start.sh"
perl -pe 's/\r?\n/\r\n/' scripts/release/start.bat > "$STAGE/start.bat"
cp scripts/release/README-RUN.md "$STAGE/README-RUN.md"

# 关键步骤：把 pnpm 的 .pnpm 虚拟布局摊平成经典扁平 node_modules。
# 原因：standalone 顶层依赖是符号链接，指向 .pnpm 里的真实目录（依赖也在那里）；
# zip 解包（尤其 Windows）不保留符号链接，摊平成全实体目录后才能直接运行，
# 同时消除同一包的多份拷贝，显著减小体积。
find "$NM" -mindepth 1 -maxdepth 1 -type l -delete
rm -rf "$NM/.bin" "$NM/.modules.yaml"

# 先处理 .pnpm 以外的符号链接（如 .next/node_modules 下指向 .pnpm 的挂载链接），
# 必须在删除 .pnpm 之前完成，否则目标丢失
while IFS= read -r l; do
  parent="$(dirname "$l")"
  name="$(basename "$l")"
  cp -R -L "$l" "$parent/.$name.__pkgtmp"
  rm "$l"
  mv "$parent/.$name.__pkgtmp" "$l"
done < <(find "$STAGE" -type l ! -path "$NM/.pnpm/*")

# 普通包与 scoped 包各扫一遍，用 cp -RL 展开所有符号链接复制为实体
if [ -d "$NM/.pnpm" ]; then
  for d in "$NM/.pnpm"/*/node_modules/*; do
    case "${d##*/}" in @*) continue ;; esac
    mkdir -p "$NM/${d##*/}"
    cp -R -L "$d/." "$NM/${d##*/}/"
  done
  for d in "$NM/.pnpm"/*/node_modules/@*/*; do
    scope="$(basename "$(dirname "$d")")"
    mkdir -p "$NM/$scope"
    cp -R -L "$d/." "$NM/$scope/${d##*/}/"
  done
  rm -rf "$NM/.pnpm"
fi

# 兜底二：发布包里不允许残留任何符号链接
links="$(find "$STAGE" -type l)"
if [ -n "$links" ]; then
  echo "error: symlinks remain in the release bundle:" >&2
  echo "$links" >&2
  exit 1
fi

# 双保险：发布包里绝不能带本地数据库或密钥
rm -rf "$STAGE/data"
rm -f "$STAGE/.env" "$STAGE/.env."*

mkdir -p dist
rm -f "dist/$NAME.zip"
( cd "$STAGE" && zip -qr "../../dist/$NAME.zip" . )
echo "dist/$NAME.zip"
