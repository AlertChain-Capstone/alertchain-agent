"""FA1 contract tests through the real repository, service and Lambda/controller layers."""

import copy
import json
from decimal import Decimal
from pathlib import Path
from unittest.mock import Mock
from urllib.parse import urlencode

import pytest
from botocore.exceptions import ClientError

import handler
from api.alerts import AlertController
from domain.alerts import AlertFilter, AlertNotFoundError, AlertStatus
from infra.dynamodb.alerts import DynamoDBAlertIncidentLookup, DynamoDBAlertRepository
from ingestion import FindingNormalizer
from services.alerts import AlertService


def item(alert_id="A-1", time="2026-11-14T14:30:00.000000Z", **changes):
    return {
        "alertId": alert_id, "alertCollection": "ALERTS",
        "eventTimeAlertId": f"{time}#{alert_id}", "eventTime": time,
        "createdTime": "2026-11-14T14:31:00.000000Z", "eventName": "StopLogging",
        "severity": "HIGH", "status": "New", "source": "AWS CloudTrail",
        "principal": "Alice", "resource": "sample-trail", "region": "us-east-2",
        "rawEvent": {"userIdentity": {"accessKeyId": "CALLER"},
                     "responseElements": {"accessKey": {"accessKeyId": "TARGET"}},
                     "sourceIPAddress": "203.0.113.4"},
        **changes,
    }


def matches(condition, row):
    expression = condition.get_expression()
    values = expression["values"]
    operator = expression["operator"]
    if operator == "AND":
        return all(matches(value, row) for value in values)
    actual = row.get(values[0].name)
    if operator == "=":
        return actual == values[1]
    if operator == ">=":
        return actual >= values[1]
    if operator == "<=":
        return actual <= values[1]
    if operator == "BETWEEN":
        return values[1] <= actual <= values[2]
    raise AssertionError(operator)


class PagedTable:
    """Evaluate boto3 conditions and paginate before filtering, like DynamoDB does."""

    def __init__(self, rows=(), chunk_size=2):
        self.rows = copy.deepcopy(list(rows))
        self.chunk_size = chunk_size
        self.queries = []
        self.scans = []

    def get_item(self, Key, **kwargs):
        found = next((row for row in self.rows if row.get("alertId") == Key["alertId"]), None)
        return {"Item": copy.deepcopy(found)} if found else {}

    def _page(self, rows, start):
        offset = (start or {}).get("offset", 0)
        result = {"Items": copy.deepcopy(rows[offset:offset + self.chunk_size])}
        if offset + self.chunk_size < len(rows):
            result["LastEvaluatedKey"] = {"offset": offset + self.chunk_size}
        return result

    def query(self, **kwargs):
        self.queries.append(copy.copy(kwargs))
        assert kwargs["IndexName"] == "alertsByTime"
        rows = [row for row in self.rows if matches(kwargs["KeyConditionExpression"], row)]
        rows.sort(key=lambda row: row["eventTimeAlertId"], reverse=not kwargs["ScanIndexForward"])
        result = self._page(rows, kwargs.get("ExclusiveStartKey"))
        fields = kwargs["ExpressionAttributeNames"].values()
        result["Items"] = [{k: v for k, v in row.items() if k in fields} for row in result["Items"]]
        return result

    def scan(self, **kwargs):
        self.scans.append(copy.copy(kwargs))
        result = self._page(self.rows, kwargs.get("ExclusiveStartKey"))
        result["Items"] = [row for row in result["Items"] if matches(kwargs["FilterExpression"], row)]
        return result


def controller(alerts=None, incidents=None):
    alerts = PagedTable([item()]) if alerts is None else alerts
    incidents = PagedTable() if incidents is None else incidents
    service = AlertService(DynamoDBAlertRepository(alerts),
                           lambda: DynamoDBAlertIncidentLookup(incidents))
    return AlertController(service), alerts, incidents


def event(path="/alerts", query=None, raw_query=None, method="GET"):
    return {"version": "2.0", "rawPath": path,
            "rawQueryString": raw_query if raw_query is not None else urlencode(query or {}),
            "requestContext": {"http": {"method": method}}}


