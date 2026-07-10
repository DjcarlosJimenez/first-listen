@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-restore-point.ps1"
if errorlevel 1 (
  echo.
  echo First Listen restore point failed. Read the message above.
  echo.
  pause
)
endlocal
