"""Incident read routes for API Gateway HTTP API v2 events."""

import logging
from collections.abc import Callable
from typing import Any
from urllib.parse import unquote

from api.http import RESOURCE_ID, InvalidQuery, error_response, positive_int, query_values, response
from services.incidents import IncidentQueryService

logger = logging.getLogger(__name__)
QUERY_KEYS = {"search", "severity", "status", "page", "pageSize"}


class IncidentsRouter:
    def __init__(self, service: Callable[[], IncidentQueryService]):
        self._service = service

    def handle(self, event: dict[str, Any]) -> dict[str, Any]:
        path = event["rawPath"]
        if event["requestContext"]["http"]["method"] != "GET":
            result = error_response(405, "METHOD_NOT_ALLOWED", "Use GET for incident reads.")
            result["headers"]["allow"] = "GET"
            return result
        try:
            if path == "/incidents":
                query = query_values(event, QUERY_KEYS)
                page = positive_int(query.get("page", "1"), "page")
                page_size = positive_int(query.get("pageSize", "20"), "pageSize", 100)
                return response(200, self._service().list_incidents(
                    query.get("search", ""), query.get("severity", ""), query.get("status", ""),
                    page, page_size,
                ))
            parts = path.split("/")
            if len(parts) != 3 or parts[1] != "incidents":
                return error_response(404, "NOT_FOUND", "Route not found.")
            incident_id = unquote(parts[2])
            if not RESOURCE_ID.fullmatch(incident_id):
                return error_response(400, "INVALID_INCIDENT_ID", "Invalid incident ID.")
            query_values(event, set())
            incident = self._service().get_incident(incident_id)
            if incident is None:
                return error_response(404, "INCIDENT_NOT_FOUND", "Incident not found.")
            return response(200, incident)
        except InvalidQuery as exc:
            return error_response(400, "INVALID_QUERY", str(exc))
        except Exception:
            logger.exception("Could not read incident data")
            return error_response(503, "SERVICE_UNAVAILABLE", "Incident data is temporarily unavailable.")
