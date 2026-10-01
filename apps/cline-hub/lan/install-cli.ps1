<#
	install-cli.ps1 - puts a "cline-hub" command on the current user's PATH.

	Why: cmd.exe skips the current directory when
	NoDefaultCurrentDirectoryInExePath=1 is set (Windows Terminal, VS Code,
	agent shells), and PowerShell never searches it at all. So typing
	"start.cmd" / "stop.cmd" by name fails with "not recognized". This
	installer puts a shim on PATH so "cline-hub start|stop|status|..." works
	from any folder in any shell.

	Usage:
		powershell -ExecutionPolicy Bypass -File install-cli.ps1
		powershell -ExecutionPolicy Bypass -File install-cli.ps1 -Remove
#>
param(
	[switch]$Remove,
	[string]$LauncherDir
)

$ErrorActionPreference = 'Stop'

$BinDir = Join-Path $env:USERPROFILE '.cline-hub\bin'
$Shim = Join-Path $BinDir 'cline-hub.cmd'

function Get-UserPath { return [Environment]::GetEnvironmentVariable('Path', 'User') }
function Set-UserPath([string]$value) {
	[Environment]::SetEnvironmentVariable('Path', $value, 'User')
}

if ($Remove) {
	if (Test-Path -LiteralPath $Shim) { Remove-Item -LiteralPath $Shim -Force }
	$kept = @((Get-UserPath) -split ';' | Where-Object { $_ -and ($_ -ne $BinDir) })
	Set-UserPath ($kept -join ';')
	Write-Host ('removed: ' + $Shim)
	Write-Host ('PATH entry removed: ' + $BinDir)
	Write-Host 'Restart your terminal to apply.'
	exit 0
}

if (-not $LauncherDir) { $LauncherDir = Split-Path -Parent $PSCommandPath }
$Server = Join-Path $LauncherDir 'lan-hub.mjs'
if (-not (Test-Path -LiteralPath $Server)) {
	Write-Host ('not found: ' + $Server)
	exit 1
}

# start.cmd / stop.cmd live at the repo root. Find it through the dashboard
# marker so a relocated launcher keeps working.
$RepoRoot = $LauncherDir
while ($RepoRoot) {
	if (Test-Path -LiteralPath (Join-Path $RepoRoot 'apps\cline-hub\src\server.ts')) { break }
	$parent = Split-Path -Parent $RepoRoot
	if (-not $parent -or $parent -eq $RepoRoot) { $RepoRoot = '' ; break }
	$RepoRoot = $parent
}
if (-not $RepoRoot) {
	Write-Host 'repo root not found (no apps\cline-hub\src\server.ts above the launcher)'
	exit 1
}

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

# start/stop go through the .cmd scripts at the repo root (QR + status
# output); every other subcommand is passed straight to lan-hub.mjs.
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('@echo off')
$lines.Add('setlocal enabledelayedexpansion')
$lines.Add('set "CLINE_HUB_NO_PAUSE=1"')
$lines.Add('set "HERE=' + $LauncherDir + '"')
$lines.Add('set "ROOT=' + $RepoRoot + '"')
$lines.Add('if /i "%~1"=="start" ( call "!ROOT!\start.cmd" %2 %3 & exit /b !ERRORLEVEL! )')
$lines.Add('if /i "%~1"=="stop" ( call "!ROOT!\stop.cmd" %2 %3 & exit /b !ERRORLEVEL! )')
$lines.Add('set "BUN=bun"')
$lines.Add('where bun >nul 2>nul')
$lines.Add('if errorlevel 1 (')
$lines.Add('  set "BUN=%USERPROFILE%\AppData\Roaming\npm\node_modules\bun\bin\bun.exe"')
$lines.Add('  if not exist "!BUN!" set "BUN=%USERPROFILE%\.bun\bin\bun.exe"')
$lines.Add(')')
$lines.Add('call "!BUN!" "!HERE!\lan-hub.mjs" %*')
$lines.Add('exit /b !ERRORLEVEL!')
Set-Content -LiteralPath $Shim -Value $lines -Encoding ASCII

$userPath = Get-UserPath
if (@($userPath -split ';') -notcontains $BinDir) {
	Set-UserPath ($userPath + ';' + $BinDir)
	Write-Host ('PATH added: ' + $BinDir)
} else {
	Write-Host ('PATH already set: ' + $BinDir)
}

Write-Host ('shim: ' + $Shim)
Write-Host ('launcher: ' + $LauncherDir)
Write-Host ''
Write-Host 'Restart your terminal, then from any folder:'
Write-Host '  cline-hub start'
Write-Host '  cline-hub stop'
Write-Host '  cline-hub status | url | doctor | hub | logs 60 | firewall --apply'
Write-Host ''
Write-Host 'Undo: powershell -ExecutionPolicy Bypass -File install-cli.ps1 -Remove'
exit 0