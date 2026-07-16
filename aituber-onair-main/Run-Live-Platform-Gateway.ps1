param([Parameter(Mandatory = $true)][string]$RoomId)

$ErrorActionPreference = 'Continue'
$logDir = Join-Path $PSScriptRoot 'logs'
$scriptPath = Join-Path $PSScriptRoot 'scripts\live-platform-gateway.mjs'
$jarPath = Join-Path $PSScriptRoot 'tools\ordinaryroad-gateway\target\ordinaryroad-gateway.jar'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (-not (Test-Path -LiteralPath $jarPath -PathType Leaf)) {
  & (Join-Path $PSScriptRoot 'Build-OrdinaryRoad-Gateway.ps1') |
    Out-File -LiteralPath (Join-Path $logDir 'live-platform-gateway.build.log') -Encoding utf8
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$env:LIVE_PLATFORM = 'bilibili'
$env:BILIBILI_ROOM_ID = $RoomId
$env:BILIBILI_AUTH_FILE = Join-Path (Split-Path $PSScriptRoot -Parent) '.runtime\bilibili-auth.json'
$env:ORDINARYROAD_GATEWAY_JAR = $jarPath
$selfUidFile = Join-Path $PSScriptRoot 'config\bilibili-self-uid.txt'
if (Test-Path -LiteralPath $selfUidFile) {
  $env:BILIBILI_SELF_UIDS = (Get-Content -LiteralPath $selfUidFile -Raw).Trim()
}

while ($true) {
  $startedAt = Get-Date
  & node $scriptPath 1>> (Join-Path $logDir 'live-platform-gateway.out.log') 2>> (Join-Path $logDir 'live-platform-gateway.err.log')
  $runtime = (Get-Date) - $startedAt
  $message = "$(Get-Date -Format o) gateway exited after $([int]$runtime.TotalSeconds)s; restarting in 5s"
  Add-Content -LiteralPath (Join-Path $logDir 'live-platform-gateway.err.log') -Value $message
  Start-Sleep -Seconds 5
}
