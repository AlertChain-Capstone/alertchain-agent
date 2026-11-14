# J11 FA1 backend contract

This is the implemented backend contract. Local Floci deployment, API checks, and the
reported Chrome live-screen checks passed on November 14, 2026; independent browser
Network-panel inspection and real AWS verification remain pending.
The existing single Lambda, ingestion writes,
health response, FA2/FA3 repository interfaces, table keys and indexes are preserved.

## Operations and routes

| J6/J7 operation | HTTP route | Result |
| --- | --- | --- |
| `listAlerts(filter, page, pageSize)` | `GET /alerts` | `AlertPage` |
| `getAlertDetails(alertId)` | `GET /alerts/{alertId}` | Normalized and derived detail fields |
| `getRawEvent(alertId)` | `GET /alerts/{alertId}/raw-event` | `{ alertId, rawEvent }` |
| `getAssociatedIncidentId(alertId)` | `GET /alerts/{alertId}/associated-incident` | `{ alertId, status, incidentId }` |

All responses use JSON. IDs match `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}` and are opaque:
existing `ALT-*` fixture IDs and live UUID IDs are both valid. Path IDs should be URL-encoded.
These are API paths; the frontend's `#/alerts/...` routes are separate browser routes.

The detail endpoint does not invoke the raw-event repository operation or incident lookup.
It does not include `rawEvent` or `incidentId`. The frontend can display normalized details
while either optional request is loading, failing, or being retried. It must distinguish
an optional read failure from a successful read returning null or no association.

## Alert list

| Query parameter | Default | Accepted values / semantics |
| --- | --- | --- |
| `search` | empty | Trimmed, case-insensitive substring of ID, event name, or principal |
| `severity` | all | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `source` | all | `Amazon GuardDuty`, `AWS CloudTrail` |
| `status` | all | `New`, `Under investigation`, `Closed · Benign`, `Closed · False positive`, `Resolved` |
| `from` | no lower bound | Inclusive event time, ISO 8601 with timezone |
| `to` | no upper bound | Inclusive event time, ISO 8601 with timezone |
| `page` | `1` | Positive integer |
| `pageSize` | `6` | Integer from 1 to 100 |

Filters combine with AND; the three searchable fields combine with OR. Blank text filters
mean all. Unknown/repeated parameters, invalid enum values, nonpositive/noninteger page
values, invalid time bounds, and `from > to` return 400. Times require seconds, optional
1–6 fractional digits, and `Z` or an explicit `±HH:MM` offset; responses normalize to UTC.
Encode positive offsets' `+` as `%2B` in query strings. Detail/raw/association routes accept
no query parameters.

Example: `GET /alerts?search=stoplogging&severity=HIGH&page=1&pageSize=6`

```json
{
  "alerts": [
    {
      "id": "A-1",
      "eventName": "StopLogging",
      "source": "AWS CloudTrail",
      "severity": "HIGH",
      "status": "New",
      "occurredAt": "2026-11-14T14:30:00.000000Z",
      "createdAt": "2026-11-14T14:31:00.000000Z",
      "principal": "dev-ci-user",
      "resource": "sample-trail",
      "region": "us-east-2"
    }
  ],
  "totalAlerts": 1,
  "page": 1,
  "pageSize": 6
}
```

`totalAlerts` counts every matching alert before page slicing. Empty results return an
empty array and zero total. An out-of-range page returns an empty array, the full matching
total, and the requested page unchanged. There is no cursor in this contract.

### Pagination cost and consistency

`DynamoDBAlertRepository` queries `alertsByTime` with `alertCollection = ALERTS` and
`ScanIndexForward=False`. The existing fixed-width UTC `eventTimeAlertId` key orders by
event time descending, then alert ID descending on ties. Time bounds narrow the key range.
The repository follows every `LastEvaluatedKey`, filters each candidate, counts all matches,
and retains only the requested page. An empty database page is not the end when a continuation
key exists. Failure on any page returns an error, never a partial total.

Each request, including later page numbers, reads its whole candidate time range. Search,
severity, source and status are filtered in the application. Projecting normalized fields
reduces response payload/memory, not billed reads. The index still projects ALL attributes,
including potentially large raw details. Cost and latency scale with the candidate data,
not just `pageSize`; the `ALERTS` partition also concentrates traffic. This approach is for
the small capstone sandbox, not a high-volume alert feed. A different production strategy
requires a separate design decision, including any pagination/UI/diagram changes.

