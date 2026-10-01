@echo off
rem ==========================================================================
rem  cline-mobile installer  (one click)
rem
rem  What it does
rem    1. detects git / Node 22+ / bun 1.4.2 / npm / winget
rem    2. installs a missing tool ONLY after you answer y to that tool
rem    3. builds the dashboard: bun install, build:sdk, build:webview
rem    4. creates apps\cline-hub\lan\config.json  (kept if it already exists)
rem    5. checks the Cline hub record written by the Cline desktop app
rem    6. asks before opening the Windows firewall port and before adding the
rem       cline-hub command to your PATH
rem    7. asks before starting the dashboard  (phone 8787 + PC 8788)
rem
rem  Nothing in this script touches the Cline desktop app or the PC hub.
rem
rem  Usage
rem    install.cmd            install, with a prompt for every install
rem    install.cmd check      report the environment, change nothing
rem
rem  Scripted runs
rem    set CLINE_INSTALL_DEFAULTS=1   answer every prompt with its default (n)
rem    set CLINE_HUB_NO_PAUSE=1       do not wait for a key at the end
rem
rem  Batch files in this repo are CRLF (see .gitattributes) and ASCII only:
rem  cmd.exe parses this file in the console codepage, before the chcp below,
rem  so non-ASCII text here can break parsing.
rem ==========================================================================
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

set "REPO=%CD%"
set "LAN=%REPO%\apps\cline-hub\lan"
set "AUTO=%CLINE_INSTALL_DEFAULTS%"
set "RC=0"
set "CHECK=0"
if /i "%~1"=="check" set "CHECK=1"

echo.
echo  ==========================================================================
echo    cline-mobile  -  install
echo    repo : %REPO%
echo    phone dashboard + PC dashboard for the Cline hub
echo  ==========================================================================
echo.

call :detect
if "%CHECK%"=="1" goto :report

rem ------------------------------------------------------------------ 1 git
echo  [1/7] git  -  used for updates
if defined GIT (
  echo    found
) else (
  echo    git is not installed. The dashboard runs without it, updates need it.
  call :ask "Install git with winget?  y/N"
  if /i "!ANSWER!"=="y" call :winget Git.Git
)
echo.

rem ---------------------------------------------------------------- 2 Node
echo  [2/7] Node 22+  -  runtime for bun
if defined NODE (
  echo    found: node !NODEVER!
) else (
  echo    Node 22 or newer is required.
  call :ask "Install Node LTS with winget?  y/N"
  if /i "!ANSWER!"=="y" (
    call :winget OpenJS.NodeJS.LTS
    echo.
    echo    Open a NEW terminal and run install.cmd again: the PATH change is
    echo    not visible in this window.
    goto :finish
  ) else (
    call :die "Node 22+ is required. Install it from https://nodejs.org and run install.cmd again."
  )
)
echo.

rem ----------------------------------------------------------------- 3 bun
echo  [3/7] bun 1.4.2  -  package manager and task runner
if defined BUN (
  echo    found: !BUN!
) else (
  echo    bun is not installed.
  call :ask "Install bun 1.4.2 with npm  -  npm install -g bun@1.4.2?  y/N"
  if /i not "!ANSWER!"=="y" call :die "bun is required. Install it with: npm install -g bun@1.4.2"
  if not defined NPM call :die "npm not found. Install Node 22+ first, then run install.cmd again."
  call npm install -g bun@1.4.2
  call :detect
  if not defined BUN call :die "bun is still not on PATH. Open a new terminal and run install.cmd again."
  echo    installed: !BUN!
)
echo.


rem --------------------------------------------------------------- 4 build
echo  [4/7] build  -  bun install, build:sdk, build:webview
set "BRC=0"
pushd "%REPO%"
call "!BUN!" install
if errorlevel 1 set "BRC=1"
call "!BUN!" run build:sdk
if errorlevel 1 set "BRC=1"
call "!BUN!" run -F @cline/cline-hub build:webview
if errorlevel 1 set "BRC=1"
popd
rem  build:webview regenerates dist\webview\index.html, which drops the injected
rem  dashboard layer, so re-apply it right away.
pushd "%LAN%"
call "!BUN!" lan-hub.mjs ui
popd
if "%BRC%"=="1" call :die "build failed. See the output above, then run install.cmd again."

rem ------------------------------------------------------------- 5 config
echo  [5/7] config  -  apps\cline-hub\lan\config.json  (per machine, not committed)
if exist "%LAN%\config.json" (
  echo    kept the existing file
) else (
  copy /y "%LAN%\config.example.json" "%LAN%\config.json" >nul
  echo    created from config.example.json
  echo    roomSecret is generated on the first start; edit the file for
  echo    repo, workspaceRoot, publicHost, lanSkip
)
echo.

