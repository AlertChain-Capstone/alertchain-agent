"""Shared normalized security alert, independent of transport and storage."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from domain.investigation.models import Severity


class AlertNotFoundError(LookupError):
    """The requested alert does not exist."""


class AlertStatus(StrEnum):
    NEW = "New"
    UNDER_INVESTIGATION = "Under investigation"
    CLOSED_BENIGN = "Closed · Benign"
    CLOSED_FALSE_POSITIVE = "Closed · False positive"
    RESOLVED = "Resolved"


@dataclass(frozen=True)
class NormalizedAlert:
    id: str
    event_name: str
    severity: Severity
    status: AlertStatus
    event_time: datetime
    created_time: datetime
    source: str
    principal: str | None
    resource: str | None
    region: str
    raw_detail: dict[str, Any] | None


@dataclass(frozen=True)
class AlertFilter:
    search: str = ""
    severity: Severity | None = None
    source: str | None = None
    status: AlertStatus | None = None
    from_time: datetime | None = None
    to_time: datetime | None = None

    def matches(self, alert: NormalizedAlert) -> bool:
        query = self.search.strip().casefold()
        return (
            any(query in (value or "").casefold()
                for value in (alert.id, alert.event_name, alert.principal))
            and (self.severity is None or alert.severity == self.severity)
            and (self.source is None or alert.source == self.source)
            and (self.status is None or alert.status == self.status)
            and (self.from_time is None or alert.event_time >= self.from_time)
            and (self.to_time is None or alert.event_time <= self.to_time)
        )


@dataclass(frozen=True)
class AlertPage:
    alerts: list[NormalizedAlert]
    total_alerts: int
    page: int
    page_size: int


class AssociationStatus(StrEnum):
    NONE = "none"
    ASSOCIATED = "associated"
    AMBIGUOUS = "ambiguous"


@dataclass(frozen=True)
class IncidentAssociation:
    status: AssociationStatus
    incident_id: str | None
