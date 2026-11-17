"""FA3 reads through the Lambda, with the same row shape the FA2 incident tool writes."""

import json
from decimal import Decimal
from unittest.mock import Mock, call

import pytest

import handler
from infra.dynamodb import DynamoDBEvidenceRepository, DynamoDBIncidentRepository
from services.incidents import IncidentQueryService


def read(path="/incidents", query="", method="GET"):
    event = {"rawPath": path, "rawQueryString": query, "requestContext": {"http": {"method": method}}}
    result = handler.handler(event, None)
    return result["statusCode"], json.loads(result["body"])


@pytest.fixture
def tables(monkeypatch):
    incidents, evidence = Mock(), Mock()
    service = IncidentQueryService(DynamoDBIncidentRepository(incidents), DynamoDBEvidenceRepository(evidence))
    monkeypatch.setattr(handler, "_incident_query_service", lambda: service)
    return incidents, evidence


def row(incident_id, severity="HIGH", **changes):
    return {"incident_id": incident_id, "title": "Login review", "severity": severity,
            "investigation_id": "INV-1", "alert_id": "A-1", "summary": "Recorded summary",
            "evidence_ids": ["EV-1", "EV-missing", "EV-other"], **changes}


def test_list_filters_and_sorts_globally_across_dynamodb_scan_pages(tables):
    incidents, evidence = tables
    cursor = {"incident_id": "INC-4"}
    incidents.scan.side_effect = [
        {"Items": [row("INC-1"), row("INC-2", "LOW"), row("INC-4", status="CLOSED")],
         "LastEvaluatedKey": cursor},
        {"Items": [row("INC-5"), row("INC-3", created_at="2026-11-17T14:10:00Z"),
                   row("INC-6", occurred_at="2026-11-17T15:00:00+02:00")]},
    ]
    status, body = read(query="pageSize=2&page=2&severity=high&status=OPEN&search=login")
    assert status == 200
    assert (body["page"], body["pageSize"], body["totalIncidents"]) == (2, 2, 4)
    assert [item["id"] for item in body["incidents"]] == ["INC-1", "INC-5"]
    assert incidents.scan.call_args_list == [call(), call(ExclusiveStartKey=cursor)]
    assert "summary" not in body["incidents"][0]
    assert body["incidents"][0]["occurredAt"] is None
    assert body["incidents"][0]["createdAt"] is None
    assert not evidence.mock_calls


def test_list_prioritizes_severity_then_time_with_id_tiebreak(tables):
    incidents, _ = tables
    incidents.scan.return_value = {"Items": [
        row("INC-Z", "LOW"), row("INC-X"), row("INC-1", occurred_at="2026-11-17T15:00:00+02:00"),
        row("INC-3", created_at="2026-11-17T14:00:00Z"), row("INC-C", "CRITICAL"), row("INC-A"),
    ]}
    status, body = read()
    assert status == 200
    assert [item["id"] for item in body["incidents"]] == ["INC-C", "INC-3", "INC-1", "INC-A", "INC-X", "INC-Z"]
    assert read(query="page=100")[1]["incidents"] == []


def test_detail_returns_only_cited_evidence_from_the_owning_investigation(tables):
    incidents, evidence = tables
    incidents.get_item.return_value = {"Item": row("INC-1")}
    evidence.query.return_value = {"Items": [
        {"evidence_id": evidence_id, "investigation_id": "INV-1", "source": "get_related_events",
         "summary": "Tool output", "raw": {"metrics": [Decimal("12"), Decimal("0.25")]}}
        for evidence_id in ["EV-1", "EV-uncited"]
    ]}
    evidence.query.return_value["Items"].append({
        "evidence_id": "EV-other", "investigation_id": "INV-2", "source": "other tool",
        "summary": "Private to another investigation", "raw": {"other": True},
    })
    status, body = read("/incidents/INC-1")
    assert status == 200
    incidents.get_item.assert_called_once_with(Key={"incident_id": "INC-1"})
    query = evidence.query.call_args.kwargs
    assert query["IndexName"] == "evidenceByInvestigation"
    field, value = query["KeyConditionExpression"].get_expression()["values"]
    assert (field.name, value) == ("investigation_id", "INV-1")
    assert body["evidenceIds"] == ["EV-1", "EV-missing", "EV-other"]
    assert body["evidence"] == [{"id": "EV-1", "incidentId": "INC-1", "source": "get_related_events",
                                 "summary": "Tool output", "raw": {"metrics": [12, 0.25]}}]
    assert body["status"] == "Open" and body["severity"] == "High"
    assert body["summary"] == "Recorded summary"


@pytest.mark.parametrize("legacy", [{"investigation_id": "INV-1"}, {"evidence_ids": ["EV-1"]}])
def test_sparse_legacy_rows_remain_readable_without_broadening_evidence(tables, legacy):
    incidents, evidence = tables
    incidents.get_item.return_value = {"Item": {"incident_id": "INC-1", **legacy}}
    status, body = read("/incidents/INC-1")
    assert status == 200
    assert body["id"] == "INC-1" and body["evidence"] == []
    assert not evidence.mock_calls


@pytest.mark.parametrize("path,query,method,expected", [
    ("/incidents", "pageSize=0", "GET", 400), ("/incidents", "pageSize=101", "GET", 400),
    ("/incidents", "page=1&page=2", "GET", 400), ("/incidents", "q=hello", "GET", 400),
    ("/incidents/INC-1", "page=1", "GET", 400), ("/incidents/%2F", "", "GET", 400),
    ("/incidents/INC-1", "", "DELETE", 405),
])
def test_bad_requests_rejected_before_storage(tables, path, query, method, expected):
    assert read(path, query, method)[0] == expected
    assert all(not table.mock_calls for table in tables)


def test_missing_and_failed_reads_are_distinct(tables):
    incidents, _ = tables
    incidents.get_item.return_value = {}
    status, body = read("/incidents/INC-missing")
    assert (status, body["error"]["code"]) == (404, "INCIDENT_NOT_FOUND")
    incidents.get_item.side_effect = RuntimeError("storage unavailable")
    assert read("/incidents/INC-missing")[0] == 503
