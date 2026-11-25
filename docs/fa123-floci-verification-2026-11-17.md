# Combined FA1/FA2/FA3 local Floci deployment and verification

Date: November 17, 2026 (Toronto; evidence timestamps extend into November 18 UTC).

The combined application is deployed to the existing local Floci environment. Stored-data browsing and navigation passed actual browser/API checks. Ask request handling, grounding, citations and retry passed using an explicitly synthetic local model dependency. **Real Nova Micro investigation/question completion is blocked and was not tested.** No real Bedrock request, AWS deployment, push, commit or merge into main was performed.

## Tested source and deployment

- Branch: `feature/fa1-arch_2`.
- Base commit: `16256911cb7ac0d61c2c2a3c12f5497d6194b492`.
- Tested source includes the existing, uncommitted Nova Micro configuration/documentation changes and configuration tests. It is not a clean checkout of that commit. The source manifest and patch are retained with the backup below.
- Existing stack: `alertchain-local`; Lambda: `alertchain-backend`; Region: `us-east-2`; existing container: `alertchain-floci` (Floci 2.4.0), healthy at `127.0.0.1:4566`.
- Website: <http://alertchain-frontend-local.s3-website-us-east-2.localhost.floci.io:4566/>.
- API: <http://f863b23b16.execute-api.localhost.floci.io:4566>.
- Exact intended model ID: **`us.amazon.nova-micro-v1:0`**.
- Final effective `BEDROCK_ENDPOINT_URL`, `DYNAMODB_ENDPOINT_URL` and `LAMBDA_ENDPOINT_URL`: `http://host.docker.internal:4566`. These are local Floci endpoints. Real Bedrock credential fields are empty. There is no automatic Nova Lite fallback.
- Real Bedrock's separate public endpoint remains supported by the source; it was not enabled for this deployment. The helper's single-Region safeguard remains intact. The Micro inference profile is an intended configuration identifier, not evidence that Micro can run under the current project's restriction.
- Backend packaged and uploaded with `scripts/floci-j11.py deploy`, without a Bedrock profile. The CloudFormation change set added incident API integrations/routes/permissions and updated the backend without replacing storage. Update completed successfully.
- Deployed backend ZIP SHA-256 (base64): `uY5BrhgCEQ3YAEUdSZLJ93ulrrcZD1nccgzFDP7jAYc=`. Packaged handler, incident router, incident service and Ask service were compared with the working source.
- Frontend built and uploaded using `scripts/deploy-floci-frontend.ps1`. Both API URL aliases point to the local API and `VITE_USE_MOCK=false`. All five uploaded production files matched local build hashes; old hashed assets were retained. Browser traffic used the local API, and demo scenario controls were absent.

No application source fix was necessary during this verification. An ignored verification script initially expected the wrong incident-list empty-state wording; correcting its selector produced a passing run. That earlier harness failure is not counted as an application failure.

## Preservation and backup

Before deployment, the following backup was created outside the repository:

`C:\Users\makil\AppData\Local\Temp\alertchain-fa123-local-20261118T025053Z`

It contains a Git history bundle, status and patches, copies/hashes of pending files and `.env.local`, all four table snapshots, the previous Lambda configuration and ZIP, stack/template/API configuration, and previous frontend objects/bucket settings. Private configuration snapshots remain outside Git; do not publish the backup or raw HAR/table evidence.

The final consistent DynamoDB scans were compared with the complete pre-deployment rows, including values, not just counts:

| Table | Before and after | Result |
| --- | ---: | --- |
| `alertchain-alerts` | 17 | Exactly unchanged, including all 14 original cases |
| `alertchain-investigations` | 4 | Exactly unchanged |
| `alertchain-evidence` | 3 | Exactly unchanged |
| `alertchain-incidents` | 1 | Exactly unchanged |

`.env.local` and all ten backed-up pending/local files retained their original hashes. This includes the untracked architecture document and configuration tests. No existing Floci container, volume or table was recreated. Two ownership-labelled synthetic association records were used by the association test and removed individually; the full-table comparison confirmed no remaining data changes. No new investigation was started.

## Results