The GSI is eventually consistent. `totalAlerts` is the complete count from that traversal,
not an estimate, but it is not an atomic snapshot. Newly ingested alerts may briefly be
absent, and concurrent writes can change counts or shift records between page requests.
Base-table detail/raw reads use `ConsistentRead=True`. A list failure/timeout remains a
failure; results are never silently truncated to fit a read budget.

See [AWS Query semantics](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html)
and [Query read capacity and counts](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Other.html).

## Alert details and mapping

`GET /alerts/A-1` returns all the list-item fields above, plus:

```json
{
  "accessKeyId": "DEMO-CALLER-KEY",
  "sourceIp": "203.0.113.45",
  "summary": "A StopLogging event was detected for a monitored trail."
}
```

This snippet shows additional fields, not a separate response envelope.

| Storage / raw detail | API / existing FA1 view |
| --- | --- |
| `alertId` | `id` |
| `eventTime` | `occurredAt` |
| `createdTime` | `createdAt` |
| `eventName`, `source`, `status`, `region` | Same field names and stored values |
| `severity` | Uppercase enum; shared client maps to Low/Medium/High/Critical labels |
| Missing/null `principal` or `resource` | Explicit JSON null; UI shows Not available and searches safely |
| CloudTrail `userIdentity.accessKeyId` | `accessKeyId`, always the caller's key, never a newly created target key |
| CloudTrail `sourceIPAddress` | `sourceIp` |
| GuardDuty `resource.accessKeyDetails.accessKeyId` | `accessKeyId` |
| GuardDuty API-call action `remoteIpDetails.ipAddressV4` or `ipAddressV6` | `sourceIp` |
| GuardDuty network-connection action | `sourceIp`: remote IP for INBOUND, local IP for OUTBOUND; null when direction or the source endpoint is unavailable |
| GuardDuty `description` | `summary` |
| Selected CloudTrail event name | Factual event-specific summary |

