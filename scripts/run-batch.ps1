# Runs the Photoshop batch script through COM and reports failures.
# Usage: run-batch.ps1 -Jsx <path to apply-preset.jsx> -Args <path to batch-args.json>
# The JSX reads its args path from the ARGS_PATH line inside itself, so
# this script rewrites that line before calling Photoshop. Photoshop must
# be installed on this Windows PC (Photoshop CC 2019 / 20.x se 2025 / 26.x
# tak — har version; COM ProgID Photoshop.Application version-independent hai).
param(
  [Parameter(Mandatory = $true)][string]$Jsx,
  [Parameter(Mandatory = $true)][string]$Args
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Jsx)) { Write-Error "JSX not found: $Jsx"; exit 2 }
if (-not (Test-Path $Args)) { Write-Error "Args file not found: $Args"; exit 2 }

# Point the JSX at this run's args file (first line matching ARGS_PATH).
$content = Get-Content -Raw -LiteralPath $Jsx
$escaped = $Args -replace '\\', '\\'
$content = $content -replace 'var ARGS_PATH = ".*";', ('var ARGS_PATH = "' + $escaped + '";')
Set-Content -LiteralPath $Jsx -Value $content -Encoding UTF8

try {
  $ps = New-Object -ComObject Photoshop.Application
} catch {
  Write-Error "Photoshop COM object could not be created. Is Adobe Photoshop installed? $($_.Exception.Message)"
  exit 3
}

try {
  $ps.DoJavaScriptFile($Jsx)
} catch {
  Write-Error "Photoshop script failed: $($_.Exception.Message)"
  exit 4
}

exit 0
