# AlertChain Agent

Sheridan College — Honours Bachelor of Computer Science
Cloud Computing Capstone Project

## Overview

AlertChain Agent helps small AWS teams review security alerts, investigate related activity, and understand potential attack chains.

The planned system collects Amazon GuardDuty findings and selected AWS CloudTrail events, normalizes them, and uses an AI investigation agent to produce evidence-based incident reports.

## Team

- Jacob Makil — Alert Ingestion & Cloud Integration
- Harneet Kaur — Agentic Reasoning & Correlation Engine
- Mattias Kerner — Application, Dashboard & Ask-the-Agent

## Inception UI Prototype

The repository includes the FA1, FA2, and FA3 frontend prototypes using fictional mock data. The shared React Router shell starts on the FA3 Dashboard and connects all three functional areas.

Implemented FA1 screens cover security signal sources, monitored event configuration, normalized alert browsing, and alert details. The shared layout provides the AlertChain Agent header and sidebar.

The FA2 investigation prototype (Investigation View, Reasoning Trace, Attack Chain) is integrated through the sidebar and alert-detail **Investigate** button. **Open incident** now opens the matching FA3 report. FA3 includes the dashboard, incident list, report, Ask the Agent, and stored-evidence viewer. Live AWS ingestion, AI investigations, and backend integration remain planned work.

## Technology

- Current frontend: React 19, React Router 7, plain CSS, Vite 8, and ESLint 10
- Planned backend: FastAPI
- Planned cloud services: Amazon GuardDuty, AWS CloudTrail,
  Amazon EventBridge, AWS Lambda, Amazon API Gateway,
  Amazon DynamoDB, Amazon Bedrock, and Amazon CloudWatch

## Setup and Run Instructions

Install Git, Node.js, and npm. The tooling locked in `package-lock.json` supports Node.js **`^20.19.0 || ^22.13.0 || >=24`**: Node 20.19+ within the 20.x line, Node 22.13+ within the 22.x line, or Node 24+. The Node 22 minimum comes from ESLint; Vite alone accepts 22.12+.

```sh
git clone https://github.com/AlertChain-Capstone/alertchain-agent.git
cd alertchain-agent
npm ci
npm run dev
```

Open the local address printed by Vite. `http://localhost:5173` is the usual default; Vite may choose another port if it is occupied.

This frontend prototype requires **no AWS credentials, backend server, or environment variables**. No `.env` file is needed.

The scripts in `package.json` are:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the Vite development server. |
| `npm run lint` | Run `eslint .`. |
| `npm run build` | Run `vite build`, generating the frontend bundle in `dist/`. |
| `npm run preview` | Run `vite preview` to serve a previously built bundle locally. Run `npm run build` first, then open the address printed by preview. |
| `npm test` | Verify incident ordering, fixture compatibility, and answer/citation boundaries. |
| `npm run test:e2e` | Run Playwright browser tests; starts Vite on port 5178 automatically. |
| `npm run test:optional` | Build isolated copies with each FA folder missing to check the shell's placeholder support. |

For browser tests, install Chromium once with `npx playwright install chromium`. Alternatively, use installed Microsoft Edge: in PowerShell run `$env:PW_CHANNEL = 'msedge'` before `npm run test:e2e`. The application itself does not need Playwright.

## Shared App Shell — M6

The start page is **Dashboard**. The sidebar has three sections: **Dashboard & Incidents** (FA3), **Alerts & Sources** (FA1), and **Investigations** (FA2).

React Router uses hash URLs so deep links also work on a static host without server rewrite rules. Refresh, Back, and Forward use the URL to select the screen.

| Area | Routes (append after `#`) |
| --- | --- |
| FA1 | `/sources`, `/alerts`, `/alerts/:id` |
| FA2 | `/investigations`, `/investigations/:id`, `/incidents/:id/chain` |
| FA3 | `/`, `/incidents`, `/incidents/:id`, `/incidents/:id/ask` |

Each `src/faX/routes.jsx` exports a default object with `Component` and a `routes` array of `{ path, view }` entries. The shell discovers these modules through Vite's glob imports. `src/shared/areas.js` supplies the sidebar and fallback route ownership. If a functional area's folder or route module is missing, its links show an integration placeholder while the other available areas still load. Dependencies of an available module, such as shared mock files, must still be present.

The existing alert badge and FA1/FA2 base styles live in `src/shared/`; FA1 retains compatibility imports. This removes FA2's dependency on the optional FA1 component folder without changing its screen styling.

Each area's root component stays mounted. FA1's filters/configuration, FA2's investigation/close-out state, and FA3's list filters and per-incident question/answer survive switching areas. Temporary screen demos reset when that screen is left. A full refresh restores the fixtures. Unknown routes or identifiers show an unavailable page instead of substituting another record.

