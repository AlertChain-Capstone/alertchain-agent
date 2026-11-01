"""HTTP API for investigations.

POST /investigations saves a RUNNING Investigation and hands it to an InvestigationLauncher
(see agent.launcher), returning 202 at once. GET /investigations/{investigationId} returns
status, steps, evidence and conclusion.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Path, status
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from agent import (
    AgentRuntime,
    InvestigationLauncher,
    LauncherError,
    LLMGateway,
    StepLimiter,
    build_in_memory_runtime,
    default_runtime,
)
from domain.investigation import (
    Conclusion,
    Evidence,
    EvidenceRepository,
    Investigation,
    InvestigationRepository,
    InvestigationStatus,
    ReasoningStep,
    SecurityEventRepository,
)

logger = logging.getLogger(__name__)

# The alert id is interpolated into the model prompt, so only allow plain identifiers.
ALERT_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
INVESTIGATION_ID_PATTERN = r"^[A-Za-z0-9._:-]{1,128}$"


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class StartInvestigationRequest(_CamelModel):
    alert_id: str = Field(pattern=ALERT_ID_PATTERN)


class StartInvestigationResponse(_CamelModel):
    investigation_id: str


class ReasoningStepOut(_CamelModel):
    step_no: int
    thought: str
    tool_name: str | None
    tool_input: dict[str, Any] | None
    tool_output: dict[str, Any] | None
    timestamp: datetime


class EvidenceOut(_CamelModel):
    id: str
    source: str
    summary: str
    raw: dict[str, Any]


class AttackChainStageOut(_CamelModel):
    description: str
    evidence_ids: list[str]


class ConclusionOut(_CamelModel):
    summary: str
    severity: str
    confidence: str
    attack_chain: list[AttackChainStageOut]
    evidence_ids: list[str]


class InvestigationOut(_CamelModel):
    investigation_id: str
    alert_id: str
    status: InvestigationStatus
    status_reason: str | None
    steps: list[ReasoningStepOut]
    evidence: list[EvidenceOut]
    conclusion: ConclusionOut | None


def _step_out(step: ReasoningStep) -> ReasoningStepOut:
    return ReasoningStepOut(
        step_no=step.step_no,
        thought=step.thought,
        tool_name=step.tool_name,
        tool_input=step.tool_input,
        tool_output=step.tool_output,
        timestamp=step.timestamp,
    )


def _evidence_out(ev: Evidence) -> EvidenceOut:
    return EvidenceOut(id=ev.id, source=ev.source, summary=ev.summary, raw=ev.raw)


def _conclusion_out(c: Conclusion) -> ConclusionOut:
    return ConclusionOut(
        summary=c.summary,
        severity=c.severity,
        confidence=c.confidence,
        attack_chain=[
            AttackChainStageOut(description=s.description, evidence_ids=list(s.evidence_ids))
            for s in c.attack_chain.stages
        ],
        evidence_ids=list(c.evidence_ids),
    )


def _new_investigation_id() -> str:
    return f"INV-{uuid.uuid4().hex[:12]}"


class InvestigationsRouter:
    def __init__(
        self,
        investigations: InvestigationRepository,
        evidence: EvidenceRepository,
        alerts: SecurityEventRepository,
        launcher: InvestigationLauncher,
        id_factory: Callable[[], str] = _new_investigation_id,
    ) -> None:
        self._investigations = investigations
        self._evidence = evidence
        self._alerts = alerts
        self._launcher = launcher
        self._id_factory = id_factory

        self.router = APIRouter(prefix="/investigations", tags=["investigations"])
        self.router.add_api_route(
            "",
            self.start_investigation,
            methods=["POST"],
            status_code=status.HTTP_202_ACCEPTED,
            response_model=StartInvestigationResponse,
        )
        self.router.add_api_route(
            "/{investigationId}",
            self.get_investigation,
            methods=["GET"],
            response_model=InvestigationOut,
        )

    @classmethod
    def from_runtime(
        cls, runtime: AgentRuntime, id_factory: Callable[[], str] = _new_investigation_id
    ) -> InvestigationsRouter:
        return cls(runtime.investigations, runtime.evidence, runtime.alerts, runtime.launcher,
                   id_factory)

    def start_investigation(self, body: StartInvestigationRequest) -> StartInvestigationResponse:
        alert_id = body.alert_id
        if self._alerts.get_alert(alert_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"alert {alert_id} not found")
        inv = Investigation(id=self._id_factory(), alert_id=alert_id)
        self._investigations.save(inv)
        try:
            self._launcher.launch(inv.id)
        except LauncherError as exc:
            # Never leave an investigation RUNNING when nothing will ever run it.
            logger.error("could not launch investigation %s: %s", inv.id, exc)
            inv.fail(f"could not start the investigation run: {exc}")
            self._investigations.save(inv)
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                f"investigation {inv.id} could not be started",
            ) from exc
        return StartInvestigationResponse(investigation_id=inv.id)

    def get_investigation(
        self,
        investigation_id: str = Path(alias="investigationId", pattern=INVESTIGATION_ID_PATTERN),
    ) -> InvestigationOut:
        inv = self._investigations.get(investigation_id)
        if inv is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, f"investigation {investigation_id} not found"
            )
        evidence = self._evidence.list_for_investigation(inv.id)
        return InvestigationOut(
            investigation_id=inv.id,
            alert_id=inv.alert_id,
            status=inv.status,
            status_reason=inv.status_reason,
            steps=[_step_out(s) for s in inv.steps],
            evidence=[_evidence_out(e) for e in evidence],
            conclusion=_conclusion_out(inv.conclusion) if inv.conclusion else None,
        )


def build_in_memory_router(
    llm: LLMGateway,
    alerts: dict[str, dict[str, Any]] | None = None,
    related_events: dict[str, list[dict[str, Any]]] | None = None,
    baselines: dict[str, dict[str, Any]] | None = None,
    limiter_factory: Callable[[], StepLimiter] = StepLimiter,
    launcher_factory: Callable[[Callable[[str], Any]], InvestigationLauncher] | None = None,
    id_factory: Callable[[], str] = _new_investigation_id,
) -> InvestigationsRouter:
    """InvestigationsRouter on in-memory repositories (until real storage exists)."""
    runtime = build_in_memory_runtime(
        llm, alerts, related_events, baselines, limiter_factory, launcher_factory
    )
    return InvestigationsRouter.from_runtime(runtime, id_factory)


def default_router() -> InvestigationsRouter:
    """Router on the process-wide runtime shared with handle_investigation_job."""
    return InvestigationsRouter.from_runtime(default_runtime())
