# Run the preserved local integration

Use `feature/fa1-arch_2`. Existing Floci container, volume, stack, API, Lambda, and
four tables are retained. Do not recreate the container, reseed, or run teardown.

## Demonstrate

Open <http://alertchain-frontend-local.s3-website-us-east-2.localhost.floci.io:4566/#/alerts>.
This serves the integrated build from Floci S3 with mock mode disabled; Vite is
not required. Screen-share for remote teammates: this URL resolves to loopback.

1. Set **Time range > All time**. Events are dated November 1; Last 24 hours hides
   them. Refresh resets the filter.
2. Show the three pages (6, 6, 5 alerts), containing all 17 stored alerts and the
   14 original cases.
3. Search `StopLogging`, select AWS CloudTrail / High, and show the five matches.
4. Click an alert ID to show normalized fields and stored raw JSON.
5. In DevTools > Network > Fetch/XHR, show local API requests while filtering,
   paging, or opening details. Details/raw JSON/incident association are separate GETs.

**Investigate is a real API action.** The backend is prepared for real Bedrock
Nova Lite in `us-east-2`; clicking it can incur AWS usage charges and send the
selected alert/related events to AWS. The user skipped the charged test. Neither
a completed real-model investigation nor analysis quality was verified. Exported
temporary credentials expire; expired credentials cause a failure, not fixture fallback.

Dashboard, incident reports, and Ask the Agent still use FA3 prototype data. Live
association works, but opening a live incident report remains disabled.

## Resume the existing environment

Inspect the existing container, and start it only if stopped:

```powershell
docker inspect alertchain-floci --format '{{.State.Running}}'
# Only if false:
docker start alertchain-floci
```

The website/backend persist in Floci. Open the website first; restarting a demo
does not require redeployment. For frontend development instead, run from the repo:

```powershell
npm run dev -- --host 127.0.0.1 --port 5182 --strictPort
```

Reuse an existing Vite process on 5182. The preserved ignored `.env.local` sets
`VITE_USE_MOCK=false` and both API aliases to
`http://f863b23b16.execute-api.localhost.floci.io:4566`. Both clients now agree on
alias precedence. CORS allows this Vite origin and the Floci website.

## Update local code or refresh Bedrock credentials

These commands update only the existing local stack/website. Use a clean PowerShell
session, separate from terminals with dummy Floci credentials. Confirm selected Region
in AWS Settings > View all projects > Overview > Additional Info > Region. Read-only
checks confirmed `us-east-2`, profile `alertchain`, and FREE/ACTIVE; no paid upgrade occurred.

```powershell
# The newer installed CLI supports the login credential provider.
$env:PATH = "$env:LOCALAPPDATA\Programs\Amazon\AWSCLIV2;$env:PATH"
aws login --profile alertchain

# Only after requirements change or if backend/vendor is absent:
powershell.exe -NoProfile -File scripts/vendor-backend-deps.ps1

python -B scripts/floci-j11.py deploy --origin http://127.0.0.1:5182 --bedrock-profile alertchain --bedrock-model-id amazon.nova-lite-v1:0
powershell.exe -NoProfile -File scripts/deploy-floci-frontend.ps1
```

All deployment/storage commands are pinned to Floci and use dummy credentials.
Only Bedrock receives exported profile credentials. The helper rejects removals/
replacements and checks table IDs and pre-update records. Its OS-temp evidence can
contain credential parameters: keep it private and outside Git. Credentials are not
automatically refreshed inside Lambda; refresh login and redeploy locally if expired.

Omitting `--bedrock-profile` deliberately uses Floci's stub, which is only a
connectivity diagnostic. Do not describe its placeholder output as a real verdict.

## Repeat validation

Read-only actual browser/database comparison, using installed Edge:

```powershell
node scripts/verify-floci-browser.mjs
```

`--associations` creates two ownership-marked incident rows, tests association
states, and removes only those rows in a finally block. It never edits an alert.
Evidence/manifests go to ignored `test-results/integration/`.

`--investigate` starts one investigation. A real endpoint additionally requires
`--allow-real-bedrock`; obtain usage approval before supplying it. Generated
investigation/evidence/incident rows are archived with exact ownership keys for
reviewed cleanup; the verifier never broadly deletes records.

See [the integration report](fa1-main-integration-2026-11-16.md) for results and limits.
