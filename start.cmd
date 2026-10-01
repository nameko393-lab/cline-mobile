@echo off
rem ==========================================================================
rem  Cline Hub dashboard launcher  (phone 8787 + PC 8788)
rem  Usage: double-click, or  start.cmd nobrowser
rem
rem  Step 1 checks the Cline hub daemon - the one the Cline desktop app runs,
rem  recorded in  %USERPROFILE%\.cline\data\locks\hub\production.json .
rem  When it is not answering, this script starts the Cline desktop app and
rem  waits for the hub to come up, then continues. It never stops, restarts or
rem  reconfigures the desktop app.
rem
rem  The dashboard lives in apps\cline-hub and the launcher in
rem  apps\cline-hub\lan; both are addressed from here.
rem
rem  Batch files in this repo are CRLF (see .gitattributes) and keep to ASCII:
rem  cmd.exe parses this file in the console codepage, before the chcp below
rem  runs, so non-ASCII text here can break parsing.
rem ==========================================================================
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

set "LAN=%~dp0apps\cline-hub\lan"
set "RC=0"

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
echo [1/4] Cline hub  -  the hub daemon the Cline desktop app runs
call "!BUN!" "!LAN!\lan-hub.mjs" hub --launch
if errorlevel 1 goto :nohub
echo.
echo [2/4] LAN dashboard  (smartphone, port 8787)
call "!BUN!" "!LAN!\lan-hub.mjs" start
if errorlevel 1 goto :failed
echo.
echo [3/4] Local dashboard  (PC, http://localhost:8788/, no roomSecret)
call "!BUN!" "!LAN!\lan-hub.mjs" local
if errorlevel 1 goto :failed
echo.
echo [4/4] status
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

rem Double-click keeps the window open; scripted callers skip the pause.
:maybe_pause
if "%CLINE_HUB_NO_PAUSE%"=="1" exit /b 0
pause
exit /b 0
