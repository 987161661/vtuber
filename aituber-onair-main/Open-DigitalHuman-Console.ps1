param(
  [string]$RoomId,
  [switch]$SkipBilibili,
  [switch]$UseMuseTalkFallback
)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$roomFile = Join-Path $root 'config\bilibili-room.txt'
$supervisorPort = if ($env:BILIBILI_SUPERVISOR_PORT) { [int]$env:BILIBILI_SUPERVISOR_PORT } else { 8197 }

if (-not $SkipBilibili) {
  if (-not $RoomId -and (Test-Path -LiteralPath $roomFile)) {
    $RoomId = (Get-Content -LiteralPath $roomFile -Raw).Trim()
  }

  if (-not $RoomId -or $RoomId -notmatch '^\d+$') {
    throw 'Bilibili room ID is missing. Run once with -RoomId <numeric room ID>, or use -SkipBilibili for an offline console.'
  }

  $bridge = Get-NetTCPConnection -LocalPort $supervisorPort -State Listen -ErrorAction SilentlyContinue
  if (-not $bridge) {
    $bridgeRunner = Join-Path $root 'Run-Bilibili-Supervisor.ps1'
    Start-Process -FilePath 'powershell.exe' `
      -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $bridgeRunner,
        '-RoomId', $RoomId
      ) `
      -WorkingDirectory $root `
      -WindowStyle Hidden

    Start-Sleep -Seconds 2
  }
}

$launcher = Join-Path $root 'Start-AITuber.ps1'
$launcherArguments = @{ OpenBrowser = $true }
if ($UseMuseTalkFallback) {
  $launcherArguments.UseMuseTalkFallback = $true
}

& $launcher @launcherArguments
