# Installs the Lambda's third-party dependencies into backend/vendor so that
# `aws cloudformation package` (Floci) and `sam deploy` ship them inside the function
# package. Run from anywhere; re-run after changing backend/requirements.txt.
# Wheels are fetched for Lambda's Linux x86_64 / Python 3.12 runtime regardless of this OS.
$ErrorActionPreference = 'Stop'
$backend = Join-Path (Split-Path -Parent $PSScriptRoot) 'backend'
$vendor = Join-Path $backend 'vendor'
if (Test-Path $vendor) { Remove-Item -Recurse -Force $vendor }
python -m pip install --upgrade --no-compile --target $vendor `
    --platform manylinux2014_x86_64 --implementation cp --python-version 3.12 `
    --only-binary=:all: -r (Join-Path $backend 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed.' }
Write-Host "Dependencies installed in $vendor"