## Current FA1 Features

- **Security sources:** healthy GuardDuty and CloudTrail cards, simulated connection tests, source-filtered alert navigation, and demo scenarios for missing configuration, denied permissions/stale ingestion, and unreachable AWS. Configuration and Retry actions briefly show loading, then recover each source independently.
- **Monitored CloudTrail events:** edit supported events, validate event names, suggest `StopLogging` for `StopLoging`, and prevent saving an empty selection. Cancel discards the draft. A failed-save demo retains the draft and previous configuration; Retry saves successfully.
- **Normalized alerts:** search by ID, event, or principal; combine severity, source, status, and time filters; sort newest first; and paginate six records per page. Separate empty states cover no filter matches and no alerts ingested.
- **Alert details:** keyboard-accessible alert IDs open normalized fields, severity/status badges, incident references, and full UTC timestamps. Raw JSON is formatted and can be copied with success/error feedback. Missing raw events and unavailable alerts have dedicated states.
- **Navigation and layout:** Sources, Alerts, and detail navigation preserve monitored selections and list state. Back to alerts restores the prior filters, page, and alert-button focus. The layout adapts to narrow screens and contains wide tables and JSON in scrollable areas.

## FA1 Demo Guide

Fixtures live in `src/mock/fa1.json`: ten alerts, including `ALT-007` with `rawEvent: null`. Filtering uses the fixed reference **`2026-10-17T16:00:00Z`**, never the real current date. Eight fixture alerts fall within the default **Last 24 hours**; choose **All time** to include all ten.

For each Alerts example below, first click **Alerts**, choose **Alerts demo scenario → Sample alerts**, then **Clear filters**. This clears search, sets Severity/Source/Status to All, and restores **Time range → Last 24 hours**. Both `ALT-002` and `ALT-007` are within that window. **Editor** below means **Sources → Edit monitored events**. Cancel any open editor before navigating elsewhere.

| # | Screen or state | Steps to display it |
| --- | --- | --- |
| 1 | Healthy security signal sources | **Sources → Demo scenario → Healthy**. Both cards show Connected. |
| 2 | Edit monitored CloudTrail events | Open **Editor**. Toggle events; Save changes updates the table/count, while Cancel discards the draft. |
| 3 | Normalized alerts list | Open **Alerts** using the baseline above. Use Previous/Next to browse six records per page. |
| 4 | Alert details with raw JSON | In Alerts, search `ALT-002`, then click **ALT-002**. Use **Copy JSON** or **Back to alerts**. |
| 5 | Source permission denied / stale data | **Sources → Demo scenario → Permission denied / stale data**. The stale successful-ingestion timestamp is shown. **Retry** recovers that source. |
| 6 | Invalid monitored event name | Open **Editor**, enter `StopLoging` under **Add a supported event by name**, then click **Add**. The error suggests `StopLogging`. |
| 7 | No alerts match the filters | In Alerts, search `nothing-matches`. The empty-state **Clear filters** button restores matches. |
| 8 | Raw event unavailable | In Alerts, search `ALT-007`, then click **ALT-007**. Normalized details remain visible; Copy JSON is disabled. |
| 9 | Source not configured | **Sources → Demo scenario → Not configured**. Click **Configure (simulated)** to recover each source. |
| 10 | AWS unreachable | **Sources → Demo scenario → AWS unreachable**. Click **Retry** to recover each source. |
| 11 | No monitored events selected | Open **Editor** and uncheck every event in **Select events to monitor**. Save changes is disabled. |
| 12 | Monitored event save failed | Open **Editor**, leave at least one event selected with no validation error, enable **Demo: simulate a failed save**, and click **Save changes**. After about 0.8 seconds, the error appears. **Retry** succeeds; **Cancel** preserves the previous configuration. |
| 13 | Alert no longer available | Open `ALT-002` as in row 4. Set **Alert details demo scenario → Alert no longer available**. **Back to alerts** works; choosing **Selected alert available** reverses the simulation without changing fixtures. |
| 14 | No alerts available | **Alerts → Alerts demo scenario → No alerts available**. This explains that nothing has been ingested, independently of filters. **View security sources** opens Sources. Return to Alerts and choose **Sample alerts** to restore fixtures and the previous filters/page. |

Source scenarios apply to both cards; recoveries operate independently. Switching scenarios cancels pending recoveries. Changing alert filters resets pagination to page one. Changing demo scenarios does not reset saved monitored selections or alert filters. A source card's **View recent events** action selects that source and resets the other alert filters. The failed-save switch resets when the editor closes, and the unavailable-alert simulation resets when details are reopened.

## FA2 Investigation Prototype

FA2 (Agentic Reasoning & Correlation, owner: Harneet Kaur) lives in `src/fa2/` with fixtures in `src/mock/fa2.json`. It reads the FA1 alert fixtures read-only.

