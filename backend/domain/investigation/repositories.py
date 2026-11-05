"""Repository interfaces. In-memory fakes live in in_memory.py; DynamoDB versions come later.

InvestigationRepository and EvidenceRepository store the investigation itself. The other
three are read/write ports the agent tools depend on.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from .models import Evidence, Investigation


class InvestigationRepository(ABC):
    @abstractmethod
    def get(self, investigation_id: str) -> Investigation | None: ...

    @abstractmethod
    def save(self, investigation: Investigation) -> None: ...


class EvidenceRepository(ABC):
    @abstractmethod
    def add(self, evidence: Evidence) -> None: ...

    @abstractmethod
    def get(self, evidence_id: str) -> Evidence | None: ...

    @abstractmethod
    def list_for_investigation(self, investigation_id: str) -> list[Evidence]: ...


class SecurityEventRepository(ABC):
    """Alerts and the raw security events (e.g. CloudTrail) around them."""

    @abstractmethod
    def get_alert(self, alert_id: str) -> dict[str, Any] | None: ...

    @abstractmethod
    def list_related_events(self, alert_id: str) -> list[dict[str, Any]]: ...


class ActorBaselineRepository(ABC):
    """Normal behaviour for an actor (IAM user/role): known IPs, usual actions."""

    @abstractmethod
    def get_baseline(self, actor: str) -> dict[str, Any] | None: ...


class IncidentRepository(ABC):
    @abstractmethod
    def find_by_investigation(self, investigation_id: str) -> dict[str, Any] | None: ...

    @abstractmethod
    def create(self, incident: dict[str, Any]) -> dict[str, Any]: ...
