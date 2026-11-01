"""In-memory repository fakes for tests and local runs."""

from __future__ import annotations

import copy
from typing import Any

from .models import Evidence, Investigation
from .repositories import (
    ActorBaselineRepository,
    EvidenceRepository,
    IncidentRepository,
    InvestigationRepository,
    SecurityEventRepository,
)


class InMemoryInvestigationRepository(InvestigationRepository):
    def __init__(self) -> None:
        self._items: dict[str, Investigation] = {}

    def get(self, investigation_id: str) -> Investigation | None:
        item = self._items.get(investigation_id)
        return copy.deepcopy(item) if item else None

    def save(self, investigation: Investigation) -> None:
        self._items[investigation.id] = copy.deepcopy(investigation)


class InMemoryEvidenceRepository(EvidenceRepository):
    def __init__(self) -> None:
        self._items: dict[str, Evidence] = {}

    def add(self, evidence: Evidence) -> None:
        if evidence.id in self._items:
            raise ValueError(f"evidence {evidence.id} already exists")
        self._items[evidence.id] = evidence

    def get(self, evidence_id: str) -> Evidence | None:
        return self._items.get(evidence_id)

    def list_for_investigation(self, investigation_id: str) -> list[Evidence]:
        return [e for e in self._items.values() if e.investigation_id == investigation_id]


class InMemorySecurityEventRepository(SecurityEventRepository):
    def __init__(
        self,
        alerts: dict[str, dict[str, Any]] | None = None,
        related_events: dict[str, list[dict[str, Any]]] | None = None,
    ) -> None:
        self._alerts = alerts or {}
        self._related = related_events or {}

    def get_alert(self, alert_id: str) -> dict[str, Any] | None:
        return copy.deepcopy(self._alerts.get(alert_id))

    def list_related_events(self, alert_id: str) -> list[dict[str, Any]]:
        return copy.deepcopy(self._related.get(alert_id, []))


class InMemoryActorBaselineRepository(ActorBaselineRepository):
    def __init__(self, baselines: dict[str, dict[str, Any]] | None = None) -> None:
        self._baselines = baselines or {}

    def get_baseline(self, actor: str) -> dict[str, Any] | None:
        return copy.deepcopy(self._baselines.get(actor))


class InMemoryIncidentRepository(IncidentRepository):
    def __init__(self) -> None:
        self.incidents: list[dict[str, Any]] = []

    def find_by_investigation(self, investigation_id: str) -> dict[str, Any] | None:
        return next(
            (copy.deepcopy(i) for i in self.incidents if i["investigation_id"] == investigation_id),
            None,
        )

    def create(self, incident: dict[str, Any]) -> dict[str, Any]:
        stored = {**incident, "id": f"INC-{len(self.incidents) + 1}"}
        self.incidents.append(stored)
        return copy.deepcopy(stored)
