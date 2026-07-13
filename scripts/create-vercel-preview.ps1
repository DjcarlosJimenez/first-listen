$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host ""
Write-Host "First Listen Vercel Preview" -ForegroundColor Green
Write-Host "Project: $repoRoot"
Write-Host ""
Write-Host "Esto crea un link publico temporal de Vercel para probar desde celular sin estar en el mismo Wi-Fi." -ForegroundColor Yellow
Write-Host "No despliega produccion y no cambia firstlisten.net." -ForegroundColor Yellow
Write-Host "Nota: Vercel recibira el codigo local actual para construir el preview." -ForegroundColor Yellow
Write-Host ""

$answer = Read-Host "Crear preview ahora? Type Y to continue"
if ($answer -notmatch '^(Y|y|S|s|Si|si|SI)$') {
  Write-Host "Preview cancelado." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Creando preview. Espera el Deployment URL que imprime Vercel..." -ForegroundColor Cyan
Write-Host ""

npx vercel --yes
