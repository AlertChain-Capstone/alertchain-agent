"""Composition root: repositories, orchestrator and launcher wired together once, so the
HTTP API and the investigation_job handler share the same objects."""

from __future__ import annotations

import functools
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from domain.investigation import (
    EvidenceRepository,
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


def build_in_memory_runtime(
    llm: LLMGateway,
    alerts: dict[str, dict[str, Any]] | None = None,
    related_events: dict[str, list[dict[str, Any]]] | None = None,
    baselines: dict[str, dict[str, Any]] | None = None,
    limiter_factory: Callable[[], StepLimiter] = StepLimiter,
    launcher_factory: Callable[[Callable[[str], Any]], InvestigationLauncher] | None = None,
    env: Mapping[str, str] | None = None,
) -> AgentRuntime:
    """In-memory repositories (until real storage exists). The launcher comes from
    `launcher_factory(run)` if given, otherwise from the environment."""
    investigations = InMemoryInvestigationRepository()
    evidence = InMemoryEvidenceRepository()
    events = InMemorySecurityEventRepository(alerts, related_events)
    registry = ToolRegistry([
        GetRelatedEventsTool(events),
        CheckActorBaselineTool(InMemoryActorBaselineRepository(baselines)),
        CreateIncidentTool(InMemoryIncidentRepository()),
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


@functools.cache
def default_runtime() -> AgentRuntime:
    """Process-wide runtime used by the Lambda handler and the default API router."""
    from infra.bedrock import BedrockClient, BedrockSettings

    return build_in_memory_runtime(BedrockClient(BedrockSettings.from_env()))
