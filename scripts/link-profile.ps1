# Link dsh-task-cost into the active web profile, enable the bundle, and verify
# that the running Host composed it into its live client module graph.
#
# Re-runnable. Safe while `dsh web` is running: HMR applies the profile change
# without a restart, and the probe only reads.
$ErrorActionPreference = 'Stop'

$pluginDir = Split-Path -Parent $PSScriptRoot
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\web'
$packageName = 'dsh-task-cost'
$storeDir = 'C:\Users\liuchang\.pnpm\store\v11'   # store this profile was installed from
$baseUrl = 'http://127.0.0.1:3080'

if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
  throw "web profile not found at $profileDir"
}

# 1. Link the package (a junction on Windows) into the profile.
Push-Location $profileDir
try {
  pnpm add "link:$pluginDir" "--config.store-dir=$storeDir" --reporter=append-only
  if ($LASTEXITCODE -ne 0) { throw "pnpm add failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

# 2. Select the bundle in dsh.profile.bundles (what the Plugins page does when enabling).
$manifestPath = Join-Path $profileDir 'package.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$bundles = [System.Collections.Generic.List[string]]::new()
foreach ($b in $manifest.dsh.profile.bundles) { $bundles.Add([string]$b) }
if (-not $bundles.Contains($packageName)) {
  $bundles.Add($packageName)
  $manifest.dsh.profile.bundles = @($bundles)
  $json = ($manifest | ConvertTo-Json -Depth 20) + "`n"
  [System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "enabled bundle: $packageName"
} else {
  Write-Output "bundle already enabled: $packageName"
}

# 3. Wait for HMR to recompose, then prove the live client graph holds the row.
$clientPath = Join-Path $pluginDir 'client.js'
$probe = Join-Path $PSScriptRoot 'probe-bundle.mjs'
$deadline = (Get-Date).AddSeconds(45)
$ok = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  node $probe $packageName $clientPath $baseUrl *> $null
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
}
if (-not $ok) {
  throw "plugin did not reach the live client module graph within 45s; check dsh web output for composition errors"
}

node $probe $packageName $clientPath $baseUrl
Write-Output 'OK: dsh-task-cost is installed, enabled, and served by the running Host. Reload the GUI page to see the pill.'
