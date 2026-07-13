@echo off
setlocal
title Crear First Listen Preview
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-vercel-preview.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo crear el preview de First Listen.
  echo Lee el mensaje de arriba.
  echo.
  pause
)
endlocal
