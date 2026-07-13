param(
  [switch]$OpenBrowser,
  [switch]$UseMuseTalkFallback
)

$ErrorActionPreference = 'Stop'

$appPath = Join-Path $PSScriptRoot 'packages\core\examples\react-purupuru-app'
# Keep launcher output alongside the authoritative runtime history, rather
# than under the example app or the retired D:\vtuber workspace.
$logPath = Join-Path $PSScriptRoot 'logs'
$port = 5173
$toolsetRoot = Split-Path $PSScriptRoot -Parent
$flashHeadLauncher = Join-Path $toolsetRoot 'FlashHead-bridge\Start-FlashHead-Service.ps1'
$museTalkLauncher = Join-Path $toolsetRoot 'MuseTalk\Start-MuseTalk-Service.ps1'

if (-not (Test-Path (Join-Path $appPath 'node_modules'))) {
  throw "Dependencies are missing. Run npm.cmd ci in: $appPath"
}

if ($UseMuseTalkFallback -and (Test-Path $museTalkLauncher)) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $museTalkLauncher
} elseif (Test-Path $flashHeadLauncher) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $flashHeadLauncher
} else {
  throw "FlashHead launcher was not found: $flashHeadLauncher"
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
$startedApp = $false
if (-not $listener) {
  New-Item -ItemType Directory -Path $logPath -Force | Out-Null
  Start-Process -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1') `
    -WorkingDirectory $appPath `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logPath 'vite.out.log') `
    -RedirectStandardError (Join-Path $logPath 'vite.err.log')

  Start-Sleep -Seconds 2
  $startedApp = $true
}

if ($startedApp -or $OpenBrowser) {
  $avatarUrl = if ($UseMuseTalkFallback) {
    'http://127.0.0.1:5173/?speakEngine=musetalk'
  } else {
    'http://127.0.0.1:5173/'
  }
  Start-Process $avatarUrl
}
