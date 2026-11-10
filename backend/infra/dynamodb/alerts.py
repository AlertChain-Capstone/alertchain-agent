"""Conditional alert writes using an injected boto3 DynamoDB Table."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from botocore.exceptions import ClientError

from domain.alerts import AlertRepository, NormalizedAlert


def _utc_timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("alert timestamps must be timezone-aware")
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _dynamodb_value(value: Any) -> Any:
    """Copy JSON detail, converting floats to DynamoDB-compatible decimals."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {key: _dynamodb_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_dynamodb_value(item) for item in value]
    return value


class DynamoDBAlertRepository(AlertRepository):
    def __init__(self, table: Any) -> None:
        self._table = table

    def store_if_absent(self, alert: NormalizedAlert) -> bool:
        event_time = _utc_timestamp(alert.event_time)
        item = {
            "alertId": alert.id,
            "alertCollection": "ALERTS",
            "eventTimeAlertId": f"{event_time}#{alert.id}",
            "eventName": alert.event_name,
            "severity": alert.severity.value,
            "status": alert.status.value,
            "eventTime": event_time,
            "createdTime": _utc_timestamp(alert.created_time),
            "source": alert.source,
            "resource": alert.resource,
            "region": alert.region,
            "rawEvent": _dynamodb_value(alert.raw_detail),
        }
        # Missing index keys keep unknown principals out of the sparse GSI.
        if alert.principal is not None:
            item["principal"] = alert.principal
        try:
            self._table.put_item(Item=item, ConditionExpression="attribute_not_exists(alertId)")
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                return False
            raise
        return True
