[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z][A-Za-z0-9-]{0,127}$')]
    [string]$StackName,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{12}$')]
    [string]$ExpectedAccountId,

    [ValidatePattern('^[a-z]{2}(-[a-z]+)+-\d+$')]
    [string]$Region = 'us-east-2'
)

$ErrorActionPreference = 'Stop'
Get-Command aws, sam -ErrorAction Stop | Out-Null

# Use the same configured credential chain for STS and SAM; do not inject credentials.
$identityJson = & aws sts get-caller-identity --region $Region --output json --no-cli-pager
if ($LASTEXITCODE -ne 0) {
    throw 'STS caller verification failed. No deployment was started.'
}
$accountId = ($identityJson | ConvertFrom-Json).Account
if ($accountId -cne $ExpectedAccountId) {
    throw "AWS account mismatch: expected $ExpectedAccountId, received $accountId. No deployment was started."
}

Write-Host "Deploying account=$accountId region=$Region stack=$StackName"
$templatePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'template.yaml'
& sam deploy --template-file $templatePath --stack-name $StackName --region $Region --capabilities CAPABILITY_IAM --resolve-s3 --confirm-changeset --no-fail-on-empty-changeset
if ($LASTEXITCODE -ne 0) {
    throw "sam deploy failed with exit code $LASTEXITCODE."
}
