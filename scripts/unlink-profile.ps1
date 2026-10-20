# Disable and remove dsh-task-cost from the active web profile.
# HMR applies the removal without restarting `dsh web`; a page reload drops the pill.
$ErrorActionPreference = 'Stop'

$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\web'
$packageName = 'dsh-task-cost'

$manifestPath = Join-Path $profileDir 'package.json'
if (-not (Test-Path $manifestPath)) { throw "web profile not found at $profileDir" }

# 1. Deselect the bundle (live removal via HMR).
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$remaining = @($manifest.dsh.profile.bundles | Where-Object { [string]$_ -ne $packageName })
if ($remaining.Count -ne @($manifest.dsh.profile.bundles).Count) {
  $manifest.dsh.profile.bundles = $remaining
  $json = ($manifest | ConvertTo-Json -Depth 20) + "`n"
  [System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "disabled bundle: $packageName"
} else {
  Write-Output "bundle was not selected: $packageName"
}

# 2. Remove the dependency and the profile junction.
Push-Location $profileDir
try {
  pnpm remove $packageName --config.store-dir=C:\Users\liuchang\.pnpm\store\v11 --reporter=append-only
  if ($LASTEXITCODE -ne 0) { Write-Warning "pnpm remove exited $LASTEXITCODE; the dependency may need manual removal" }
} finally {
  Pop-Location
}

Write-Output "OK: $packageName removed. Reload the GUI page."
