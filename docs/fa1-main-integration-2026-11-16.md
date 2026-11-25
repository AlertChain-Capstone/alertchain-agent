# J11 and main integration — November 16, 2026

## History and preservation

The starting worktree was clean, with no staged or non-ignored untracked changes.
Origin was fetched. `origin/main` at `7c2a43b7f680c4df406ac6e3a6b13b911f849507`
already contains all J11 work through `19fa4414fdfa79a385c93ec6d02a24b7c2e2fbdf`.
The new branch `feature/fa1-arch_2` fast-forwarded by 12 commits without conflicts.
Its inherited history includes PR #13 (J11), #14 (HTTP/job dispatch), #15 (live
Investigate), #16 (local Bedrock endpoint), and #17/#18 (real Bedrock credentials
and live frontend). The AWS preparation branch was not merged.

These original branch pointers remain unchanged:

| Branch | Commit |
| --- | --- |
| `feature/fa1-arch` | `19fa4414fdfa79a385c93ec6d02a24b7c2e2fbdf` |
| `feature/aws-deployment` | `76653764f1666a0738a513c3b3d277d2ff28a58f` |
| `main` | `c6da7ccb78155dfe2ac6fe7ce81042b11539e340` |

Backup refs: `backup/fa1-integration-start-20261116` and
`backup/main-integration-source-20261116`. External backup:
`C:\Users\makil\AppData\Local\Temp\alertchain-integration-20261116-101524`.
It contains a starting Git bundle, branch/status inventory, original ignored
configuration, original/final table snapshots, original Lambda configuration and
code ZIP, stack template/parameters, API configuration, and private logs. Prior
local AGENTS.md rules remain in the preceding Git-preservation backup. No credentials,
login configuration, vendor packages, database snapshots, or generated browser artifacts
were staged. The ignored `.env.local` remains byte-identical to its starting copy.

## Actual application flow and earlier gaps

| Flow | Reviewed implementation |
| --- | --- |
| Ingestion | Local EventBridge rules target the shared Lambda. GuardDuty/selected CloudTrail envelopes dispatch to normalizers and conditional `store_if_absent`. Duplicate deliveries preserve the original item; raw event detail is retained. No new ingestion fixtures were published in this verification. |
| Alert browsing | API Gateway -> handler -> AlertController/AlertService -> local DynamoDB. List filters/pagination run on the backend. Details, raw events, and incident association are separate GETs. Optional read failures do not hide normalized details. |
| Investigation request | POST `/investigations` validates an existing alert, persists RUNNING, launches work, and returns 202. GET `/investigations/{id}` returns state, steps, evidence, and conclusion. A new controller directly adapts the FastAPI router to API Gateway v2 events. |
| Background work | LambdaSelfInvokeLauncher calls the existing local Lambda with InvocationType Event and an `investigation_job` payload. The shared handler dispatches it to the runtime/orchestrator. The previous missing HTTP/job dispatch is fixed. |
| Bedrock and tools | Bedrock Runtime `Converse`, not Bedrock Agent Runtime/InvokeAgent. The application's own loop runs get_related_events, check_actor_baseline, and create_incident; it stores steps/evidence and validates cited final answers. Six model turns maximum, 600 output tokens per turn. Baselines remain empty; tools read locally stored alerts, not real GuardDuty/CloudTrail/IAM. |
| Frontend handoff | FA1 Investigate passes the real alert into FA2, which POSTs and polls until terminal status. A refreshed investigation URL can reload by ID. The previous disabled investigation handoff is fixed. |
| Incident/report handoff | Association works from local incident storage. FA3 still imports fixtures, with no live incident/report retrieval endpoint. Open incident for a live alert remains deliberately disabled. Live attack-chain graph mapping and durable closeout remain incomplete. |

## Fixes made on this integration branch

1. FA2 now follows FA1's `VITE_API_URL` precedence over the legacy alias, with trailing
   slash normalization. The static build forces both aliases to the discovered local API.
   A regression test covers conflicting aliases so alert and investigation requests cannot
   silently use different backends.
