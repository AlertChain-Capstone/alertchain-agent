"""Shared normalized security alert, independent of transport and storage."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from domain.investigation.models import Severity


class AlertStatus(StrEnum):
    NEW = "New"


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
    raw_detail: dict[str, Any]
