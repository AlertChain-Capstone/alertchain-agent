"""Agent tools. Each tool depends only on repository interfaces, so the same code runs on the
in-memory fakes today and on DynamoDB-backed repositories later.

Tool input comes from the model and is untrusted: the ToolRegistry validates it against
`input_schema` before `execute` runs, and tools re-check anything with side effects.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, ClassVar

from domain.investigation import (
    ActorBaselineRepository,
    IncidentRepository,
    SecurityEventRepository,
    Severity,
)


class ToolInputError(ValueError):
    """The model sent input the tool cannot accept. The message is returned to the model."""


@dataclass(frozen=True)
class ToolContext:
    investigation_id: str
    alert_id: str
    known_evidence_ids: frozenset[str]


@dataclass(frozen=True)
class ToolResult:
    summary: str  # one line, stored on the Evidence record
    data: dict[str, Any]


class AgentTool(ABC):
    name: ClassVar[str]
    description: ClassVar[str]
    input_schema: ClassVar[dict[str, Any]]

    @abstractmethod
    def execute(self, tool_input: dict[str, Any], context: ToolContext) -> ToolResult: ...


class GetRelatedEventsTool(AgentTool):
    name = "get_related_events"
    description = (
        "Get an alert and the security events related to it (e.g. CloudTrail events by the "
        "same actor or from the same IP around the alert time)."
    )
    input_schema = {
        "type": "object",
        "properties": {"alert_id": {"type": "string", "description": "Alert ID, e.g. A-1"}},
        "required": ["alert_id"],
        "additionalProperties": False,
    }

    def __init__(self, events: SecurityEventRepository) -> None:
        self._events = events

    def execute(self, tool_input: dict[str, Any], context: ToolContext) -> ToolResult:
        alert_id = tool_input["alert_id"]
        alert = self._events.get_alert(alert_id)
        if alert is None:
            raise ToolInputError(f"alert {alert_id!r} not found")
        related = self._events.list_related_events(alert_id)
        return ToolResult(
            summary=f"Alert {alert_id} ({alert.get('title', 'untitled')}) "
            f"with {len(related)} related event(s)",
            data={"alert": alert, "related_events": related},
        )


class CheckActorBaselineTool(AgentTool):
    name = "check_actor_baseline"
    description = (
        "Compare an actor's (IAM user or role) activity with their normal baseline: known "
        "source IPs and typical API actions."
    )
    input_schema = {
        "type": "object",
        "properties": {
            "actor": {"type": "string", "description": "IAM user or role name"},
            "source_ip": {"type": "string", "description": "IP to check against known IPs"},
            "event_name": {"type": "string", "description": "API action, e.g. CreateAccessKey"},
        },
        "required": ["actor"],
        "additionalProperties": False,
    }

    def __init__(self, baselines: ActorBaselineRepository) -> None:
        self._baselines = baselines

    def execute(self, tool_input: dict[str, Any], context: ToolContext) -> ToolResult:
        actor = tool_input["actor"]
        baseline = self._baselines.get_baseline(actor)
        if baseline is None:
            return ToolResult(
                summary=f"No baseline exists for actor {actor}",
                data={"actor": actor, "baseline_found": False},
            )
        data: dict[str, Any] = {"actor": actor, "baseline_found": True, "baseline": baseline}
        findings = []
        if ip := tool_input.get("source_ip"):
            data["ip_is_known"] = ip in baseline.get("known_ips", [])
            findings.append(f"IP {ip} {'known' if data['ip_is_known'] else 'NOT known'}")
        if event := tool_input.get("event_name"):
            data["action_is_typical"] = event in baseline.get("typical_actions", [])
            findings.append(f"{event} {'typical' if data['action_is_typical'] else 'NOT typical'}")
        return ToolResult(
            summary=f"Baseline for {actor}: " + ("; ".join(findings) or "baseline returned"),
            data=data,
        )


class CreateIncidentTool(AgentTool):
    name = "create_incident"
    description = (
        "Open a security incident for this investigation. Only use when the evidence shows "
        "likely malicious activity. Must cite evidence IDs returned by earlier tool calls."
    )
    input_schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string", "maxLength": 200},
            "severity": {"type": "string", "enum": [s.value for s in Severity]},
            "summary": {"type": "string", "maxLength": 2000},
            "evidence_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        },
        "required": ["title", "severity", "summary", "evidence_ids"],
        "additionalProperties": False,
    }

    def __init__(self, incidents: IncidentRepository) -> None:
        self._incidents = incidents

    def execute(self, tool_input: dict[str, Any], context: ToolContext) -> ToolResult:
        cited = list(dict.fromkeys(tool_input["evidence_ids"]))
        unknown = sorted(set(cited) - context.known_evidence_ids)
        if unknown:
            raise ToolInputError(f"unknown evidence IDs: {unknown}")

        # Idempotent: one incident per investigation, even if the model asks twice.
        existing = self._incidents.find_by_investigation(context.investigation_id)
        if existing:
            return ToolResult(
                summary=f"Incident {existing['id']} already exists for this investigation",
                data={"incident": existing, "created": False},
            )
        incident = self._incidents.create(
            {
                "investigation_id": context.investigation_id,
                "alert_id": context.alert_id,
                "title": tool_input["title"],
                "severity": tool_input["severity"],
                "summary": tool_input["summary"],
                "evidence_ids": cited,
            }
        )
        return ToolResult(
            summary=f"Created incident {incident['id']} ({incident['severity']})",
            data={"incident": incident, "created": True},
        )
