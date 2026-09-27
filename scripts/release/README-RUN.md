# 运行说明 / How to run

1. 启动 / Start:
   - Windows：双击 `start.bat` / double-click `start.bat`
   - macOS / Linux：终端里执行 `sh start.sh` / run `sh start.sh` in a terminal
2. 打开 / Open <http://localhost:3000>

## 说明 / Notes

- **Node.js：** 装了 22+ 就直接用；没装也不用手动装——首次启动会自动下载一份便携版 Node 到本目录 `runtime/`（约 30MB，仅此一次；先用官方源，连不上自动切国内镜像，也可用 `NODE_MIRROR` 环境变量强制指定），不改系统、不需要管理员权限 / **Node.js:** used directly if version 22+ is installed; otherwise the start scripts fetch a portable Node into `runtime/` on first launch (~30 MB, once; official source first with automatic China-mirror fallback, or force one via `NODE_MIRROR`). No admin rights, no system changes.
- 更换端口：设置环境变量 `PORT`（如 `PORT=8080 sh start.sh`）/ Change the port with the `PORT` env var.
- 允许局域网访问：macOS / Linux 用 `BIND=0.0.0.0 sh start.sh`；Windows 先 `set HOSTNAME=0.0.0.0` 再运行 `start.bat` / To allow LAN access: `BIND=0.0.0.0 sh start.sh` (macOS/Linux) or `set HOSTNAME=0.0.0.0` before `start.bat` (Windows).
- 模型配置与对局数据都保存在本目录的 `data/app.db`，首次启动自动创建 / All data lives in `data/app.db` inside this folder, created on first launch.
- 除首次可能下载 Node 运行时外，应用自身不需要联网安装任何依赖；对局时按你配置的模型接口联网 / Apart from the optional one-time Node runtime download, the app reaches the network only when calling your configured model APIs.
- Alpine (musl) 用户请先 `sudo apk add nodejs` 再运行 / Alpine (musl) users: install Node via `sudo apk add nodejs` first.
