# AI 竞技游乐场

[English](README.md) | [简体中文](README.zh-CN.md)

一个开源的大模型棋类游乐场：让 LLM 在五子棋棋盘上一决高下。你可以亲自下场和模型对弈，也可以选两个模型让它们在竞技场里互殴，实时观看双方的思维链。整体为纸质水墨漫画风。

## 功能特性

- **人机对战** —— 与任意已配置的模型下五子棋，采用 Swap2 开局规则保证先手公平。
- **AI 对战竞技场** —— 任选两个模型开赛，双侧思维链面板实时滚动，边看边学模型怎么想。
- **多厂商模型配置** —— 支持 OpenAI 兼容 Chat Completions、OpenAI Responses、Anthropic Messages 三种协议；在「模型配置」页随意添加端点与模型，粒度到单个模型的思考开关与力度档位。
- **可读的思维链** —— 推理流在展示层剥掉 Markdown 记号并按轮次裁剪，读起来像笔记而不是原始转储。
- **零配置存储** —— SQLite 数据库首次运行自动建库建表，无需任何手工迁移。
- **密钥只留在本地** —— API 密钥存于本地数据库、仅服务端使用；`data/` 与 `.env*` 均被 git 忽略，绝不会进仓库。

## 环境要求

| | |
| --- | --- |
| 操作系统 | macOS（Apple Silicon 或 Intel）、Windows（x64 或 ARM64）、Linux（x64 / arm64） |
| [Node.js](https://nodejs.org) | **22 LTS 及以上**（`better-sqlite3` v13 要求） |
| [pnpm](https://pnpm.io) | 11.x（仓库通过 `packageManager` 固定为 11.9.0） |
| 磁盘 | 含依赖约 500 MB |

原生 SQLite 依赖在 npm 包内直接附带了 `darwin-arm64/x64`、`win32-x64/arm64`、`linux-x64/arm64` 的预编译产物：所有支持平台都**不需要**安装编译工具链（Xcode / Visual Studio Build Tools），安装过程也不从 GitHub 下载任何二进制。

## 下载预编译包直接运行（最省事）

从 [GitHub Releases](https://github.com/skys-mission/i-playground-s1/releases) 下载免安装 zip 并解压，之后唯一的前置是装好 Node.js 22+——不需要 pnpm，也没有安装步骤：

- **Windows：** 双击 `start.bat`
- **macOS / Linux：** 终端执行 `sh start.sh`

打开 <http://localhost:3000>。同一个 zip 覆盖全部支持平台（macOS / Windows / Linux 的 x64 与 ARM64），安装和运行阶段都不需要下载任何依赖。想从源码构建的话，继续往下看。

## 快速开始

```bash
git clone https://github.com/skys-mission/i-playground-s1.git
cd i-playground-s1
pnpm install
pnpm dev
```

打开 <http://localhost:3000>，进入「模型配置」页添加一个模型（名称、协议、模型 ID、Base URL、API 密钥），然后从主页开一局。

> 构建脚本提示：pnpm 11 会在运行依赖安装脚本前征求同意，本仓库的 `pnpm-workspace.yaml` 已提前放行所需项——`pnpm install` 全程无弹窗。

### macOS（Apple 芯片）

```bash
# 通过 Homebrew 安装 Node + pnpm（也可用 nodejs.org / pnpm.io 的官方安装包）
brew install node pnpm

git clone https://github.com/skys-mission/i-playground-s1.git
cd i-playground-s1
pnpm install
pnpm dev
```

开箱即用——`darwin-arm64` 的 SQLite 预编译产物已随包附带，无需安装 Xcode 命令行工具。

### Windows（x64 与 ARM64）

两种架构的支持方式完全相同；`win32-arm64` 的 SQLite 预编译产物已随包附带，无需安装 Visual Studio Build Tools。

```powershell
# Node.js 22+：任选其一
winget install OpenJS.NodeJS.LTS        # ARM64 机器上会安装 ARM64 版本
# ...或到 https://nodejs.org 下载 Windows ARM64/x64 安装包

npm install -g pnpm

git clone https://github.com/skys-mission/i-playground-s1.git
cd i-playground-s1
pnpm install
pnpm dev
```

浏览器没有自动打开的话，手动访问 <http://localhost:3000> 即可。

> **Windows ARM64 现状：** 应用依赖的所有环节（Node.js、pnpm、Next.js SWC、SQLite 预编译）都发布了 ARM64 原生产物，预期开箱即用。如遇到平台相关问题，欢迎提 issue。

## 中国大陆网络环境部署

从克隆到生产构建，全流程不需要代理。

1. **克隆仓库：** GitHub 直连时快时慢，浅克隆可以显著减少传输量；手头有代理的话也可以只给 git 配代理：

   ```bash
   git clone --depth 1 https://github.com/skys-mission/i-playground-s1.git
   # 或者只对 GitHub 走代理：
   # git config --global http.https://github.com.proxy http://127.0.0.1:7890
   ```

2. **安装依赖：** 把 pnpm 切到国内镜像。预编译二进制和字体文件都随 npm 包分发，安装过程不从 GitHub 或 Google 下载任何东西。

   ```bash
   pnpm config set registry https://registry.npmmirror.com
   ```

3. **开发与构建：** `pnpm dev`、`pnpm build` 直接运行即可。Geist 字体通过 [`geist`](https://www.npmjs.com/package/geist) npm 包本地分发，构建期不访问 Google Fonts。

## 生产运行

```bash
pnpm build
pnpm start            # 监听 http://localhost:3000
PORT=8080 pnpm start  # 自定义端口
```

SQLite 数据库位于 `data/app.db`（可用 `DATABASE_PATH` 环境变量覆盖路径），首次使用时自动创建——备份这个文件即可保住你的模型配置。

## 模型配置说明

在「模型配置」页添加配置。填写的 Base URL 会按协议拼接固定路径：

| 协议 | Base URL 示例 | 实际请求端点 |
| --- | --- | --- |
| `openai-chat` | `https://api.openai.com/v1` | `{base}/chat/completions` |
| `openai-responses` | `https://api.openai.com/v1` | `{base}/responses` |
| `anthropic-messages` | `https://api.anthropic.com` | `{base}/v1/messages` |

第三方网关同样适用——把 Base URL 指向网关地址，按其协议遵守同样的 `/v1` 规则即可。对局前可用每个配置上的「测试」按钮验证连通性。

## 常用脚本

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动开发服务器 |
| `pnpm build` / `pnpm start` | 生产构建 / 启动 |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm db:generate` / `pnpm db:push` / `pnpm db:studio` | Drizzle 数据库工具（运行时也会自动执行迁移） |

## 许可证

[Apache-2.0](LICENSE)
