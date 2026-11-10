[CmdletBinding()]
param()

# No AWS CLI or Pester installation is needed. The local aws function shadows
# the executable for every call made by the script under test.
$ErrorActionPreference = 'Stop'
$target = Join-Path (Split-Path -Parent $PSScriptRoot) 'test-aws-guardduty-ingestion.ps1'
$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($target, [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
Write-Output 'PASS PowerShell syntax'

function aws {
    $a = @($args)
    [void]$global:AlertChainGuardDutyOfflineState.Calls.Add($a)
    foreach ($flag in @('--profile', '--region', '--endpoint-url')) {
        if ($a -notcontains $flag) { throw "Mock assertion: missing $flag" }
    }
    if ($a[([array]::IndexOf($a, '--profile') + 1)] -cne 'sandbox-test') {
        throw 'Mock assertion: wrong profile'
    }
    if ($a[([array]::IndexOf($a, '--region') + 1)] -cne $global:AlertChainGuardDutyOfflineState.Region) {
        throw 'Mock assertion: wrong region'
    }
    $service = if ($a[0] -eq 'sts') { 'sts' } else { 'guardduty' }
    if ($a[([array]::IndexOf($a, '--endpoint-url') + 1)] -cne "https://$service.$($global:AlertChainGuardDutyOfflineState.Region).amazonaws.com") {
        throw 'Mock assertion: wrong public AWS endpoint'
    }
    # Set in the caller-visible scope just like a native process exit code.
    $global:LASTEXITCODE = 0
    switch ($a[1]) {
        'get-caller-identity' {
            if ($global:AlertChainGuardDutyOfflineState.Case -eq 'sts-error') { $global:LASTEXITCODE = 1; return }
            if ($global:AlertChainGuardDutyOfflineState.Case -eq 'account-mismatch') { return '{"Account":"999999999999"}' }
            return '{"Account":"123456789012"}'
        }
        'list-detectors' {
            if ($global:AlertChainGuardDutyOfflineState.Case -eq 'list-error') { $global:LASTEXITCODE = 1; return }
            if ($global:AlertChainGuardDutyOfflineState.Case -eq 'no-detector') { return '{"DetectorIds":[]}' }
            return '{"DetectorIds":["0123456789abcdef0123456789abcdef"]}'
        }
        'get-detector' {
            if ($global:AlertChainGuardDutyOfflineState.Case -eq 'get-error') { $global:LASTEXITCODE = 1; return }
            if ($global:AlertChainGuardDutyOfflineState.Case -eq 'disabled') { return '{"Status":"DISABLED"}' }
            return '{"Status":"ENABLED"}'
        }
        'create-sample-findings' {
            if (-not $global:AlertChainGuardDutyOfflineState.Prompted) { throw 'Mock assertion: generation before confirmation' }
            $index = [array]::IndexOf($a, '--finding-types')
            if ($index -lt 0 -or $a[$index + 1] -cne 'UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS' -or $a[$index + 2] -ne '--profile') {
                throw 'Mock assertion: expected exactly one explicit finding type'
            }
            if ($global:AlertChainGuardDutyOfflineState.Case -eq 'create-error') { $global:LASTEXITCODE = 1 }
            return
        }
        default { throw "Mock assertion: unexpected AWS command: $a" }
    }
}

function Read-Host {
    $global:AlertChainGuardDutyOfflineState.Prompted = $true
    if (($global:AlertChainGuardDutyOfflineState.Calls | ForEach-Object { $_[1] }) -join ',' -cne 'get-caller-identity,list-detectors,get-detector') {
        throw 'Mock assertion: prompt before all preflight calls'
    }
    if (($global:AlertChainGuardDutyOfflineState.Messages -join ' ') -notmatch "account=123456789012 region=$($global:AlertChainGuardDutyOfflineState.Region)") {
        throw 'Mock assertion: account/region not displayed before confirmation'
    }
    if ($global:AlertChainGuardDutyOfflineState.Case -eq 'cancel') { return 'cancel' }
    return "123456789012/$($global:AlertChainGuardDutyOfflineState.Region)"
}

function Write-Host { [void]$global:AlertChainGuardDutyOfflineState.Messages.Add(($args -join ' ')) }

$script:findingType = 'UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS'
$cases = @(
    @{ Name = 'success'; Commands = 4 },
    @{ Name = 'region-override'; Commands = 4 },
    @{ Name = 'account-mismatch'; Commands = 1; Error = 'AWS account mismatch' },
    @{ Name = 'sts-error'; Commands = 1; Error = 'STS caller verification failed' },
    @{ Name = 'no-detector'; Commands = 2; Error = 'Expected one GuardDuty detector' },
    @{ Name = 'disabled'; Commands = 3; Error = 'GuardDuty is not ENABLED' },
    @{ Name = 'list-error'; Commands = 2; Error = 'GuardDuty detector lookup failed' },
    @{ Name = 'get-error'; Commands = 3; Error = 'GuardDuty status lookup failed' },
    @{ Name = 'cancel'; Commands = 3 },
    @{ Name = 'create-error'; Commands = 4; Error = 'GuardDuty sample request failed' },
    @{ Name = 'inherited-credentials'; Commands = 0; Error = 'Clear AWS_ACCESS_KEY_ID' },
    @{ Name = 'inherited-endpoint'; Commands = 0; Error = 'Clear AWS_ENDPOINT_URL overrides' },
    @{ Name = 'multiple-types'; Commands = 0; Error = 'FindingType' },
    @{ Name = 'blank-type'; Commands = 0; Error = 'FindingType' },
    @{ Name = 'whitespace-type'; Commands = 0; Error = 'FindingType' }
)
$savedEnvironment = @{}
$environmentNames = @('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_SECURITY_TOKEN', 'AWS_ENDPOINT_URL')
$environmentNames += @(Get-ChildItem Env: | Where-Object { $_.Name -like 'AWS_ENDPOINT_URL*' } | Select-Object -ExpandProperty Name)
$environmentNames = @($environmentNames | Select-Object -Unique)
foreach ($name in $environmentNames) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name)
    [Environment]::SetEnvironmentVariable($name, $null)
}
$savedExitCode = $global:LASTEXITCODE
$savedMockState = Get-Variable -Name AlertChainGuardDutyOfflineState -Scope Global -ErrorAction SilentlyContinue
try {
    foreach ($case in $cases) {
        $global:AlertChainGuardDutyOfflineState = @{
            Case = $case.Name
            Calls = New-Object System.Collections.ArrayList
            Messages = New-Object System.Collections.ArrayList
            Prompted = $false
            Region = if ($case.Name -eq 'region-override') { 'us-west-2' } else { 'us-east-2' }
        }
        $parameters = @{ Profile = 'sandbox-test'; ExpectedAccountId = '123456789012'; FindingType = $script:findingType }
        switch ($case.Name) {
            'region-override' { $parameters.Region = $global:AlertChainGuardDutyOfflineState.Region }
            'inherited-credentials' { $env:AWS_ACCESS_KEY_ID = 'dummy' }
            'inherited-endpoint' { $env:AWS_ENDPOINT_URL = 'http://127.0.0.1:4566' }
            'multiple-types' { $parameters.FindingType = 'Type:EC2/One Type:EC2/Two' }
            'blank-type' { $parameters.FindingType = '' }
            'whitespace-type' { $parameters.FindingType = '   ' }
        }
        $caught = $null
        try { & $target @parameters } catch { $caught = $_ }
        Remove-Item Env:AWS_ACCESS_KEY_ID, Env:AWS_ENDPOINT_URL -ErrorAction SilentlyContinue
        if ($case.Error) {
            if (-not $caught -or $caught.ToString() -notmatch $case.Error) {
                throw "$($case.Name): expected '$($case.Error)', received '$caught'"
            }
        } elseif ($caught) { throw "$($case.Name): unexpected error: $caught" }
        if ($global:AlertChainGuardDutyOfflineState.Calls.Count -ne $case.Commands) { throw "$($case.Name): wrong AWS call count" }
        $generations = @($global:AlertChainGuardDutyOfflineState.Calls | Where-Object { $_[1] -eq 'create-sample-findings' }).Count
        $expectedGenerations = if ($case.Name -in @('success', 'region-override', 'create-error')) { 1 } else { 0 }
        if ($generations -ne $expectedGenerations) { throw "$($case.Name): wrong sample-generation count" }
        if ($case.Name -in @('success', 'region-override') -and ($global:AlertChainGuardDutyOfflineState.Messages -join ' ') -notmatch 'PENDING: ingestion is not verified') {
            throw "$($case.Name): missing pending verification warning"
        }
        Write-Output "PASS mocked $($case.Name)"
    }
    Write-Output "PASS all $($cases.Count) offline scenarios; live AWS sandbox verification PENDING"
} finally {
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name])
    }
    $global:LASTEXITCODE = $savedExitCode
    if ($savedMockState) {
        Set-Variable -Name AlertChainGuardDutyOfflineState -Scope Global -Value $savedMockState.Value
    } else {
        Remove-Variable -Name AlertChainGuardDutyOfflineState -Scope Global -ErrorAction SilentlyContinue
    }
}
