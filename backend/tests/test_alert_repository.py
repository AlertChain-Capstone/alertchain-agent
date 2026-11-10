import copy
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import Mock

import pytest
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

from domain.alerts import AlertRepository
from infra.dynamodb import DynamoDBAlertRepository
from ingestion import FindingNormalizer


@pytest.fixture
def alert():
    event = json.loads((Path(__file__).parent / "fixtures" / "guardduty_finding.json").read_text())
    return FindingNormalizer(now=lambda: datetime(2026, 11, 1, 11, tzinfo=UTC)).normalize(event)


def test_stores_full_alert_with_conditional_insert(alert):
    table = Mock()
    repository = DynamoDBAlertRepository(table)
    assert isinstance(repository, AlertRepository)
    assert repository.store_if_absent(alert) is True
    table.put_item.assert_called_once_with(
        ConditionExpression="attribute_not_exists(alertId)",
        Item={
            "alertId": alert.id,
            "alertCollection": "ALERTS",
            "eventTimeAlertId": f"2026-11-01T10:00:00.000000Z#{alert.id}",
            "eventName": alert.event_name,
            "severity": "HIGH",
            "status": "New",
            "eventTime": "2026-11-01T10:00:00.000000Z",
            "createdTime": "2026-11-01T11:00:00.000000Z",
            "source": "Amazon GuardDuty",
            "principal": "sample-instance-role",
            "resource": "i-0123456789abcdef0",
            "region": "us-east-2",
            "rawEvent": alert.raw_detail,
        },
    )


def test_omits_unknown_principal_entirely(alert):
    table = Mock()
    assert DynamoDBAlertRepository(table).store_if_absent(replace(alert, principal=None)) is True
    assert "principal" not in table.put_item.call_args.kwargs["Item"]


def test_duplicate_condition_failure_returns_false(alert):
    failure = ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "PutItem")
    table = Mock()
    table.put_item.side_effect = failure
    assert DynamoDBAlertRepository(table).store_if_absent(alert) is False
    assert table.put_item.call_count == 1


@pytest.mark.parametrize("error", [
    ClientError({"Error": {"Code": "AccessDeniedException"}}, "PutItem"),
    ClientError({"Error": {"Code": "ProvisionedThroughputExceededException"}}, "PutItem"),
    ClientError({"Error": {"Code": "ResourceNotFoundException"}}, "PutItem"),
    RuntimeError("connection failed"),
])
def test_other_storage_errors_propagate_unchanged(alert, error):
    table = Mock()
    table.put_item.side_effect = error
    with pytest.raises(type(error)) as caught:
        DynamoDBAlertRepository(table).store_if_absent(alert)
    assert caught.value is error


def test_fixed_width_utc_timestamps_sort_chronologically(alert):
    table = Mock()
    repository = DynamoDBAlertRepository(table)
    offset = timezone(timedelta(hours=-5))
    earlier = datetime(2026, 11, 1, 5, 0, 0, 1, tzinfo=offset)
    repository.store_if_absent(replace(alert, event_time=earlier, created_time=earlier))
    first = table.put_item.call_args.kwargs["Item"]
    repository.store_if_absent(replace(alert, event_time=earlier + timedelta(microseconds=1)))
    second = table.put_item.call_args.kwargs["Item"]
    assert first["eventTime"] == "2026-11-01T10:00:00.000001Z"
    assert first["createdTime"] == first["eventTime"]
    assert len(first["eventTime"]) == len(second["eventTime"]) == 27
    assert first["eventTimeAlertId"] < second["eventTimeAlertId"]


def test_raw_detail_is_preserved_and_float_values_are_serializable(alert):
    alert.raw_detail["severity"] = 8.5
    alert.raw_detail["extra"] = [{"score": 0.25, "flag": True, "missing": None}]
    original = copy.deepcopy(alert.raw_detail)
    table = Mock()
    DynamoDBAlertRepository(table).store_if_absent(alert)
    item = table.put_item.call_args.kwargs["Item"]
    assert item["rawEvent"]["severity"] == Decimal("8.5")
    assert item["rawEvent"]["extra"][0]["score"] == Decimal("0.25")
    TypeSerializer().serialize(item)
    assert alert.raw_detail == original
    item["rawEvent"]["extra"][0]["score"] = Decimal("9")
    assert alert.raw_detail == original


@pytest.mark.parametrize("field", ["event_time", "created_time"])
def test_naive_timestamp_rejected_before_storage(alert, field):
    table = Mock()
    with pytest.raises(ValueError, match="timezone-aware"):
        DynamoDBAlertRepository(table).store_if_absent(
            replace(alert, **{field: datetime(2026, 11, 1)})
        )
    table.put_item.assert_not_called()
