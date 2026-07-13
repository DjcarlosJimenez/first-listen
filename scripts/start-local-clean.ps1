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
Write-Host "First Listen local test autorun" -ForegroundColor Green
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
Write-Host "PC links:" -ForegroundColor Cyan
Write-Host "  Public landing:    http://localhost:$port/"
Write-Host "  Main account test:  http://localhost:$port/dashboard"
Write-Host "  Workspace V2:       http://localhost:$port/workspace-v2"
Write-Host "  Guest preview:      http://localhost:$port/workspace-v2/guest"
Write-Host ""
Write-Host "Playback Bank guest previews:" -ForegroundColor Cyan
Write-Host "  Nueva:       http://localhost:$port/workspace-v2/guest?bankPreview=fresh"
Write-Host "  Parcial:     http://localhost:$port/workspace-v2/guest?bankPreview=partial"
Write-Host "  Completa:    http://localhost:$port/workspace-v2/guest?bankPreview=complete"
Write-Host "  Repetida:    http://localhost:$port/workspace-v2/guest?bankPreview=replay"
Write-Host "  Preparado:   http://localhost:$port/workspace-v2/guest?bankPreview=idle"
$localIPv4 = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -notlike "127.*" -and
    ($_.IPAddress -like "10.*" -or $_.IPAddress -like "192.168.*" -or $_.IPAddress -match "^172\.(1[6-9]|2\d|3[0-1])\.")
  } |
  Select-Object -First 1 -ExpandProperty IPAddress
if ($localIPv4) {
  Write-Host ""
  Write-Host "Phone/tablet links on the same Wi-Fi:" -ForegroundColor Cyan
  Write-Host "  Public landing:    http://${localIPv4}:$port/"
  Write-Host "  Main account test:  http://${localIPv4}:$port/dashboard"
  Write-Host "  Workspace V2:       http://${localIPv4}:$port/workspace-v2"
  Write-Host "  Guest preview:      http://${localIPv4}:$port/workspace-v2/guest"
  Write-Host ""
  Write-Host "Phone/tablet Playback Bank guest previews:" -ForegroundColor Cyan
  Write-Host "  Nueva:       http://${localIPv4}:$port/workspace-v2/guest?bankPreview=fresh"
  Write-Host "  Parcial:     http://${localIPv4}:$port/workspace-v2/guest?bankPreview=partial"
  Write-Host "  Completa:    http://${localIPv4}:$port/workspace-v2/guest?bankPreview=complete"
  Write-Host "  Repetida:    http://${localIPv4}:$port/workspace-v2/guest?bankPreview=replay"
  Write-Host "  Preparado:   http://${localIPv4}:$port/workspace-v2/guest?bankPreview=idle"
} else {
  Write-Host ""
  Write-Host "No local Wi-Fi IP was detected. Make sure the phone and PC are on the same network." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Keep this window open while testing." -ForegroundColor Yellow
Write-Host "If the phone cannot open the link, allow Node.js through Windows Firewall." -ForegroundColor Yellow
Write-Host "If the browser still shows old UI, use Ctrl+F5, close the PWA, or open a private window." -ForegroundColor DarkGray
Write-Host ""

npm.cmd run dev -- -H 0.0.0.0 -p $port
