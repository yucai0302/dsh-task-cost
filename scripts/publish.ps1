# Test, build and publish dsh-task-cost to npm.
# Run from a terminal where `npm whoami` already prints your npm username.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  Write-Output '=== tests ==='
  node --test test/cost.test.mjs
  if ($LASTEXITCODE -ne 0) { throw "tests failed ($LASTEXITCODE)" }

  Write-Output '=== release build ==='
  node scripts/build-release.mjs --pack
  if ($LASTEXITCODE -ne 0) { throw "release build failed ($LASTEXITCODE)" }

  Write-Output '=== npm identity ==='
  npm whoami
  if ($LASTEXITCODE -ne 0) { throw 'npm is not logged in; run `npm login` first' }

  Write-Output '=== publish ==='
  npm publish
  if ($LASTEXITCODE -ne 0) { throw "npm publish failed ($LASTEXITCODE)" }

  Write-Output '=== verify ==='
  npm view dsh-task-cost version dist.tarball
} finally {
  Pop-Location
}
