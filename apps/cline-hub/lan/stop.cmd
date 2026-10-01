@echo off
rem ==========================================================================
rem  Cline Hub dashboard stopper  (LAN 8787 + PC 8788)
rem  Stops ONLY the hub dashboards, never the Cline desktop / PC hub.
rem  Usage: double-click
rem
rem  Batch files in this repo are CRLF (see the root .gitattributes) and keep
rem  to ASCII: cmd.exe parses this file in the console codepage, before the
rem  chcp below runs, so non-ASCII text here can break parsing.
rem ==========================================================================
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

rem Resolve bun: PATH first, then the usual per-user install locations.
set "BUN="
where bun >nul 2>nul
if not errorlevel 1 set "BUN=bun"
if not defined BUN if exist "%USERPROFILE%\.bun\bin\bun.exe" set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if not defined BUN if exist "%USERPROFILE%\AppData\Roaming\npm\node_modules\bun\bin\bun.exe" set "BUN=%USERPROFILE%\AppData\Roaming\npm\node_modules\bun\bin\bun.exe"
if not defined BUN if exist "%ProgramFiles%\bun\bun.exe" set "BUN=%ProgramFiles%\bun\bun.exe"
if not defined BUN goto :nobun

echo ============ Cline Hub stop ============
echo.
echo [1/2] LAN dashboard  (8787)
call "!BUN!" lan-hub.mjs stop
echo.
echo [2/2] Local dashboard  (8788)
call "!BUN!" lan-hub.mjs stop --local
echo.
echo status:
call "!BUN!" lan-hub.mjs status
echo.
echo Stopped. The Cline desktop app and the PC hub were NOT touched.
call :maybe_pause
endlocal
exit /b 0

:nobun
echo.
echo bun not found. Install it with:  npm install -g bun@1.4.2
call :maybe_pause
endlocal
exit /b 1

rem Double-click keeps the window open; scripted callers skip the pause.
:maybe_pause
if "%CLINE_HUB_NO_PAUSE%"=="1" exit /b 0
pause
exit /b 0