def call(api, path="/alerts", query=None, **kwargs):
    result = api.handle(event(path, query, **kwargs))
    return result["statusCode"], json.loads(result["body"])


def test_numbered_pages_count_every_match_and_order_ties_by_id_descending():
    table = PagedTable([item("A-1"), item("A-3"), item("A-2"),
                        item("A-4", "2026-11-14T15:00:00.000000Z")], chunk_size=1)
    api, _, _ = controller(table)
    for page, ids in [(1, ["A-4", "A-3"]), (2, ["A-2", "A-1"]), (3, [])]:
        table.queries.clear()
        status, body = call(api, query={"page": page, "pageSize": 2})
        assert status == 200
        assert [row["id"] for row in body["alerts"]] == ids
        assert {k: body[k] for k in ("totalAlerts", "page", "pageSize")} == {
            "totalAlerts": 4, "page": page, "pageSize": 2,
        }
        assert len(table.queries) == 4  # even page one must traverse the whole index
        assert table.queries[1]["ExclusiveStartKey"] == {"offset": 1}
        assert all(q["ScanIndexForward"] is False and "ConsistentRead" not in q
                   for q in table.queries)
        assert all("rawEvent" not in row for row in body["alerts"])


@pytest.mark.parametrize("query", [
    {"search": "  alice  "}, {"search": "a-1"}, {"search": "stopLOGGING"},
    {"severity": "HIGH", "source": "AWS CloudTrail", "status": "New"},
    {"from": "2026-11-14T09:30:00-05:00", "to": "2026-11-14T14:30:00Z"},
    {"from": "2026-11-14T14:30:00Z"}, {"to": "2026-11-14T14:30:00Z"},
])
def test_filter_search_fields_and_inclusive_utc_bounds(query):
    api, _, _ = controller()
    status, body = call(api, query=query)
    assert status == 200
    assert body["totalAlerts"] == 1


def test_filters_are_combined_and_nonmatches_do_not_fill_a_page():
    table = PagedTable([
        item("A-5", severity="LOW"), item("A-4", source="Amazon GuardDuty"),
        item("A-3", principal=None), item("A-2", status="Resolved"), item("A-1"),
    ], chunk_size=1)
    api, _, _ = controller(table)
    status, body = call(api, query={"search": "ALICE", "severity": "HIGH",
                                   "source": "AWS CloudTrail", "status": "New", "pageSize": 1})
    assert status == 200
    assert body["totalAlerts"] == 1
    assert [a["id"] for a in body["alerts"]] == ["A-1"]
    assert len(table.queries) == 5


@pytest.mark.parametrize("query", [
    {"search": "unknown"}, {"severity": "CRITICAL"},
    {"from": "2026-11-14T14:30:00.000001Z"},
    {"to": "2026-11-14T14:29:59.999999Z"},
])
def test_empty_filtered_results(query):
    api, _, _ = controller()
    assert call(api, query=query) == (200, {"alerts": [], "totalAlerts": 0, "page": 1, "pageSize": 6})


def test_empty_table_and_blank_text_filters():
    api, _, _ = controller(PagedTable())
    assert call(api)[1] == {"alerts": [], "totalAlerts": 0, "page": 1, "pageSize": 6}
    api, _, _ = controller()
    assert call(api, query={"search": " ", "severity": "", "source": "", "status": ""})[1]["totalAlerts"] == 1
    assert call(api, query={"page": "99999999999"})[1] == {
        "alerts": [], "totalAlerts": 1, "page": 99999999999, "pageSize": 6,
    }


