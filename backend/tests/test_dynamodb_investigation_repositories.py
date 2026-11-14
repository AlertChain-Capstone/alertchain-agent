from datetime import UTC, datetime
from decimal import Decimal

import pytest
from botocore.exceptions import ClientError

from domain.investigation import (
    AttackChain,
    AttackChainStage,
    Conclusion,
    Confidence,
    Evidence,
    EvidenceRepository,
    IncidentRepository,
    Investigation,
    InvestigationRepository,
    ReasoningStep,
    SecurityEventRepository,
    Severity,
)
from infra.dynamodb import (
    DynamoDBEvidenceRepository,
    DynamoDBIncidentRepository,
    DynamoDBInvestigationRepository,
    DynamoDBSecurityEventRepository,
)


class FakeTable:
    """Just enough of a boto3 Table: get_item, put_item (with not-exists condition), query."""

    def __init__(self, key: str, index_key: str | None = None):
        self.key = key
        self.index_key = index_key
        self.items: dict[str, dict] = {}

    def get_item(self, Key):
        item = self.items.get(Key[self.key])
        return {"Item": dict(item)} if item else {}

    def put_item(self, Item, ConditionExpression=None):
        if ConditionExpression and Item[self.key] in self.items:
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "PutItem")
        self.items[Item[self.key]] = dict(Item)

    def query(self, IndexName, KeyConditionExpression, Limit=None, ScanIndexForward=True):
        name, value = KeyConditionExpression.get_expression()["values"]
        rows = [dict(i) for i in self.items.values() if i.get(name.name) == value]
        rows.sort(key=lambda i: i.get("eventTime", ""), reverse=not ScanIndexForward)
        return {"Items": rows[:Limit] if Limit else rows}


def _investigation() -> Investigation:
    inv = Investigation(id="inv-1", alert_id="alert-1")
    inv.add_step(
        ReasoningStep(
            step_no=1,
            thought="look at related events",
            tool_name="get_related_events",
            tool_input={"alert_id": "alert-1", "limit": 5},
            tool_output={"count": 2, "score": 0.5},
            timestamp=datetime(2026, 11, 1, 10, 0, tzinfo=UTC),
        )
    )
    return inv


def _conclusion() -> Conclusion:
    return Conclusion(
        summary="Key created by unusual actor",
        severity=Severity.HIGH,
        confidence=Confidence.MEDIUM,
        attack_chain=AttackChain((AttackChainStage("key created", ("inv-1-ev-1",)),)),
        evidence_ids=("inv-1-ev-1",),
    )


def test_repositories_implement_domain_interfaces():
    t = FakeTable("x")
    assert isinstance(DynamoDBInvestigationRepository(t), InvestigationRepository)
    assert isinstance(DynamoDBEvidenceRepository(t), EvidenceRepository)
    assert isinstance(DynamoDBIncidentRepository(t), IncidentRepository)
    assert isinstance(DynamoDBSecurityEventRepository(t), SecurityEventRepository)


def test_investigation_round_trip_with_steps_and_conclusion():
    table = FakeTable("investigation_id")
    repo = DynamoDBInvestigationRepository(table)
    inv = _investigation()
    inv.complete(_conclusion(), {"inv-1-ev-1"})
    repo.save(inv)
    stored = table.items["inv-1"]
    assert stored["steps"][0]["tool_output"]["score"] == Decimal("0.5")
    assert repo.get("inv-1") == inv


def test_investigation_without_conclusion_keeps_status_reason():
    repo = DynamoDBInvestigationRepository(FakeTable("investigation_id"))
    inv = _investigation()
    inv.escalate("model blocked")
    repo.save(inv)
    loaded = repo.get("inv-1")
    assert loaded == inv
    assert loaded.conclusion is None


def test_missing_investigation_returns_none():
    assert DynamoDBInvestigationRepository(FakeTable("investigation_id")).get("nope") is None


def test_evidence_add_get_and_duplicate_rejected():
    table = FakeTable("evidence_id")
    repo = DynamoDBEvidenceRepository(table)
    ev = Evidence("inv-1-ev-1", "inv-1", "get_related_events", "2 events", {"count": 2, "ratio": 0.25})
    repo.add(ev)
    assert repo.get("inv-1-ev-1") == ev
    assert repo.get("missing") is None
    with pytest.raises(ValueError):
        repo.add(ev)


def test_evidence_list_is_ordered_by_number_and_scoped_to_investigation():
    table = FakeTable("evidence_id")
    repo = DynamoDBEvidenceRepository(table)
    for n in (10, 2, 1):
        repo.add(Evidence(f"inv-1-ev-{n}", "inv-1", "t", "s", {}))
    repo.add(Evidence("inv-2-ev-1", "inv-2", "t", "s", {}))
    assert [e.id for e in repo.list_for_investigation("inv-1")] == [
        "inv-1-ev-1",
        "inv-1-ev-2",
        "inv-1-ev-10",
    ]


def test_incident_create_then_find_by_investigation():
    table = FakeTable("incident_id")
    repo = DynamoDBIncidentRepository(table)
    assert repo.find_by_investigation("inv-1") is None
    created = repo.create({"investigation_id": "inv-1", "severity": "HIGH", "score": 0.9})
    assert created["id"].startswith("INC-")
    found = repo.find_by_investigation("inv-1")
    assert found == {"investigation_id": "inv-1", "severity": "HIGH", "score": 0.9, "id": created["id"]}


def _alert(alert_id, principal, time):
    return {"alertId": alert_id, "principal": principal, "eventTime": time, "severity": "HIGH"}


def test_security_events_get_alert_and_related_exclude_self():
    table = FakeTable("alertId")
    for a in (
        _alert("a1", "bob", "2026-11-01T10:00:00Z"),
        _alert("a2", "bob", "2026-11-01T11:00:00Z"),
        _alert("a3", "alice", "2026-11-01T12:00:00Z"),
    ):
        table.put_item(a)
    repo = DynamoDBSecurityEventRepository(table)
    assert repo.get_alert("a1")["principal"] == "bob"
    assert repo.get_alert("zzz") is None
    assert [e["alertId"] for e in repo.list_related_events("a1")] == ["a2"]


def test_related_events_empty_when_alert_missing_or_has_no_principal():
    table = FakeTable("alertId")
    table.put_item({"alertId": "a1", "eventTime": "2026-11-01T10:00:00Z"})
    repo = DynamoDBSecurityEventRepository(table)
    assert repo.list_related_events("a1") == []
    assert repo.list_related_events("missing") == []


def test_build_dynamodb_runtime_uses_table_names_from_env():
    from agent.runtime import build_dynamodb_runtime

    class FakeResource:
        def __init__(self):
            self.requested = []

        def Table(self, name):  # noqa: N802 (boto3 API name)
            self.requested.append(name)
            return FakeTable("x")

    resource = FakeResource()
    env = {
        "ALERTS_TABLE_NAME": "a",
        "INVESTIGATIONS_TABLE_NAME": "i",
        "EVIDENCE_TABLE_NAME": "e",
        "INCIDENTS_TABLE_NAME": "n",
    }
    runtime = build_dynamodb_runtime(llm=object(), dynamodb=resource, env=env)
    assert isinstance(runtime.investigations, DynamoDBInvestigationRepository)
    assert sorted(resource.requested) == ["a", "e", "i", "n"]
