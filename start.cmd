@echo off
rem ==========================================================================
rem  Cline Hub dashboard launcher  (phone 8787 + PC 8788)
rem  Usage: double-click, or  start.cmd nobrowser
rem
rem  Step 1 asks the upstream branch (product/main) for new commits. They are
rem  listed and you are asked y/N; only after y it runs  git pull --ff-only
rem  and rebuilds. Fetching is read-only, so answering n changes nothing.
rem
rem  Step 2 checks the Cline hub daemon - the one the Cline desktop app runs,
rem  recorded in  %USERPROFILE%\.cline\data\locks\hub\production.json .
rem  When it is not answering, this script starts the Cline desktop app and
rem  waits for the hub to come up, then continues. It never stops, restarts or
rem  reconfigures the desktop app.
rem
rem  The dashboard lives in apps\cline-hub and the launcher in
rem  apps\cline-hub\lan; both are addressed from here.
rem
rem  Scripted runs
rem    set CLINE_INSTALL_DEFAULTS=1   answer every prompt with its default (n)
rem    set CLINE_HUB_NO_PAUSE=1       do not wait for a key at the end
rem
rem  Batch files in this repo are CRLF (see .gitattributes) and keep to ASCII:
rem  cmd.exe parses this file in the console codepage, before the chcp below
rem  runs, so non-ASCII text here can break parsing.
rem ==========================================================================
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

set "LAN=%~dp0apps\cline-hub\lan"
set "REPO=%~dp0"
set "RC=0"
set "AUTO=%CLINE_INSTALL_DEFAULTS%"

rem Resolve bun: PATH first, then the usual per-user install locations.
set "BUN="
where bun >nul 2>nul
if not errorlevel 1 set "BUN=bun"
if not defined BUN if exist "%USERPROFILE%\.bun\bin\bun.exe" set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if not defined BUN if exist "%USERPROFILE%\AppData\Roaming\npm\node_modules\bun\bin\bun.exe" set "BUN=%USERPROFILE%\AppData\Roaming\npm\node_modules\bun\bin\bun.exe"
if not defined BUN if exist "%ProgramFiles%\bun\bun.exe" set "BUN=%ProgramFiles%\bun\bun.exe"
if not defined BUN goto :nobun

set "OPEN_BROWSER=1"
if /i "%~1"=="nobrowser" set "OPEN_BROWSER=0"

