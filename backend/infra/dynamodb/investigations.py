"""DynamoDB versions of the investigation, evidence, incident and security-event repositories.

Each class takes an injected boto3 DynamoDB Table (like DynamoDBAlertRepository), so tests use a
fake table and the Lambda passes real ones. Tables are defined in template.yaml:
  alertchain-investigations   key investigation_id
  alertchain-evidence         key evidence_id, GSI evidenceByInvestigation
  alertchain-incidents        key incident_id, GSI incidentsByInvestigation
  alertchain-alerts           key alertId, GSI alertsByPrincipalAndTime
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from boto3.dynamodb.conditions import Key
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
    InvestigationStatus,
    ReasoningStep,
    SecurityEventRepository,
    Severity,
)

RELATED_EVENT_LIMIT = 25


def to_dynamodb(value: Any) -> Any:
    """Floats become Decimal (DynamoDB has no float type); None values are kept as NULL."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: to_dynamodb(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_dynamodb(v) for v in value]
    return value


def from_dynamodb(value: Any) -> Any:
    """Decimals become int when whole, otherwise float."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: from_dynamodb(v) for k, v in value.items()}
    if isinstance(value, list):
        return [from_dynamodb(v) for v in value]
    return value


def _step_to_item(step: ReasoningStep) -> dict[str, Any]:
    return {
        "step_no": step.step_no,
        "thought": step.thought,
        "tool_name": step.tool_name,
        "tool_input": to_dynamodb(step.tool_input),
        "tool_output": to_dynamodb(step.tool_output),
        "timestamp": step.timestamp.isoformat(),
    }


def _step_from_item(item: dict[str, Any]) -> ReasoningStep:
    return ReasoningStep(
        step_no=int(item["step_no"]),
        thought=item["thought"],
        tool_name=item.get("tool_name"),
        tool_input=from_dynamodb(item.get("tool_input")),
        tool_output=from_dynamodb(item.get("tool_output")),
        timestamp=datetime.fromisoformat(item["timestamp"]),
    )


def _conclusion_to_item(conclusion: Conclusion) -> dict[str, Any]:
    return {
        "summary": conclusion.summary,
        "severity": conclusion.severity.value,
        "confidence": conclusion.confidence.value,
        "evidence_ids": list(conclusion.evidence_ids),
        "attack_chain": [
            {"description": s.description, "evidence_ids": list(s.evidence_ids)}
            for s in conclusion.attack_chain.stages
        ],
    }


def _conclusion_from_item(item: dict[str, Any]) -> Conclusion:
    return Conclusion(
        summary=item["summary"],
        severity=Severity(item["severity"]),
        confidence=Confidence(item["confidence"]),
        attack_chain=AttackChain(
            tuple(
                AttackChainStage(s["description"], tuple(s["evidence_ids"]))
                for s in item.get("attack_chain", [])
            )
        ),
        evidence_ids=tuple(item["evidence_ids"]),
    )


class DynamoDBInvestigationRepository(InvestigationRepository):
    def __init__(self, table: Any) -> None:
        self._table = table

    def get(self, investigation_id: str) -> Investigation | None:
        item = self._table.get_item(Key={"investigation_id": investigation_id}).get("Item")
        if not item:
            return None
        return Investigation(
            id=item["investigation_id"],
            alert_id=item["alert_id"],
            status=InvestigationStatus(item["status"]),
            steps=[_step_from_item(s) for s in item.get("steps", [])],
            conclusion=_conclusion_from_item(item["conclusion"]) if item.get("conclusion") else None,
            status_reason=item.get("status_reason"),
        )

    def save(self, investigation: Investigation) -> None:
        item: dict[str, Any] = {
            "investigation_id": investigation.id,
            "alert_id": investigation.alert_id,
            "status": investigation.status.value,
            "steps": [_step_to_item(s) for s in investigation.steps],
        }
        if investigation.conclusion is not None:
            item["conclusion"] = _conclusion_to_item(investigation.conclusion)
        if investigation.status_reason is not None:
            item["status_reason"] = investigation.status_reason
        self._table.put_item(Item=item)


def _evidence_number(evidence: Evidence) -> int:
    match = re.search(r"(\d+)$", evidence.id)
    return int(match.group(1)) if match else 0


class DynamoDBEvidenceRepository(EvidenceRepository):
    def __init__(self, table: Any, index_name: str = "evidenceByInvestigation") -> None:
        self._table = table
        self._index = index_name

    def add(self, evidence: Evidence) -> None:
        item = {
            "evidence_id": evidence.id,
            "investigation_id": evidence.investigation_id,
            "source": evidence.source,
            "summary": evidence.summary,
            "raw": to_dynamodb(evidence.raw),
        }
        try:
            self._table.put_item(Item=item, ConditionExpression="attribute_not_exists(evidence_id)")
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                raise ValueError(f"evidence {evidence.id} already exists") from exc
            raise

    def get(self, evidence_id: str) -> Evidence | None:
        item = self._table.get_item(Key={"evidence_id": evidence_id}).get("Item")
        return self._to_evidence(item) if item else None

    def list_for_investigation(self, investigation_id: str) -> list[Evidence]:
        items: list[dict[str, Any]] = []
        kwargs: dict[str, Any] = {
            "IndexName": self._index,
            "KeyConditionExpression": Key("investigation_id").eq(investigation_id),
        }
        while True:
            page = self._table.query(**kwargs)
            items.extend(page.get("Items", []))
            if "LastEvaluatedKey" not in page:
                break
            kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
        return sorted((self._to_evidence(i) for i in items), key=_evidence_number)

    @staticmethod
    def _to_evidence(item: dict[str, Any]) -> Evidence:
        return Evidence(
            id=item["evidence_id"],
            investigation_id=item["investigation_id"],
            source=item["source"],
            summary=item["summary"],
            raw=from_dynamodb(item.get("raw", {})),
        )


class DynamoDBIncidentRepository(IncidentRepository):
    def __init__(self, table: Any, index_name: str = "incidentsByInvestigation") -> None:
        self._table = table
        self._index = index_name

    def find_by_investigation(self, investigation_id: str) -> dict[str, Any] | None:
        page = self._table.query(
            IndexName=self._index,
            KeyConditionExpression=Key("investigation_id").eq(investigation_id),
            Limit=1,
        )
        items = page.get("Items", [])
        return self._to_incident(items[0]) if items else None

    def create(self, incident: dict[str, Any]) -> dict[str, Any]:
        incident_id = f"INC-{uuid.uuid4().hex[:8].upper()}"
        stored = {**incident, "id": incident_id}
        item = {**to_dynamodb(incident), "incident_id": incident_id}
        self._table.put_item(Item=item, ConditionExpression="attribute_not_exists(incident_id)")
        return stored

    @staticmethod
    def _to_incident(item: dict[str, Any]) -> dict[str, Any]:
        data = from_dynamodb(item)
        data["id"] = data.pop("incident_id")
        return data


class DynamoDBSecurityEventRepository(SecurityEventRepository):
    """Reads alerts that the ingestion Lambda stored. Related events are the other alerts raised
    by the same principal, newest first (alertsByPrincipalAndTime)."""

    def __init__(
        self,
        alerts_table: Any,
        index_name: str = "alertsByPrincipalAndTime",
        limit: int = RELATED_EVENT_LIMIT,
    ) -> None:
        self._table = alerts_table
        self._index = index_name
        self._limit = limit

    def get_alert(self, alert_id: str) -> dict[str, Any] | None:
        item = self._table.get_item(Key={"alertId": alert_id}).get("Item")
        return from_dynamodb(item) if item else None

    def list_related_events(self, alert_id: str) -> list[dict[str, Any]]:
        alert = self.get_alert(alert_id)
        if not alert or not alert.get("principal"):
            return []
        page = self._table.query(
            IndexName=self._index,
            KeyConditionExpression=Key("principal").eq(alert["principal"]),
            ScanIndexForward=False,
            Limit=self._limit + 1,
        )
        related = [from_dynamodb(i) for i in page.get("Items", []) if i["alertId"] != alert_id]
        return related[: self._limit]
