param([string]$RoomId)

$ErrorActionPreference = 'Stop'
$configDir = Join-Path $PSScriptRoot 'config'
$roomFile = Join-Path $configDir 'bilibili-room.txt'
$runner = Join-Path $PSScriptRoot 'Run-Bilibili-Supervisor.ps1'
$supervisorPort = if ($env:BILIBILI_SUPERVISOR_PORT) { [int]$env:BILIBILI_SUPERVISOR_PORT } else { 8197 }

if ($RoomId) {
  if ($RoomId -notmatch '^\d+$') { throw 'RoomId must be a numeric Bilibili live room number.' }
  New-Item -ItemType Directory -Path $configDir -Force | Out-Null
  Set-Content -LiteralPath $roomFile -Value $RoomId -Encoding ASCII
} elseif (Test-Path $roomFile) {
  $RoomId = (Get-Content -LiteralPath $roomFile -Raw).Trim()
}

if (-not $RoomId -or $RoomId -notmatch '^\d+$') {
  throw 'Run once with: .\Start-Linglan-Bilibili.ps1 -RoomId <your live room number>'
}

$listener = Get-NetTCPConnection -LocalPort $supervisorPort -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $runner, '-RoomId', $RoomId) `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

& (Join-Path $PSScriptRoot 'Start-AITuber.ps1')
