# SearchBox for OpenCode Desktop - restore the pristine app.asar (Windows)
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/restore.ps1
param()

$ErrorActionPreference = "Stop"

$Candidates = @(
  "$env:LOCALAPPDATA\Programs\opencode\resources\app.asar",
  "$env:LOCALAPPDATA\Programs\OpenCode\resources\app.asar",
  "$env:LOCALAPPDATA\Programs\opencode-desktop\resources\app.asar"
)
$App = $null
foreach ($c in $Candidates) {
  if (Test-Path $c) { $App = $c; break }
}
if (-not $App) { Write-Host "app.asar not found." -ForegroundColor Red; exit 1 }

$Bak = Join-Path (Split-Path $App -Parent) "app.asar.bak-original"
if (-not (Test-Path $Bak)) {
  Write-Host "No pristine backup found at $Bak" -ForegroundColor Red
  exit 1
}

try {
  Copy-Item $Bak $App -Force
} catch {
  Write-Host "Direct copy was denied. Elevating once..." -ForegroundColor Yellow
  $arg = "-NoProfile -Command `"Copy-Item -LiteralPath '$Bak' -Destination '$App' -Force`""
  $p = Start-Process powershell -Verb RunAs -ArgumentList $arg -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "Elevated copy failed (exit $($p.ExitCode))" }
}

Write-Host "Restored $App from $Bak" -ForegroundColor Green
Write-Host "Fully quit and reopen OpenCode Desktop."