Open it with **Investigations** in the sidebar (or `http://localhost:5173/#/investigations`); **Alerts & Sources** goes back to FA1. From an FA1 alert's details, **Investigate** starts or opens that alert's investigation (with the same threshold and already-running/closed rules), and **Open incident** opens the FA3 incident report. FA2's **Open incident report** link connects the investigation to FA3, and the report links back to the investigation and attack chain.

The agent is simulated: new investigations add one reasoning step about every second and finish with a verdict, confidence score and recommended next steps. No AWS, Bedrock or backend calls are made.

### FA2 Features

- **Start an Alert Investigation:** start from any FA1 alert; low-severity alerts ask for confirmation; an alert with a running investigation opens it instead of starting another; a closed alert shows its result and offers Re-investigate.
- **Investigation View:** progress, gathered evidence, verdict with confidence, and a **Recommended next steps** checklist with quick actions (copy CLI command or message, open filtered trace). Steps can be ticked or marked skipped with a reason.
- **Resolve Alert with Next Steps:** close out as **True positive – escalate**, **Benign** or **False positive**. Benign/False positive need a reason; escalating with unticked steps asks for confirmation; the note is optional. The saved resolution records name, time, note and next-step status.
- **Reasoning Trace:** numbered steps with decision, reason, tool, query, raw result and evidence links; failed steps, too-large results, very long traces and evidence links to events that no longer exist have their own states.
- **Attack-Chain Graph:** events as nodes in time order with technique and "why it is linked"; single-event, branching, still-running, too-large and unmapped-technique states.

### FA2 Demo Guide

Each row maps to a use case extension in the shared Visual Paradigm project and a screen in the FA2 Figma wireframes. Start on **Investigations** (`#/investigations`). **Close-out scenario** is the selector under the close-out buttons on the Overview tab.

| # | Screen or state | Steps to display it |
| --- | --- | --- |
| 0 | Handoff from FA1 | **Alerts & Sources → Alerts**, click **ALT-002**, then **Investigate** (opens INV-001) or **Open incident INC-001**. **ALT-004** shows the below-threshold dialog; **ALT-003** starts a new run. |
| 1 | Investigation View – verdict and next steps | Open **INV-001**. Tick steps, use a quick action, or click **Open filtered trace**. |
| 2 | Reasoning Trace | In INV-001 click **Reasoning Trace**; expand any step. |
| 3 | Attack Chain Graph | In INV-001 click **Attack Chain**; select a node; **View in reasoning trace** jumps to its step. |
| 4 | Below threshold (Start 4a) | Click **Investigate** on `ALT-004` (Low). Choose **Investigate anyway** or **Cancel**. |
| 5 | Already running (Start 3a) | Click **Investigate** on `ALT-006`. INV-003 opens and keeps running. |
| 6 | Already investigated, closed (Start 3b) | Click **Investigate** on `ALT-009`. **Re-investigate** starts a new run. |
| 7 | Investigation started – trace running (Trace 2a) | Click **Investigate** on `ALT-001`, then open **Reasoning Trace** while it runs. |
| 8 | Attack chain still running (Graph 2c) | Start a run as in row 7 and open **Attack Chain** while it runs. |
| 9 | Paused – Bedrock unavailable (Start 6a) | Set **Investigation demo scenario → Amazon Bedrock unavailable**, then **Investigate** `ALT-003`. Click **Retry**. |
| 10 | CloudTrail query failed (Start 7a) | Set the scenario to **CloudTrail query denied**, then **Investigate** `ALT-001` or `ALT-003`. Click **View failed step**. |
| 11 | Failed step / large result / missing event (Trace 3a, 5a, 7a) | In INV-001 Reasoning Trace expand step 7 (failed), step 3 (too large) and step 2 → **Open Last StopLogging…** (no longer available). |
| 12 | Very long trace (Trace 2b) | Reasoning Trace → **Trace demo scenario → Very long trace**. Click **Show all 24 steps**. |
| 13 | Single event (Graph 2a) | Open **INV-002** → **Attack Chain**. |
| 14 | Branching / too large / missing technique (Graph 2b, 2d, 3a) | Attack Chain → **Chain demo scenario → Branching chain** (select `CreateUser`) or **Large chain**. |
| 15 | Needs human review (Resolve 2a) | Open **INV-002**. |
| 16 | Next step skipped (Resolve 4a) | In INV-001 click **Can't do this step** on step 1, enter a reason, **Mark skipped**. |
| 17 | Close as Benign / False positive (Resolve 5a) | In INV-001 click **Benign** or **False positive**; the close button stays disabled until a reason is entered. |
| 18 | Not all next steps ticked (Resolve 5b) | In INV-001 leave a step unticked and click **True positive – escalate**. |
| 19 | Submit without note (Resolve 6a) | Tick every step, click **True positive – escalate**, leave the note empty: **Submit without note**. |
| 20 | Already resolved by someone else (Resolve 7a) | Set **Close-out scenario → Another analyst resolves it first**, then close out INV-001. |
| 21 | Resolution could not be saved (Resolve 7b) | Set **Close-out scenario → Save fails once**, close out INV-001, then click **Retry** in the banner. |

