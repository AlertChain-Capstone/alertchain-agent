"""InvestigationController for API Gateway HTTP API v2 events.

The investigations router is written with FastAPI, but the Lambda receives raw API Gateway
events and no ASGI adapter is packaged. This controller calls the router's methods directly
(the same ones FastAPI would call) and maps results and errors onto the same JSON error
contract the alert endpoints use, so FastAPI and pydantic are the only extra dependencies.
"""

from __future__ import annotations

import base64
import logging
import re
from typing import Any
from urllib.parse import unquote

from api.alerts import error_response, response

logger = logging.getLogger(__name__)

INVESTIGATION_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}")
_ERROR_CODES = {
    404: "NOT_FOUND",
    503: "SERVICE_UNAVAILABLE",
}


def _body(event: dict[str, Any]) -> bytes:
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        return base64.b64decode(raw)
    return raw.encode("utf-8")


class InvestigationController:
    def __init__(self, router: Any) -> None:
        # An api.investigations.InvestigationsRouter, typed loosely so that importing this
        # module does not import FastAPI.
        self._router = router

    def handle(self, event: dict[str, Any]) -> dict[str, Any]:
        try:
            return self._handle(event)
        except Exception:
            logger.exception("Investigation request failed")
            return error_response(
                503, "SERVICE_UNAVAILABLE", "Investigations are temporarily unavailable."
            )

    def _handle(self, event: dict[str, Any]) -> dict[str, Any]:
        from fastapi import HTTPException
        from pydantic import ValidationError

        from api.investigations import StartInvestigationRequest

        method = event.get("requestContext", {}).get("http", {}).get("method")
        parts = event.get("rawPath", "").rstrip("/").split("/")  # ["", "investigations", id?]
        if len(parts) not in (2, 3) or parts[1] != "investigations":
            return error_response(404, "NOT_FOUND", "Route not found.")

        try:
            if len(parts) == 2:
                if method != "POST":
                    return _not_allowed("POST")
                try:
                    request = StartInvestigationRequest.model_validate_json(_body(event))
                except ValidationError:
                    return error_response(
                        400, "INVALID_REQUEST", "Body must be JSON with a valid alertId."
                    )
                started = self._router.start_investigation(request)
                return response(202, started.model_dump(mode="json", by_alias=True))

            if method != "GET":
                return _not_allowed("GET")
            investigation_id = unquote(parts[2])
            if not INVESTIGATION_ID.fullmatch(investigation_id):
                return error_response(400, "INVALID_INVESTIGATION_ID", "Invalid investigation ID.")
            found = self._router.get_investigation(investigation_id)
            return response(200, found.model_dump(mode="json", by_alias=True))
        except HTTPException as exc:
            return error_response(
                exc.status_code, _ERROR_CODES.get(exc.status_code, "ERROR"), str(exc.detail)
            )


def _not_allowed(allowed: str) -> dict[str, Any]:
    result = error_response(405, "METHOD_NOT_ALLOWED", f"Use {allowed} for this route.")
    result["headers"]["allow"] = allowed
    return result


__all__ = ["InvestigationController"]
