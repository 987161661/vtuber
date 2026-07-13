[CmdletBinding()]
param(
  [ValidateSet('configure', 'configure-auth', 'clear-auth', 'start', 'stop', 'status', 'diagnose', 'events', 'logs')]
  [string]$Action = 'status',
  [string]$RoomId,
  [string]$SelfUid,
  [int]$Port = 0,
  [int]$WaitSeconds = 20,
  [int]$Seconds = 10,
  [int]$Tail = 80,
  [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if (-not $ProjectRoot) {
  $ProjectRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\..\..\..')
  )
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$appRoot = Join-Path $ProjectRoot 'aituber-onair-main'
$runner = Join-Path $appRoot 'Run-Bilibili-Supervisor.ps1'
$roomFile = Join-Path $appRoot 'config\bilibili-room.txt'
$selfUidFile = Join-Path $appRoot 'config\bilibili-self-uid.txt'
$runtimeDir = Join-Path $ProjectRoot '.runtime'
$pidFile = Join-Path $runtimeDir 'bilibili-automation.pid'
$authFile = Join-Path $runtimeDir 'bilibili-auth.json'
$outLog = Join-Path $appRoot 'logs\bilibili-supervisor.out.log'
$errLog = Join-Path $appRoot 'logs\bilibili-supervisor.err.log'

if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
  throw "Bilibili supervisor runner not found: $runner"
}
if ($Port -le 0) {
  $Port = if ($env:BILIBILI_SUPERVISOR_PORT) {
    [int]$env:BILIBILI_SUPERVISOR_PORT
  } else {
    8197
  }
}

function Write-Json {
  param([Parameter(Mandatory = $true)]$Value)
  $Value | ConvertTo-Json -Depth 10
}

function Get-ConfiguredRoomId {
  if (-not (Test-Path -LiteralPath $roomFile -PathType Leaf)) { return $null }
  $value = (Get-Content -LiteralPath $roomFile -Raw).Trim()
  if ($value -match '^\d+$') { return $value }
  return $null
}

function Get-ManagedProcessId {
  if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) { return $null }
  $value = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  if ($value -match '^\d+$') { return [int]$value }
  return $null
}

function Get-BridgeHealth {
  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" `
      -Method Get -TimeoutSec 2 -Headers @{ 'Cache-Control' = 'no-cache' }
  } catch {
    return $null
  }
}

function Get-PortListener {
  return Get-NetTCPConnection -LocalPort $Port -State Listen `
    -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Get-StatusSnapshot {
  $managedProcessId = Get-ManagedProcessId
  $managedProcess = if ($managedProcessId) {
    Get-CimInstance Win32_Process -Filter "ProcessId = $managedProcessId" `
      -ErrorAction SilentlyContinue
  } else {
    $null
  }
  $listener = Get-PortListener
  [PSCustomObject]@{
    configuredRoomId = Get-ConfiguredRoomId
    port = $Port
    bridge = Get-BridgeHealth
    listenerProcessId = if ($listener) { $listener.OwningProcess } else { $null }
    managedProcessId = if ($managedProcess) { $managedProcess.ProcessId } else { $null }
    managed = [bool]$managedProcess
    outboundAuthFileExists = Test-Path -LiteralPath $authFile -PathType Leaf
  }
}

function Stop-ProcessTree {
  param([Parameter(Mandatory = $true)][int]$RootProcessId)
  $children = Get-CimInstance Win32_Process -Filter `
    "ParentProcessId = $RootProcessId" -ErrorAction SilentlyContinue
  foreach ($child in @($children)) {
    Stop-ProcessTree -RootProcessId ([int]$child.ProcessId)
  }
  Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
}

function Get-NormalizedLogTail {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][int]$Count
  )
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @() }
  return @(
    Get-Content -LiteralPath $Path -Tail ([Math]::Max(1, $Count)) |
      ForEach-Object { ($_ -replace "`0", '').TrimEnd() } |
      Where-Object { $_.Length -gt 0 }
  )
}