State is held in React and resets when the page is refreshed. Switching between FA1 and FA2 in the sidebar keeps each area's state.

## FA3 Dashboard & Ask-the-Agent Prototype — M16

Owner: Mattias Kerner. Screens live in `src/fa3/`, and all FA3 incident records, stored evidence, source snapshots, and canned answers live in `src/mock/fa3.json`. The feature branch is `feature/fa3-screens`.

- **Dashboard:** incident counts, incidents needing attention, source-health snapshot, and navigation to all areas.
- **Incident list:** combined ID/title search, severity and status filters, highest-severity/newest-first ordering, and four records per page. Filters and page survive report review.
- **Incident report:** selected incident identity, status, findings, recorded timeline, evidence, attack-chain explanation, and uncertainty. Generating, unavailable, failed-load, and human-review states remain distinct.
- **Ask the Agent:** incident-specific suggested questions, text input, pending state, canned responses, and citations. Whitespace questions are rejected. Unsupported questions produce a limitation, and candidate answers with invalid citations are withheld. A timeout preserves the question and offers Retry.
- **Evidence inspection:** select a citation to open an accessible dialog with source, event time, principal, raw JSON, and a link to the normalized FA1 alert. Escape/Close returns focus to the citation. Missing or foreign evidence is never substituted; temporary errors can be retried, and large previews can be read in bounded segments.

`INC-001` and `INC-002` correspond to the existing `INV-001` and `INV-002`. FA3 preserves the repo's `ALT-*` identifiers, timestamps, principals, and raw events, which differ from older VP illustration data. `INC-001`'s title describes the demonstration scenario; the report explicitly distinguishes the candidate chain from proof that the same key or actor caused every event. Its first two events share an IP but have different principals/keys, and its GuardDuty event has another principal/IP.

Four additional records named `INC-DEMO-*` demonstrate pagination, closed incidents, and generating/limited reports. They are labelled as FA3-only fixtures and do not pretend to have shared FA2 investigations. Source-health and report data are fixed snapshots: an FA1 recovery simulation or FA2 close-out does not rewrite FA3's fixtures.

### FA3 Demo Guide

Open **Demo scenarios** on the relevant screen to expose its selector. Unless stated otherwise, start from `#/incidents/INC-001`. This guide supports a later team rehearsal; it does not mean M17 has been completed.

| # | Screen or state | Steps to display it |
| --- | --- | --- |
| 1 | Dashboard | Open `#/`. **View all incidents** opens the list; **Needs human review** applies that status filter. |
| 2 | Incident list, filters, pagination | Open `#/incidents`. Select Severity **High** and Status **Open**. Clear filters, then **Next** to see the remaining records. |
| 3 | No matching incidents | Set Severity to **Critical**, or search `nothing-matches`. **Clear filters** restores the sample list. |
| 4 | Empty portfolio / load failure | **Incident list demo scenario → No incidents available** or **Incident load failed**. Empty Refresh keeps the empty fixture; error Retry recovers while keeping filters. |
| 5 | Report and evidence | Open `INC-001`; inspect a timeline evidence item. **View investigation** opens `INV-001`; **Open attack-chain graph** opens FA2's matching graph. |
| 6 | Report generating | **Incident report demo scenario → Report generating**, or open `INC-DEMO-003`. **Refresh report** retains generating state; it never invents a completed report. |
| 7 | Failed report / unavailable incident | Choose **Report load failed**, then **Retry report**. Choose **Incident unavailable**, or navigate to an unknown incident ID, to see the unavailable state. |
| 8 | Human review / no chain | Open `INC-002`, or use **Needs human review** / **No supported attack chain** in the report selector. |
| 9 | Cited answer | **Ask the Agent → What shows that logging was disabled? → Ask question**. Pending appears briefly, then an answer with **View citation E2**. |
| 10 | Empty / out-of-scope / unsupported question | Submit whitespace; ask `Disable logging now`; or ask an unscripted question. Each produces an explanation without invented citations. |
| 11 | Agent timeout and retry | **Answer demo scenario → Agent timeout**, submit a suggested question, then **Retry answer**. The same question receives its canned answer. |
| 12 | Insufficient evidence / invalid candidate | Choose **Insufficient evidence** or **Candidate has invalid citations**, then submit a suggested question. No supported answer is presented. |
| 13 | Partial answer | On `INC-001`, choose **What disabled logging, and was data copied?** with the normal scenario. The logging claim is cited and the exfiltration question remains explicitly unanswered. |
| 14 | Incident becomes unavailable | **Answer demo scenario → Incident becomes unavailable**. A route back to the list appears and no answer is produced. |
| 15 | Evidence states | After obtaining a normal answer, set **Evidence demo scenario** to missing, temporary error, foreign citation, or segmented preview, then select **View citation E2**. Error Retry succeeds; the preview's Next/Previous controls preserve the evidence ID. |
| 16 | Return paths and isolation | Close evidence, return to the report, then reopen Ask. The question and answer remain. Switch to `INC-002`: it has its own question/answer context. |

