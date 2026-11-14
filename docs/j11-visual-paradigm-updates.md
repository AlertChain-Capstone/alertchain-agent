# J11 Visual Paradigm updates

Checklist against the final code, reviewed from main base `c6da7ccb78155dfe2ac6fe7ce81042b11539e340`.
No Visual Paradigm project was edited by this review. Keep the existing architectural class
names; annotate Python operation/field spelling rather than renaming the design classes.

## Class and operation diagrams

| Class | Final public operations / signatures |
| --- | --- |
| `AlertApiClient` (JavaScript) | `listAlerts(filter = {}, page = 1, pageSize = 6, options = {}) -> Promise<AlertPage>`; `getAlertDetails(id, options = {}) -> Promise<object>`; `getRawEvent(id, options = {}) -> Promise<{alertId, rawEvent}>`; `getAssociatedIncidentId(id, options = {}) -> Promise<{alertId, status, incidentId}>` |
| `AlertController` (Python) | `__init__(service: AlertService)`; `handle(event: dict[str, Any]) -> dict[str, Any]` (Lambda HTTP response) |
| `AlertService` (Python) | `__init__(alerts: AlertRepository, incident_lookup: Callable[[], AlertIncidentLookup])`; `list_alerts(filter: AlertFilter, page: int = 1, page_size: int = 6) -> AlertPage`; `get_alert_details(alert_id: str) -> dict[str, Any]`; `get_raw_event(alert_id: str) -> dict[str, Any] \| None`; `get_associated_incident_id(alert_id: str) -> IncidentAssociation` |
| `AlertRepository` (abstract Python port) | Preserve `store_if_absent(alert: NormalizedAlert) -> bool`; add `list_alerts(filter: AlertFilter, page: int, page_size: int) -> AlertPage`, `get_alert(alert_id: str) -> NormalizedAlert \| None`, `get_raw_event(alert_id: str) -> dict \| None` |
| `DynamoDBAlertRepository` | Implements `AlertRepository`; `__init__(table)`; same public read/write signatures |

In JavaScript, `options` supports `signal` for cancellation; list also accepts a mock-only
`demoScenario`. Do not turn those into server query parameters. Returned alerts are adapted
to FA1's display shape, including title-case severity labels and explicit nullable fields.

Annotate these Python equivalents on J6/J7 operation calls:

- `listAlerts` -> `list_alerts`; `pageSize` -> `page_size`.
- `getAlertDetails` -> service `get_alert_details`; repository read is named `get_alert`.
- `getRawEvent` -> `get_raw_event`.
- `getAssociatedIncidentId` -> service `get_associated_incident_id`.
- `storeIfAbsent`, if shown in the design, -> `store_if_absent`.

The actual controller exposes a single `handle(event)` dispatcher. Do not label nonexistent
public controller methods `list_alerts`/`get_alert_details`: those are service methods. A
conceptual controller operation may remain if explicitly marked as a route responsibility,
with the implementation mapping to `handle` and its internal `_handle` dispatcher.

Add these classes/interfaces and dependency arrows:

1. `AlertIncidentLookup` (abstract FA1 read port), operation
   `get_association(alert_id: str) -> IncidentAssociation`.
2. `DynamoDBAlertIncidentLookup`, realization of that port, constructor `__init__(table)`.
   It scans existing incident items by `alert_id`, returning their `incident_id`; no new index.
3. `IncidentAssociation`, immutable data class with `status: AssociationStatus` and
   `incident_id: str | None`.
4. `AssociationStatus`, enum with `NONE = "none"`, `ASSOCIATED = "associated"`,
   `AMBIGUOUS = "ambiguous"`.
5. `AlertNotFoundError` (domain exception), `InvalidQuery` (HTTP validation exception),
   and `AlertApiError` (JavaScript client exception, carrying `status` and `code`) if the
   diagrams show error types. These do not add server endpoints.

`AlertController` depends on `AlertService`. The service depends on `AlertRepository` and
a lazy factory for `AlertIncidentLookup`; the Lambda composition supplies both adapters.
Do not replace or rename FA2's existing `SecurityEventRepository`,
`DynamoDBSecurityEventRepository`, or `IncidentRepository`: those contracts are unchanged.

## Domain/data diagrams

- Preserve `AlertPage {alerts, totalAlerts, page, pageSize}` on the wire. Python fields are
  `alerts: list[NormalizedAlert]`, `total_alerts: int`, `page: int`, `page_size: int`.
