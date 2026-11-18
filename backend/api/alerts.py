"""AlertController for API Gateway HTTP API v2 events (no extra Lambda/HTTP framework)."""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import unquote

from api.http import RESOURCE_ID, InvalidQuery, error_response, positive_int, query_values, response

from domain.alerts import AlertFilter, AlertNotFoundError, AlertStatus, Severity
from services.alerts import AlertService, alert_fields

logger = logging.getLogger(__name__)
SOURCES = {"Amazon GuardDuty", "AWS CloudTrail"}
QUERY_KEYS = {"search", "severity", "source", "status", "from", "to", "page", "pageSize"}
# Require a full timestamp, not a date-only or offset-free datetime.
TIMESTAMP = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?"
    r"(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)"
)


def _time(value: str | None) -> datetime | None:
    if value is None:
        return None
    if not TIMESTAMP.fullmatch(value):
        raise InvalidQuery("Time bounds must be ISO 8601 timestamps with a timezone.")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except (ValueError, OverflowError) as exc:
        raise InvalidQuery("Invalid timestamp.") from exc


def _list_args(event: dict[str, Any]) -> tuple[AlertFilter, int, int]:
    values = query_values(event, QUERY_KEYS)
    try:
        severity = Severity(values["severity"]) if values.get("severity") else None
        status = AlertStatus(values["status"]) if values.get("status") else None
    except ValueError as exc:
        raise InvalidQuery("Invalid severity or status.") from exc
    source = values.get("source") or None
    if source is not None and source not in SOURCES:
        raise InvalidQuery("Invalid source.")
    start, end = _time(values.get("from")), _time(values.get("to"))
    if start and end and start > end:
        raise InvalidQuery("from must not be after to.")
    return (
        AlertFilter(values.get("search", ""), severity, source, status, start, end),
        positive_int(values.get("page", "1"), "page"),
        positive_int(values.get("pageSize", "6"), "pageSize", 100),
    )


class AlertController:
    def __init__(self, service: AlertService) -> None:
        self._service = service

    def handle(self, event: dict[str, Any]) -> dict[str, Any]:
        try:
            return self._handle(event)
        except InvalidQuery as exc:
            return error_response(400, "INVALID_QUERY", str(exc))
        except AlertNotFoundError:
            return error_response(404, "ALERT_NOT_FOUND", "Alert not found.")
        except Exception:
            logger.exception("Alert read failed")
            return error_response(503, "SERVICE_UNAVAILABLE", "Alert data is temporarily unavailable.")

    def _handle(self, event: dict[str, Any]) -> dict[str, Any]:
        path = event.get("rawPath", "")
        if event.get("requestContext", {}).get("http", {}).get("method") != "GET":
            result = error_response(405, "METHOD_NOT_ALLOWED", "Use GET for alert reads.")
            result["headers"]["allow"] = "GET"
            return result
        if path == "/alerts":
            page = self._service.list_alerts(*_list_args(event))
            return response(200, {"alerts": [alert_fields(a) for a in page.alerts],
                                  "totalAlerts": page.total_alerts,
                                  "page": page.page, "pageSize": page.page_size})
        parts = path.split("/")
        if len(parts) not in (3, 4) or (len(parts) == 4 and parts[3] not in (
            "raw-event", "associated-incident",
        )):
            return error_response(404, "NOT_FOUND", "Route not found.")
        alert_id = unquote(parts[2])
        if not RESOURCE_ID.fullmatch(alert_id):
            return error_response(400, "INVALID_ALERT_ID", "Invalid alert ID.")
        if event.get("rawQueryString") or event.get("queryStringParameters"):
            raise InvalidQuery("This endpoint does not accept query parameters.")
        if len(parts) == 3:
            return response(200, self._service.get_alert_details(alert_id))
        if parts[3] == "raw-event":
            return response(200, {"alertId": alert_id,
                                  "rawEvent": self._service.get_raw_event(alert_id)})
        association = self._service.get_associated_incident_id(alert_id)
        return response(200, {"alertId": alert_id, "status": association.status.value,
                              "incidentId": association.incident_id})