@pytest.mark.parametrize("query", [
    {"page": "0"}, {"page": "-1"}, {"page": "1.5"}, {"page": ""},
    {"pageSize": "0"}, {"pageSize": "101"},
    {"severity": "High"}, {"source": "aws.guardduty"}, {"status": "RUNNING"},
    {"from": "2026-11-14"}, {"from": "2026-11-14T14:30:00"},
    {"from": "2026-02-30T14:30:00Z"}, {"to": ""},
    {"from": "2026-11-15T00:00:00Z", "to": "2026-11-14T00:00:00Z"},
    {"limit": "6"},
])
def test_invalid_query_is_400_and_does_not_read_storage(query):
    api, table, _ = controller()
    status, body = call(api, query=query)
    assert status == 400
    assert body["error"]["code"] == "INVALID_QUERY"
    assert not table.queries


@pytest.mark.parametrize("raw_query", ["page=1&page=2", "source=AWS+CloudTrail&source=Amazon+GuardDuty"])
def test_repeated_query_parameters_are_rejected(raw_query):
    api, table, _ = controller()
    assert call(api, raw_query=raw_query)[0] == 400
    assert not table.queries


def test_nullable_fields_and_critical_severity_do_not_break_list_or_details():
    row = item(severity="CRITICAL", resource=None, rawEvent=None)
    del row["principal"]
    api, _, _ = controller(PagedTable([row]))
    status, body = call(api, query={"severity": "CRITICAL"})
    assert status == 200
    assert body["alerts"][0]["principal"] is None
    assert body["alerts"][0]["resource"] is None
    details = call(api, "/alerts/A-1")[1]
    assert details["severity"] == "CRITICAL"
    assert details["accessKeyId"] is None and details["sourceIp"] is None
    assert "rawEvent" not in details and "incidentId" not in details
    assert call(api, "/alerts/A-1/raw-event") == (200, {"alertId": "A-1", "rawEvent": None})


def test_details_enrich_caller_identity_without_optional_reads():
    api, _, incidents = controller()
    status, details = call(api, "/alerts/A-1")
    assert status == 200
    assert details["accessKeyId"] == "CALLER"  # never TARGET
    assert details["sourceIp"] == "203.0.113.4"
    assert details["summary"] == "A StopLogging event was detected for a monitored trail."
    assert details["occurredAt"] == "2026-11-14T14:30:00.000000Z"
    assert not incidents.scans


def test_guardduty_details_and_ingestion_write_read_roundtrip():
    fixture = json.loads((Path(__file__).parent / "fixtures/guardduty_finding.json").read_text())
    raw = fixture["detail"]
    raw["description"] = "Unusual API activity."
    raw["resource"]["accessKeyDetails"]["accessKeyId"] = "GD-CALLER"
    raw["service"]["action"] = {"awsApiCallAction": {
        "remoteIpDetails": {"ipAddressV4": "198.51.100.12"},
    }}
    alert = FindingNormalizer().normalize(fixture)
    table = Mock()
    assert DynamoDBAlertRepository(table).store_if_absent(alert)
    stored = table.put_item.call_args.kwargs["Item"]
    api, _, _ = controller(PagedTable([stored]))
    status, details = call(api, f"/alerts/{alert.id}")
    assert status == 200
    assert details["accessKeyId"] == "GD-CALLER"
    assert details["sourceIp"] == "198.51.100.12"
    assert details["summary"] == raw["description"]
    assert call(api, f"/alerts/{alert.id}/raw-event")[1]["rawEvent"] == raw


def test_raw_event_serializes_nested_decimals_booleans_and_nulls_without_mutation():
    raw = {"severity": Decimal("8.5"), "count": Decimal("2"),
           "nested": [{"number": Decimal("0.25"), "flag": True, "missing": None}]}
    table = PagedTable([item(rawEvent=raw)])
    api, _, _ = controller(table)
    status, body = call(api, "/alerts/A-1/raw-event")
    assert status == 200
    assert body == {"alertId": "A-1", "rawEvent": {
        "severity": 8.5, "count": 2, "nested": [{"number": 0.25, "flag": True, "missing": None}],
    }}
    assert table.rows[0]["rawEvent"] == raw


@pytest.mark.parametrize("suffix", ["", "/raw-event", "/associated-incident"])
def test_missing_alert_returns_404_for_each_operation(suffix):
    api, _, incidents = controller(PagedTable())
    status, body = call(api, "/alerts/absent" + suffix)
    assert status == 404
    assert body["error"]["code"] == "ALERT_NOT_FOUND"
    assert not incidents.scans


