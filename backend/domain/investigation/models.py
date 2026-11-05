"""Investigation domain model.

Rule: every claim in a Conclusion (and in each AttackChain stage) must cite at least one
Evidence id. Evidence is only ever created from a tool result, never from model text.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any


class InvestigationStatus(StrEnum):
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    NEEDS_HUMAN_REVIEW = "NEEDS_HUMAN_REVIEW"
    FAILED = "FAILED"


class Confidence(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class Severity(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class DomainError(ValueError):
    """Raised when an operation would break a domain rule."""


@dataclass(frozen=True)
class Evidence:
    id: str
    investigation_id: str
    source: str  # tool that produced it, e.g. "get_related_events"
    summary: str
    raw: dict[str, Any]


@dataclass(frozen=True)
class ReasoningStep:
    step_no: int
    thought: str
    tool_name: str | None
    tool_input: dict[str, Any] | None
    tool_output: dict[str, Any] | None
    timestamp: datetime


@dataclass(frozen=True)
class AttackChainStage:
    description: str
    evidence_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.evidence_ids:
            raise DomainError(f"attack chain stage {self.description!r} cites no evidence")


@dataclass(frozen=True)
class AttackChain:
    stages: tuple[AttackChainStage, ...] = ()

    @property
    def evidence_ids(self) -> set[str]:
        return {eid for stage in self.stages for eid in stage.evidence_ids}


@dataclass(frozen=True)
class Conclusion:
    summary: str
    severity: Severity
    confidence: Confidence
    attack_chain: AttackChain
    evidence_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.evidence_ids:
            raise DomainError("conclusion cites no evidence")

    def cited_evidence_ids(self) -> set[str]:
        return set(self.evidence_ids) | self.attack_chain.evidence_ids


@dataclass
class Investigation:
    id: str
    alert_id: str
    status: InvestigationStatus = InvestigationStatus.RUNNING
    steps: list[ReasoningStep] = field(default_factory=list)
    conclusion: Conclusion | None = None
    status_reason: str | None = None

    def add_step(self, step: ReasoningStep) -> None:
        self._require_running()
        expected = len(self.steps) + 1
        if step.step_no != expected:
            raise DomainError(f"expected step_no {expected}, got {step.step_no}")
        self.steps.append(step)

    def complete(self, conclusion: Conclusion, known_evidence_ids: set[str]) -> None:
        self._require_running()
        unknown = conclusion.cited_evidence_ids() - known_evidence_ids
        if unknown:
            raise DomainError(f"conclusion cites unknown evidence: {sorted(unknown)}")
        self.conclusion = conclusion
        self.status = InvestigationStatus.COMPLETED
        self.status_reason = None

    def escalate(self, reason: str) -> None:
        self._require_running()
        self.status = InvestigationStatus.NEEDS_HUMAN_REVIEW
        self.status_reason = reason

    def fail(self, reason: str) -> None:
        self._require_running()
        self.status = InvestigationStatus.FAILED
        self.status_reason = reason

    def _require_running(self) -> None:
        if self.status is not InvestigationStatus.RUNNING:
            raise DomainError(f"investigation {self.id} is {self.status}, not RUNNING")
