param([string]$RoomId)

$ErrorActionPreference = 'Stop'

$configDir = Join-Path $PSScriptRoot 'config'
$legacyRoomFile = Join-Path $configDir 'bilibili-room.txt'
$runtimeConfigFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.runtime\live-connectors\ordinaryroad.json'
$runner = Join-Path $PSScriptRoot 'Run-Live-Platform-Gateway.ps1'
$gatewayPort = if ($env:BILIBILI_SUPERVISOR_PORT) { [int]$env:BILIBILI_SUPERVISOR_PORT } else { 8197 }

$runtimeConfigLoaded = $false
if (-not $RoomId -and (Test-Path -LiteralPath $runtimeConfigFile)) {
  try {
    $runtimeConfig = Get-Content -LiteralPath $runtimeConfigFile -Raw | ConvertFrom-Json
    $runtimeConfigLoaded = $true
    if ($runtimeConfig.platforms.bilibili.enabled) {
      $RoomId = [string]$runtimeConfig.platforms.bilibili.roomId
    }
  } catch {
    Write-Warning "Unable to read live connector config: $($_.Exception.Message)"
  }
}

if (-not $RoomId -and -not $runtimeConfigLoaded -and (Test-Path -LiteralPath $legacyRoomFile)) {
  $RoomId = (Get-Content -LiteralPath $legacyRoomFile -Raw).Trim()
}

# A project without a configured Bilibili room can still use the avatar app.
if (-not $RoomId) { return }
if ($RoomId -notmatch '^\d+$') {
  throw "Configured Bilibili room id is invalid: $RoomId"
}
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
  throw "Live platform gateway runner was not found: $runner"
}

$listener = Get-NetTCPConnection -LocalPort $gatewayPort -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $runner, '-RoomId', $RoomId) `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden
}

$healthUrl = "http://127.0.0.1:$gatewayPort/health"
$deadline = (Get-Date).AddSeconds(20)
do {
  try {
    $status = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($status.connectorId -eq 'ordinaryroad') { return }
    throw "Port $gatewayPort is occupied by a different service."
  } catch {
    if ($listener -and $_.Exception.Message -notmatch 'actively refused|Unable to connect|timed out') {
      throw
    }
  }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)

throw "Live platform gateway did not become ready at $healthUrl"