Unknown access keys, IPs, and summaries are null. Multi-IP probe findings do not invent a
single source IP. Ingestion still writes status `New`; J11 adds no status-transition writes.
Network destination IPs are not relabeled as source IPs; see the
[GuardDuty network action fields](https://docs.aws.amazon.com/guardduty/latest/APIReference/API_NetworkConnectionAction.html).
Adding the existing UI status labels to the enum makes reads compatible without changing
what ingestion writes. FA1 includes a Critical filter option and danger badge treatment.

## Raw event

`GET /alerts/A-1/raw-event`:

```json
{
  "alertId": "A-1",
  "rawEvent": {
    "eventName": "StopLogging",
    "sourceIPAddress": "203.0.113.45"
  }
}
```

The example raw object is abbreviated. The implementation returns the complete stored
`rawEvent` without truncation or enrichment: the original source event detail, not the
EventBridge envelope. DynamoDB Decimal numbers become JSON numbers recursively; nulls,
booleans, arrays and objects are preserved. No raw data is rewritten in storage.

An existing alert with absent/null raw detail returns 200 with `rawEvent: null`. A missing
alert returns 404. The raw operation reads the raw fields independently, without requiring
the other normalized attributes to deserialize successfully.

## Temporary incident association: coordinate with FA2/FA3

`GET /alerts/A-1/associated-incident` returns 200 for all three successful lookup outcomes:

```json
{ "alertId": "A-1", "status": "none", "incidentId": null }
```

```json
{ "alertId": "A-1", "status": "associated", "incidentId": "INC-ABC12345" }
```

```json
{ "alertId": "A-1", "status": "ambiguous", "incidentId": null }
```

The FA1-owned `AlertIncidentLookup` port / `DynamoDBAlertIncidentLookup` adapter scans
existing incident items for exact `alert_id` equality, reading `incident_id`. It follows
scan pages, including empty filtered pages. Zero matches produce none; one produces its ID;
two distinct matches establish ambiguity immediately, without choosing or ranking them.
No alphabetical/newest selection is made. There is no new index, migration, or modification
to FA2's `IncidentRepository`, investigation writer, or FA3 data contract.

This matches FA2's primary `alert_id` association only. It does not infer that every alert
cited as incident evidence has a primary association. Scans cost reads proportional to the
incident table and are not atomic snapshots. A storage failure is 503, not none. A missing
alert is 404 and does not scan incidents. No incident lookup occurs on list/detail/raw reads.

Design coordination needed: `getAssociatedIncidentId` now returns a result with an explicit
ambiguity state, rather than only a nullable ID. FA2/FA3 should agree future primary-incident
semantics before replacing this temporary lookup. The frontend should show an ambiguity
message without an Open incident link; live reports still depend on FA3's backend integration.
Mock mode should preserve FA1's explicit fixture incident references.

## Errors, CORS, and architecture

Errors use `{ "error": { "code": "...", "message": "..." } }`:

| HTTP status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_QUERY` | Invalid filters, pagination or unexpected query parameters |
| 400 | `INVALID_ALERT_ID` | Malformed alert ID |
| 404 | `ALERT_NOT_FOUND` | Alert absent for the requested operation |
| 503 | `SERVICE_UNAVAILABLE` | Storage/configuration/read failure; optional requests can retry independently |

The controller also handles unknown alert subroutes (404 `NOT_FOUND`) and non-GET requests
(405 `METHOD_NOT_ALLOWED`, `Allow: GET`) when invoked directly. SAM exposes only the four
specified GET routes, so API Gateway may reject other paths/methods before Lambda runs.
Errors do not expose storage exception details to clients.

Python names follow the repository convention: `list_alerts`, `get_alert_details`,
`get_raw_event`, `get_associated_incident_id`. `AlertController` validates/serializes HTTP,
`AlertService` implements the use cases/enrichment, and `AlertRepository` /
`DynamoDBAlertRepository` implement persistence. `AlertFilter`, `AlertPage`, and
`IncidentAssociation` are domain contracts. The service receives incident lookup lazily,
so incident configuration/failure cannot block normalized details.

The handler adds only alert dispatch. Existing health/ingestion dispatch stays intact.
FA2's router exports remain available through lazy package imports, avoiding a FastAPI
dependency for FA1 reads. Existing investigation HTTP/job dispatch gaps are unchanged and
remain team integration work; J11 does not silently implement those unrelated paths.

SAM adds Query on `alertsByTime` and Scan on the incidents table. Existing GetItem access
already covers alert details/raw reads. CORS is managed by HTTP API Gateway, using the
`CorsAllowedOrigins` comma-delimited SAM parameter, defaulting to `http://localhost:5173`
and `http://127.0.0.1:5173`. Override it with the actual frontend origin(s), including scheme
and port, for Floci/other environments. GET, POST and OPTIONS are allowed; Content-Type is
allowed; preflight max age is 600 seconds. POST preserves compatibility with the declared
FA2 API. Credentials are not enabled. Lambda does not reflect arbitrary Origin headers.
Gateway adds response headers and handles preflight; direct Lambda unit tests cannot prove
browser CORS behavior. See [AWS HTTP API CORS](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html).

## Verification and remaining integration

Backend tests: `python -B -m pytest backend/tests -q -p no:cacheprovider`, using an environment
with pytest, boto3/botocore, FastAPI and httpx already available. Tests make no AWS requests.
The focused contract tests are in `backend/tests/test_alert_reads.py`.

### Local Floci checkpoint — November 14, 2026

Deployment and API checks passed against the existing `alertchain-local` stack in
`alertchain-floci` at `127.0.0.1:4566`, region `us-east-2`. No real AWS services were accessed.
The stack retained one Lambda, all four table physical IDs, and every pre-update record.
SAM CLI was unavailable; Python syntax validation, Floci `validate-template`, AWS CLI
`cloudformation package`, and an inspected UPDATE change set were used instead. This does
not establish validation through SAM CLI or real AWS.

The API ID was discovered from the stack resources and checked through API Gateway metadata.
Floci returns an AWS-shaped `ApiEndpoint`; that public hostname was not requested. The
documented Floci hostname using the discovered ID was resolved to loopback and verified:

- API: `http://f863b23b16.execute-api.localhost.floci.io:4566`
- Live frontend: `http://127.0.0.1:5173/#/alerts`

The frontend URL requires its local Vite process to remain running. The API ID is specific
to this existing stack; reruns discover it rather than relying on this recorded value.
Use All time when browsing the ingestion fixtures, whose event times are November 1.

| Check | Result |
| --- | --- |
| Existing J10 smoke test through EventBridge | Passed for fresh synthetic GuardDuty, CreateAccessKey, and StopLogging events |
| Actual HTTP alert list/detail and raw-event reads | Passed; returned raw detail matched the source fixtures, with their generated identity fields |
| Search, combined filters, inclusive time bounds | Passed |
| Numbered pagination, exact totals, stable descending time/ID order | Passed, including no duplicate rows and an out-of-range page |
| Missing-alert and invalid/repeated-input responses | Passed: expected 404 and 400 responses |
| Incident association | Passed for none, one associated ID, and explicit ambiguity for multiple matches |
| Duplicate handling | Acknowledged synchronous Lambda redeliveries returned duplicate and preserved complete stored alerts, including creation times; initial ingestion was independently verified through EventBridge |
| Data preservation | Passed; original data remained unchanged and only the verification run's synthetic incident records were removed |
| CORS | Allowed frontend origin received headers/preflight response; unrelated origin received no allow-origin header |

Floci's SAM transform omitted `CorsConfiguration`; initial preflight returned 404. The
local-only verification helper applies the declared settings through `apigatewayv2 update-api`
when absent/different, then checks metadata and preflight. This is an emulator workaround,
not a change to the application's AWS template or evidence of AWS IAM/CORS parity.

Chrome browser review, reported by the reviewer and recorded at this checkpoint:

- Passed live alert listing, pagination, combined search/source filtering, alert details,
  raw JSON display, returning to the list, and detail-page refresh against Floci.
- No warnings or errors appeared in the captured browser logs.
- List filters reset after a full refresh. Filters/page survive ordinary detail/back
  navigation; they are held in React state and are not persisted across full reloads.
- The browser Network panel was **not independently inspected**. Successful screens and
  captured logs do not establish a complete network-request audit.

Remaining work: independently inspect browser Network requests; verify real AWS deployment,
IAM and CORS behavior in a separately authorized sandbox session; and coordinate live alert
handoff with FA2 and live reports with FA3. Those live handoffs remain disabled in FA1.
Independent optional-request failure/retry and stale-response behavior passed the controlled
frontend tests; they were not separately fault-injected in this Floci browser review.

### Repeatable local verification helper

Prerequisites: Python 3.11+, AWS CLI v2, PowerShell 5.1+ for the existing ingestion script,
and the existing running Floci stack/container. The helper does not install dependencies,
create a replacement stack, tear down resources, or start the frontend server.

```powershell
python -B scripts/floci-j11.py inspect
python -B scripts/floci-j11.py deploy --origin http://127.0.0.1:5173
python -B scripts/floci-j11.py verify --origin http://127.0.0.1:5173
```

`inspect` is read-only. `deploy` packages a temporary backend copy excluding tests, bytecode,
and .env files into the existing local artifact bucket, rejects change sets with resource
removals or replacements, updates the existing stack, and compares table IDs and stored
records before/after. `verify` runs the existing smoke script with fresh IDs, then exercises
the real HTTP endpoints. To reuse exactly three IDs from an already-passed smoke run, pass
`--alert-ids <guardduty-id>,<create-access-key-id>,<stop-logging-id>` instead.

All AWS CLI calls explicitly use the fixed loopback endpoint and dummy credentials in
child-process environments. Inherited profiles and endpoint overrides are removed, including
for the nested package uploader and ingestion smoke script. API HTTP requests use a discovered
Floci hostname only after checking loopback resolution. Parent environment settings are not
changed. Generated packages, snapshots, payloads, and results stay under the printed OS
temporary evidence directory; they are not repository source or commit inputs.

Each fresh smoke run leaves three synthetic alert records. Association checks conditionally
create two uniquely named synthetic incidents, then conditionally delete only records owned
by that verification run. Existing alerts and incidents are never deleted. Post-verification
snapshots check that baseline data is unchanged. Run without concurrent writers so exact
snapshot comparisons are meaningful; do not use Python optimization flags, which disable
the verification assertions. Verification does not prove production-scale performance or
replace independent browser/AWS checks.

## FA1 frontend configuration and behavior

`src/shared/api.js` exports `AlertApiClient` with `listAlerts`, `getAlertDetails`,
`getRawEvent`, and `getAssociatedIncidentId`. Operations return mapped alert fields or the
raw/association envelopes documented above. They accept an optional `{ signal }` argument;
for list calls it is the fourth argument, after filter/page/pageSize. The client validates
response identities, pagination metadata, and association outcomes before displaying them.

| Configuration | FA1 behavior |
| --- | --- |
| `VITE_USE_MOCK=true` | Fixtures, even if an API URL is configured; no FA1 API calls |
| No nonblank API URL configured | Fixtures, preserving the existing default convention |
| `VITE_API_URL` configured and mock is not `true` | Live FA1 reads |
| Only legacy `VITE_API_BASE_URL` configured | Live FA1 reads, for compatibility |
| Both URL variables configured | FA1 uses `VITE_API_URL` |

Vite settings are applied when starting the dev server or building. Restart/rebuild after
changing them. In PowerShell, for a local development session:

```powershell
$env:VITE_API_URL = '<actual local API Gateway base URL, including any stage>'
$env:VITE_USE_MOCK = 'false'
npm run dev
```

Use the actual deployed API base URL, not Floci's service endpoint by assumption. CORS must
allow the frontend's complete origin. Do not put AWS credentials or other secrets in Vite
variables: those variables are public frontend configuration. No .env file is required.

To return to mock mode, set `VITE_USE_MOCK=true` and restart/rebuild. An explicit live request
failure never falls back to fixtures. Invalid successful responses also remain errors. Sources
and monitored-event editing remain simulated regardless of FA1 alert mode and retain their
prototype labels. The existing Floci frontend deploy script forces mock mode; it is unchanged
and is not evidence of live integration.

List filters run on the server in live mode. The client translates severity labels and time
ranges into API values. A filter change freezes one reference time and resets page to one;
page changes, Retry, and detail/back navigation retain that window. A full refresh resets
the list filters/page to their defaults. All time omits `from`
but retains the reference-time upper bound, matching the prototype's exclusion of future
events. Mock mode uses `2026-10-17T16:00:00Z` and the existing fixtures/scenarios. Empty lists,
filtered-empty results, transient errors, and a page that became out of range have distinct
states. An out-of-range live page is explicitly marked unavailable and offers a return to
page one, including when the matching total drops to zero. Exact totals come from the
response, not a second frontend filtering pass.

Normalized details load first. Once they succeed, raw-event and incident requests start
independently. Each optional section owns its loading/error/retry state, leaving details
visible. Null raw events remain distinct from failed retrieval; copy is disabled until JSON
is available. A missing normalized alert shows the unavailable state; transient detail failures
offer Retry. Request cleanup aborts fetch and guards late completions; response keys also
prevent an older filter's data from appearing during a newer request.

### Teammate handoff boundaries

Mock Investigate and Open incident retain their existing fixture handoffs. Live mode disables
both actions, including for IDs that happen to resemble fixtures, and explains that live
investigations/reports are not connected. Associated live IDs still display as read-only
information; none and ambiguous states offer no incident action.

The reason is the current shared shell forwards only `alert.id` to FA2, whose imperative
handoff resolves it with `alertById` from fixtures. FA3 similarly resolves incident reports
from fixtures. `VITE_API_URL` configures FA1; FA2's unchanged optional client still uses
`VITE_API_BASE_URL`. Configuring FA1 does not connect teammates' screens, nor does setting
the old variable fix the backend investigation HTTP/job dispatch gaps described above.
No FA2/FA3 files or shared shell handoff implementation were changed.

### Frontend verification

- `npm test`: Node client/data tests, including FA1 live/error/abort/contract mapping and fixtures.
- `npm run lint` and `npm run build`: static checks and production build.
- `npm run test:e2e`: mock browser regressions and cross-area navigation; use mock configuration.
- `npm run test:fa1-live`: separate Vite server on port 5180 with controlled live-mode HTTP
  responses. Covers server query/page wiring, independent failures/retry/copy, association
  states, stale responses even with a transport ignoring abort, and narrow-screen layout.
- If the installed Playwright Chromium version is absent, use installed Edge with
  `$env:PW_CHANNEL = 'msedge'` before either browser command; no browser install is required.

The controlled HTTP tests verify frontend behavior independently of the actual Floci checks
recorded above. Independent browser Network-panel inspection, real AWS verification, and
FA2/FA3 live handoffs remain pending.

### Pre-push review fixes (not redeployed)

Review against main base `c6da7ccb78155dfe2ac6fe7ce81042b11539e340` reproduced and fixed:

- GuardDuty network source-IP derivation previously treated a remote destination as the
  source on outbound connections. It now uses direction and preserves null for unknown sources.
- Impossible numeric timezone offsets such as `+00:99` were normalized by Python instead
  of rejected. The API now rejects invalid offset hours/minutes with 400 before querying.
- A retained list page could display `Page 2 of 1`, and when its total fell to zero it lost
  the explicit page-recovery state. It now marks the page unavailable and offers page one.

Regression coverage includes these cases and an isolated cold-start check proving FA1 reads
do not import FastAPI. Tests used local fakes/controlled browser responses; this review did
not redeploy or rerun the unchanged Floci integration checks. The Floci checkpoint above
describes the deployed checkpoint, not verification of these newer review fixes.

The exact class, operation, data, sequence, and deployment-diagram changes are listed in
[J11 Visual Paradigm updates](j11-visual-paradigm-updates.md). No Visual Paradigm project was edited.
