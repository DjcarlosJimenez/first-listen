param(
  [string]$Name = "",
  [switch]$Push,
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $previousErrorActionPreference = $ErrorActionPreference
  $output = @()
  $exitCode = 0
  try {
    $ErrorActionPreference = "Continue"
    $output = & git @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  $outputText = @($output | ForEach-Object { $_.ToString() })
  if ($exitCode -ne 0) {
    throw ($outputText -join "`n")
  }
  return $outputText
}

Write-Host ""
Write-Host "First Listen restore point" -ForegroundColor Green
Write-Host "Project: $repoRoot"
Write-Host ""

$branch = (Invoke-Git @("branch", "--show-current") | Select-Object -First 1).Trim()
$commit = (Invoke-Git @("rev-parse", "HEAD") | Select-Object -First 1).Trim()
$shortCommit = (Invoke-Git @("rev-parse", "--short", "HEAD") | Select-Object -First 1).Trim()
$trackedChanges = Invoke-Git @("status", "--porcelain", "--untracked-files=no")

if ($trackedChanges.Count -gt 0) {
  Write-Host "Tracked files have uncommitted changes." -ForegroundColor Yellow
  Write-Host "A restore point only captures committed code, not local edits." -ForegroundColor Yellow
  Write-Host ""
  $trackedChanges | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkYellow }
  Write-Host ""
  $answer = Read-Host "Continue anyway? Type Y to continue"
  if ($answer -notmatch '^(Y|y|S|s|Si|si|SI)$') {
    Write-Host "Restore point cancelled." -ForegroundColor Red
    exit 1
  }
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$safeName = $Name.Trim().ToLowerInvariant() -replace '[^a-z0-9._-]+', '-'
$safeName = $safeName.Trim("-")
if ([string]::IsNullOrWhiteSpace($safeName)) {
  $safeName = "workspace-stable"
}

$tagName = "restore-first-listen-$safeName-$timestamp"
$existingTag = & git tag --list $tagName
if ($existingTag) {
  throw "Tag already exists: $tagName"
}

$message = "First Listen restore point: $safeName at $timestamp ($shortCommit)"
Invoke-Git @("tag", "-a", $tagName, "-m", $message) | Out-Null

$restoreDir = Join-Path $repoRoot "backups\restore-points"
New-Item -ItemType Directory -Force -Path $restoreDir | Out-Null

$reportPath = Join-Path $restoreDir "$tagName.md"
$statusText = Invoke-Git @("status", "--short", "--untracked-files=no")
$recentLog = Invoke-Git @("log", "-5", "--oneline")

$report = @"
# First Listen Restore Point

- Tag: `$tagName`
- Commit: `$commit`
- Short commit: `$shortCommit`
- Branch at creation: `$branch`
- Created: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")

## What This Captures

This restore point captures the committed application code at the tag above.
It does not create a database backup and does not modify production.

## Restore Safely

Recommended safe rollback path:

~~~powershell
git fetch --tags origin
git checkout -b restore/$tagName $tagName
npm.cmd run build
~~~

After verifying locally, deploy from that branch only if needed.

## Current Git Status

Tracked changes only:

~~~text
$($statusText -join "`n")
~~~

Untracked files are intentionally skipped so temporary output folders do not break the restore point.
Only committed code is captured by this restore tag.

## Recent Commits

~~~text
$($recentLog -join "`n")
~~~
"@

Set-Content -LiteralPath $reportPath -Value $report -Encoding UTF8

Write-Host "Created local restore tag:" -ForegroundColor Cyan
Write-Host "  $tagName"
Write-Host ""
Write-Host "Saved report:" -ForegroundColor Cyan
Write-Host "  $reportPath"
Write-Host ""

$shouldPush = $false
if ($Push) {
  $shouldPush = $true
} elseif (-not $NoPush) {
  $pushAnswer = Read-Host "Push this restore tag to GitHub now? Type Y to push"
  $shouldPush = $pushAnswer -match '^(Y|y|S|s|Si|si|SI)$'
}

if ($shouldPush) {
  Write-Host ""
  Write-Host "Pushing restore tag to GitHub..." -ForegroundColor Yellow
  Invoke-Git @("push", "origin", $tagName) | Out-Null
  Write-Host "Restore tag pushed to GitHub." -ForegroundColor Green
} else {
  Write-Host "Restore tag is local only." -ForegroundColor Yellow
  Write-Host "To push later, run:" -ForegroundColor Yellow
  Write-Host "  git push origin $tagName"
}

Write-Host ""
Write-Host "Done. This is a code restore point only; database backups are separate." -ForegroundColor Green
