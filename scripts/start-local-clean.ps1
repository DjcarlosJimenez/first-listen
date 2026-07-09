$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$port = 3100
if ($env:FIRST_LISTEN_PORT) {
  $parsedPort = 0
  if ([int]::TryParse($env:FIRST_LISTEN_PORT, [ref]$parsedPort) -and $parsedPort -gt 0) {
    $port = $parsedPort
  }
}

Write-Host ""
Write-Host "First Listen local autorun" -ForegroundColor Green
Write-Host "Project: $repoRoot"
Write-Host "Port:    $port"
Write-Host ""

$existingConnection = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1

if ($existingConnection) {
  $processName = "unknown"
  $processId = [int]$existingConnection.OwningProcess
  try {
    $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
  } catch {
    $processName = "unknown"
  }

  Write-Host "Port $port is already in use by process $processId ($processName)." -ForegroundColor Yellow
  Write-Host "This may be an older First Listen dev server." -ForegroundColor Yellow
  $answer = Read-Host "Stop it and start a clean updated server? Type Y to stop it"
  if ($answer -match '^(Y|y|S|s|Si|si|SI)$') {
    Stop-Process -Id $processId -Force
    Start-Sleep -Seconds 1
  } else {
    Write-Host "Autorun cancelled so you do not test an old server." -ForegroundColor Red
    exit 1
  }
}

Write-Host "Cleaning local build cache so the newest workspace code is tested..." -ForegroundColor Yellow
if (Test-Path -LiteralPath ".next") {
  Remove-Item -LiteralPath ".next" -Recurse -Force
}
if (Test-Path -LiteralPath "tsconfig.tsbuildinfo") {
  Remove-Item -LiteralPath "tsconfig.tsbuildinfo" -Force
}

$env:NEXT_TELEMETRY_DISABLED = "1"
$env:FIRST_LISTEN_LOCAL_RUN_ID = (Get-Date).ToString("yyyyMMdd-HHmmss")

Write-Host ""
Write-Host "Open these after the server says Ready:" -ForegroundColor Cyan
Write-Host "  http://localhost:$port/dashboard"
Write-Host "  http://localhost:$port/workspace-v2"
Write-Host "  http://localhost:$port/workspace-v2/guest"
Write-Host ""
Write-Host "Tip: if the browser still shows old UI, use Ctrl+F5 or open a new private window." -ForegroundColor DarkGray
Write-Host ""

npm.cmd run dev -- -p $port
