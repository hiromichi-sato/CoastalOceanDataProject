@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE="
for /f "delims=" %%N in ('where.exe node.exe 2^>nul') do call :use_node "%%N"
call :use_node "%ProgramFiles%\nodejs\node.exe"
call :use_node "%LOCALAPPDATA%\Programs\nodejs\node.exe"
call :use_node "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo Node.js 18 or newer was not found.
  echo Install Node.js LTS from https://nodejs.org/en/download and run this file again.
  pause
  exit /b 1
)

echo Using "%NODE_EXE%"
echo Keep this window open. Press Ctrl+C to stop.
"%NODE_EXE%" "%~dp0server.js" --open
set "SERVER_EXIT=%ERRORLEVEL%"
if not "%SERVER_EXIT%"=="0" pause
exit /b %SERVER_EXIT%

:use_node
if defined NODE_EXE exit /b
if not exist "%~1" exit /b
"%~1" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" >nul 2>&1
if not errorlevel 1 set "NODE_EXE=%~1"
exit /b