- `AlertFilter` has `search: str`, optional `severity: Severity`, `source: str`,
  `status: AlertStatus`, `from_time: datetime`, `to_time: datetime`, plus
  `matches(alert: NormalizedAlert) -> bool`. HTTP uses `from`/`to`; UI `timeRange` becomes
  explicit bounds rather than being sent as a server parameter.
- `NormalizedAlert` contains `id`, `event_name`, `severity`, `status`, `event_time`,
  `created_time`, `source`, nullable `principal`/`resource`, `region`, and nullable
  `raw_detail: dict[str, Any] | None`. `Severity` reuses the existing investigation enum,
  including `CRITICAL`; no duplicate severity enum is introduced.
- `AlertStatus` supports `New`, `Under investigation`, `Closed · Benign`,
  `Closed · False positive`, and `Resolved`. Ingestion still writes only `New`; do not
  imply J11 implements status-transition persistence.
- Storage -> API mappings: `alertId` -> `id`, `eventTime` -> `occurredAt`,
  `createdTime` -> `createdAt`; `raw_detail` is stored/exposed by the raw endpoint as `rawEvent`.
- `accessKeyId`, `sourceIp`, and `summary` are derived detail-response fields, not new stored
  columns or fields on `NormalizedAlert`. Raw detail remains unchanged. A network source IP
  follows GuardDuty connection direction; unavailable direction/source produces null.
- Normalized details exclude `rawEvent` and `incidentId`. Optional responses have their
  own envelopes, including the requested `alertId` added by the controller.

## J6/J7 sequence and screen-state diagrams

1. List flow: FA1 -> `AlertApiClient.listAlerts` -> `GET /alerts` -> shared Lambda ->
   `AlertController.handle` -> `AlertService.list_alerts` -> repository `list_alerts` ->
   DynamoDB `alertsByTime`. The repository follows all database query pages, applies
   `AlertFilter.matches`, counts all matches and retains the requested numbered page.
   Return `AlertPage`; keep page numbers and exact totals, with no cursor operation.
2. Ordering: event time descending, then alert ID descending on ties. Mark the GSI as
   eventually consistent and the count as a complete traversal, not an atomic snapshot.
3. Detail flow: `getAlertDetails` -> `GET /alerts/{alertId}` -> controller ->
   `get_alert_details` -> repository `get_alert`. Missing alert: 404. Successful normalized
   fields become visible before the optional operations begin.
4. Use a parallel fragment for `getRawEvent` and `getAssociatedIncidentId`, each owning
   its loading/error/retry state. Raw flow calls repository `get_raw_event` through its own
   service method at `GET /alerts/{alertId}/raw-event`. An existing alert with no raw detail
   returns 200/null; a missing alert returns 404.
5. Association flow at `GET /alerts/{alertId}/associated-incident`: service checks alert
   existence, then invokes `AlertIncidentLookup.get_association`. Add three alternatives:
   zero matches -> `{status: "none", incidentId: null}`; one -> `{status: "associated",
   incidentId: "..."}`; multiple -> `{status: "ambiguous", incidentId: null}`. Never select
   by alphabetical order or claim the latest incident. This changes a nullable-ID return
   into an explicit result object. Add the requested `alertId` to each HTTP envelope.
6. Storage failures return 503 and remain distinct from null/no association/not found.
   Retrying an optional operation leaves normalized details visible. Validation errors
   return 400. API Gateway can reject unmatched routes/methods before Lambda dispatch.
7. Filter changes reset to page one; detail/back navigation retains filters, page and the
   frozen time window. A full refresh restores default list state. If a retained live page
   becomes out of range, show it as unavailable with a return-to-first-page action.
8. Annotate abort and completion guards on filter changes/navigation; older requests cannot
   replace newer results. Live errors do not substitute fixtures. Mock mode preserves the
   fixed fixture clock and explicit fixture incident references.
9. Screen extensions: Critical severity, null field placeholders, raw-copy success/failure,
   and none/associated/ambiguous incident states. Live Investigate/Open incident remain
   disabled pending FA2/FA3 integration; mock handoffs remain enabled.

## Deployment diagram

Keep one Lambda with four new GET routes under the existing HTTP API, plus the existing
health and EventBridge ingestion dispatch. Do not draw a second alert Lambda or a deployed
FastAPI application for FA1. Existing investigation HTTP/job dispatch gaps remain team work,
not completed J11 functionality.

Show Query access scoped to `alertsByTime`, existing alert GetItem access, and incident Scan
access scoped to the incidents table. CORS uses configurable explicit frontend origins at
API Gateway. The local Floci CORS workaround is a deployment note, not another application
class or an AWS architecture change. No table/index migration was introduced by J11.
