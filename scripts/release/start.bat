@echo off
rem 启动 AI 竞技游乐场。需要 Node.js 22+。
rem 端口默认 3000（PORT 环境变量可改），默认只监听本机（HOSTNAME 可改）。
cd /d "%~dp0"
if not defined HOSTNAME set HOSTNAME=127.0.0.1
node server.js
pause
