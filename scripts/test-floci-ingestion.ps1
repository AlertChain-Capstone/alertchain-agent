[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

try {
    $python = (Get-Command python -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $aws = (Get-Command aws -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $repoRoot = Split-Path -Parent $PSScriptRoot

    # Python imports the real normalizers; all AWS calls use the CLI below.
    # Credentials are confined to the child process, including when dot-sourced.
    @'
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid

if sys.version_info < (3, 11):
    print('FAIL prerequisites: Python 3.11 or newer is required', flush=True)
    sys.exit(1)

sys.dont_write_bytecode = True
repo = Path(sys.argv[1])
aws_executable = sys.argv[2]
sys.path.insert(0, str(repo / 'backend'))
from ingestion import CloudTrailNormalizer, FindingNormalizer

environment = os.environ.copy()
environment.update(
    AWS_ACCESS_KEY_ID='test',
    AWS_SECRET_ACCESS_KEY='test',
    AWS_SESSION_TOKEN='test',
    AWS_EC2_METADATA_DISABLED='true',
    AWS_MAX_ATTEMPTS='1',
    AWS_PAGER='',
    AWS_ENDPOINT_URL='http://127.0.0.1:4566',
)
for name in ('AWS_PROFILE', 'AWS_DEFAULT_PROFILE'):
    environment.pop(name, None)


def aws(*arguments):
    command = [
        aws_executable, *arguments,
        '--endpoint-url', 'http://127.0.0.1:4566', '--region', 'us-east-2',
        '--no-cli-pager', '--output', 'json',
        '--cli-connect-timeout', '3', '--cli-read-timeout', '5',
    ]
    response = subprocess.run(
        command, env=environment, capture_output=True, text=True, timeout=12,
    )
    if response.returncode:
        raise RuntimeError(response.stderr.strip() or response.stdout.strip())
    # CLI GetItem can produce no output when the item does not exist.
    return json.loads(response.stdout) if response.stdout.strip() else {}


cases = [
    ('GuardDuty finding', 'guardduty_finding.json', FindingNormalizer()),
    ('CloudTrail CreateAccessKey', 'cloudtrail_create_access_key.json', CloudTrailNormalizer()),
    ('CloudTrail StopLogging', 'cloudtrail_stop_logging.json', CloudTrailNormalizer()),
]

try:
    stacks = aws('cloudformation', 'describe-stacks', '--stack-name', 'alertchain-local')
    stack = next(s for s in stacks.get('Stacks', []) if s['StackName'] == 'alertchain-local')
    print(f"Stack: alertchain-local ({stack['StackStatus']}); Floci only", flush=True)
except Exception as error:
    for label, _, _ in cases:
        print(f'FAIL {label}: local stack preflight failed: {error}', flush=True)
    sys.exit(1)

failures = 0
with tempfile.TemporaryDirectory(prefix='alertchain-j10-') as scratch:
    scratch = Path(scratch)
    for label, fixture, normalizer in cases:
        alert_id = 'not calculated'
        try:
            event = json.loads((repo / 'backend/tests/fixtures' / fixture).read_text())
            fresh_id = str(uuid.uuid4())
            identity_key = 'arn' if event['source'] == 'aws.guardduty' else 'eventID'
            if identity_key == 'arn':
                event['detail']['id'] = fresh_id
                event['detail']['arn'] = (
                    event['detail']['arn'].rsplit('/finding/', 1)[0] + '/finding/' + fresh_id
                )
            else:
                event['detail']['eventID'] = fresh_id
            alert = normalizer.normalize(event)
            alert_id = alert.id
            key_file = scratch / 'key.json'
            key_file.write_text(json.dumps({'alertId': {'S': alert_id}}), encoding='utf-8')

            def get_item():
                return aws(
                    'dynamodb', 'get-item', '--table-name', 'alertchain-alerts',
                    '--key', 'file://' + str(key_file), '--consistent-read',
                ).get('Item')

            if get_item():
                raise RuntimeError('expected alert ID already exists before publishing')

            entries_file = scratch / 'entries.json'
            entries_file.write_text(json.dumps([{
                'Source': event['source'],
                'DetailType': event['detail-type'],
                'Detail': json.dumps(event['detail']),
                'EventBusName': 'default',
            }]), encoding='utf-8')
            published = aws('events', 'put-events', '--entries', 'file://' + str(entries_file))
            entries = published.get('Entries', [])
            if (published.get('FailedEntryCount') != 0 or len(entries) != 1
                    or entries[0].get('ErrorCode') or not entries[0].get('EventId')):
                raise RuntimeError('EventBridge publish failed: ' + json.dumps(published))
            print(f"Published {label}: EventId={entries[0]['EventId']}; FailedEntryCount=0", flush=True)

            deadline = time.monotonic() + 15
            while True:
                item = get_item()
                if item:
                    stored_identity = item.get('rawEvent', {}).get('M', {}).get(identity_key, {}).get('S')
                    if stored_identity != event['detail'][identity_key]:
                        raise RuntimeError('stored rawEvent source ID does not match the published event')
                    if (item.get('alertId', {}).get('S') != alert_id
                            or item.get('eventName', {}).get('S') != alert.event_name):
                        raise RuntimeError('stored alert ID or event name does not match the normalizer')
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError('expected record absent after 15-second delivery retry window')
                time.sleep(1)
            print(f'PASS {label}: alertId={alert_id} (absent before publish, verified afterward)', flush=True)
        except Exception as error:
            failures += 1
            print(f'FAIL {label}: alertId={alert_id}: {error}', flush=True)

print(f'Result: {len(cases) - failures} passed, {failures} failed', flush=True)
sys.exit(1 if failures else 0)
'@ | & $python - $repoRoot $aws
    exit $LASTEXITCODE
}
catch {
    Write-Host "FAIL smoke test: $($_.Exception.Message)"
    exit 1
}
