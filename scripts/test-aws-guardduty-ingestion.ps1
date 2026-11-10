[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.@-]*$')]
    [string]$Profile,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{12}$')]
    [string]$ExpectedAccountId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z][A-Za-z0-9]*:[A-Za-z0-9]+/[A-Za-z0-9][A-Za-z0-9._!/-]*$')]
    [string]$FindingType,

    [ValidatePattern('^[a-z]{2}(-[a-z]+)+-\d+$')]
    [string]$Region = 'us-east-2'
)

$ErrorActionPreference = 'Stop'
Get-Command aws -ErrorAction Stop | Out-Null

# Refuse inherited Floci/test credentials or endpoint overrides. Use a clean
# PowerShell session and the named sandbox profile, as in the deploy workflow.
foreach ($name in @('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_SECURITY_TOKEN')) {
    if ([Environment]::GetEnvironmentVariable($name)) {
        throw "Clear $name in a separate sandbox session before running this script. No sample requested."
    }
}
if (Get-ChildItem Env: | Where-Object { $_.Name -like 'AWS_ENDPOINT_URL*' -and $_.Value }) {
    throw 'Clear AWS_ENDPOINT_URL overrides in a separate sandbox session. No sample requested.'
}

# Explicit public AWS endpoints also prevent profile-configured emulator endpoints.
$stsEndpoint = "https://sts.$Region.amazonaws.com"
$guardDutyEndpoint = "https://guardduty.$Region.amazonaws.com"
$identityJson = & aws sts get-caller-identity --profile $Profile --region $Region --endpoint-url $stsEndpoint --output json --no-cli-pager
if ($LASTEXITCODE -ne 0) {
    throw 'STS caller verification failed. No sample requested.'
}
$accountId = ($identityJson | ConvertFrom-Json).Account
if ($accountId -cne $ExpectedAccountId) {
    throw "AWS account mismatch: expected $ExpectedAccountId, received $accountId. No sample requested."
}

$detectorsJson = & aws guardduty list-detectors --profile $Profile --region $Region --endpoint-url $guardDutyEndpoint --output json --no-cli-pager
if ($LASTEXITCODE -ne 0) {
    throw 'GuardDuty detector lookup failed. No sample requested.'
}
$detectorIds = @(($detectorsJson | ConvertFrom-Json).DetectorIds)
if ($detectorIds.Count -ne 1 -or $detectorIds[0] -notmatch '^[a-f0-9]{32}$') {
    throw "Expected one GuardDuty detector in account=$accountId region=$Region. No sample requested."
}
$detectorId = $detectorIds[0]
$detectorJson = & aws guardduty get-detector --detector-id $detectorId --profile $Profile --region $Region --endpoint-url $guardDutyEndpoint --output json --no-cli-pager
if ($LASTEXITCODE -ne 0) {
    throw 'GuardDuty status lookup failed. No sample requested.'
}
if (($detectorJson | ConvertFrom-Json).Status -cne 'ENABLED') {
    throw "GuardDuty is not ENABLED in account=$accountId region=$Region. No sample requested."
}

Write-Host "AWS sandbox profile=$Profile account=$accountId region=$Region detector=$detectorId"
Write-Host "Request exactly one sample type: $FindingType"
$confirmation = Read-Host "Type '$accountId/$Region' to request this sample (anything else cancels)"
if ($confirmation -cne "$accountId/$Region") {
    Write-Host 'Cancelled. No sample requested.'
    return
}

$requestedAt = [DateTime]::UtcNow.ToString('o')
& aws guardduty create-sample-findings --detector-id $detectorId --finding-types $FindingType --profile $Profile --region $Region --endpoint-url $guardDutyEndpoint --output json --no-cli-pager
if ($LASTEXITCODE -ne 0) {
    throw 'GuardDuty sample request failed. Ingestion has not passed.'
}
Write-Host "Sample request accepted at $requestedAt for account=$accountId region=$Region."
Write-Host 'PENDING: ingestion is not verified. Follow the README to correlate the sample finding ARN with a new alertchain-alerts record.'
Write-Host 'A successful script exit confirms only the sample request, not EventBridge/Lambda/DynamoDB delivery.'