| Check | Status | Evidence and scope |
| --- | --- | --- |
| Backend build/package and Floci deployment | Passed | Existing stack reached update complete; no storage replacement; actual handler imports also passed in an isolated Lambda Python 3.12 container |
| Frontend production build and Floci deployment | Passed | Uploaded production asset hashes matched; actual website served the new application |
| Health | Passed | Actual `GET /health`: 200 and `{"status":"ok"}` |
| CORS | Passed | Allowed website origin for alert requests and question POST preflight; unrelated origin received no matching allow-origin header |
| Real local API, mock disabled | Passed | Browser network/HAR recorded actual local API requests and responses; no browser route interception in deployed-site verification |
| Alert pagination | Passed | All 17 stored IDs and ordering matched DynamoDB; pages contained 6, 6 and 5 alerts |
| Alert filters | Passed | Combined case-insensitive `stopLOG`, HIGH severity and AWS CloudTrail filter returned the five expected stored alerts |
| Alert details and raw event | Passed | Actual API/browser detail and raw-event values compared with stored data |
| Incident associations | Passed | None, associated and ambiguous states; temporary records explicitly labelled and removed |
| Alert → stored incident | Passed | Open incident navigated to `INC-C6856B6A` and its stored report |
| Stored investigation → incident | Passed | Existing completed `INV-05da65ad0b13` opened the same stored report; no new model run |
| Dashboard and incident list | Passed | Actual stored title/results, no sample snapshot; search miss, clear filters and report navigation |
| Report and stored evidence | Passed | Report evidence IDs matched the stored incident; expanded evidence JSON matched the API's stored record |
| Blank Ask question | Passed | Validation shown; no POST sent |
| Cross-incident insufficient evidence | Passed | Actual backend returned limitation with no citations and made no model request |
| Ask answer and citation navigation | Passed — substitute only | Actual browser → deployed API → deterministic local dependency; backend reconstructed recorded evidence text; citation opened the matching stored evidence |
| Unknown citation rejection | Passed — substitute only | Synthetic dependency supplied an unknown ID; actual backend returned insufficient evidence |
| Ask error and retry | Passed — substitute only | Injected local dependency failure caused actual API 503; UI preserved draft; retry returned an answer after dependency recovery |
| Full backend regression suite | Passed | 363 tests; existing Starlette/httpx deprecation warning |
| Frontend unit tests | Passed | 37 tests |
| ESLint | Passed | `npm run lint` |
| Production build | Passed | `npm run build` |
| Existing browser regressions | Passed — controlled fixtures | 11 prototype tests plus 21 FA1/FA3 HTTP-intercepted tests in Edge; distinct from actual Floci checks above |
| Offline SAM/template validation | Passed | Installed SAM runtime executed `scripts/tests/test-bedrock-model-template.py`: transform, ten paths, unchanged tables, Micro default/IAM scope and endpoint references |
| Real Nova Micro investigation completion | **Blocked** | Current single-Region restriction conflicts with intended cross-Region Micro profile; no real invocation or new investigation attempted |
| Real Nova Micro Ask completion/model quality | **Blocked** | Same restriction; substitutes do not verify model access, real IAM/SCP permission, quality, reasoning or model-produced insufficient-evidence decisions |

Final application failures: **none observed within the tested scope**. The blocked model checks prevent claiming complete real-model integration readiness.

Backend command: existing validation venv Python ran `-B -m pytest backend/tests -q -p no:cacheprovider`. Frontend commands: `npm test`, `npm run lint`, `npm run build`, `npm run test:e2e`, `npm run test:fa1-live`. Browser regression servers used their separate configured test ports, not the deployed website.

## Synthetic dependency boundary and final state

For Ask protocol/UI checks only, a temporary deterministic server ran in `alertchain-verification-model-025053`, exposed on laptop loopback port 5186. The backend's model endpoint temporarily pointed to `http://host.docker.internal:5186`; its DynamoDB/self-invocation endpoints stayed on Floci. The substitute selected an existing evidence reference, supplied an invalid reference, or returned an injected failure. It had no real AWS credentials and made no outbound model request.

The test restored the complete original Lambda environment with the Floci stub endpoint and verified equality. The temporary substitute container was then stopped and automatically removed. The existing Floci container remained healthy. Expected browser console output contained only the deliberately injected 503; there were no uncaught page errors.

The final website is suitable for demonstrating stored alerts, reports, evidence and existing investigation associations. New real-model investigation/Ask completion remains blocked. The default Floci model stub is a placeholder and must not be presented as Nova Micro; successful substitute answers from this verification are not the website's final model dependency.

## Retained verification evidence

- Actual alert browser/API/DynamoDB checks: `test-results/integration/integration-3a39f6e9-be9a-4dc2-a6ea-862d83cd0f37/` (summary, HAR/screenshots and ownership cleanup evidence).
- Actual FA3 browser/API checks: `test-results/fa123-local-20261117-025053/` (`fa3-summary.json`, `fa3-network.json`, `fa3-actual.har`, screenshots, explicitly labelled diagnostic scripts).
- Final complete preservation comparison: same directory, `preservation-summary.json` and private `tables-after.private.json`.
- Deployment change set, package, table comparison and validation: `C:\Users\makil\AppData\Local\Temp\alertchain-j11-3le4ah8f`.
- Backup directory above: `tested-base-commit.txt`, `tested-source-manifest.json`, `tested-working-tree.patch`, `deployed-config-safe.json`, `frontend-deployed-manifest.json` and original deployment backup.

Ignored evidence includes local stored event content and remains outside Git. This report contains no credentials or tokens. Existing uncommitted work remains uncommitted.

## Demonstration

1. Open the website above and select Alerts. Page through all 17 alerts or filter for StopLogging.
2. Open alert `ebe7e4ea-4e5b-5f95-99c4-f95566e27ecf`, inspect its raw event, then choose Open incident `INC-C6856B6A`.
3. Review the report and expand its stored evidence. Follow View investigation `INV-05da65ad0b13`, then Open incident report to show the FA2/FA3 connection.
4. Use the dashboard and incident list to reach the same stored report. Explain that real Nova Micro completion is blocked; do not demonstrate the Floci placeholder as a real model answer.