2. FA2 fetches the alert list only on its active home screen and no longer renders a
   hidden duplicate screen. State and the imperative FA1 handoff ref remain mounted.
   This repairs three browser test failures exposed in updated main's behavior.
3. Added `BedrockModelId` and `--bedrock-model-id`, defaulting the local deployment to
   `amazon.nova-lite-v1:0`. The local helper rejects geographic/global cross-Region
   profile prefixes. No table definition changed. Existing generic SDK defaults and
   AWS IAM examples still reference Nova Micro; no AWS deployment is validated here.
4. Restricted Lambda vendor-path injection to Linux Python 3.12. After Linux wheels
   were packaged, the previous unconditional path injection broke Windows Python 3.11
   test collection. Host tests now use their own installed dependencies; Lambda loads
   the packaged Linux wheels. Both environments were verified.
5. Added `scripts/verify-floci-browser.mjs` for actual browser/DynamoDB comparison,
   HAR/screenshots, guarded model invocation, and ownership-marked association checks.
   Corrected stale setup guidance and added reproducible startup instructions.

## Deployment and data results

Floci 2.4.0 container `alertchain-floci`, volume `alertchain-floci-data`, stack
`alertchain-local`, API `f863b23b16`, and Lambda `alertchain-backend` were reused.
Local UPDATE change sets modified BackendFunction only, with Replacement False.
No storage resource was removed/replaced. CORS allows `http://127.0.0.1:5182` and
the existing local S3 website. The production frontend was built with mock mode
disabled and uploaded to that existing bucket, preserving old hashed assets.

| Table | Starting records | Final records |
| --- | ---: | ---: |
| `alertchain-alerts` | 17 | 17 |
| `alertchain-investigations` | 0 | 0 |
| `alertchain-evidence` | 0 | 0 |
| `alertchain-incidents` | 0 | 0 |

Consistent final scans equal the original records, including every field/raw event.
The 14 original alerts were identified by stored creation timestamps before November 15;
the other three also predated this session. One disposable stub investigation,
`INV-653b76dc0f3a`, and two uniquely marked association rows were archived and removed
by exact ownership keys. No original case was overwritten, no original record or
resource was deleted, and no broad cleanup command was used.

## Validation

| Check | Result |
| --- | --- |
| Backend pytest | 318 passed; one existing Starlette/httpx deprecation warning |
| Frontend unit tests | 29 passed, including the new configuration regression test |
| ESLint, Vite production build, whitespace | Passed |
| Prototype browser suite | 11 passed |
| Live-contract browser suite | Three initial failures from hidden FA2 loading/fetching; 14 passed after the fix |
| Dependency packaging | FastAPI/Pydantic and transitives installed as Linux x86_64 Python 3.12 wheels under ignored backend/vendor; imports checked in an ephemeral Lambda Python 3.12 container with networking disabled |
| Offline SAM transform | Passed: four unchanged table definitions, one Lambda, seven API paths |
| Local update/CORS/health | Passed; no removals/replacements; health 200 |
| Actual browser alert reads | All 17 IDs rendered in exact server order across three pages; fields/timestamps matched DynamoDB; case-insensitive combined filter matched five StopLogging alerts; raw JSON matched stored data |
| Actual browser association | none -> associated -> ambiguous -> none, using only two owned disposable incident rows; live report action stayed disabled |
| HTTP/job dispatch | Actual browser POST returned 202; browser GETs observed the worker's terminal state stored in local DynamoDB |
| Floci stub investigation | NEEDS_HUMAN_REVIEW, zero evidence, null conclusion; placeholder output is not a successful agent investigation |
| Real Bedrock investigation | User explicitly skipped the charged test after one approval question. Zero real-model invocations; completion and analysis quality unverified |
| Browser console/network | No page errors, console errors, or failed requests in actual Floci verification |
| Backend logs | Local CloudWatch query returned no events (logging limitation). Floci container logs were privately archived; inspected window had no ERROR/WARN/Traceback/ExpiredToken/AccessDenied entries. Empty logs do not prove real Bedrock execution. |