switch ($Action) {
  'configure-auth' {
    Write-Host 'Paste the Cookie request header from a signed-in live.bilibili.com request.'
    Write-Host 'The value is hidden and will only be stored in the local ignored .runtime folder.'
    $secureCookie = Read-Host 'Bilibili Cookie' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureCookie)
    try {
      $cookie = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    if ($cookie -notmatch '(?:^|;\s*)SESSDATA=[^;]+' -or
        $cookie -notmatch '(?:^|;\s*)bili_jct=[^;]+') {
      throw 'Cookie must contain both SESSDATA and bili_jct.'
    }
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    $json = @{ cookie = $cookie } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText(
      $authFile,
      $json,
      [System.Text.UTF8Encoding]::new($false)
    )
    $cookie = $null
    $json = $null
    Write-Json ([PSCustomObject]@{
      configured = $true
      authFile = $authFile
      restartRequired = $false
      next = 'Enable the Bilibili text-reply switch in Settings -> Stream.'
    })
    break
  }

  'clear-auth' {
    Remove-Item -LiteralPath $authFile -Force -ErrorAction SilentlyContinue
    Write-Json ([PSCustomObject]@{
      cleared = -not (Test-Path -LiteralPath $authFile -PathType Leaf)
      authFile = $authFile
    })
    break
  }

  'configure' {
    if (-not $RoomId -or $RoomId -notmatch '^\d+$') {
      throw 'RoomId must be a numeric public Bilibili live-room ID.'
    }
    $configDir = Split-Path -Parent $roomFile
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    Set-Content -LiteralPath $roomFile -Value $RoomId -Encoding ASCII
    if ($PSBoundParameters.ContainsKey('SelfUid')) {
      if ($SelfUid -and $SelfUid -notmatch '^\d+(\s*,\s*\d+)*$') {
        throw 'SelfUid must be one numeric UID or a comma-separated UID list.'
      }
      $normalized = (($SelfUid -split ',') | ForEach-Object { $_.Trim() }) -join ','
      Set-Content -LiteralPath $selfUidFile -Value $normalized -Encoding ASCII
    }
    Write-Json (Get-StatusSnapshot)
    break
  }

  'start' {
    if ($RoomId) {
      if ($RoomId -notmatch '^\d+$') {
        throw 'RoomId must be a numeric public Bilibili live-room ID.'
      }
      New-Item -ItemType Directory -Path (Split-Path -Parent $roomFile) `
        -Force | Out-Null
      Set-Content -LiteralPath $roomFile -Value $RoomId -Encoding ASCII
    }
    $resolvedRoomId = Get-ConfiguredRoomId
    if (-not $resolvedRoomId) {
      throw 'No valid room is configured. Run the configure action first.'
    }
    $health = Get-BridgeHealth
    if ($health) {
      if ("$($health.requestedRoomId)" -ne $resolvedRoomId) {
        throw "Port $Port already serves room $($health.requestedRoomId). Stop it before switching to $resolvedRoomId."
      }
      Write-Json (Get-StatusSnapshot)
      break
    }
    $listener = Get-PortListener
    if ($listener) {
      throw "Port $Port is occupied by process $($listener.OwningProcess), but it is not a healthy Bilibili bridge."
    }
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', $runner,
      '-RoomId', $resolvedRoomId
    ) -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII

    $deadline = (Get-Date).AddSeconds([Math]::Max(1, $WaitSeconds))
    do {
      Start-Sleep -Milliseconds 500
      $health = Get-BridgeHealth
    } until ($health -or (Get-Date) -ge $deadline -or $process.HasExited)

    if (-not $health) {
      if (-not $process.HasExited) {
        Stop-ProcessTree -RootProcessId $process.Id
      }
      Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
      $latestErrorLines = @(Get-NormalizedLogTail -Path $errLog -Count 10)
      $latestError = if ($latestErrorLines.Count -gt 0) {
        $latestErrorLines -join [Environment]::NewLine
      } else {
        'No supervisor error log was created.'
      }
      throw "Bilibili bridge did not become healthy within $WaitSeconds seconds.`n$latestError"
    }
    Write-Json (Get-StatusSnapshot)
    break
  }

  'stop' {
    $managedProcessId = Get-ManagedProcessId
    if (-not $managedProcessId) {
      Write-Json ([PSCustomObject]@{
        stopped = $false
        reason = 'No supervisor process is recorded as managed by this skill.'
        status = Get-StatusSnapshot
      })
      break
    }
    $process = Get-CimInstance Win32_Process -Filter `
      "ProcessId = $managedProcessId" -ErrorAction SilentlyContinue
    if (-not $process) {
      Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
      Write-Json ([PSCustomObject]@{
        stopped = $false
        reason = 'The recorded supervisor process is no longer running.'
        status = Get-StatusSnapshot
      })
      break
    }
    if ($process.Name -notmatch '^powershell' -or
        $process.CommandLine -notlike '*Run-Bilibili-Supervisor.ps1*') {
      throw "Refusing to stop process $managedProcessId because it is not the recorded Bilibili runner."
    }
    Stop-ProcessTree -RootProcessId $managedProcessId
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    Write-Json ([PSCustomObject]@{
      stopped = $true
      processId = $managedProcessId
      status = Get-StatusSnapshot
    })
    break
  }

  'events' {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) { throw 'curl.exe is required to sample SSE events.' }
    $duration = [Math]::Max(1, $Seconds)
    & $curl.Source --silent --show-error --no-buffer --max-time $duration `
      "http://127.0.0.1:$Port/events?client=codex-automation"
    if ($LASTEXITCODE -notin @(0, 28)) { exit $LASTEXITCODE }
    break
  }

  'logs' {
    foreach ($log in @($outLog, $errLog)) {
      "--- $log"
      if (Test-Path -LiteralPath $log -PathType Leaf) {
        Get-NormalizedLogTail -Path $log -Count $Tail
      } else {
        '(missing)'
      }
    }
    break
  }

  'diagnose' {
    $status = Get-StatusSnapshot
    $alerts = [System.Collections.Generic.List[string]]::new()
    if (-not $status.configuredRoomId) { $alerts.Add('room_not_configured') }
    if (-not $status.listenerProcessId) { $alerts.Add('listener_not_running') }
    if (-not $status.bridge) { $alerts.Add('health_unreachable') }
    if ($status.bridge -and $status.bridge.state -ne 'online') {
      $alerts.Add("bridge_state_$($status.bridge.state)")
    }
    if ($status.bridge -and $status.bridge.isLive -eq $true -and
        [int]$status.bridge.connectedClients -eq 0) {
      $alerts.Add('live_room_has_no_sse_client')
    }
    Write-Json ([PSCustomObject]@{
      status = $status
      alerts = $alerts
      recentErrors = @(Get-NormalizedLogTail -Path $errLog -Count 20)
    })
    break
  }

  default {
    Write-Json (Get-StatusSnapshot)
  }
}
