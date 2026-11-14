"""Conditional alert writes using an injected boto3 DynamoDB Table."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Attr, Key

from domain.alerts import (
    AlertFilter, AlertIncidentLookup, AlertNotFoundError, AlertPage, AlertRepository,
    AlertStatus, AssociationStatus, IncidentAssociation, NormalizedAlert, Severity,
)


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


def _json_value(value: Any) -> Any:
    """Restore JSON numbers without changing booleans, nulls or nested structures."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    return value


def _from_item(item: dict[str, Any]) -> NormalizedAlert:
    return NormalizedAlert(
        id=item["alertId"], event_name=item["eventName"], severity=Severity(item["severity"]),
        status=AlertStatus(item["status"]),
        event_time=datetime.fromisoformat(item["eventTime"].replace("Z", "+00:00")),
        created_time=datetime.fromisoformat(item["createdTime"].replace("Z", "+00:00")),
        source=item["source"], principal=item.get("principal"), resource=item.get("resource"),
        region=item["region"], raw_detail=_json_value(item.get("rawEvent")),
    )


class DynamoDBAlertRepository(AlertRepository):
    def __init__(self, table: Any) -> None:
        self._table = table

    def list_alerts(self, filter: AlertFilter, page: int, page_size: int) -> AlertPage:
        condition = Key("alertCollection").eq("ALERTS")
        time_key = Key("eventTimeAlertId")
        lower = _utc_timestamp(filter.from_time) + "#" if filter.from_time else None
        upper = _utc_timestamp(filter.to_time) + "#\uffff" if filter.to_time else None
        if lower is not None and upper is not None:
            condition &= time_key.between(lower, upper)
        elif lower is not None:
            condition &= time_key.gte(lower)
        elif upper is not None:
            condition &= time_key.lte(upper)
        # Exclude raw detail from list payloads. Projection does not lower DynamoDB read cost.
        fields = ["alertId", "eventName", "severity", "status", "eventTime", "createdTime",
                  "source", "principal", "resource", "region"]
        kwargs = {
            "IndexName": "alertsByTime", "KeyConditionExpression": condition,
            "ScanIndexForward": False,
            "ProjectionExpression": ", ".join(f"#f{i}" for i in range(len(fields))),
            "ExpressionAttributeNames": {f"#f{i}": field for i, field in enumerate(fields)},
        }
        offset = (page - 1) * page_size
        total = 0
        alerts = []
        while True:
            response = self._table.query(**kwargs)
            for item in response.get("Items", []):
                alert = _from_item(item)
                if filter.matches(alert):
                    if offset <= total < offset + page_size:
                        alerts.append(alert)
                    total += 1
            # Count all matches, even after the requested page has been filled.
            key = response.get("LastEvaluatedKey")
            if not key:
                break
            kwargs["ExclusiveStartKey"] = key
        return AlertPage(alerts, total, page, page_size)

    def get_alert(self, alert_id: str) -> NormalizedAlert | None:
        item = self._table.get_item(Key={"alertId": alert_id}, ConsistentRead=True).get("Item")
        return _from_item(item) if item else None

    def get_raw_event(self, alert_id: str) -> dict[str, Any] | None:
        response = self._table.get_item(
            Key={"alertId": alert_id}, ConsistentRead=True,
            ProjectionExpression="#id, #raw",
            ExpressionAttributeNames={"#id": "alertId", "#raw": "rawEvent"},
        )
        item = response.get("Item")
        if not item:
            raise AlertNotFoundError(alert_id)
        return _json_value(item.get("rawEvent"))

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


class DynamoDBAlertIncidentLookup(AlertIncidentLookup):
    """Temporary FA1 read adapter over FA2's unchanged incident items; no index needed."""

    def __init__(self, table: Any) -> None:
        self._table = table

    def get_association(self, alert_id: str) -> IncidentAssociation:
        kwargs = {
            "FilterExpression": Attr("alert_id").eq(alert_id),
            "ProjectionExpression": "incident_id",
        }
        first_id = None
        while True:
            response = self._table.scan(**kwargs)
            for item in response.get("Items", []):
                incident_id = item["incident_id"]
                if first_id is not None and incident_id != first_id:
                    return IncidentAssociation(AssociationStatus.AMBIGUOUS, None)
                first_id = incident_id
            key = response.get("LastEvaluatedKey")
            if not key:
                break
            kwargs["ExclusiveStartKey"] = key
        return IncidentAssociation(
            AssociationStatus.ASSOCIATED if first_id is not None else AssociationStatus.NONE,
            first_id,
        )
