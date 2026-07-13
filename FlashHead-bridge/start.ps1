$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = "D:\copyme\OpenAvatarChat\.venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "CopyMe Python environment was not found: $Python"
}

Set-Location -LiteralPath $Root
& $Python -m uvicorn live_service:app --host 127.0.0.1 --port 8196
