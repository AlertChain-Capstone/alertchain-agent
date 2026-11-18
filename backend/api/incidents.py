"""Incident and evidence-grounded question routes for API Gateway HTTP API v2."""

import base64
import json
import logging
from collections.abc import Callable
from typing import Any
from urllib.parse import unquote

from api.http import RESOURCE_ID, InvalidQuery, error_response, positive_int, query_values, response
from services.ask import MAX_QUESTION_LENGTH, AskService
from services.incidents import IncidentQueryService

logger = logging.getLogger(__name__)
QUERY_KEYS = {"search", "severity", "status", "page", "pageSize"}


class InvalidQuestion(ValueError):
    pass


def _question(event: dict[str, Any]) -> str:
    raw = event.get("body")
    if not isinstance(raw, str) or len(raw) > 24_000:
        raise ValueError("Invalid request body.")
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw, validate=True).decode("utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict) or set(data) != {"question"}:
        raise ValueError("Expected one question.")
    question = data["question"]
    if not isinstance(question, str) or not 1 <= len(question.strip()) <= MAX_QUESTION_LENGTH:
        raise InvalidQuestion(f"Enter a question of 1 to {MAX_QUESTION_LENGTH} characters.")
    question.encode("utf-8")  # reject unpaired JSON surrogates
    return question.strip()


class IncidentsRouter:
    def __init__(self, service: Callable[[], IncidentQueryService], ask_service: Callable[[], AskService]):
        self._service = service
        self._ask_service = ask_service

    def handle(self, event: dict[str, Any]) -> dict[str, Any]:
        path = event["rawPath"]
        parts = path.split("/")
        is_question = len(parts) == 4 and parts[3] == "questions"
        if path != "/incidents" and len(parts) != 3 and not is_question:
            return error_response(404, "NOT_FOUND", "Route not found.")
        method = event["requestContext"]["http"]["method"]
        if method == "OPTIONS":
            return {"statusCode": 204, "headers": {}, "body": ""}
        allowed = "POST" if is_question else "GET"
        if method != allowed:
            result = error_response(405, "METHOD_NOT_ALLOWED", f"Use {allowed} for this route.")
            result["headers"]["allow"] = allowed
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
            incident_id = unquote(parts[2])
            if not RESOURCE_ID.fullmatch(incident_id):
                return error_response(400, "INVALID_INCIDENT_ID", "Invalid incident ID.")
            query_values(event, set())
            if is_question:
                try:
                    question = _question(event)
                except InvalidQuestion as exc:
                    return error_response(400, "INVALID_QUESTION", str(exc))
                except (ValueError, RecursionError):
                    return error_response(400, "INVALID_REQUEST", "Expected a JSON object containing a question.")
                payload = self._ask_service().ask(incident_id, question)
            else:
                payload = self._service().get_incident(incident_id)
            if payload is None:
                return error_response(404, "INCIDENT_NOT_FOUND", "Incident not found.")
            return response(200, payload)
        except InvalidQuery as exc:
            return error_response(400, "INVALID_QUERY", str(exc))
        except Exception:
            logger.exception("Incident request failed")
            return error_response(503, "SERVICE_UNAVAILABLE", "The incident service is temporarily unavailable.")
