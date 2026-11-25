[CmdletBinding()]
param(
    # Build with fixtures and the simulated agent instead of the local Floci API.
    [switch]$Mock
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$bucket = 'alertchain-frontend-local'
$stack = 'alertchain-local'
$websiteOrigin = "http://$bucket.s3-website-us-east-2.localhost.floci.io:4566"
$website = "$websiteOrigin/"
# First match on PATH: several AWS CLI installs would otherwise give an array of paths.
$aws = (Get-Command aws -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
Get-Command npm.cmd, docker -ErrorAction Stop | Out-Null

# Fixed endpoint, region and bucket: this helper cannot deploy to AWS.
function Invoke-LocalAws {
    & $aws --endpoint-url http://127.0.0.1:4566 --region us-east-2 --no-cli-pager @args
    if ($LASTEXITCODE -ne 0) { throw "Local AWS CLI failed: $($args -join ' ')" }
}

$environment = @{
    AWS_ACCESS_KEY_ID = 'test'; AWS_SECRET_ACCESS_KEY = 'test'; AWS_SESSION_TOKEN = 'test'
    AWS_PROFILE = $null; AWS_DEFAULT_PROFILE = $null; AWS_EC2_METADATA_DISABLED = 'true'
    AWS_ENDPOINT_URL = 'http://127.0.0.1:4566'; AWS_ENDPOINT_URL_S3 = 'http://127.0.0.1:4566'
    # Set below: live mode points at the stack's HTTP API. Both are forced so local .env
    # files cannot change what this script builds.
    VITE_USE_MOCK = 'true'; VITE_API_BASE_URL = ''; VITE_API_URL = ''
}
$saved = @{}
$policyFile = $null
foreach ($name in $environment.Keys) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name)
    [Environment]::SetEnvironmentVariable($name, $environment[$name])
}
Push-Location $repoRoot
try {
    $running = & docker inspect alertchain-floci --format '{{.State.Running}}'
    if ($LASTEXITCODE -ne 0 -or $running -ne 'true') { throw 'Start the existing alertchain-floci container first.' }
    $image = & docker inspect alertchain-floci --format '{{.Image}}'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Floci image.' }
    $labels = & docker image inspect $image --format '{{json .Config.Labels}}' | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Floci version.' }
    Write-Host "Floci version: $($labels.'org.opencontainers.image.version')"

    $apiUrl = $null
    if (-not $Mock) {
        $resources = Invoke-LocalAws cloudformation list-stack-resources --stack-name $stack --output json | ConvertFrom-Json
        $apiId = ($resources.StackResourceSummaries | Where-Object LogicalResourceId -eq 'HttpApi').PhysicalResourceId
        if (-not $apiId) { throw "No HttpApi in local stack $stack. Deploy the backend first, or pass -Mock." }
        # Floci's local hostname for the stack-owned API (resolves to loopback).
        $apiUrl = "http://$apiId.execute-api.localhost.floci.io:4566"

        # The browser calls the API from the website origin, so CORS must allow it. Merge it
        # into the existing local CORS settings instead of replacing them.
        $cors = (Invoke-LocalAws apigatewayv2 get-api --api-id $apiId --output json | ConvertFrom-Json).CorsConfiguration
        $origins = @($cors.AllowOrigins | Where-Object { $_ })
        if ($websiteOrigin -notin $origins) {
            $desired = @{
                AllowOrigins = @($origins + $websiteOrigin)
                AllowMethods = @('GET', 'POST', 'OPTIONS'); AllowHeaders = @('Content-Type'); MaxAge = 600
            }
            $corsFile = [IO.Path]::GetTempFileName()
            try {
                $desired | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $corsFile -Encoding ASCII
                Invoke-LocalAws apigatewayv2 update-api --api-id $apiId --cors-configuration "file://$corsFile" | Out-Null
            } finally { Remove-Item -LiteralPath $corsFile -ErrorAction SilentlyContinue }
            Write-Host "Allowed CORS origin $websiteOrigin on local API $apiId"
        }
        $health = Invoke-WebRequest -UseBasicParsing -Uri "$apiUrl/health" -TimeoutSec 120
        if ($health.StatusCode -ne 200) { throw "Local API health check failed: $apiUrl/health" }
        [Environment]::SetEnvironmentVariable('VITE_USE_MOCK', 'false')
        [Environment]::SetEnvironmentVariable('VITE_API_BASE_URL', $apiUrl)
        [Environment]::SetEnvironmentVariable('VITE_API_URL', $apiUrl)
        Write-Host "Live build against $apiUrl"
    } else {
        Write-Host 'Mock build: fixtures and the simulated agent, no backend API calls.'
    }

    if (-not (Test-Path node_modules/.bin/vite.cmd)) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed; no objects uploaded.' }

    $buckets = Invoke-LocalAws s3api list-buckets --output json | ConvertFrom-Json
    if ($bucket -notin @($buckets.Buckets.Name)) {
        Invoke-LocalAws s3api create-bucket --bucket $bucket --create-bucket-configuration LocationConstraint=us-east-2 | Out-Null
    }
    Invoke-LocalAws s3api put-bucket-website --bucket $bucket --website-configuration 'IndexDocument={Suffix=index.html},ErrorDocument={Key=index.html}'
    # Public GET is restricted to this local frontend bucket. No account-wide changes.
    Invoke-LocalAws s3api put-public-access-block --bucket $bucket --public-access-block-configuration 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false'
    $policyFile = [IO.Path]::GetTempFileName()
    @{
        Version = '2012-10-17'
        Statement = @(@{ Effect = 'Allow'; Principal = '*'; Action = 's3:GetObject'; Resource = "arn:aws:s3:::$bucket/*" })
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $policyFile -Encoding ASCII
    Invoke-LocalAws s3api put-bucket-policy --bucket $bucket --policy "file://$policyFile"

    $dist = (Resolve-Path dist).Path
    # Upload assets first and index last. Keep old hashes for already-open tabs.
    $files = Get-ChildItem -LiteralPath $dist -File -Recurse | Sort-Object @{ Expression = { $_.Name -eq 'index.html' } }, FullName
    foreach ($file in $files) {
        $key = $file.FullName.Substring($dist.Length + 1).Replace('\', '/')
        $type = switch ($file.Extension.ToLowerInvariant()) {
            '.html' { 'text/html; charset=utf-8' }
            '.js' { 'application/javascript' }
            '.css' { 'text/css' }
            '.svg' { 'image/svg+xml' }
            '.png' { 'image/png' }
            '.json' { 'application/json' }
            default { 'application/octet-stream' }
        }
        Invoke-LocalAws s3api put-object --bucket $bucket --key $key --body $file.FullName --content-type $type --cache-control no-cache | Out-Null
        Write-Host "Uploaded $key ($type)"
    }
    $config = Invoke-LocalAws s3api get-bucket-website --bucket $bucket --output json | ConvertFrom-Json
    if ($config.IndexDocument.Suffix -ne 'index.html') { throw 'Website configuration did not persist.' }
    $response = Invoke-WebRequest -UseBasicParsing -Uri $website -TimeoutSec 15
    if ($response.StatusCode -ne 200 -or $response.Content -notmatch '<div id="root">') {
        throw 'Floci website endpoint did not serve the React entry point.'
    }
    Write-Host "Website: $website"
    Write-Host "Nested route: ${website}#/incidents/INC-001"
    if ($apiUrl) {
        $preflight = Invoke-WebRequest -UseBasicParsing -Method Options -Uri "$apiUrl/investigations" -TimeoutSec 30 -Headers @{
            Origin = $websiteOrigin; 'Access-Control-Request-Method' = 'POST'; 'Access-Control-Request-Headers' = 'content-type'
        }
        if ($preflight.Headers['Access-Control-Allow-Origin'] -ne $websiteOrigin) {
            throw "Local API CORS does not allow $websiteOrigin."
        }
        Write-Host "Live build: API $apiUrl (CORS preflight passed). Browser checks are still required."
    } else {
        Write-Host 'Mock build: no backend API calls. Browser navigation/console checks are still required.'
    }
} finally {
    Pop-Location
    if ($policyFile) { Remove-Item -LiteralPath $policyFile -ErrorAction SilentlyContinue }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
}