echo ============ Cline Hub start ============
echo.
echo [1/5] Update check  -  new commits on the upstream branch
call :update_check
echo.
echo [2/5] Cline hub  -  the hub daemon the Cline desktop app runs
call "!BUN!" "!LAN!\lan-hub.mjs" hub --launch
if errorlevel 1 goto :nohub
echo.
echo [3/5] LAN dashboard  (smartphone, port 8787)
call "!BUN!" "!LAN!\lan-hub.mjs" start
if errorlevel 1 goto :failed
echo.
echo [4/5] Local dashboard  (PC, http://localhost:8788/, no roomSecret)
call "!BUN!" "!LAN!\lan-hub.mjs" local
if errorlevel 1 goto :failed
echo.
echo [5/5] status
call "!BUN!" "!LAN!\lan-hub.mjs" status

rem Read the invite URL (first line of the "url" output) so it can be shown
rem last, after the QR code has scrolled the console.
set "URLFILE=%TEMP%\cline-hub-invite.txt"
call "!BUN!" "!LAN!\lan-hub.mjs" url > "%URLFILE%" 2>nul
set "INVITE="
set /p INVITE=<"%URLFILE%"
del "%URLFILE%" >nul 2>nul

if "%OPEN_BROWSER%"=="1" start "" "http://localhost:8788/"

echo.
echo ==================================================================
echo   OPEN ON YOUR PHONE  (same LAN, Wi-Fi):
echo.
echo      %INVITE%
echo.
echo   PC dashboard: http://localhost:8788/
echo ==================================================================
goto :end

:nobun
echo.
echo bun not found. Install it with:  npm install -g bun@1.4.2
set "RC=1"
goto :end

:nohub
echo.
echo The Cline hub is not running and the Cline desktop app did not bring it up.
echo   - install Cline desktop  https://cline.bot/desktop  and sign in
echo   - or start Cline desktop yourself, then run start.cmd again
echo   - check with:  bun apps\cline-hub\lan\lan-hub.mjs hub   (from this folder)
set "RC=1"
goto :end

:failed
echo.
echo Start FAILED. Check these:
echo   doctor   : bun apps\cline-hub\lan\lan-hub.mjs doctor
echo   logs     : bun apps\cline-hub\lan\lan-hub.mjs logs 60
echo   files    : %LAN%\logs\dashboard.log  /  dashboard-local.log
set "RC=1"
goto :end

:end
echo.
call :maybe_pause
exit /b %RC%

rem --------------------------------------------------------------------------
rem  Update check. Read-only until you answer y:
rem    fetch  ->  count and list the commits this checkout is missing  ->  ask
rem    y      ->  git pull --ff-only, rebuild, re-apply the injected UI layer,
rem               restart the dashboards so they run the updated code
rem  Anything that is not a clean fast-forward is reported and skipped, the
rem  dashboards then start on the version that is already here.
rem --------------------------------------------------------------------------
:update_check
where git >nul 2>nul
if errorlevel 1 (
  echo   git not found - update check skipped
  exit /b 0
)
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo   not a git checkout - update check skipped
  exit /b 0
)
set "UPSTREAM="
for /f "delims=" %%u in ('git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2^>nul') do set "UPSTREAM=%%u"
if not defined UPSTREAM (
  echo   no upstream branch configured - update check skipped
  exit /b 0
)
set "UPREMOTE="
set "UPBRANCH="
for /f "tokens=1 delims=/" %%r in ("!UPSTREAM!") do set "UPREMOTE=%%r"
for /f "tokens=2* delims=/" %%a in ("!UPSTREAM!") do set "UPBRANCH=%%b"
if not defined UPREMOTE (
  echo   upstream "!UPSTREAM!" has no remote - update check skipped
  exit /b 0
)
echo   upstream: !UPSTREAM!
git fetch !UPREMOTE! --prune >nul 2>nul
if errorlevel 1 (
  echo   fetch from !UPREMOTE! failed  -  offline?  keeping the current version
  exit /b 0
)
set "BEHIND=0"
for /f "delims=" %%c in ('git rev-list --count "HEAD..!UPSTREAM!" 2^>nul') do set "BEHIND=%%c"
if "!BEHIND!"=="0" (
  echo   up to date with !UPSTREAM!
  exit /b 0
)
echo   !BEHIND! new commit(s) on !UPSTREAM!  -  newest first:
git --no-pager log --oneline -10 "HEAD..!UPSTREAM!"
echo.
call :ask "Update now  -  git pull + rebuild + restart dashboards?  y/N"
if /i not "!ANSWER!"=="y" (
  echo   keeping the current version
  exit /b 0
)
set "DIRTY=0"
for /f "delims=" %%d in ('git status --porcelain 2^>nul') do set "DIRTY=1"
if "!DIRTY!"=="1" (
  echo   this checkout has local changes - update skipped
  echo   commit or revert them with git status, then run start.cmd again
  exit /b 0
)
git pull --ff-only !UPREMOTE! !UPBRANCH!
if errorlevel 1 (
  echo   update failed - see the git output above, keeping the current version
  echo   a fast-forward is required - check git status and git log --oneline -5
  exit /b 0
)
echo   updated. rebuilding...
pushd "%REPO%"
call "!BUN!" install
if errorlevel 1 (popd & echo   bun install failed - see output above & exit /b 0)
call "!BUN!" run build:sdk
if errorlevel 1 (popd & echo   build:sdk failed - see output above & exit /b 0)
call "!BUN!" run -F @cline/cline-hub build:webview
if errorlevel 1 (popd & echo   build:webview failed - see output above & exit /b 0)
popd
rem  build:webview regenerates dist\webview\index.html, which drops the injected
rem  dashboard layer, so re-apply it right away.
pushd "!LAN!"
call "!BUN!" lan-hub.mjs ui
rem  the dashboards run the code that was loaded at their start, restart them.
call "!BUN!" lan-hub.mjs restart
call "!BUN!" lan-hub.mjs restart --local
popd
echo   update done
exit /b 0


rem --------------------------------------------------------------------------
rem  y/N prompt. CLINE_INSTALL_DEFAULTS=1 answers every prompt with its
rem  default (n) so scripted runs change nothing.
rem --------------------------------------------------------------------------
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

rem Double-click keeps the window open; scripted callers skip the pause.
:maybe_pause
if "%CLINE_HUB_NO_PAUSE%"=="1" exit /b 0
pause
exit /b 0