Only the suggested questions (ignoring case, surrounding whitespace, and trailing punctuation) have canned factual answers. This is a UI prototype, not an AI question-answering service. No AWS, Bedrock, or backend calls are made.

## Current Limitations and Planned Work

- Data is fictional. Connection tests, configuration, recovery, and save-failure actions are simulated; source scenarios do not alter the alert fixtures or generate live events.
- State is held locally in React and resets on refresh. There is no server-side persistence or authentication; “SOC Analyst” is a prototype label.
- `src/shared/AppLayout.jsx` and React Router provide the team shell. The previous FA1-only `#/` entry now opens Dashboard; use `#/sources` for FA1.
- Backend services, live AWS ingestion, AI reasoning/correlation, and generated incident reports remain planned work. Displayed reports and answers are static fixture content.
- Copy JSON depends on browser clipboard support and permission. If copying fails, the JSON remains available for manual copying.

## J9 infrastructure: team AWS sandbox

Prerequisites: PowerShell 5.1 or newer, AWS CLI v2, AWS SAM CLI, and configured team sandbox credentials with permission to manage this stack's resources and IAM role. Select your team's profile with `$env:AWS_PROFILE = 'your-sandbox-profile'`, sign in if needed, and clear any local Floci credential or endpoint overrides first. The scripts use your configured credentials and verify the STS caller's account before running SAM. There is no established infrastructure script language in this repo, so these helpers use PowerShell.

From the repo root, replace `123456789012` with the team's actual sandbox account ID:

```powershell
.\scripts\deploy.ps1 -StackName alertchain-sandbox -ExpectedAccountId 123456789012
```

```powershell
.\scripts\teardown.ps1 -StackName alertchain-sandbox -ExpectedAccountId 123456789012
```

Both accept `-Region`, defaulting to `us-east-2`. Deploy uses `sam deploy` and asks for change-set confirmation; review replacements and removals before accepting. Teardown shows the verified account, region, and stack name, requires typing the stack name, and retains `sam delete` confirmation. **Deleting the stack can delete its DynamoDB tables and all their data.** Back up anything needed first. Resource names in `template.yaml` are fixed, so use one AlertChain stack per account/region to avoid name collisions. Neither script is for Floci.

### Local Floci verification

Prerequisites on Windows: **Docker Desktop** running with Linux containers and **AWS CLI v2** installed (`aws --version`). Open PowerShell in the root of your fresh clone, where `template.yaml` is located. No AWS account, AWS login, or SAM CLI is required. Use a separate PowerShell session so temporary test credentials do not affect your AWS sandbox session.

On first use, create a persistent Docker volume and the Floci container. The Docker socket mount lets Floci run the Lambda in a container; persistent storage keeps the local stack across restarts. These settings follow Floci's [Docker](https://floci.io/floci/configuration/docker/) and [storage](https://floci.io/floci/configuration/storage/) documentation.

```powershell
docker volume create alertchain-floci-data
docker run -d --name alertchain-floci -p 127.0.0.1:4566:4566 --mount source=alertchain-floci-data,target=/app/data --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock -e FLOCI_STORAGE_MODE=hybrid -e FLOCI_STORAGE_PERSISTENT_PATH=/app/data floci/floci:latest
```

On later sessions, start the existing stopped container instead of creating another one:

```powershell
docker start alertchain-floci
```

Wait until Floci is ready (`docker logs alertchain-floci`). Then set process-local credentials, package the Python backend into a local S3 bucket, and create or update `alertchain-local` through Floci's CloudFormation API. AWS CLI's `cloudformation package` zips `backend/` automatically; SAM CLI is not required. Keep the generated template in the temporary directory. Every AWS CLI command explicitly targets Floci in `us-east-2`; the endpoint environment settings also keep the packager's nested S3 calls local:

