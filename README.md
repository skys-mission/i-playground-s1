# AI Arena Playground

[English](README.md) | [简体中文](README.zh-CN.md)

An open-source playground where LLMs battle on a Gomoku (five-in-a-row) board. Play a game yourself against a model, or sit back and watch two models duel in the arena while their reasoning streams in live. Styled in a paper-and-ink manga look.

## Features

- **Human vs AI** — play Gomoku against any configured model, with the Swap2 opening rule for fairness.
- **AI vs AI arena** — pick two models and watch the match unfold with live thinking-chain panels on both sides.
- **Multi-vendor model configs** — OpenAI-compatible Chat Completions, OpenAI Responses, and Anthropic Messages protocols. Add as many endpoints/models as you like from the in-app Models page; per-model thinking toggle and effort levels included.
- **Readable reasoning** — thinking streams are stripped of Markdown markers and trimmed per round, so summaries read like notes, not raw dumps.
- **Zero-config storage** — SQLite database is created and migrated automatically on first run. Nothing to set up.
- **Keys stay local** — API keys are stored in the local database and used server-side only. `data/` and `.env*` are git-ignored, so secrets never reach the repository.

## Requirements

| | |
| --- | --- |
| OS | macOS (Apple Silicon or Intel), Windows (x64 or ARM64), Linux (x64 / arm64) |
| [Node.js](https://nodejs.org) | **22 LTS or newer** (required by `better-sqlite3` v13) |
| [pnpm](https://pnpm.io) | 11.x (pinned to 11.9.0 via `packageManager`) |
| Disk | ~500 MB with dependencies |

The native SQLite dependency ships prebuilt binaries inside its npm package for `darwin-arm64/x64`, `win32-x64/arm64`, and `linux-x64/arm64`. No compiler toolchain (Xcode / Visual Studio Build Tools) is needed on any supported platform, and no binaries are downloaded from GitHub during install.

## Run from a prebuilt release (easiest)

Download the portable zip from [GitHub Releases](https://github.com/skys-mission/i-playground-s1/releases), unzip it, and start it — no pnpm and no install step:

- **Windows:** double-click `start.bat`
- **macOS / Linux:** run `sh start.sh` in a terminal

Node.js 22+ is used if it is already installed; otherwise the start scripts download a portable Node.js into the bundle's `runtime/` folder on first launch (official source first, automatic fallback to a China mirror) — no admin rights, no system changes. Open <http://localhost:3000>. A single zip covers every supported platform (macOS / Windows / Linux, both x64 and ARM64). To build from source instead, continue below.

## Quick start

```bash
git clone https://github.com/skys-mission/i-playground-s1.git
cd i-playground-s1
pnpm install
pnpm dev
```

Open <http://localhost:3000>, go to the **Models** page, add a model config (name, protocol, model ID, base URL, API key), then start a game from the home page.

> Build-script prompts: pnpm 11 asks before running dependency install scripts, but `pnpm-workspace.yaml` in this repo already allowlists everything needed — `pnpm install` runs clean with no prompts.

### macOS (Apple Silicon)

```bash
# Node + pnpm via Homebrew (or use the official installers from nodejs.org / pnpm.io)
brew install node pnpm

git clone https://github.com/skys-mission/i-playground-s1.git
cd i-playground-s1
pnpm install
pnpm dev
```

Works out of the box — the `darwin-arm64` SQLite prebuild is bundled, so Xcode command-line tools are not required.

### Windows (x64 and ARM64)

Both architectures are supported the same way; the `win32-arm64` SQLite prebuild is bundled, so no Visual Studio Build Tools are needed.

```powershell
# Node.js 22+: pick one
winget install OpenJS.NodeJS.LTS        # installs the ARM64 build on ARM64 machines
# ...or download the Windows ARM64/x64 installer from https://nodejs.org

npm install -g pnpm

git clone https://github.com/skys-mission/i-playground-s1.git
cd i-playground-s1
pnpm install
pnpm dev
```

If your browser does not open the page, visit <http://localhost:3000> manually.

> **Windows ARM64 status:** everything the app needs (Node.js, pnpm, Next.js SWC, SQLite prebuild) publishes ARM64-native artifacts, so it is expected to work out of the box. If you hit a platform-specific problem, please open an issue.

## Deploying on a restricted network (mainland China)

The entire flow — clone, install, dev, production build — works without a proxy.

1. **Cloning:** direct GitHub access from the mainland can be slow. A shallow clone transfers much less; if you do have a proxy, you can scope it to git only:

   ```bash
   git clone --depth 1 https://github.com/skys-mission/i-playground-s1.git
   # or scope a proxy to GitHub only:
   # git config --global http.https://github.com.proxy http://127.0.0.1:7890
   ```

2. **Installing packages:** switch pnpm to a domestic registry. Prebuilt binaries and font files ship inside the npm packages — nothing is downloaded from GitHub or Google during install.

   ```bash
   pnpm config set registry https://registry.npmmirror.com
   ```

3. **Dev & build:** run `pnpm dev` / `pnpm build` as usual. The Geist font is self-hosted via the [`geist`](https://www.npmjs.com/package/geist) npm package, so production builds never contact Google Fonts.

## Production run

```bash
pnpm build
pnpm start            # serves on http://localhost:3000
PORT=8080 pnpm start  # custom port
```

The SQLite database lives at `data/app.db` (override with the `DATABASE_PATH` env var) and is created on first use — back up that file to preserve your model configs.

## Configuring models

Add configs on the **Models** page. The base URL you fill in is combined with a fixed path per protocol:

| Protocol | Base URL example | Actual endpoint called |
| --- | --- | --- |
| `openai-chat` | `https://api.openai.com/v1` | `{base}/chat/completions` |
| `openai-responses` | `https://api.openai.com/v1` | `{base}/responses` |
| `anthropic-messages` | `https://api.anthropic.com` | `{base}/v1/messages` |

Third-party gateways work too — point the base URL at the gateway and follow the same `/v1` rule for its protocol. Use the **Test** button on each config to verify connectivity before playing.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm db:generate` / `pnpm db:push` / `pnpm db:studio` | Drizzle schema tooling (migrations also apply automatically at runtime) |

## License

[Apache-2.0](LICENSE)