rem ------------------------------------------------------------- 6 desktop
echo  [6/7] Cline desktop  -  the hub daemon that runs the agent loop
if "%HUB%"=="1" (
  echo    hub record found: %HUBLOCK%
) else (
  echo    No hub record. The dashboard only mediates: session.create and
  echo    run.start go to the hub daemon that the Cline desktop app starts.
  echo    Start Cline desktop and sign in.
  call :ask "Cline desktop is not running. Continue anyway?  y/N"
  if /i not "!ANSWER!"=="y" call :die "start Cline desktop, sign in, then run install.cmd again."
)
echo.

rem ------------------------------------------------------------- 7 extras
echo  [7/7] optional steps
call :ask "Open Windows firewall port 8787 for the LAN  -  UAC prompt?  y/N"
if /i "!ANSWER!"=="y" (
  pushd "%LAN%"
  call "!BUN!" lan-hub.mjs firewall --apply
  popd
)
call :ask "Add the cline-hub command to your PATH?  y/N"
if /i "!ANSWER!"=="y" powershell -NoProfile -ExecutionPolicy Bypass -File "%LAN%\install-cli.ps1"
call :ask "Start the dashboard now  -  phone 8787 and PC 8788?  y/N"
if /i "!ANSWER!"=="y" (
  set "CLINE_HUB_NO_PAUSE=1"
  call "%LAN%\start.cmd" nobrowser
  set "CLINE_HUB_NO_PAUSE="
)
echo.

:finish
echo.
echo  ==========================================================================
if "%RC%"=="0" (echo    finished) else (echo    NOT finished)
echo  ==========================================================================
if not "%RC%"=="0" goto :end
if not defined BUN goto :end
pushd "%LAN%"
call "!BUN!" lan-hub.mjs doctor
call "!BUN!" lan-hub.mjs url
popd
echo.
echo  PHONE : open the invite URL above on a phone on the same Wi-Fi
echo          keep the roomSecret part of the URL
echo  PC    : http://localhost:8788/
echo  STOP  : apps\cline-hub\lan\stop.cmd  -  dashboard only, desktop untouched
goto :end

rem ---------------------------------------------------------------- report
:report
echo  [check] environment  -  nothing was changed
if defined GIT (echo    git        : found) else (echo    git        : missing  -  updates only)
if defined NODE (echo    node       : !NODEVER!) else (echo    node       : missing  -  22+ required)
if defined BUN (echo    bun        : !BUN!) else (echo    bun        : missing  -  1.4.2 required)
if defined NPM (echo    npm        : found) else (echo    npm        : missing)
if defined WINGET (echo    winget     : found  -  used for installs) else (echo    winget     : missing  -  installs must be manual)
if exist "%LAN%\config.json" (echo    config     : found) else (echo    config     : will be created from config.example.json)
if "%HUB%"=="1" (echo    hub record : found  -  Cline desktop is running) else (echo    hub record : missing  -  start Cline desktop and sign in)
if exist "%LAN%\dashboard-ui.js" (echo    UI layer   : found) else (echo    UI layer   : missing)
echo.
echo  Run install.cmd with no arguments to install.
goto :end

rem ------------------------------------------------------------- subroutines
:ask
if "%AUTO%"=="1" (
  echo %~1
  echo    [auto] n
  set "ANSWER=n"
  exit /b 0
)
set "ANSWER=n"
set /p "ANSWER=  %~1  "
if "!ANSWER!"=="" set "ANSWER=n"
exit /b 0

:winget
if not defined WINGET (
  echo    winget not found. Install the requirement manually.
  exit /b 1
)
winget install -e --id %~1 --accept-source-agreements --accept-package-agreements
exit /b %ERRORLEVEL%

:detect
set "GIT="
where git >nul 2>nul
if not errorlevel 1 set "GIT=1"
set "NODE="
where node >nul 2>nul
if not errorlevel 1 set "NODE=1"
set "NODEVER="
if defined NODE for /f "delims=" %%v in ('node -v 2^>nul') do set "NODEVER=%%v"
set "BUN="
where bun >nul 2>nul
if not errorlevel 1 set "BUN=bun"
if not defined BUN if exist "%USERPROFILE%\.bun\bin\bun.exe" set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if not defined BUN if exist "%USERPROFILE%\AppData\Roaming\npm\node_modules\bun\bin\bun.exe" set "BUN=%USERPROFILE%\AppData\Roaming\npm\node_modules\bun\bin\bun.exe"
if not defined BUN if exist "%ProgramFiles%\bun\bun.exe" set "BUN=%ProgramFiles%\bun\bun.exe"
set "NPM="
where npm >nul 2>nul
if not errorlevel 1 set "NPM=1"
set "WINGET="
where winget >nul 2>nul
if not errorlevel 1 set "WINGET=1"
set "HUBLOCK=%USERPROFILE%\.cline\data\locks\hub\production.json"
set "HUB=0"
if exist "%HUBLOCK%" set "HUB=1"
exit /b 0

:die
echo.
echo  FAILED: %~1
set "RC=1"
goto :finish

:end
if "%CLINE_HUB_NO_PAUSE%"=="1" exit /b %RC%
echo.
pause >nul
exit /b %RC%
