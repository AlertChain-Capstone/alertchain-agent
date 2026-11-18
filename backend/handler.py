"""Shared Lambda entry point for HTTP health and selected security events."""

from __future__ import annotations

import functools
import os
import sys
from pathlib import Path
from typing import Any

# Third-party packages for the investigations API (FastAPI, pydantic) are installed into
# backend/vendor by scripts/vendor-backend-deps.ps1 and shipped inside the function package.
_VENDOR = Path(__file__).resolve().parent / "vendor"
# The vendor target contains Linux CPython 3.12 wheels. Host-side tests must use
# their own environment rather than importing incompatible Lambda binaries.
if _VENDOR.is_dir() and sys.platform == "linux" and sys.version_info[:2] == (3, 12):
    sys.path.insert(0, str(_VENDOR))

from ingestion import CloudTrailNormalizer, FindingNormalizer
from infra.dynamodb import DynamoDBAlertRepository


def _dynamodb_resource():
    import boto3

    return boto3.resource(
        "dynamodb",
        region_name=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"),
        endpoint_url=os.environ.get("DYNAMODB_ENDPOINT_URL") or None,
    )


@functools.cache
def _alert_repository() -> DynamoDBAlertRepository:
    return DynamoDBAlertRepository(_dynamodb_resource().Table(os.environ["ALERTS_TABLE_NAME"]))


@functools.cache
def _incident_lookup():
    from infra.dynamodb.alerts import DynamoDBAlertIncidentLookup

    return DynamoDBAlertIncidentLookup(_dynamodb_resource().Table(os.environ["INCIDENTS_TABLE_NAME"]))


@functools.cache
def _incident_query_service():
    from infra.dynamodb import DynamoDBEvidenceRepository, DynamoDBIncidentRepository
    from services.incidents import IncidentQueryService

    dynamodb = _dynamodb_resource()
    return IncidentQueryService(
        DynamoDBIncidentRepository(dynamodb.Table(os.environ["INCIDENTS_TABLE_NAME"])),
        DynamoDBEvidenceRepository(dynamodb.Table(os.environ["EVIDENCE_TABLE_NAME"])),
    )


@functools.cache
def _ask_service():
    from infra.bedrock import BedrockClient
    from services.ask import AskService

    return AskService(_incident_query_service(), BedrockClient())


def _handle_alert_http(event: dict[str, Any]) -> dict[str, Any]:
    from api.alerts import AlertController, error_response
    from services.alerts import AlertService

    try:
        return AlertController(AlertService(_alert_repository(), _incident_lookup)).handle(event)
    except Exception:
        # Configuration/client initialization failures use the same retriable HTTP contract.
        import logging

        logging.getLogger(__name__).exception("Could not initialize alert reads")
        return error_response(503, "SERVICE_UNAVAILABLE", "Alert data is temporarily unavailable.")


@functools.cache
def _investigation_controller():
    # Built lazily so /health, alert reads and ingestion never import the agent stack
    # (FastAPI, pydantic, Bedrock). A failed build is not cached, so the next call retries.
    from api.investigations import default_router
    from api.investigations_http import InvestigationController

    return InvestigationController(default_router())


def _handle_investigation_http(event: dict[str, Any]) -> dict[str, Any]:
    from api.alerts import error_response

    try:
        controller = _investigation_controller()
    except Exception:
        import logging

        logging.getLogger(__name__).exception("Could not initialize investigations")
        return error_response(
            503, "SERVICE_UNAVAILABLE", "Investigations are temporarily unavailable."
        )
    return controller.handle(event)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    if not isinstance(event, dict):
        raise ValueError("event must be an object")
    if event.get("type") == "investigation_job":
        # Asynchronous run started by the launcher invoking this function with itself.
        from agent import handle_investigation_job

        return handle_investigation_job(event)
    http = event.get("requestContext", {}).get("http", {})
    if http.get("method") == "GET" and event.get("rawPath") == "/health":
        return {
            "statusCode": 200,
            "headers": {"content-type": "application/json"},
            "body": '{"status":"ok"}',
        }
    if http.get("method") and (
        event.get("rawPath") == "/alerts" or event.get("rawPath", "").startswith("/alerts/")
    ):
        return _handle_alert_http(event)
    if http.get("method") and (
        event.get("rawPath") == "/incidents" or event.get("rawPath", "").startswith("/incidents/")
    ):
        from api.incidents import IncidentsRouter

        return IncidentsRouter(_incident_query_service, _ask_service).handle(event)
    if http.get("method") and (
        event.get("rawPath") == "/investigations"
        or event.get("rawPath", "").startswith("/investigations/")
    ):
        return _handle_investigation_http(event)
    if event.get("source") == "aws.guardduty" and event.get("detail-type") == "GuardDuty Finding":
        alert = FindingNormalizer().normalize(event)
    elif (event.get("detail-type") == "AWS API Call via CloudTrail"
          or event.get("source") in ("aws.iam", "aws.cloudtrail")):
        alert = CloudTrailNormalizer().normalize(event)
        if alert is None:
            return {"outcome": "ignored"}
    else:
        raise ValueError("unsupported event")
    inserted = _alert_repository().store_if_absent(alert)
    return {"alertId": alert.id, "outcome": "inserted" if inserted else "duplicate"}
