# Run the preserved local integration

Use `feature/fa1-arch_2`. Existing Floci container, volume, stack, API, Lambda, and
four tables are retained. Do not recreate the container, reseed, or run teardown.

The supported workflow uses Floci's local Bedrock stub. The November 25 verification
confirmed local DynamoDB, Lambda and Bedrock endpoints with no real Bedrock
credentials. The intended model ID remains `us.amazon.nova-micro-v1:0` in
`us-east-2`; carrying that ID in a stub request does not verify Nova Micro inference.
See [the verification report](local-floci-verification-2026-11-25.md) for dated results.

## Demonstrate

Open <http://alertchain-frontend-local.s3-website-us-east-2.localhost.floci.io:4566/#/alerts>.
This serves the integrated build from Floci S3 with mock mode disabled; Vite is
not required. Screen-share for remote teammates: this URL resolves to loopback.

1. Set **Time range > All time** to include older fixtures. Last 24 hours can hide
   them. Refresh resets the filter.
2. Browse the pages and totals shown by the API. Counts vary as local tests add data.
3. Search `StopLogging` and select AWS CloudTrail / High to show matching stored alerts.
4. Click an alert ID to show normalized fields and stored raw JSON.
5. In DevTools > Network > Fetch/XHR, show local API requests while filtering,
   paging, or opening details. Details/raw JSON/incident association are separate GETs.

**Investigate and Ask use the local API.** With the supported deployment below, model
requests go to Floci's placeholder. A new investigation can finish in
`NEEDS_HUMAN_REVIEW` with no conclusion; Ask may return a limitation rather than a
useful answer. Stored reports and evidence remain available. The earlier grounded
Ask verification used a temporary deterministic local substitute that is no longer
running. Actual Nova Micro inference remains unverified.

Combined source now includes live FA3 reports/questions and enables associated
incident navigation. An older deployed backend/build does not gain these routes
until separately updated. The November 16 reports describe that earlier deployment.

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
alias precedence. The update command below allows this Vite origin and the Floci website.

## Update local code using the supported Floci stub

These commands update the existing local stack/website. No AWS login or real model
profile is required. Omitting `--bedrock-profile` selects the local stub and supplies
empty real-Bedrock credential parameters.

```powershell
# Only after requirements change or if backend/vendor is absent:
powershell.exe -NoProfile -File scripts/vendor-backend-deps.ps1

python -B scripts/floci-j11.py deploy --origin http://127.0.0.1:5182
powershell.exe -NoProfile -File scripts/deploy-floci-frontend.ps1
```

All deployment/storage commands are pinned to Floci and use dummy credentials.
The helper rejects removals/replacements and checks table IDs and pre-update
records. Keep its OS-temp evidence private and outside Git. The stub is only a
connectivity diagnostic; do not describe its placeholder output as a real verdict.

## Future real-model setup (not enabled by this workflow)

The intended Micro profile requires cross-Region inference. The existing helper
unconditionally rejects `us.`, `eu.`, `apac.` and `global.` model IDs whenever
`--bedrock-profile` is supplied, before exporting credentials or contacting a
service. It does not discover project policy or lift the block in another account.
It also rejects the bare `amazon.nova-micro-v1:0` ID. This restriction is unchanged.

An environment/policy decision and a separately reviewed implementation change
would be required before enabling the intended real profile. Changing accounts,
logging in again, or selecting another Region does not remove the helper's guard.
There is no automatic Lite fallback. See [local setup](local-setup.md) for the
future integration boundary; do not use the old real-profile commands as startup steps.

## Repeat validation

Read-only actual browser/database comparison, using installed Edge:

```powershell
node scripts/verify-floci-browser.mjs
```

`--associations` creates two ownership-marked incident rows, tests association
states, and removes only those rows in a finally block. It never edits an alert.
Evidence/manifests go to ignored `test-results/integration/`.

`--investigate` starts one investigation; use it with the verified local-stub
configuration. The verifier's separate `--allow-real-bedrock` flag does not enable
the deployment helper's blocked profile path and is not part of this workflow. Generated
investigation/evidence/incident rows are archived with exact ownership keys for
reviewed cleanup; the verifier never broadly deletes records.

See [the November 25 verification report](local-floci-verification-2026-11-25.md)
for results and limits. The [November 16 integration report](fa1-main-integration-2026-11-16.md)
describes an earlier deployment.