```powershell
$env:AWS_ACCESS_KEY_ID = 'test'
$env:AWS_SECRET_ACCESS_KEY = 'test'
$env:AWS_SESSION_TOKEN = $null
$env:AWS_PAGER = ''
$env:AWS_ENDPOINT_URL = 'http://127.0.0.1:4566'
$env:AWS_ENDPOINT_URL_S3 = 'http://127.0.0.1:4566'
aws --endpoint-url http://127.0.0.1:4566 --region us-east-2 s3api head-bucket --bucket alertchain-local-artifacts
if ($LASTEXITCODE -ne 0) {
    aws --endpoint-url http://127.0.0.1:4566 --region us-east-2 s3api create-bucket --bucket alertchain-local-artifacts --create-bucket-configuration LocationConstraint=us-east-2
    if ($LASTEXITCODE -ne 0) { throw 'Local artifact bucket creation failed.' }
}
$packagedTemplate = Join-Path $env:TEMP 'alertchain-local-packaged.yaml'
aws --endpoint-url http://127.0.0.1:4566 --region us-east-2 cloudformation package --template-file template.yaml --s3-bucket alertchain-local-artifacts --output-template-file $packagedTemplate
if ($LASTEXITCODE -ne 0) { throw 'Local backend packaging failed.' }
aws --endpoint-url http://127.0.0.1:4566 --region us-east-2 cloudformation deploy --template-file $packagedTemplate --stack-name alertchain-local --parameter-overrides DynamoDBEndpointUrl=http://host.docker.internal:4566 --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset
if ($LASTEXITCODE -ne 0) { throw 'Local stack deployment failed; inspect the error before continuing.' }
aws --endpoint-url http://127.0.0.1:4566 --region us-east-2 cloudformation describe-stacks --stack-name alertchain-local --query 'Stacks[0].StackStatus' --output text
aws --endpoint-url http://127.0.0.1:4566 --region us-east-2 apigatewayv2 get-apis
# Replace <api-id> with the ApiId of the HTTP API returned above.
$response = Invoke-WebRequest -UseBasicParsing -Uri 'http://<api-id>.execute-api.localhost.floci.io:4566/health' -TimeoutSec 120
$response.StatusCode
$response.Content
```

On first deployment, expect stack status `CREATE_COMPLETE` and this health result (HTTP `200 OK`):

```text
200
{"status":"ok"}
```

The first request may take longer while Docker pulls the Python Lambda image. Inside that container, `127.0.0.1` refers to the Lambda itself: the local-only `DynamoDBEndpointUrl` override uses Docker Desktop's `http://host.docker.internal:4566` to reach Floci. Leave this parameter empty on AWS. The Python runtime supplies boto3; the handler currently needs no additional packaged dependencies.

The container and stack remain available for later sessions; do not recreate or reset them just to rerun the health check. For local updates, package again, then create and inspect a CloudFormation UPDATE change set using the generated `$packagedTemplate`, the same `DynamoDBEndpointUrl` override, and `CAPABILITY_IAM`, then execute it and wait for `stack-update-complete`. Check `dynamodb describe-table` for each of the four tables, EventBridge rules/targets and Lambda invoke permissions, and synthetic events with `events test-event-pattern`. Pattern matches and configured targets do not prove actual EventBridge delivery. Direct Lambda ingestion returns `{"alertId":"...","outcome":"inserted"}` for a new GuardDuty finding ARN or selected CloudTrail eventID, and `outcome: duplicate` on redelivery; duplicate writes preserve the original stored item.

CloudTrail ingestion accepts only `aws.iam / iam.amazonaws.com / CreateAccessKey` and `aws.cloudtrail / cloudtrail.amazonaws.com / StopLogging` with detail type `AWS API Call via CloudTrail`. Unselected events return `outcome: ignored` without writing; malformed selected events fail before storage. Caller identity comes from `userIdentity` (user name or assumed-role issuer name when available), separately from the target user/trail in `resource`. Original detail is preserved as `rawEvent`. Severity defaults are provisionally `MEDIUM` for CreateAccessKey and `HIGH` for StopLogging, matching the INC-001/FA1 fixture examples; no formal severity policy is defined in the repo. Synthetic examples live in `backend/tests/fixtures/cloudtrail_create_access_key.json` and `cloudtrail_stop_logging.json`. The EventBridge smoke test below publishes these synthetic events through Floci; it never calls the actual IAM or CloudTrail actions.

### Local frontend website (Floci only)

With the existing `alertchain-floci` container running, use Windows PowerShell 5.1+, Node.js/npm (compatible with the installed Vite version), and AWS CLI v2. From the repository root:

```powershell
powershell.exe -NoProfile -File .\scripts\deploy-floci-frontend.ps1
```

The script installs locked dependencies with `npm ci` if Vite is missing, runs `npm run build`, and uploads the **contents** of ignored `dist/` to the dedicated `alertchain-frontend-local` bucket. Run `npm ci` yourself after dependency/lockfile changes. Every AWS CLI call explicitly uses `http://127.0.0.1:4566` and `us-east-2`, with temporary dummy credentials. The script restores its environment on exit, configures `index.html` as the website index/error document, grants anonymous object reads only on this local bucket, and assigns HTML, JavaScript, CSS, and SVG content types. Re-running updates the site without deleting old assets, the backend stack, or DynamoDB data; assets upload before `index.html`. Generated files are not source changes and should not be committed.

