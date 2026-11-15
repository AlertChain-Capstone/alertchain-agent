"""FA1 use cases. Optional reads never run as part of normalized detail retrieval."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from domain.alerts import (
    AlertFilter, AlertIncidentLookup, AlertNotFoundError, AlertPage, AlertRepository,
    IncidentAssociation, NormalizedAlert,
)


def _timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def alert_fields(alert: NormalizedAlert) -> dict[str, Any]:
    return {
        "id": alert.id, "eventName": alert.event_name, "source": alert.source,
        "severity": alert.severity.value, "status": alert.status.value,
        "occurredAt": _timestamp(alert.event_time), "createdAt": _timestamp(alert.created_time),
        "principal": alert.principal, "resource": alert.resource, "region": alert.region,
    }


def _text_at(data: Any, *path: str) -> str | None:
    for key in path:
        if not isinstance(data, dict):
            return None
        data = data.get(key)
    return data if isinstance(data, str) and data.strip() else None


def _guardduty_source_ip(raw: Any) -> str | None:
    action_path = ("service", "action")
    # The remote endpoint initiates an API call. For network connections, direction
    # determines the source: remote on inbound connections, local on outbound ones.
    ip_path = (*action_path, "awsApiCallAction", "remoteIpDetails")
    if not isinstance(raw, dict) or not isinstance(raw.get("service"), dict):
        return None
    action = raw["service"].get("action")
    if not isinstance(action, dict):
        return None
    if not isinstance(action.get("awsApiCallAction"), dict):
        direction = _text_at(action, "networkConnectionAction", "connectionDirection")
        endpoint = {"INBOUND": "remoteIpDetails", "OUTBOUND": "localIpDetails"}.get(direction)
        if endpoint is None:
            return None
        ip_path = (*action_path, "networkConnectionAction", endpoint)
    return _text_at(raw, *ip_path, "ipAddressV4") or _text_at(raw, *ip_path, "ipAddressV6")


class AlertService:
    def __init__(
        self, alerts: AlertRepository, incident_lookup: Callable[[], AlertIncidentLookup],
    ) -> None:
        self._alerts = alerts
        self._incident_lookup = incident_lookup

    def list_alerts(self, filter: AlertFilter, page: int = 1, page_size: int = 6) -> AlertPage:
        if isinstance(page, bool) or not isinstance(page, int) or page < 1:
            raise ValueError("page must be a positive integer")
        if isinstance(page_size, bool) or not isinstance(page_size, int) or not 1 <= page_size <= 100:
            raise ValueError("pageSize must be between 1 and 100")
        if filter.from_time and filter.to_time and filter.from_time > filter.to_time:
            raise ValueError("from must not be after to")
        return self._alerts.list_alerts(filter, page, page_size)

    def _require_alert(self, alert_id: str) -> NormalizedAlert:
        alert = self._alerts.get_alert(alert_id)
        if alert is None:
            raise AlertNotFoundError(alert_id)
        return alert

    def get_alert_details(self, alert_id: str) -> dict[str, Any]:
        alert = self._require_alert(alert_id)
        raw = alert.raw_detail
        access_key = source_ip = summary = None
        if alert.source == "AWS CloudTrail":
            access_key = _text_at(raw, "userIdentity", "accessKeyId")
            source_ip = _text_at(raw, "sourceIPAddress")
            summary = {
                "StopLogging": "A StopLogging event was detected for a monitored trail.",
                "CreateAccessKey": "A CreateAccessKey event was detected for a monitored user.",
            }.get(alert.event_name)
        elif alert.source == "Amazon GuardDuty":
            access_key = _text_at(raw, "resource", "accessKeyDetails", "accessKeyId")
            summary = _text_at(raw, "description")
            source_ip = _guardduty_source_ip(raw)
        return {**alert_fields(alert), "accessKeyId": access_key,
                "sourceIp": source_ip, "summary": summary}

    def get_raw_event(self, alert_id: str) -> dict[str, Any] | None:
        return self._alerts.get_raw_event(alert_id)

    def get_associated_incident_id(self, alert_id: str) -> IncidentAssociation:
        self._require_alert(alert_id)
        return self._incident_lookup().get_association(alert_id)
