<#
.SYNOPSIS
  Windows ファイアウォールに Cline Hub LAN dashboard 用のインバウンド許可ルールを作る。
.DESCRIPTION
  管理者権限が無い場合は自分で UAC 昇格する。ルールは TCP/<Port> のインバウンド許可で、
  通信相手はローカルサブネット（同一LAN）に限定する。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install-firewall.ps1 -Port 8787
  powershell -ExecutionPolicy Bypass -File install-firewall.ps1 -Port 8787 -Remove
#>
param(
	[int]$Port = 8787,
	[switch]$Remove,
	[switch]$AllProfiles
)

$RuleName = "cline-hub-lan-$Port"
$Profile = if ($AllProfiles) { "Any" } else { "Private" }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
	Write-Host "管理者権限が必要なので UAC プロンプトを出します..."
	$forward = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath, "-Port", $Port)
	if ($Remove) { $forward += "-Remove" }
	if ($AllProfiles) { $forward += "-AllProfiles" }
	Start-Process -FilePath "powershell.exe" -ArgumentList $forward -Verb RunAs
	exit
}

if (Get-NetFirewallRule -Name $RuleName -ErrorAction SilentlyContinue) {
	Remove-NetFirewallRule -Name $RuleName
	Write-Host "既存ルール $RuleName を削除しました"
}

if ($Remove) {
	exit 0
}

New-NetFirewallRule `
	-Name $RuleName `
	-DisplayName "Cline Hub LAN dashboard ($Port)" `
	-Description "Cline Hub dashboard on port $Port, LAN-only (LocalSubnet remote addresses)." `
	-Direction Inbound `
	-Action Allow `
	-Enabled True `
	-Profile $Profile `
	-Protocol TCP `
	-LocalPort $Port `
	-RemoteAddress LocalSubnet | Out-Null

$check = Get-NetFirewallRule -Name $RuleName -ErrorAction SilentlyContinue |
	Select-Object -First 1
if ($check -and $check.Enabled -eq "True") {
	Write-Host "OK: $RuleName を追加しました (TCP/$Port, Profile=$Profile, RemoteAddress=LocalSubnet)"
	exit 0
}

Write-Host "ルール追加に失敗しました"
exit 1
