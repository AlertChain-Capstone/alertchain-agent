# Running AlertChain locally with the real Bedrock agent

The backend and the frontend run in **Floci** (local AWS on Docker). Only the investigation
agent calls **real Amazon Bedrock** (Nova Micro, about $0.0001 per investigation). Everything
else, including the DynamoDB data, stays on your machine.

> **Live frontend needs [#18](https://github.com/AlertChain-Capstone/alertchain-agent/pull/18).**
> Until it is merged, `deploy-floci-frontend.ps1` on `main` still builds the mock frontend, where
> **Investigate** runs a simulated agent. To test the full flow before then, check out
> `fix/floci-real-bedrock` instead of `main` in step 1.

## What you need

- Windows with **Docker Desktop** running (Linux containers), **AWS CLI v2**, **Python 3.11+**
  and **Node.js/npm**.
- Your own sign-in to the team AWS account, set up as an AWS CLI profile named **`alertchain`**
  with Region `us-east-2`, with permission to call Bedrock (`bedrock:InvokeModel` on
  `us.amazon.nova-micro-v1:0`). Ask whoever manages the account if you don't have this.

## 1. Get the code

```powershell
git checkout main
git pull
npm ci
```

## 2. Start Floci

First time only, create the container:

```powershell
docker volume create alertchain-floci-data
docker run -d --name alertchain-floci -p 127.0.0.1:4566:4566 --mount source=alertchain-floci-data,target=/app/data --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock -e FLOCI_STORAGE_MODE=hybrid -e FLOCI_STORAGE_PERSISTENT_PATH=/app/data floci/floci:latest
```

On later sessions, start it instead:

```powershell
docker start alertchain-floci
```

## 3. Create the local stack and add alerts (first time only)

1. Install the backend's Lambda dependencies. Run this again whenever `backend/requirements.txt`
   changes:

   ```powershell
   powershell.exe -NoProfile -File .\scripts\vendor-backend-deps.ps1
   ```

2. Create the `alertchain-local` stack with the code block in the README's
   **Local Floci verification** section. It should end with `200` and `{"status":"ok"}`.
3. A new stack has no alerts. Add synthetic ones:

   ```powershell
   powershell.exe -NoProfile -File .\scripts\test-floci-ingestion.ps1
   ```

## 4. Connect the agent to real Bedrock and deploy the frontend

Use a **new** PowerShell terminal. The Floci setup in step 3 sets `AWS_ENDPOINT_URL` and fake
credentials in its terminal, and `aws login` run there opens Floci's sign-in page instead of AWS.

```powershell
aws login --profile alertchain
python -B scripts/floci-j11.py deploy --bedrock-profile alertchain
powershell.exe -NoProfile -File .\scripts\deploy-floci-frontend.ps1
```

The backend deploy should end with `Health: (200, ...)`. With #18 merged, the frontend deploy
ends with `Live build: API ... (CORS preflight passed)`.

## 5. Try it

Open <http://alertchain-frontend-local.s3-website-us-east-2.localhost.floci.io:4566/>, open an
alert and click **Investigate**. After a few seconds you should see real reasoning steps
(`get_related_events`, `check_actor_baseline`, ...) and a completed verdict with a severity and
a confidence.

## Troubleshooting

| You see | Fix |
| --- | --- |
| A step saying `Floci stub response…` | The backend was deployed without `--bedrock-profile`. Rerun step 4. |
| Canned steps about once a second | The frontend is the mock build: #18 isn't on your branch, or the page is cached. Rerun the frontend deploy, then press Ctrl+F5. |
| `ExpiredToken` | `aws login` credentials last a few hours. Rerun the first two commands of step 4. |
| `aws login` opens a Floci page | The terminal still has Floci settings. Open a new terminal. |
| `AccessDeniedException` | Your AWS user can't call Bedrock. Ask whoever manages the account. |
| `503 Investigations are temporarily unavailable` | Rerun `vendor-backend-deps.ps1`, then the backend deploy. |
| `floci-j11.py deploy` says the stack doesn't exist | Do step 3 first. The script only updates an existing stack. |

## What the agent looks at

The agent only uses alerts already stored in the local `alertchain-alerts` table. It does not
query CloudTrail, GuardDuty or IAM during an investigation. Its tools:

- `get_related_events`: the alert (including its raw event) and up to 25 other alerts from the
  same principal.
- `check_actor_baseline`: compares the actor with a "normal" baseline. No baseline data exists
  yet, so it always reports that there is no baseline.
- `create_incident`: opens an incident when the model judges the activity malicious.