@pytest.mark.parametrize("rows,expected", [
    ([], {"status": "none", "incidentId": None}),
    ([{"incident_id": "INC-Z", "alert_id": "A-1"}],
     {"status": "associated", "incidentId": "INC-Z"}),
    ([{"incident_id": "INC-Z", "alert_id": "A-1"}, {"incident_id": "INC-A", "alert_id": "A-1"}],
     {"status": "ambiguous", "incidentId": None}),
])
def test_incident_association_does_not_choose_between_multiple_matches(rows, expected):
    # An empty filtered scan page must not be confused with end-of-scan.
    incidents = PagedTable([{"incident_id": "OTHER", "alert_id": "A-2"}, *rows], chunk_size=1)
    api, _, _ = controller(incidents=incidents)
    assert call(api, "/alerts/A-1/associated-incident") == (200, {"alertId": "A-1", **expected})
    assert len(incidents.scans) == 1 + len(rows)


@pytest.mark.parametrize("operation", ["list", "detail", "raw", "association"])
def test_storage_failures_are_retriable_and_do_not_leak_internal_details(operation):
    alerts, incidents = Mock(), Mock()
    alerts.get_item.return_value = {"Item": item()}
    error = ClientError({"Error": {"Code": "AccessDeniedException", "Message": "private ARN"}}, "Read")
    path = "/alerts"
    if operation == "list":
        alerts.query.side_effect = error
    elif operation == "detail":
        alerts.get_item.side_effect = error
        path += "/A-1"
    elif operation == "raw":
        alerts.get_item.side_effect = error
        path += "/A-1/raw-event"
    else:
        incidents.scan.side_effect = error
        path += "/A-1/associated-incident"
    api, _, _ = controller(alerts, incidents)
    status, body = call(api, path)
    assert status == 503
    assert body["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert "private" not in json.dumps(body)


def test_failure_on_later_query_page_never_returns_partial_total():
    table = Mock()
    table.query.side_effect = [{"Items": [item()], "LastEvaluatedKey": {"offset": 1}},
                               RuntimeError("database offline")]
    api, _, _ = controller(table)
    status, body = call(api, query={"pageSize": 1})
    assert status == 503 and "totalAlerts" not in body


def test_failure_on_later_scan_page_never_claims_a_unique_association():
    incidents = Mock()
    incidents.scan.side_effect = [
        {"Items": [{"incident_id": "INC-Z"}], "LastEvaluatedKey": {"incident_id": "INC-Z"}},
        RuntimeError("scan interrupted"),
    ]
    api, _, _ = controller(incidents=incidents)
    status, body = call(api, "/alerts/A-1/associated-incident")
    assert status == 503 and "incidentId" not in body


def test_raw_read_does_not_require_normalized_fields_and_missing_raw_is_null():
    table = Mock()
    table.get_item.return_value = {"Item": {"alertId": "A-1"}}
    api, _, _ = controller(alerts=table)
    assert call(api, "/alerts/A-1/raw-event") == (200, {"alertId": "A-1", "rawEvent": None})
    table.get_item.assert_called_once_with(
        Key={"alertId": "A-1"}, ConsistentRead=True,
        ProjectionExpression="#id, #raw",
        ExpressionAttributeNames={"#id": "alertId", "#raw": "rawEvent"},
    )


def test_boto3_request_and_response_conversion_without_network():
    import boto3
    from boto3.dynamodb.types import TypeSerializer
    from botocore.stub import Stubber

    resource = boto3.resource("dynamodb", region_name="us-east-2",
                              aws_access_key_id="test", aws_secret_access_key="test")
    table = resource.Table("alertchain-alerts")
    serializer = TypeSerializer()
    stored = item(rawEvent={"number": Decimal("8.5"), "flag": True})
    wire = {key: serializer.serialize(value) for key, value in stored.items()}
    with Stubber(resource.meta.client) as stub:
        # boto3 deserializes response dictionaries in place; each response needs its own copy.
        stub.add_response("query", {"Items": [copy.deepcopy(wire)], "Count": 1, "ScannedCount": 1})
        stub.add_response("get_item", {"Item": copy.deepcopy(wire)})
        api, _, _ = controller(alerts=table)
        assert call(api, query={"from": "2026-11-14T14:00:00Z", "to": "2026-11-14T15:00:00Z"})[1]["totalAlerts"] == 1
        assert call(api, "/alerts/A-1/raw-event")[1]["rawEvent"] == {"number": 8.5, "flag": True}
        stub.assert_no_pending_responses()


def test_optional_failure_can_be_retried_without_affecting_details():
    api, alerts, incidents = controller()
    incidents.scan = Mock(side_effect=[RuntimeError("offline"), {"Items": []}])
    assert call(api, "/alerts/A-1/associated-incident")[0] == 503
    assert call(api, "/alerts/A-1")[0] == 200
    assert call(api, "/alerts/A-1/associated-incident")[1]["status"] == "none"
    original_get = alerts.get_item
    alerts.get_item = Mock(side_effect=RuntimeError("raw read failed"))
    assert call(api, "/alerts/A-1/raw-event")[0] == 503
    alerts.get_item = original_get
    assert call(api, "/alerts/A-1")[0] == 200
    assert call(api, "/alerts/A-1/raw-event")[0] == 200


@pytest.mark.parametrize("path", ["/alerts/%2F", "/alerts/" + "a" * 129, "/alerts/has%20space"])
def test_invalid_alert_id(path):
    api, _, _ = controller()
    assert call(api, path)[1]["error"]["code"] == "INVALID_ALERT_ID"


def test_unknown_subroute_wrong_method_and_detail_query_validation():
    api, _, _ = controller()
    assert call(api, "/alerts/A-1/other")[0] == 404
    assert call(api, method="POST")[0] == 405
    assert call(api, "/alerts/A-1", query={"search": "x"})[0] == 400


def test_shared_lambda_dispatches_all_four_reads_without_initializing_incidents(monkeypatch):
    table = PagedTable([item()])
    incidents = Mock(side_effect=AssertionError("optional lookup initialized"))
    monkeypatch.setattr(handler, "_alert_repository", lambda: DynamoDBAlertRepository(table))
    monkeypatch.setattr(handler, "_incident_lookup", incidents)
    for path in ("/alerts", "/alerts/A-1", "/alerts/A-1/raw-event"):
        assert handler.handler(event(path), None)["statusCode"] == 200
    incidents.assert_not_called()
    monkeypatch.setattr(handler, "_incident_lookup", lambda: DynamoDBAlertIncidentLookup(PagedTable()))
    result = handler.handler(event("/alerts/A-1/associated-incident"), None)
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["status"] == "none"


def test_shared_lambda_initialization_failure_returns_503(monkeypatch):
    monkeypatch.setattr(handler, "_alert_repository", Mock(side_effect=RuntimeError("config")))
    assert handler.handler(event(), None)["statusCode"] == 503


def test_repository_direct_read_contracts():
    table = Mock()
    table.get_item.return_value = {"Item": item()}
    repo = DynamoDBAlertRepository(table)
    assert repo.get_alert("A-1").status == AlertStatus.NEW
    table.get_item.assert_called_once_with(Key={"alertId": "A-1"}, ConsistentRead=True)
    table.get_item.return_value = {}
    assert repo.get_alert("absent") is None
    with pytest.raises(AlertNotFoundError):
        repo.get_raw_event("absent")


@pytest.mark.parametrize("page,size", [(0, 6), (True, 6), (1, 101), (1, False)])
def test_service_validates_numbered_pagination_before_repository_access(page, size):
    alerts = Mock()
    service = AlertService(alerts, Mock())
    with pytest.raises(ValueError):
        service.list_alerts(AlertFilter(), page, size)
    alerts.list_alerts.assert_not_called()
