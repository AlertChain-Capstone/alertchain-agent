# Local Floci verification — November 25, 2026

The current combined application passed local ingestion, storage, API, and browser
verification. Model-dependent behavior was checked with Floci's placeholder and a
deterministic local substitute, **not actual Nova Micro inference**. No real AWS
deployment or Bedrock request was made.

## Source and preservation

- Tested branch: `feature/fa1-arch_2`, HEAD
  `16256911cb7ac0d61c2c2a3c12f5497d6194b492`, including pre-existing uncommitted work.
- Current remote main, independently confirmed with `git ls-remote`:
  `14f4624fdc849d34ea7dd76382927699108f83a7` (PR #19).
- Mattias's FA3 changes are `0d1f2af`, `a45b174`, and `0fadb3a`.
  They are already included in the tested integration branch. HEAD and remote main
  differ by two integration commits versus main's merge commit; this was not a
  pristine main checkout.
- No applicable `AGENTS.md` was found in the repository or ancestor directories.
- The initial workspace had six modified and four untracked files. They were
  preserved. No branch switch, fetch, reset, cleanup, commit, push, merge, release
  tag, Jira update, or shared-tracker update was performed.
- Existing container `alertchain-floci`, stack `alertchain-local`, tables and volume
  were reused. Docker's Linux engine stopped during initial inspection; Docker
  Desktop and the same Floci container were restarted without recreating storage.

## Defect fixed in this task

`scripts/floci-j11.py deploy` rejected a repeat deployment when Floci returned a
FAILED change set with the explicit reason that the submitted information did not
contain changes. The packaged application was already deployed.

The helper now skips change-set execution only for that explicit empty-update
response and continues stack, table identity, full-record preservation, CORS and
health checks. Other failed/pending responses still fail. Existing removal and
replacement guards remain in force. Following publication review, the no-change
path also accepts a healthy `CREATE_COMPLETE` stack. Executed updates still require
`UPDATE_COMPLETE`. The success message reports the actual stack status.

Eleven offline regression tests now cover the predicate and real `deploy()` control
flow with mocked service responses and temporary fixture files. They exercise both
healthy no-change statuses, normal update polling, rejection of `CREATE_COMPLETE`
after executing an update, unhealthy stacks, unrelated change-set failures,
removals/replacements, table identity, complete record values, and reaching CORS/health
checks. No repository files or live resources are used as test fixtures.

The initial verification added the no-op handling, `scripts/tests/test_floci_deployment.py`,
and this report. The publication-review follow-up completed that fix and corrected
the current setup documentation. Earlier pending model/configuration edits are
preserved and remain separate from these fixes.

## Starting and final checks

| Check | Result |
| --- | --- |
| Backend pytest | 363 passed again after the publication-review correction, including the eight model/profile-boundary tests. One Starlette/httpx deprecation warning. |
| Frontend unit tests | 37 passed |
| ESLint | Passed |
| Production build | Passed initially and again during local frontend deployment |
| Offline SAM validation with lint | Passed, exit 0 |
| Offline SAM translation/model contract | 1 passed again after the publication-review correction |
| Deployment-helper regression tests | 11 passed after the publication-review correction; service responses are mocked |
| Publication documentation checks | Passed: superseded snapshot notice, account-ID removal, stub-only setup command blocks, profile restriction wording and local links |
| Unrelated pending-file preservation | Six untouched pending files retained their publication-review SHA-256 hashes |
| Mock Playwright suite | 11 passed |
| Intercepted HTTP contract/UI Playwright suite | 21 passed; these responses are mocked, not Floci evidence |
| Corrected local deployment | Passed; unchanged stack accepted, preservation/CORS/health checks completed |
| `git diff --check` | Passed; existing line-ending notices only |

System Python initially lacked pytest. The old temporary validation environment
was incomplete. A fresh isolated environment was installed under ignored
`test-results/venv-verify`; application requirements and lockfiles were unchanged.
An exploratory unittest discovery was not an appropriate runner for these pytest
tests and produced import errors; it was replaced by the documented pytest command.
Sandbox restrictions initially blocked package downloads, Docker access, and SAM
metadata writes. Those checks were rerun with the required host access. SAM first
reported a valid template but exited on its telemetry metadata permission error;
the final offline run completed successfully. Initial sandbox browser processes
also lingered at teardown; host-access runs completed successfully.

## Publication-review corrections

The November 16 architecture snapshot is now explicitly superseded historical
documentation, links to current setup/verification, and omits its real AWS account
ID. Startup instructions use API totals and filters without fixed alert counts.
README first-time setup explicitly selects the Floci model endpoint; existing-stack
updates use the preservation-aware helper without a real profile. The local setup
and startup guides lead with runnable stub commands and expected placeholder behavior.

Future real-model setup is separate. Documentation now states that the existing
geographic/global profile guard is unconditional when a profile is supplied; it
does not detect project policy or automatically permit another account/environment.
The guard, intended model, Region and IAM scope were not changed or bypassed.

This follow-up reran the deployment-helper tests, complete backend suite, offline
SAM translation/model contract, and whitespace checks. Frontend/browser checks and
the running Floci results below are retained evidence from the earlier verification,
not new runs after these helper/documentation edits. No additional deployment,
ingestion, investigation, real AWS or Bedrock call was made during this follow-up.
The `CREATE_COMPLETE` edge case is verified offline, not by resetting the preserved
stack. No remaining blocker was found for publishing this scoped local-Floci fix;
actual Nova Micro inference and model quality remain unverified.

## Running deployment results

- Floci 2.4.0 runs at `http://127.0.0.1:4566`, Region `us-east-2`.
- API: `http://f863b23b16.execute-api.localhost.floci.io:4566`.
- Website: `http://alertchain-frontend-local.s3-website-us-east-2.localhost.floci.io:4566/`.
- API Gateway, one shared Python 3.12 backend Lambda, all four DynamoDB tables and
  expected indexes were inspected. Both enabled EventBridge rules target the
  shared backend; GuardDuty and selected CloudTrail patterns were checked.
- Bedrock, DynamoDB and Lambda self-invocation endpoints are
  `http://host.docker.internal:4566`. Real Bedrock credential fields are empty.
  Model ID remains `us.amazon.nova-micro-v1:0`; no fallback model was selected.
- Backend packaging/change-set submission found the current package and parameters
  unchanged. The corrected helper verified the existing deployment rather than
  forcing a code update. Floci's CORS configuration was reapplied by the existing
  helper. The frontend was rebuilt in live mode and all five production assets
  uploaded to the existing local bucket, retaining old hashed assets.
- Health returned 200 and `{"status":"ok"}`.
- Fresh synthetic GuardDuty, CreateAccessKey and StopLogging fixtures passed
  EventBridge → Lambda ingestion → DynamoDB → alerts API. Each was absent before
  publication and present afterward. No attack or real-account activity was used.
- Alert pagination, ordering, filters, exact raw-event fixture fidelity, details,
  missing-record errors and invalid-query errors passed. Acknowledged duplicate
  Lambda delivery returned `duplicate` and preserved each complete stored item.
- Association checks passed for none, one association, and ambiguity. Only the
  two ownership-labelled synthetic association records were removed afterward.
- Actual Edge browser traffic used the local API with mock mode disabled. Alert
  pagination/filtering/details/raw JSON, website assets and CORS passed without
  unexpected browser errors or failed requests. Stored report navigation,
  dashboard, incident filtering, evidence/raw-data comparison and the existing
  investigation/report handoff passed.
- A new browser-started investigation, `INV-351fbb252f45`, returned 202, dispatched
  through local Lambda, persisted, and polled to `NEEDS_HUMAN_REVIEW` with zero
  evidence and no conclusion. This establishes stub plumbing, not useful inference.
- Actual Ask API/UI checks passed blank-question validation, grounded-answer
  reconstruction, citation inspection, cross-incident limitation, rejection of an
  unknown citation, injected 503, retained draft and successful retry. Only the
  model dependency was substituted; browser routes/API/storage were real local
  services. The substitute had no outbound model calls. The full original Lambda
  environment was restored and its disposable container stopped/removed.

All pre-existing table records were compared in full and preserved:

| Table | Before | Final |
| --- | ---: | ---: |
| Alerts | 17 | 20 |
| Investigations | 4 | 5 |
| Evidence | 3 | 3 |
| Incidents | 1 | 1 |

The three new alerts and one stub investigation are retained as local test data.
Alert IDs: `e8888ced-5324-5963-ab21-c8c6338106c9`,
`173f1576-2581-5749-84d1-056b733c06fa`,
`d5a252c0-d124-5aa9-aca2-fee71175a228`.

## Repeat locally

Run from the repository in PowerShell with Docker Desktop running. These commands
target the existing Floci deployment and deliberately omit a Bedrock profile:

```powershell
docker start alertchain-floci
python -B scripts/floci-j11.py inspect
python -B scripts/floci-j11.py deploy --origin http://127.0.0.1:5173
powershell.exe -NoProfile -File .\scripts\deploy-floci-frontend.ps1
python -B scripts/floci-j11.py verify --origin http://127.0.0.1:5173
$env:PW_CHANNEL = 'msedge'
node scripts/verify-floci-browser.mjs
# Optional: creates and retains one new local stub investigation.
node scripts/verify-floci-browser.mjs --investigate
```

`verify` creates three fresh synthetic alerts on each run. For read/API/duplicate
checks against this run's existing fixtures instead, use:

```powershell
python -B scripts/floci-j11.py verify --origin http://127.0.0.1:5173 --alert-ids e8888ced-5324-5963-ab21-c8c6338106c9,173f1576-2581-5749-84d1-056b733c06fa,d5a252c0-d124-5aa9-aca2-fee71175a228
```

Tests in the prepared environment:

```powershell
.\test-results\venv-verify\Scripts\python.exe -B -m pytest backend/tests -q -p no:cacheprovider
python -B -m unittest discover -s scripts/tests -p test_floci_deployment.py -v
& 'C:\Program Files\Amazon\AWSSAMCLI\runtime\python.exe' -B scripts/tests/test-bedrock-model-template.py
$env:SAM_CLI_TELEMETRY = '0'
$env:AWS_EC2_METADATA_DISABLED = 'true'
$env:AWS_DEFAULT_REGION = 'us-east-2'
sam validate --template-file template.yaml --lint
npm test
npm run lint
npm run build
$env:PW_CHANNEL = 'msedge'
$env:VITE_USE_MOCK = 'true'
npm run test:e2e
npm run test:fa1-live
```

For a fresh test environment, create a venv and install `pytest boto3 httpx` plus
`-r backend/requirements.txt`. The existing Linux Lambda vendor directory was
already populated and exercised by the running deployment; rerun
`scripts/vendor-backend-deps.ps1` only when installing or changing Lambda dependencies.

## Evidence and limits

Ignored evidence is retained locally, including event payloads; do not publish raw
HAR/table files without reviewing their contents:

- `test-results/floci-verification-20261125/`: FA3 actual-browser summary, network
  log, HAR, screenshots, diagnostic substitute/harness, safe resource metadata and
  final preservation summary. The diagnostic harness is a local, snapshot-based
  reproduction aid, not a portable repository test runner.
- `test-results/integration/integration-6bbae5eb-5790-4b1e-b603-64c9c37475f1/`:
  read-only deployed alert browser checks.
- `test-results/integration/integration-a13c4a49-3273-485f-81ce-1c7c1329c2f3/`:
  final deployed browser/stub investigation and owned-record manifest.
- `%TEMP%\alertchain-j11-lgsqxl6i`: corrected deployment/package/change set and
  complete before/after table comparisons.
- `%TEMP%\alertchain-j11-k_siwom1`: ingestion/API/duplicate/association verification.

No remaining local product blocker was found in the verified paths. Source
connection controls and monitored-event editing remain simulated as implemented.
Floci's Bedrock placeholder cannot establish a useful investigation, create a
model-generated incident chain, or answer-quality baseline. Actual Nova Micro
inference, model quality and real AWS service parity remain unverified. The
pre-existing real-profile/cross-Region restriction was retained, not bypassed.

This is sufficient to begin benchmark/baseline implementation against the local
ingestion, persistence, API and UI contracts. It is not a real-model benchmark
baseline or a complete model-backed end-to-end pass. No benchmark replay, wider
CloudTrail coverage, actor baseline, graph change or Stratus execution was added.
All source changes remain uncommitted for review.
