"""Pure GuardDuty EventBridge normalization; no AWS calls or persistence."""

from __future__ import annotations

import copy
import math
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from domain.alerts import AlertStatus, NormalizedAlert, Severity


def _object(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return value


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a nonempty string")
    return value


def _optional_text(value: Any, field: str) -> str | None:
    return None if value is None else _text(value, field)


def _timestamp(value: Any, field: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(_text(value, field).replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("timezone required")
        return parsed.astimezone(UTC)
    except (ValueError, OverflowError) as exc:
        raise ValueError(f"{field} must be a timezone-aware ISO 8601 timestamp") from exc


def _severity(value: Any) -> Severity:
    # bool is an int subclass, but is not a valid finding severity.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("detail.severity must be a finite number from 1 to 10")
    try:
        valid = math.isfinite(value) and 1 <= value <= 10
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError("detail.severity must be a finite number from 1 to 10")
    if value >= 9:
        return Severity.CRITICAL
    if value >= 7:
        return Severity.HIGH
    if value >= 4:
        return Severity.MEDIUM
    return Severity.LOW


class FindingNormalizer:
    """Normalize a finding with an injectable clock for alert creation time.

    IDs use the standard URL UUID namespace and the exact finding ARN. Delivery
    IDs and timestamps do not participate in identity. Optional actor/resource
    information stays None when unavailable; userName follows the actor-name
    convention used by existing baseline lookups.
    """

    def __init__(self, now: Callable[[], datetime] | None = None) -> None:
        self._now = now if now is not None else lambda: datetime.now(UTC)

    def normalize(self, event: dict[str, Any]) -> NormalizedAlert:
        event = _object(event, "event")
        if event.get("source") != "aws.guardduty":
            raise ValueError("source must be aws.guardduty")
        if event.get("detail-type") != "GuardDuty Finding":
            raise ValueError("detail-type must be GuardDuty Finding")
        detail = _object(event.get("detail"), "detail")
        arn = _text(detail.get("arn"), "detail.arn")
        if not arn.startswith("arn:") or ":guardduty:" not in arn or "/finding/" not in arn:
            raise ValueError("detail.arn must be a GuardDuty finding ARN")
        event_name = _text(detail.get("type"), "detail.type")
        severity = _severity(detail.get("severity"))
        region = _text(detail.get("region"), "detail.region")
        service = _object(detail.get("service", {}), "detail.service")
        if "eventFirstSeen" in service:
            event_time = _timestamp(service["eventFirstSeen"], "detail.service.eventFirstSeen")
        elif "createdAt" in detail:
            event_time = _timestamp(detail["createdAt"], "detail.createdAt")
        else:
            event_time = _timestamp(event.get("time"), "time")

        resource = _object(detail.get("resource", {}), "detail.resource")
        access_key = _object(resource.get("accessKeyDetails", {}), "detail.resource.accessKeyDetails")
        principal = _optional_text(access_key.get("userName"), "accessKeyDetails.userName")
        instance = _object(resource.get("instanceDetails", {}), "detail.resource.instanceDetails")
        resource_id = _optional_text(instance.get("instanceId", resource.get("arn")), "resource identifier")

        created_time = self._now()
        if (not isinstance(created_time, datetime) or created_time.tzinfo is None
                or created_time.utcoffset() is None):
            raise ValueError("creation clock must return a timezone-aware datetime")
        return NormalizedAlert(
            id=str(uuid5(NAMESPACE_URL, arn)),
            event_name=event_name,
            severity=severity,
            status=AlertStatus.NEW,
            event_time=event_time,
            created_time=created_time.astimezone(UTC),
            source="Amazon GuardDuty",
            principal=principal,
            resource=resource_id,
            region=region,
            raw_detail=copy.deepcopy(detail),
        )
