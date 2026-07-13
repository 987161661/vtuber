$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
$logDir = Join-Path $root 'logs'
$port = 8195

if (-not (Test-Path $python)) {
  throw "MuseTalk environment is missing: $python"
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  Start-Process -FilePath $python `
    -ArgumentList @('-m', 'uvicorn', 'live_service:app', '--host', '127.0.0.1', '--port', $port.ToString()) `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'service.out.log') `
    -RedirectStandardError (Join-Path $logDir 'service.err.log')
}

$deadline = (Get-Date).AddMinutes(2)
do {
  Start-Sleep -Seconds 2
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3
    if ($health.ready) {
      Write-Output "MuseTalk service is ready on port $port"
      exit 0
    }
    if ($health.error) {
      throw $health.error
    }
  } catch {
    if ((Get-Date) -ge $deadline) { throw }
  }
} while ((Get-Date) -lt $deadline)

throw 'MuseTalk service startup timed out.'
