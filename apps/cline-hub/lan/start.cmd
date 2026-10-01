@echo off
rem ==========================================================================
rem  Cline Hub dashboard launcher  (LAN 8787 for phone + PC 8788)
rem  Usage: double-click, or  start.cmd [nobrowser]
rem ==========================================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"

rem Resolve bun: PATH first, then the usual per-user install locations.
rem (Keep the PATH token untouched: "if not exist" on the bare word "bun"
rem would be true and wrongly fall through to the file paths.)
set "BUN=bun"
where bun >nul 2>nul
if errorlevel 1 (
	set "BUN=%USERPROFILE%\AppData\Roaming\npm\node_modules\bun\bin\bun.exe"
	if not exist "%BUN%" set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
	if not exist "%BUN%" goto :nobun
)

set "OPEN_BROWSER=1"
if /i "%~1"=="nobrowser" set "OPEN_BROWSER=0"

echo ============ Cline Hub start ============
echo.

echo [1/3] LAN dashboard  (smartphone, port 8787)
call "%BUN%" lan-hub.mjs start
if errorlevel 1 goto :failed

echo.
echo [2/3] Local dashboard  (PC, http://localhost:8788/ , no roomSecret)
call "%BUN%" lan-hub.mjs local
if errorlevel 1 goto :failed

echo.
echo [3/3] status
call "%BUN%" lan-hub.mjs status

rem Read the invite URL (first line of "url" output) so it can be shown last,
rem after the QR code has scrolled the console.
set "URLFILE=%TEMP%\cline-hub-invite.txt"
call "%BUN%" lan-hub.mjs url > "%URLFILE%" 2>nul
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
echo bun が見つかりません。次を実行してください:  npm install -g bun@1.4.2
goto :end

:failed
echo.
echo Start FAILED. Check these:
echo   doctor   : "%BUN%" lan-hub.mjs doctor
echo   logs     : "%BUN%" lan-hub.mjs logs 60
echo   files    : %~dp0logs\dashboard.log  /  dashboard-local.log
echo   hub      : is the PC Cline desktop / Cline Hub running?

:end
echo.
call :maybe_pause
endlocal
exit /b 0

rem Double-click keeps the window open; scripted / PATH callers skip the pause.
:maybe_pause
if "%CLINE_HUB_NO_PAUSE%"=="1" exit /b 0
pause
exit /b 0


