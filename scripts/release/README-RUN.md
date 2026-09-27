# 运行说明 / How to run

1. 安装 Node.js 22 或更高版本 / Install Node.js 22 or newer (<https://nodejs.org>)
2. 启动 / Start:
   - Windows：双击 `start.bat` / double-click `start.bat`
   - macOS / Linux：终端里执行 `sh start.sh` / run `sh start.sh` in a terminal
3. 打开 / Open <http://localhost:3000>

## 说明 / Notes

- 更换端口：设置环境变量 `PORT`（如 `PORT=8080 sh start.sh`）/ Change the port with the `PORT` env var.
- 允许局域网访问：macOS / Linux 用 `BIND=0.0.0.0 sh start.sh`；Windows 先 `set HOSTNAME=0.0.0.0` 再运行 `start.bat` / To allow LAN access: `BIND=0.0.0.0 sh start.sh` (macOS/Linux) or `set HOSTNAME=0.0.0.0` before `start.bat` (Windows).
- 模型配置与对局数据都保存在本目录的 `data/app.db`，首次启动自动创建 / All data lives in `data/app.db` inside this folder, created on first launch.
- 运行不需要联网安装任何依赖；对局时按你配置的模型接口联网 / No dependency downloads; the app only reaches the network when calling your configured model APIs.
