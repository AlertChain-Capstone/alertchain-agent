# Running AlertChain locally with the Floci Bedrock stub

The supported local workflow runs the backend, frontend, storage and Bedrock
placeholder in **Floci** (local AWS on Docker). It requires no real AWS login or
model credentials. The model identifier remains `us.amazon.nova-micro-v1:0`, but
Floci's placeholder is not Nova Micro inference. Actual Nova Micro inference
remains unverified. Future real-model integration is described separately below.

> PR #18 is merged. For the existing preserved Floci environment, use
> [the integration startup instructions](fa1-integration-startup.md).
> The [November 25 verification report](local-floci-verification-2026-11-25.md)
> records the combined FA1/FA3 deployment, live stored reports, and local-substitute
> Ask checks. November 16 architecture/integration documents are historical.

## What you need

- Windows with **Docker Desktop** running (Linux containers), **AWS CLI v2**, **Python 3.11+**
  and **Node.js/npm**.
- Intended model: **Nova Micro**, exact ID `us.amazon.nova-micro-v1:0`, called
  through Bedrock Runtime in `us-east-2`. This is the US inference profile, not
  the bare `amazon.nova-micro-v1:0` model (which has no in-Region support in Ohio).
- The model profile is carried as configuration in local stub requests. Do not
  supply `--bedrock-profile` for this workflow. There is no automatic Lite fallback.

## 1. Get the code

```powershell
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

## 4. Deploy the backend and frontend using the local stub

From the repository, update the existing local stack. The helper pins service
operations to Floci with dummy credentials. With no `--bedrock-profile`, it sets
the model endpoint to `http://host.docker.internal:4566` and supplies empty
real-Bedrock credential parameters. It preserves table IDs and pre-existing records
and refuses resource removals/replacements. An unchanged deployment may finish in
`CREATE_COMPLETE` or `UPDATE_COMPLETE`; an executed update must reach `UPDATE_COMPLETE`.

```powershell
python -B scripts/floci-j11.py deploy --origin http://127.0.0.1:5182
powershell.exe -NoProfile -File .\scripts\deploy-floci-frontend.ps1
```

The backend deploy should end with `Health: (200, ...)`. The frontend deploy ends
with `Live build: API ... (CORS preflight passed)`. A Vite development server using
port 5182 is optional; the deployed website does not require it.

## 5. Try it

Open <http://alertchain-frontend-local.s3-website-us-east-2.localhost.floci.io:4566/>.
Browse the stored alerts; select **All time** to include older fixtures. Counts,
pages and filter results depend on the current local data, including retained tests.
Open an associated incident to review its stored report and evidence.

**Investigate** starts a real local API/job/persistence flow, but Floci's placeholder
can finish in `NEEDS_HUMAN_REVIEW` with no evidence or conclusion. **Ask the Agent**
uses the actual API but can return an insufficient-evidence limitation with this
stub. Do not expect a useful model verdict or a newly generated incident. The
verification report's grounded Ask answers used a temporary deterministic local
substitute; that substitute is not part of the normal running deployment.

## Troubleshooting

| You see | Fix |
| --- | --- |
| A step saying `Floci stub response…`, a limitation, or `NEEDS_HUMAN_REVIEW` | Expected placeholder behavior in the supported local-stub workflow; it does not establish Nova Micro inference. |
| Canned steps about once a second | The frontend is the mock build: #18 isn't on your branch, or the page is cached. Rerun the frontend deploy, then press Ctrl+F5. |
| `ExpiredToken` or real Bedrock `AccessDeniedException` | Inspect the effective model endpoint; an older deployment may still use real Bedrock. Redeploy with step 4 to select the supported local stub. |
| `503 Investigations are temporarily unavailable` | Rerun `vendor-backend-deps.ps1`, then the backend deploy. |
| `floci-j11.py deploy` says the stack doesn't exist | Do step 3 first. The script only updates an existing stack. |

## Future real-model setup (not enabled)

The intended US Micro profile can route across Regions. The existing helper
unconditionally rejects model IDs beginning `us.`, `eu.`, `apac.` or `global.` when
`--bedrock-profile` is supplied, before credential export or service calls. It also
rejects the bare `amazon.nova-micro-v1:0` identifier. The guard represents the
project's restriction; it does not query AWS policy, detect account capabilities,
or automatically allow a profile in a different environment. This behavior is unchanged.

Enabling the intended real profile would require an environment/policy decision
and a separately reviewed implementation change. Logging in again, switching
accounts, or selecting another Region does not remove the current guard. This
guide does not supply a real-profile startup command or an alternative model to
bypass the restriction.

The existing real-model integration uses Bedrock Runtime Converse, separate
profile-exported credentials and a public HTTPS endpoint; those requests can incur
charges and send selected event/evidence data to AWS. Before any future enablement,
the actual signing identity would need the relevant profile/destination model
permissions. Template declarations and Floci IAM emulation do not prove those
permissions or model access. Exported credentials expire and do not refresh inside
Lambda automatically. Private deployment parameter/configuration backups can
contain credentials even when parameters are marked NoEcho; keep them outside Git.

## What the agent looks at

The agent only uses alerts already stored in the local `alertchain-alerts` table. It does not
query CloudTrail, GuardDuty or IAM during an investigation. Its tools:

- `get_related_events`: the alert (including its raw event) and up to 25 other alerts from the
  same principal.
- `check_actor_baseline`: compares the actor with a "normal" baseline. No baseline data exists
  yet, so it always reports that there is no baseline.
- `create_incident`: opens an incident when the model judges the activity malicious.

Model/Region references: [Nova Micro model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-micro.html)
and [inference-profile permissions](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html).
