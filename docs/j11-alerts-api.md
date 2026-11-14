# J11 FA1 backend contract

This is the implemented backend contract, pending deployment and Floci verification.
FA1 frontend integration is implemented in source; live Floci verification remains pending.
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
| GuardDuty API-call/network-connection action `remoteIpDetails.ipAddressV4` or `ipAddressV6` | `sourceIp` |
| GuardDuty `description` | `summary` |
| Selected CloudTrail event name | Factual event-specific summary |

Unknown access keys, IPs, and summaries are null. Multi-IP probe findings do not invent a
single source IP. Ingestion still writes status `New`; J11 adds no status-transition writes.
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

Before Floci completion:

1. The shared client and FA1 screens are connected in source, with mock mode, field mappings,
   numbered pages, a fixed fixture clock, and independent optional loading/retry states.
2. Review the frontend configuration below and use the actual local API URL for live testing.
3. Coordinate real UUID alert handoff with FA2 and live incident reporting with FA3.
4. After deployment authorization, update the existing local backend stack and configure
   the actual frontend origin. Verify processed routes, CORS/preflight and scoped IAM.
5. Run the existing J10 Floci EventBridge ingestion smoke test, then exercise all four
   endpoints for the generated IDs. Use All time or fixture-appropriate time bounds;
   J10 fixtures contain older timestamps. Allow bounded retries for GSI propagation.
6. Verify search, combined filters, page totals/ties/boundaries, missing records, raw JSON,
   and zero/one/multiple incident outcomes using isolated synthetic incident records.
7. Verify the live browser Network/Console and independent retry behavior. Separately
   regress mock mode: the existing Floci frontend deploy script forces mock mode and
   cannot prove live integration unchanged.
8. Record Floci findings separately from AWS IAM/CORS parity checks. SAM CLI is not present
   in the inspected environment; offline YAML/structure checks are not SAM transform validation.

No deployment or Floci mutation is part of this backend implementation step.

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
page changes, Retry, and detail/back navigation retain that window. All time omits `from`
but retains the reference-time upper bound, matching the prototype's exclusion of future
events. Mock mode uses `2026-10-17T16:00:00Z` and the existing fixtures/scenarios. Empty lists,
filtered-empty results, transient errors, and a page that became out of range have distinct
states. Exact totals come from the response, not a second frontend filtering pass.

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

The controlled HTTP tests verify frontend behavior, not an actual Lambda/Floci round trip
or CORS across origins. The outstanding Floci checklist above still applies.
