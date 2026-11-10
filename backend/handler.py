"""Shared Lambda entry point for HTTP health and selected security events."""

from __future__ import annotations

import functools
import os
from typing import Any

from ingestion import CloudTrailNormalizer, FindingNormalizer
from infra.dynamodb import DynamoDBAlertRepository


@functools.cache
def _alert_repository() -> DynamoDBAlertRepository:
    import boto3

    dynamodb = boto3.resource(
        "dynamodb",
        region_name=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"),
        endpoint_url=os.environ.get("DYNAMODB_ENDPOINT_URL") or None,
    )
    return DynamoDBAlertRepository(dynamodb.Table(os.environ["ALERTS_TABLE_NAME"]))


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    if not isinstance(event, dict):
        raise ValueError("event must be an object")
    http = event.get("requestContext", {}).get("http", {})
    if http.get("method") == "GET" and event.get("rawPath") == "/health":
        return {
            "statusCode": 200,
            "headers": {"content-type": "application/json"},
            "body": '{"status":"ok"}',
        }
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