Open [the local frontend](http://alertchain-frontend-local.s3-website-us-east-2.localhost.floci.io:4566/). This hostname resolves to loopback; Windows PowerShell did not resolve the shorter `*.localhost` variant. The script checks the root HTTP response and prints the installed Floci version. Floci **2.4.0** was verified to serve the index and assets with HTTP 200 and the expected MIME types. Its [S3 website support](https://floci.io/floci/services/s3/#website-hosting) includes index/error documents, but not advanced routing rules. This local HTTP test does not establish production AWS hosting, TLS, or IAM parity.

The app already uses `HashRouter`: nested URLs must retain `/#/`, for example [incident INC-001](http://alertchain-frontend-local.s3-website-us-east-2.localhost.floci.io:4566/#/incidents/INC-001). The hash stays in the browser, so refreshing requests the site root. A bare `/incidents/INC-001` path is not an equivalent app link; an error document is not a server-side route rewrite. Changes made to mock UI state can reset on refresh.

This deployment forces `VITE_USE_MOCK=true` at build time and overrides the API base URL to loopback, including when local `.env` files exist. Data behavior:

| Screens | Data / backend behavior |
| --- | --- |
| FA1 sources, alerts, alert details | `src/mock/fa1.json` and in-memory UI changes; no backend calls. |
| FA2 investigations, reasoning trace, attack chain | Fixtures and simulated investigations in this build. Its optional live client uses `POST /investigations` and `GET /investigations/{id}` polling when a base URL is configured and mock mode is off. |
| FA3 dashboard, incidents, reports, Ask the Agent | `src/mock/fa3.json`, in-memory state, and canned answers; no backend calls. |

The deployed Lambda HTTP entry point currently exposes only `GET /health`; this website does not call it or display ingested DynamoDB records. Live investigations require backend routing/integration and cross-origin access before enabling the API client in a separate build.

Browser verification checklist (the script's HTTP check does **not** complete these checks):

1. Open the site with DevTools Network recording, reload, and confirm HTML, JS, CSS, and SVG assets load with no failed requests or MIME errors.
2. Navigate through Dashboard & Incidents, Alerts & Sources, and Investigations, then open an incident report and an alert detail.
3. Refresh `/#/incidents/INC-001` and confirm the same report renders; test Back/Forward navigation.
4. Check Console for runtime errors and Network for unexpected backend or external requests. This mock build should make no investigation API requests.

Browser checks completed through ChatGPT's connected browser (reported by the reviewer): Dashboard, Sources, Alerts list, alert detail, and Investigations rendered. Refreshing `/#/incidents/INC-001` kept the incident report open, and browser Back and Forward worked. No captured console warnings or errors were reported. A **full Network-panel check remains pending**, including checking for failed asset requests and unexpected backend or external requests. These checks used the mock-data build; backend integration remains pending.

### J10 EventBridge ingestion smoke test (Floci only)

With the existing `alertchain-local` stack and `alertchain-floci` container running, use PowerShell 5.1+ with AWS CLI v2 and Python 3.11+ on `PATH`. From the repo root, run this in a separate PowerShell process:

```powershell
powershell.exe -NoProfile -File .\scripts\test-floci-ingestion.ps1
$LASTEXITCODE
```

The script checks that the local stack exists, then copies the three synthetic fixtures in memory, generates a fresh GuardDuty finding ARN and CloudTrail event IDs, and calculates expected alert IDs using the existing Python normalizers. It confirms each ID is absent, publishes through the default EventBridge bus, checks each publish result, and polls `alertchain-alerts` with consistent reads for up to 15 seconds after publishing. A pass requires the new record and matching source ID. It prints `PASS` or `FAIL` for each event and exits with `0` only when all three pass.

Dummy credentials are confined to the child process. Every AWS CLI call explicitly targets `http://127.0.0.1:4566` in `us-east-2`. The test leaves three synthetic alert records on success; it does not edit fixtures, change or deploy the stack, invoke Lambda directly, or call real IAM/CloudTrail actions. If the local stack is missing, it stops without publishing.

Known Floci limits and checks still required in AWS:

- Floci's SAM transform drops the Lambda's `LoggingConfig`: it is absent from `cloudformation get-template --template-stage Processed`, and the function reports the default group. **AWS check:** confirm the processed Lambda retains `LoggingConfig.LogGroup`, the function uses `/alertchain/backend`, and that group's retention is one day.
- Floci's `dynamodb describe-table` omitted `BillingModeSummary.BillingMode` and reported provisioned throughput values, so on-demand billing was not confirmed despite `PAY_PER_REQUEST` in the template. **AWS check:** confirm all four tables report `BillingModeSummary.BillingMode: PAY_PER_REQUEST`, with the expected base keys and active GSIs.

### J10 AWS GuardDuty sample verification (sandbox, manual review)

Offline validation (no AWS calls, credentials, AWS CLI, or Pester required): `powershell.exe -NoProfile -File .\scripts\tests\test-aws-guardduty-ingestion.offline.ps1`. This checks PowerShell syntax and 15 mocked scenarios, including blank finding types, cancellation, profile/region forwarding, and CLI failures. Live AWS sandbox ingestion verification remains **PENDING** until the stored-record check below passes.

Use the deployed sandbox ingestion stack, an already enabled GuardDuty detector, PowerShell 5.1+, and AWS CLI v2. In a clean PowerShell session, authenticate the sandbox profile (for example, `aws sso login --profile your-sandbox-profile`); remove inherited Floci credentials and endpoint overrides. The profile needs `sts:GetCallerIdentity`, `guardduty:ListDetectors`, `guardduty:GetDetector`, and `guardduty:CreateSampleFindings`; verification also needs `guardduty:ListFindings`, `guardduty:GetFindings`, and `dynamodb:GetItem`. Replace the profile/account below with the team's sandbox values:

```powershell
.\scripts\test-aws-guardduty-ingestion.ps1 -Profile your-sandbox-profile -ExpectedAccountId 123456789012 -FindingType 'UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS'
```

`-Region` defaults to `us-east-2`. The script verifies STS account identity and an `ENABLED` regional detector, displays the account/region/type, and requires typing `account-id/region` before requesting exactly one explicit sample type. It does not enable GuardDuty or deploy resources. It uses the named profile and explicit public AWS endpoints, and refuses inherited credential/endpoint overrides. A zero exit code means only that AWS accepted the request: ingestion remains **PENDING**. See AWS's [sample findings guide](https://docs.aws.amazon.com/guardduty/latest/ug/sample_findings.html).

To complete verification, record the request time and detector ID printed by the script. In the GuardDuty console for that account/region, locate the sample of the requested type and check its sample marker and creation/update time against the request. Alternatively, use `aws guardduty list-findings --detector-id <detector-id> --profile your-sandbox-profile --region us-east-2`, then `aws guardduty get-findings --detector-id <detector-id> --finding-ids <finding-id> --profile your-sandbox-profile --region us-east-2` to inspect it. Copy the exact finding ARN. Calculate the alert ID using the same URL-namespace UUIDv5 mapping as `FindingNormalizer`, then read the base table consistently (Python 3.11+ is needed for this snippet):

```powershell
$profile = 'your-sandbox-profile'
$region = 'us-east-2'
$findingArn = '<exact sample finding ARN>'
$alertId = python -B -c "import sys; from uuid import uuid5, NAMESPACE_URL; print(uuid5(NAMESPACE_URL, sys.argv[1]))" $findingArn
if ($LASTEXITCODE -ne 0) { throw 'Alert ID calculation failed.' }
$keyPath = Join-Path $env:TEMP 'alertchain-guardduty-key.json'
try {
    @{ alertId = @{ S = $alertId } } | ConvertTo-Json -Compress | Set-Content -Encoding ASCII $keyPath
    aws dynamodb get-item --table-name alertchain-alerts --key "file://$keyPath" --consistent-read --profile $profile --region $region --endpoint-url "https://dynamodb.$region.amazonaws.com" --output json --no-cli-pager
    if ($LASTEXITCODE -ne 0) { throw 'Alert lookup failed.' }
} finally {
    Remove-Item -LiteralPath $keyPath -ErrorAction SilentlyContinue
}
```

Allow several minutes for asynchronous delivery and repeat the lookup. **PASS requires a new record** with the calculated `alertId`, `source` equal to `Amazon GuardDuty`, the requested `eventName` and `region`, `rawEvent.arn` matching the sample ARN, and `createdTime` after the request. Save the ARN, alert ID, request time, and stored record as evidence. A missing record or CLI error is not a pass; inspect the EventBridge rule/target, Lambda permissions/logs, and DynamoDB permissions. Repeated samples can reuse a finding ARN; an existing alert is preserved on redelivery and cannot prove new delivery for this run. Choose a sample type not previously ingested rather than deleting evidence. Updated findings may also follow GuardDuty's configured [EventBridge publication frequency](https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_findings_eventbridge.html). Do not substitute direct Lambda invocation for this check.

## Project Resources

- Source code: https://github.com/AlertChain-Capstone/alertchain-agent
- Jira: https://alertchain-agent.atlassian.net
- Requirements, use cases, domain model, and wireframes:
  maintained in the team's shared Visual Paradigm project.
