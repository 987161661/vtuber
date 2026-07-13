@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Linglan-Bilibili.ps1" %*
if errorlevel 1 (
  echo.
  echo Linglan Bilibili startup failed. See the error above.
  pause
)
