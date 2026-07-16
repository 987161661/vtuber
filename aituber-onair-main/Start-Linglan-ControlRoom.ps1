param(
  [switch]$UseMuseTalkFallback,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$baseLauncher = Join-Path $PSScriptRoot 'Start-AITuber.ps1'
$appPath = Join-Path $PSScriptRoot 'packages\core\examples\react-purupuru-app'
$logPath = Join-Path $PSScriptRoot 'logs'
$flashHeadLauncher = Join-Path (Split-Path $PSScriptRoot -Parent) 'FlashHead-bridge\Start-FlashHead-Service.ps1'
$gatewayLauncher = Join-Path $PSScriptRoot 'Ensure-Live-Platform-Gateway.ps1'
$controlRoomUrl = if ($UseMuseTalkFallback) {
  'http://127.0.0.1:5173/?listener=1&speakEngine=musetalk'
} else {
  'http://127.0.0.1:5173/?listener=1'
}

if (Test-Path -LiteralPath $baseLauncher -PathType Leaf) {
  # Start the canonical gateway, renderer and Vite chain without opening its
  # display-only page. The listener page opened below is the sole runtime owner.
  & $baseLauncher -NoBrowser -UseMuseTalkFallback:$UseMuseTalkFallback
} else {
  # Some working trees deliberately omit the older umbrella launcher. Keep
  # this entrypoint self-sufficient rather than silently closing on double-click.
  if ($UseMuseTalkFallback) {
    throw 'MuseTalk fallback requires Start-AITuber.ps1, which is not present in this working tree.'
  }
  if (-not (Test-Path -LiteralPath $appPath)) {
    throw "Digital-human app was not found: $appPath"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $appPath 'node_modules'))) {
    throw "Digital-human dependencies are missing: $appPath\\node_modules"
  }
  if (Test-Path -LiteralPath $gatewayLauncher -PathType Leaf) {
    & $gatewayLauncher
  }
  if (-not (Test-Path -LiteralPath $flashHeadLauncher -PathType Leaf)) {
    throw "FlashHead launcher was not found: $flashHeadLauncher"
  }
  & $flashHeadLauncher
  if (-not (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)) {
    New-Item -ItemType Directory -Path $logPath -Force | Out-Null
    Start-Process -FilePath 'npm.cmd' `
      -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1') `
      -WorkingDirectory $appPath `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logPath 'vite.out.log') `
      -RedirectStandardError (Join-Path $logPath 'vite.err.log')
  }
}

$response = $null
$deadline = (Get-Date).AddSeconds(30)
do {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 `
      'http://127.0.0.1:5173/'
    if ($response.StatusCode -eq 200) { break }
  } catch {
    Start-Sleep -Milliseconds 500
  }
} while ((Get-Date) -lt $deadline)

if (-not $response -or $response.StatusCode -ne 200) {
  throw 'Digital-human control room did not become ready on http://127.0.0.1:5173/ within 30 seconds.'
}

if (-not $NoBrowser) {
  Start-Process $controlRoomUrl
}

Write-Host 'Linglan control room is ready.' -ForegroundColor Green
Write-Host "Runtime owner: $controlRoomUrl"
