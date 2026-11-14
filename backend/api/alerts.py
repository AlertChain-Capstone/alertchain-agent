"""AlertController for API Gateway HTTP API v2 events (no extra Lambda/HTTP framework)."""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qsl, unquote

from domain.alerts import AlertFilter, AlertNotFoundError, AlertStatus, Severity
from services.alerts import AlertService, alert_fields

logger = logging.getLogger(__name__)
ALERT_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
SOURCES = {"Amazon GuardDuty", "AWS CloudTrail"}
QUERY_KEYS = {"search", "severity", "source", "status", "from", "to", "page", "pageSize"}
# Require a full timestamp, not a date-only or offset-free datetime.
TIMESTAMP = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?"
    r"(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)"
)


class InvalidQuery(ValueError):
    pass


def response(status: int, body: Any) -> dict[str, Any]:
    return {"statusCode": status, "headers": {"content-type": "application/json"},
            "body": json.dumps(body, allow_nan=False)}


def error_response(status: int, code: str, message: str) -> dict[str, Any]:
    return response(status, {"error": {"code": code, "message": message}})


def _query(event: dict[str, Any]) -> dict[str, str]:
    # v2 queryStringParameters folds duplicate values into a comma-separated string.
    # Parse rawQueryString instead, so duplicates cannot silently change semantics.
    if "rawQueryString" in event:
        pairs = parse_qsl(event["rawQueryString"], keep_blank_values=True)
    else:
        pairs = list((event.get("queryStringParameters") or {}).items())
    values = {}
    for key, value in pairs:
        if key not in QUERY_KEYS or key in values:
            raise InvalidQuery("Unknown or repeated query parameter.")
        values[key] = value.strip()
    return values


def _time(value: str | None) -> datetime | None:
    if value is None:
        return None
    if not TIMESTAMP.fullmatch(value):
        raise InvalidQuery("Time bounds must be ISO 8601 timestamps with a timezone.")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except (ValueError, OverflowError) as exc:
        raise InvalidQuery("Invalid timestamp.") from exc


def _positive_int(value: str, name: str, maximum: int | None = None) -> int:
    if not re.fullmatch(r"[0-9]+", value):
        raise InvalidQuery(f"{name} must be a positive integer.")
    try:
        result = int(value)
    except ValueError as exc:
        raise InvalidQuery(f"Invalid {name}.") from exc
    if result < 1 or (maximum is not None and result > maximum):
        raise InvalidQuery(f"Invalid {name}.")
    return result


def _list_args(event: dict[str, Any]) -> tuple[AlertFilter, int, int]:
    values = _query(event)
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
        _positive_int(values.get("page", "1"), "page"),
        _positive_int(values.get("pageSize", "6"), "pageSize", 100),
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
        if not ALERT_ID.fullmatch(alert_id):
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
