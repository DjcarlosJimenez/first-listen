@echo off
setlocal
title Probar First Listen Local
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local-clean.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo iniciar la prueba local de First Listen.
  echo Lee el mensaje de arriba.
  echo.
  pause
)
endlocal
