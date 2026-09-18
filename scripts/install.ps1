# SearchBox for OpenCode Desktop - install (Windows)
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/install.ps1
#         powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -App C:\path\to\app.asar
param([string]$App)

$ErrorActionPreference = "Stop"

if (Test-Path "$PSScriptRoot\install.sh") {
  # nothing to do - this distinguishes the script dir; kept for clarity
}

$Candidates = @(
  "$env:LOCALAPPDATA\Programs\opencode\resources\app.asar",
  "$env:LOCALAPPDATA\Programs\OpenCode\resources\app.asar",
  "$env:LOCALAPPDATA\Programs\opencode-desktop\resources\app.asar"
)

if (-not $App) {
  foreach ($c in $Candidates) {
    if (Test-Path $c) { $App = $c; break }
  }
}
if (-not $App -or -not (Test-Path $App)) {
  Write-Host "app.asar not found. Pass -App C:\path\to\app.asar" -ForegroundColor Red
  Write-Host ("Candidates tried:`n  " + ($Candidates -join "`n  ")) -ForegroundColor DarkGray
  exit 1
}

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { Write-Host "Node.js >= 22.12.0 is required (https://nodejs.org)" -ForegroundColor Red; exit 1 }

$RepoDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$AppDir  = Split-Path $App -Parent
$Bak     = Join-Path $AppDir "app.asar.bak-original"

if (-not (Test-Path $Bak)) {
  Copy-Item $App $Bak -Force
  Write-Host "Created pristine backup: $Bak"
} else {
  Write-Host "Using existing pristine backup: $Bak"
}

$Tmp = Join-Path $env:TEMP ("sbox-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $Tmp | Out-Null

try {
  & node "$RepoDir\patch\patch-asar.mjs" `
    --src $Bak `
    --out "$Tmp\app.asar" `
    --snippet "$RepoDir\patch\index-inject.html" `
    --bridge "$RepoDir\patch\bridge.js"
  if ($LASTEXITCODE -ne 0) { throw "patch-asar.mjs failed with exit code $LASTEXITCODE" }

  try {
    Copy-Item "$Tmp\app.asar" $App -Force
  } catch {
    Write-Host "Direct copy was denied (app dir is protected). Elevating once..." -ForegroundColor Yellow
    $arg = "-NoProfile -Command `"Copy-Item -LiteralPath '$Tmp\app.asar' -Destination '$App' -Force`""
    $p = Start-Process powershell -Verb RunAs -ArgumentList $arg -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Elevated copy failed (exit $($p.ExitCode))" }
  }

  Write-Host ""
  Write-Host "Patch applied to: $App" -ForegroundColor Green
  Write-Host ""
  Write-Host "Next steps:"
  Write-Host "  1. Fully exit OpenCode Desktop from the tray (not just close the window)."
  Write-Host "  2. Reopen it. The search box appears only inside a chat that has messages."
  Write-Host "  3. Use the Up/Down arrows or Enter / Shift+Enter while typing to jump between matches."
  Write-Host ""
  Write-Host "Restore any time with: powershell -ExecutionPolicy Bypass -File ""$RepoDir\scripts\restore.ps1"""
}
finally {
  Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}