"""Test support: the A-1 security scenario, a fake bedrock-runtime client, and a harness
that wires the real BedrockClient/orchestrator to in-memory repositories."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from agent import (
    AgentOrchestrator,
    CheckActorBaselineTool,
    CreateIncidentTool,
    GetRelatedEventsTool,
    StepLimiter,
    ToolRegistry,
)
from domain.investigation import (
    InMemoryActorBaselineRepository,
    InMemoryEvidenceRepository,
    InMemoryIncidentRepository,
    InMemoryInvestigationRepository,
    InMemorySecurityEventRepository,
    Investigation,
)
from infra.bedrock import BedrockClient, BedrockSettings

INVESTIGATION_ID = "INV-1"
FIXED_NOW = datetime(2026, 11, 1, 10, 10, tzinfo=UTC)

# Alert A-1: console login from a new IP, followed by IAM CreateAccessKey.
ALERTS = {
    "A-1": {
        "id": "A-1",
        "title": "Console login from new IP",
        "actor": "alice.dev",
        "event_name": "ConsoleLogin",
        "source_ip": "203.0.113.50",
        "mfa_used": False,
        "time": "2026-11-01T10:02:00Z",
    }
}
RELATED_EVENTS = {
    "A-1": [
        {"event_id": "E-100", "event_name": "ConsoleLogin", "actor": "alice.dev",
         "source_ip": "203.0.113.50", "mfa_used": False, "time": "2026-11-01T10:02:00Z"},
        {"event_id": "E-101", "event_name": "CreateAccessKey", "actor": "alice.dev",
         "target_user": "alice.dev", "source_ip": "203.0.113.50",
         "time": "2026-11-01T10:05:00Z"},
    ]
}
BASELINES = {
    "alice.dev": {
        "known_ips": ["198.51.100.10"],
        "typical_actions": ["ConsoleLogin", "DescribeInstances", "GetObject"],
    }
}


def tool_use_response(name: str, tool_input: dict[str, Any], tool_use_id: str = "tu-1",
                      text: str = "") -> dict[str, Any]:
    content: list[dict[str, Any]] = [{"text": text}] if text else []
    content.append({"toolUse": {"toolUseId": tool_use_id, "name": name, "input": tool_input}})
    return {
        "output": {"message": {"role": "assistant", "content": content}},
        "stopReason": "tool_use",
        "usage": {"inputTokens": 400, "outputTokens": 40},
    }


def final_response(text: str, stop_reason: str = "end_turn") -> dict[str, Any]:
    return {
        "output": {"message": {"role": "assistant", "content": [{"text": text}]}},
        "stopReason": stop_reason,
        "usage": {"inputTokens": 900, "outputTokens": 150},
    }


def conclusion_json(evidence_ids: list[str], **overrides: Any) -> str:
    body = {
        "summary": "alice.dev signed in without MFA from unknown IP 203.0.113.50 and three "
                   "minutes later created a new access key: likely credential compromise "
                   "with persistence.",
        "severity": "HIGH",
        "confidence": "HIGH",
        "attack_chain": [
            {"description": "Initial access: console login from new IP without MFA",
             "evidence_ids": evidence_ids[:1]},
            {"description": "Persistence: IAM CreateAccessKey from the same IP",
             "evidence_ids": evidence_ids},
        ],
        "evidence_ids": evidence_ids,
    }
    body.update(overrides)
    return json.dumps(body)


class FakeBedrockRuntime:
    """Stands in for boto3's bedrock-runtime client. Records every converse request."""

    def __init__(self, responses: list[dict[str, Any]] | Callable[[int], dict[str, Any]],
                 on_call: Callable[[], None] | None = None) -> None:
        self._responses = responses
        self._on_call = on_call
        self.requests: list[dict[str, Any]] = []

    def converse(self, **request: Any) -> dict[str, Any]:
        self.requests.append(json.loads(json.dumps(request)))  # snapshot, not a live reference
        if self._on_call:
            self._on_call()
        index = len(self.requests) - 1
        if callable(self._responses):
            return self._responses(index)
        if index >= len(self._responses):
            raise AssertionError("model called more times than the test scripted")
        return self._responses[index]


@dataclass
class Harness:
    runtime: FakeBedrockRuntime
    orchestrator: AgentOrchestrator
    investigations: InMemoryInvestigationRepository
    evidence: InMemoryEvidenceRepository
    incidents: InMemoryIncidentRepository
    tool_names: list[str] = field(default_factory=list)

    def run(self) -> Investigation:
        return self.orchestrator.run(INVESTIGATION_ID)


def make_harness(runtime: FakeBedrockRuntime,
                 limiter_factory: Callable[[], StepLimiter] = StepLimiter) -> Harness:
    investigations = InMemoryInvestigationRepository()
    evidence = InMemoryEvidenceRepository()
    incidents = InMemoryIncidentRepository()
    investigations.save(Investigation(id=INVESTIGATION_ID, alert_id="A-1"))
    registry = ToolRegistry([
        GetRelatedEventsTool(InMemorySecurityEventRepository(ALERTS, RELATED_EVENTS)),
        CheckActorBaselineTool(InMemoryActorBaselineRepository(BASELINES)),
        CreateIncidentTool(incidents),
    ])
    orchestrator = AgentOrchestrator(
        llm=BedrockClient(BedrockSettings(), runtime_client=runtime),
        registry=registry,
        investigations=investigations,
        evidence=evidence,
        limiter_factory=limiter_factory,
        now=lambda: FIXED_NOW,
    )
    return Harness(runtime, orchestrator, investigations, evidence, incidents,
                   [t.name for t in registry.tools])
