# J11 pull request validation — November 15, 2026

The feature branch is `feature/fa1-arch`. Its four implementation commits through
`450b27b` were already committed, with no tracked or untracked changes and no unfinished
merge/rebase. Local branch `backup/j11-before-main-2026-11-15` preserves that checkpoint.
No applicable AGENTS.md files were found in the repository or its ancestor directories.

After fetching all origin branches, the remote main tip was independently confirmed as
`c6da7ccb78155dfe2ac6fe7ce81042b11539e340` (PR #12, Harneet's AWS agent template).
It is already an ancestor of J11. `git merge origin/main` returned `Already up to date.`;
there was no merge commit or textual conflict to resolve.

## Compatibility review

- Harneet's DynamoDB investigation, evidence, incident, and security-event adapters and
  domain contracts are unchanged. J11's incident lookup remains a separate, lazy read port.
- The existing alert table keys and time/principal indexes remain intact. J11 adds read
  permissions for the time index and incident scans without removing investigation IAM.
- The shared handler implements health, ingestion, and J11 alert reads. Main already
  declares investigation HTTP routes and supplies launcher/runtime code, but does not
  dispatch investigation HTTP requests or investigation jobs from `handler.handler`.
  These are pre-existing integration gaps, not working routes established by the template.
- The Lambda runtime supplies boto3; alert reads do not require FastAPI. The existing
  investigation API uses FastAPI, and main has no packaged requirements manifest for it.
  Finishing investigation dispatch also requires dependency packaging. This PR does not
  claim the deployed investigation application is complete.
- FA1 supports `VITE_API_URL` and legacy `VITE_API_BASE_URL`; FA2 still uses the latter.
  Explicit live alert failures remain errors, and live FA1 handoffs to fixture-backed
  investigation/report screens remain disabled. Mock cross-area handoffs work.
- CORS retains GET/POST/OPTIONS with explicit origins. Floci scripts and deployment
  scripts were inspected but not executed against a service; no deployment occurred.
- Each Playwright suite now uses its own output directory to prevent trace artifacts
  colliding with the mock suite when both commands run concurrently.

## Checks performed

Python dependencies were installed in an isolated OS temporary virtual environment:
pytest 9.2.0, boto3/botocore 1.44.3, FastAPI 0.163.1, httpx 0.28.1, cfn-lint 1.60.1.
No repository dependencies or lockfiles were changed for that environment.

| Check | Result |
| --- | --- |
| `python -B -m pytest backend/tests -q -p no:cacheprovider` using the temporary environment | 288 passed; one Starlette/httpx deprecation warning |
| `npm test` | 26 passed |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `npm run test:e2e -- --output=test-results/mock-review` with mock mode and Edge | 11 passed |
| Live Playwright suite with Edge, isolated output and temporary port 5181 configuration | 12 passed |
| `npm run test:optional` | All three builds with one optional area absent passed |
| `powershell.exe -NoProfile -File scripts/tests/test-aws-guardduty-ingestion.offline.ps1` | Syntax and all 15 mocked scenarios passed |
| `cfn-lint template.yaml` using the temporary environment | Passed, including local SAM transform validation; SAM CLI unavailable |
| `git diff --check origin/main...HEAD` | Passed |

The first overlapping browser runs collided in Playwright's shared artifact directory.
They are not counted as passes. The mock suite passed with separate output; the live suite
was rerun using a temporary configuration on port 5181 and a separate output directory.
Its temporary Vite server stalled during shutdown after all tests finished; terminating
only that server allowed the runner to exit successfully with all 12 tests passed.
The initial system Python lacked pytest; an attempt before dependency installation finished
had collection errors. The completed isolated environment produced the 288-test pass above.

## Limits

Browser live tests use controlled HTTP responses, and backend tests use local fakes.
They do not establish deployed AWS/Floci behavior, IAM parity, production performance,
or an end-to-end live investigation/report handoff. Historical Floci evidence in the
J11 API document is from the earlier checkpoint and was not rerun here.
No AWS or Floci deployment, Visual Paradigm diagram modification, or teammate messaging
was performed. Diagram updates remain paused and tracked separately.
