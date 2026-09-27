@echo off
rem Start AI Arena Playground.
rem
rem Node.js 22+ resolution order:
rem   1. System Node.js >= 22  -> use it directly.
rem   2. Bundled runtime\node.exe exists -> use it directly.
rem   3. Otherwise download a portable Node.js into runtime\ (once; official
rem      source first, auto-fallback to the npmmirror China mirror; force a
rem      mirror with the NODE_MIRROR env var).
rem No admin rights or system changes. ASCII-only output on purpose: cmd's
rem default codepage is not UTF-8.
rem
rem Default port 3000 (override with PORT); binds to loopback by default
rem (override with HOSTNAME, e.g. "set HOSTNAME=0.0.0.0" for LAN access).
setlocal EnableExtensions
cd /d "%~dp0"

set "NODE_VERSION=22.23.3"
set "USE_NODE="

rem --- 1. system node, major version >= 22?
where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE_MAJOR="
  for /f "usebackq tokens=1 delims=." %%v in (`node -v 2^>nul`) do set "NODE_MAJOR=%%v"
)
if defined NODE_MAJOR set "NODE_MAJOR=%NODE_MAJOR:~1%"
if defined NODE_MAJOR if %NODE_MAJOR% GEQ 22 set "USE_NODE=node"

rem --- 2. bundled runtime already downloaded?
if not defined USE_NODE (
  if exist "runtime\node.exe" set "USE_NODE=runtime\node.exe"
)

rem --- 3. download a portable runtime
if defined USE_NODE goto run

echo ^>^> Node.js 22+ not found. Downloading a portable runtime (about 30 MB, once)...
if "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
  set "NODE_DIST=win-arm64"
) else (
  set "NODE_DIST=win-x64"
)
set "NODE_FILE=node-v%NODE_VERSION%-%NODE_DIST%.zip"
if not exist "runtime" mkdir runtime
set "GOT="

if defined NODE_MIRROR (
  call :fetch "%NODE_MIRROR%/v%NODE_VERSION%/%NODE_FILE%" && set "GOT=1"
)
if not defined GOT (
  call :fetch "https://nodejs.org/dist/v%NODE_VERSION%/%NODE_FILE%" && set "GOT=1"
)
if not defined GOT (
  call :fetch "https://cdn.npmmirror.com/binaries/node/v%NODE_VERSION%/%NODE_FILE%" && set "GOT=1"
)
if defined GOT goto extract

echo ^>^> Download failed. Check your network and retry, or install Node 22+ manually: https://nodejs.org
del "%NODE_FILE%" 2>nul
pause
exit /b 1

:fetch
curl -fSL --connect-timeout 10 -o "%NODE_FILE%" "%~1"
exit /b %errorlevel%

:extract
tar -xf "%NODE_FILE%"
if exist "runtime" rmdir /s /q "runtime"
move "node-v%NODE_VERSION%-%NODE_DIST%" "runtime" >nul
del "%NODE_FILE%" >nul 2>nul
if not exist "runtime\node.exe" (
  echo ^>^> Extraction failed: runtime\node.exe not found.
  pause
  exit /b 1
)
set "USE_NODE=runtime\node.exe"

:run
if not defined HOSTNAME set "HOSTNAME=127.0.0.1"
echo ^>^> Using Node: %USE_NODE%
"%USE_NODE%" server.js
pause
