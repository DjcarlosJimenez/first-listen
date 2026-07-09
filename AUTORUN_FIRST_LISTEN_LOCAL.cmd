@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local-clean.ps1"
if errorlevel 1 (
  echo.
  echo First Listen autorun failed. Read the message above.
  echo.
  pause
)
endlocal
