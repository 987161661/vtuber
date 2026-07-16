param([Parameter(Mandatory = $true)][string]$RoomId)

# Compatibility entrypoint. The active implementation is now the generic
# OrdinaryRoad live-platform gateway.
& (Join-Path $PSScriptRoot 'Run-Live-Platform-Gateway.ps1') -RoomId $RoomId
exit $LASTEXITCODE
