param([Parameter(Mandatory = $true)][string]$RoomId)

$ErrorActionPreference = 'Continue'
$logDir = Join-Path $PSScriptRoot 'logs'
$scriptPath = Join-Path $PSScriptRoot 'scripts\bilibili-room-supervisor.mjs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$env:BILIBILI_ROOM_ID = $RoomId
$env:BILIBILI_AUTH_FILE = Join-Path (Split-Path $PSScriptRoot -Parent) '.runtime\bilibili-auth.json'
$selfUidFile = Join-Path $PSScriptRoot 'config\bilibili-self-uid.txt'
if (Test-Path -LiteralPath $selfUidFile) {
  $env:BILIBILI_SELF_UIDS = (Get-Content -LiteralPath $selfUidFile -Raw).Trim()
}

while ($true) {
  $startedAt = Get-Date
  & node $scriptPath 1>> (Join-Path $logDir 'bilibili-supervisor.out.log') 2>> (Join-Path $logDir 'bilibili-supervisor.err.log')
  $runtime = (Get-Date) - $startedAt
  $message = "$(Get-Date -Format o) supervisor exited after $([int]$runtime.TotalSeconds)s; restarting in 5s"
  Add-Content -LiteralPath (Join-Path $logDir 'bilibili-supervisor.err.log') -Value $message
  Start-Sleep -Seconds 5
}