The initial live-contract failures are present in fetched main behavior, not merge
conflicts. Initial restricted test-server teardown hung; the authorized rerun exited
normally with both suites passing. The initial dependency download hit sandbox network
restrictions and then succeeded with authorized package access. Pip's host-environment
resolver warnings do not establish a problem in the isolated Linux vendor target;
that target's imports were tested. No dependencies were installed into the test venv.

Ignored evidence directories:

- `test-results/integration/integration-58a2429d-645c-4dea-8867-b42ae58a1cd0/` — stub network/worker result and cleanup manifest.
- `test-results/integration/integration-93f710be-0ff9-48f0-996c-01a1a5d61ff6/` — real-endpoint-configured read/association checks, HAR, screenshots, and ownership cleanup manifest; no real invocation.
- `test-results/integration/integration-ec23852c-fc81-48ab-be84-dcfcce86c4b3/` — final read-only browser run after the vendor-path fix was deployed; all API requests 200 and all alerts preserved.

The external backup contains `preservation-result.json`, `offline-sam-validation.json`,
and `log-review.json`. Local deployment evidence is also under OS temp directories
prefixed `alertchain-j11-`; credential parameter files there must remain private.
`deployed-code-verification.json` confirms that the downloaded final Lambda package
contains the exact current handler and Linux native dependency, with both local
service endpoints intact. The last local update evidence is `alertchain-j11-yq9n110g`.

## Effective configuration and AWS boundary

DynamoDB, API Gateway, Lambda/self-invocation, CloudFormation packaging/deployment,
S3 website/assets, and service logging run locally in Floci. Host service commands
are endpoint-pinned to loopback and use dummy credentials. No AWS infrastructure
was created or updated, no paid features were activated, and nothing was pushed.

Only the prepared model client can contact real AWS:

| Setting | Effective value/source |
| --- | --- |
| `BEDROCK_REGION` | `us-east-2`, confirmed from the profile and regional model metadata; also confirm selected Region in AWS Settings |
| `BEDROCK_MODEL_ID` | `amazon.nova-lite-v1:0` |
| `BEDROCK_ENDPOINT_URL` | `https://bedrock-runtime.us-east-2.amazonaws.com` |
| `BEDROCK_AWS_ACCESS_KEY_ID`, `BEDROCK_AWS_SECRET_ACCESS_KEY`, `BEDROCK_AWS_SESSION_TOKEN` | Temporary credentials exported from the user's refreshed `alertchain` login into the local Lambda only; never printed or committed |
| `DYNAMODB_ENDPOINT_URL`, `LAMBDA_ENDPOINT_URL` | `http://host.docker.internal:4566` |
| Table variables | `ALERTS_TABLE_NAME`, `INVESTIGATIONS_TABLE_NAME`, `EVIDENCE_TABLE_NAME`, `INCIDENTS_TABLE_NAME` point to the existing four local tables |
| Frontend | `VITE_USE_MOCK=false`; both API aliases target `http://f863b23b16.execute-api.localhost.floci.io:4566` |

No Bedrock agent ID/alias is required: this is a custom tool loop over Converse.
Read-only identity checks succeeded after the user refreshed login. Plan metadata
reported FREE/ACTIVE, not a paid upgrade. Model metadata reported regional Nova Lite
AUTHORIZED/AVAILABLE and ON_DEMAND. Nova Micro reported only INFERENCE_PROFILE;
its `us.` profile lists us-east-1/us-east-2/us-west-2 destinations and was not invoked.
Metadata authorization does not prove runtime invocation success or analysis quality.
Exported credentials expire and do not refresh inside Lambda automatically.

The remaining limits are the skipped charged test, expiring model credentials, empty
actor baselines, and incomplete live FA3/report integration. Use
[startup instructions](fa1-integration-startup.md) for the working URL, demo steps,
local update commands, and precise boundaries.
