"""Composition root: repositories, orchestrator and launcher wired together once, so the
HTTP API and the investigation_job handler share the same objects."""

from __future__ import annotations

import functools
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from domain.investigation import (
    ActorBaselineRepository,
    EvidenceRepository,
    IncidentRepository,
    InMemoryActorBaselineRepository,
    InMemoryEvidenceRepository,
    InMemoryIncidentRepository,
    InMemoryInvestigationRepository,
    InMemorySecurityEventRepository,
    InvestigationRepository,
    SecurityEventRepository,
)

from .launcher import InvestigationLauncher, launcher_from_env, run_investigation_safely
from .orchestrator import AgentOrchestrator, LLMGateway
from .registry import ToolRegistry
from .step_limiter import StepLimiter
from .tools import CheckActorBaselineTool, CreateIncidentTool, GetRelatedEventsTool


@dataclass
class AgentRuntime:
    investigations: InvestigationRepository
    evidence: EvidenceRepository
    alerts: SecurityEventRepository
    orchestrator: AgentOrchestrator
    launcher: InvestigationLauncher


def _assemble(
    llm: LLMGateway,
    investigations: InvestigationRepository,
    evidence: EvidenceRepository,
    events: SecurityEventRepository,
    baselines: ActorBaselineRepository,
    incidents: IncidentRepository,
    limiter_factory: Callable[[], StepLimiter],
    launcher_factory: Callable[[Callable[[str], Any]], InvestigationLauncher] | None,
    env: Mapping[str, str] | None,
) -> AgentRuntime:
    registry = ToolRegistry([
        GetRelatedEventsTool(events),
        CheckActorBaselineTool(baselines),
        CreateIncidentTool(incidents),
    ])
    orchestrator = AgentOrchestrator(
        llm=llm,
        registry=registry,
        investigations=investigations,
        evidence=evidence,
        limiter_factory=limiter_factory,
    )

    def run(investigation_id: str) -> Any:
        return run_investigation_safely(orchestrator, investigations, investigation_id)

    launcher = launcher_factory(run) if launcher_factory else launcher_from_env(run, env)
    return AgentRuntime(investigations, evidence, events, orchestrator, launcher)


def build_in_memory_runtime(
    llm: LLMGateway,
    alerts: dict[str, dict[str, Any]] | None = None,
    related_events: dict[str, list[dict[str, Any]]] | None = None,
    baselines: dict[str, dict[str, Any]] | None = None,
    limiter_factory: Callable[[], StepLimiter] = StepLimiter,
    launcher_factory: Callable[[Callable[[str], Any]], InvestigationLauncher] | None = None,
    env: Mapping[str, str] | None = None,
) -> AgentRuntime:
    """In-memory repositories (tests and local runs). The launcher comes from
    `launcher_factory(run)` if given, otherwise from the environment."""
    return _assemble(
        llm,
        InMemoryInvestigationRepository(),
        InMemoryEvidenceRepository(),
        InMemorySecurityEventRepository(alerts, related_events),
        InMemoryActorBaselineRepository(baselines),
        InMemoryIncidentRepository(),
        limiter_factory,
        launcher_factory,
        env,
    )


def build_dynamodb_runtime(
    llm: LLMGateway,
    dynamodb: Any,
    env: Mapping[str, str] | None = None,
    limiter_factory: Callable[[], StepLimiter] = StepLimiter,
    launcher_factory: Callable[[Callable[[str], Any]], InvestigationLauncher] | None = None,
) -> AgentRuntime:
    """Real storage. `dynamodb` is a boto3 resource; table names come from the environment
    (ALERTS_TABLE_NAME, INVESTIGATIONS_TABLE_NAME, EVIDENCE_TABLE_NAME, INCIDENTS_TABLE_NAME).
    Actor baselines have no table yet, so that one stays empty (the tool reports no baseline)."""
    from infra.dynamodb import (
        DynamoDBEvidenceRepository,
        DynamoDBIncidentRepository,
        DynamoDBInvestigationRepository,
        DynamoDBSecurityEventRepository,
    )

    names = os.environ if env is None else env
    table = lambda key: dynamodb.Table(names[key])  # noqa: E731
    return _assemble(
        llm,
        DynamoDBInvestigationRepository(table("INVESTIGATIONS_TABLE_NAME")),
        DynamoDBEvidenceRepository(table("EVIDENCE_TABLE_NAME")),
        DynamoDBSecurityEventRepository(table("ALERTS_TABLE_NAME")),
        InMemoryActorBaselineRepository(),
        DynamoDBIncidentRepository(table("INCIDENTS_TABLE_NAME")),
        limiter_factory,
        launcher_factory,
        env,
    )


@functools.cache
def default_runtime() -> AgentRuntime:
    """Process-wide runtime used by the Lambda handler and the default API router."""
    from infra.bedrock import BedrockClient, BedrockSettings

    llm = BedrockClient(BedrockSettings.from_env())
    if os.environ.get("INVESTIGATIONS_TABLE_NAME"):
        import boto3

        dynamodb = boto3.resource(
            "dynamodb",
            region_name=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"),
            endpoint_url=os.environ.get("DYNAMODB_ENDPOINT_URL") or None,
        )
        return build_dynamodb_runtime(llm, dynamodb)
    return build_in_memory_runtime(llm)
