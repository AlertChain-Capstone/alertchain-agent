"""Normalize only the service/action pairs selected by the EventBridge rule."""

from __future__ import annotations

import copy
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from domain.alerts import AlertStatus, NormalizedAlert, Severity


# Provisional application defaults, matching the INC-001/FA1 examples.
SELECTED_EVENTS = {
    ("aws.iam", "iam.amazonaws.com", "CreateAccessKey"): Severity.MEDIUM,
    ("aws.cloudtrail", "cloudtrail.amazonaws.com", "StopLogging"): Severity.HIGH,
}


def _object(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return value


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a nonempty string")
    return value


def _event_time(value: Any) -> datetime:
    try:
        parsed = datetime.fromisoformat(_text(value, "detail.eventTime").replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("timezone required")
        return parsed.astimezone(UTC)
    except (ValueError, OverflowError) as exc:
        raise ValueError("detail.eventTime must be a timezone-aware ISO 8601 timestamp") from exc


def _caller(identity: dict[str, Any]) -> str:
    identity_type = _text(identity.get("type"), "detail.userIdentity.type")
    if identity.get("userName") is not None:
        return _text(identity["userName"], "detail.userIdentity.userName")
    if identity_type == "AssumedRole":
        context = _object(identity.get("sessionContext", {}), "userIdentity.sessionContext")
        issuer = _object(context.get("sessionIssuer", {}), "sessionContext.sessionIssuer")
        for field in ("userName", "arn"):
            if issuer.get(field) is not None:
                return _text(issuer[field], f"sessionIssuer.{field}")
    for field in ("arn", "principalId", "invokedBy"):
        if identity.get(field) is not None:
            return _text(identity[field], f"userIdentity.{field}")
    raise ValueError("detail.userIdentity must identify the caller")


class CloudTrailNormalizer:
    """Return None for unselected events; reject malformed selected events.

    CloudTrail eventID identifies the underlying API event, independently of
    EventBridge's delivery ID. A CloudTrail namespace prefix keeps its IDs
    distinct from GuardDuty finding ARN identities in the same UUID namespace.
    """

    def __init__(self, now: Callable[[], datetime] | None = None) -> None:
        self._now = now if now is not None else lambda: datetime.now(UTC)

    def normalize(self, event: dict[str, Any]) -> NormalizedAlert | None:
        event = _object(event, "event")
        if (event.get("detail-type") != "AWS API Call via CloudTrail"
                or event.get("source") not in ("aws.iam", "aws.cloudtrail")):
            return None
        detail = _object(event.get("detail"), "detail")
        event_name = _text(detail.get("eventName"), "detail.eventName")
        event_source = _text(detail.get("eventSource"), "detail.eventSource")
        severity = SELECTED_EVENTS.get((event["source"], event_source, event_name))
        if severity is None:
            return None

        event_id = _text(detail.get("eventID"), "detail.eventID")
        event_time = _event_time(detail.get("eventTime"))
        region = _text(detail.get("awsRegion"), "detail.awsRegion")
        identity = _object(detail.get("userIdentity"), "detail.userIdentity")
        principal = _caller(identity)
        parameters_value = detail.get("requestParameters")
        parameters = _object(
            {} if parameters_value is None else parameters_value, "detail.requestParameters"
        )
        if event_name == "StopLogging":
            resource = _text(parameters.get("name"), "requestParameters.name")
        elif "userName" in parameters:
            resource = _text(parameters["userName"], "requestParameters.userName")
        else:
            # CreateAccessKey may omit UserName for an IAM user's own key.
            resource = identity.get("userName") if identity["type"] == "IAMUser" else None

        created_time = self._now()
        if (not isinstance(created_time, datetime) or created_time.tzinfo is None
                or created_time.utcoffset() is None):
            raise ValueError("creation clock must return a timezone-aware datetime")
        return NormalizedAlert(
            id=str(uuid5(NAMESPACE_URL, f"cloudtrail:{event_id}")),
            event_name=event_name,
            severity=severity,
            status=AlertStatus.NEW,
            event_time=event_time,
            created_time=created_time.astimezone(UTC),
            source="AWS CloudTrail",
            principal=principal,
            resource=resource,
            region=region,
            raw_detail=copy.deepcopy(detail),
        )
