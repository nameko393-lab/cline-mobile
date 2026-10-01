@echo off
rem ==========================================================================
rem  Cline Hub dashboard stopper  (LAN 8787 + PC 8788)
rem  Stops ONLY the hub dashboards, never the Cline desktop / PC hub.
rem  Usage: double-click
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

echo ============ Cline Hub stop ============
echo.

echo [1/2] LAN dashboard  (8787)
call "%BUN%" lan-hub.mjs stop

echo.
echo [2/2] Local dashboard  (8788)
call "%BUN%" lan-hub.mjs stop --local

echo.
echo status:
call "%BUN%" lan-hub.mjs status

echo.
echo Stopped. The Cline desktop app and the PC hub were NOT touched.
call :maybe_pause
endlocal
exit /b 0

:nobun
echo.
echo bun が見つかりません。次を実行してください:  npm install -g bun@1.4.2
call :maybe_pause
endlocal
exit /b 1

rem Double-click keeps the window open; scripted / PATH callers skip the pause.
:maybe_pause
if "%CLINE_HUB_NO_PAUSE%"=="1" exit /b 0
pause
exit /b 0

