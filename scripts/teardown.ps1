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

$identityJson = & aws sts get-caller-identity --region $Region --output json --no-cli-pager
if ($LASTEXITCODE -ne 0) {
    throw 'STS caller verification failed. No deletion was started.'
}
$accountId = ($identityJson | ConvertFrom-Json).Account
if ($accountId -cne $ExpectedAccountId) {
    throw "AWS account mismatch: expected $ExpectedAccountId, received $accountId. No deletion was started."
}

Write-Host "Teardown account=$accountId region=$Region stack=$StackName"
Write-Warning 'Deleting this stack can delete its DynamoDB tables and all their data.'
$confirmation = Read-Host "Type the stack name '$StackName' to continue (anything else cancels)"
if ($confirmation -cne $StackName) {
    Write-Host 'Cancelled. No deletion was started.'
    return
}

# Keep SAM's own interactive confirmation as well.
& sam delete --stack-name $StackName --region $Region
if ($LASTEXITCODE -ne 0) {
    throw "sam delete failed with exit code $LASTEXITCODE."
}
