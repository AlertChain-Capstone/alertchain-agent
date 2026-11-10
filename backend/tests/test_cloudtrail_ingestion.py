import copy
import json
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock
from uuid import NAMESPACE_URL, UUID, uuid5

import pytest
from botocore.exceptions import ClientError

import handler as entrypoint
from domain.alerts import AlertStatus, Severity
from ingestion import CloudTrailNormalizer


CREATED = datetime(2026, 11, 1, 11, tzinfo=UTC)


@pytest.fixture(params=["cloudtrail_create_access_key.json", "cloudtrail_stop_logging.json"])
def event(request):
    return json.loads((Path(__file__).parent / "fixtures" / request.param).read_text())


def normalize(event):
    return CloudTrailNormalizer(now=lambda: CREATED).normalize(event)


def test_maps_selected_events_and_separates_caller_from_target(event):
    original = copy.deepcopy(event)
    alert = normalize(event)
    assert alert.id == str(uuid5(NAMESPACE_URL, "cloudtrail:" + event["detail"]["eventID"]))
    assert UUID(alert.id).version == 5
    assert alert.event_name == event["detail"]["eventName"]
    assert alert.status is AlertStatus.NEW
    assert alert.source == "AWS CloudTrail"
    assert alert.region == event["detail"]["awsRegion"]
    assert alert.created_time == CREATED
    assert alert.event_time.tzinfo is UTC
    assert alert.raw_detail == event["detail"]
    if alert.event_name == "CreateAccessKey":
        assert alert.severity is Severity.MEDIUM
        assert alert.principal == "synthetic-security-admin"
        assert alert.resource == "synthetic-target-user"
        assert alert.event_time == datetime(2026, 11, 1, 10, tzinfo=UTC)
    else:
        assert alert.severity is Severity.HIGH
        assert alert.principal == "synthetic-ops-role"
        assert alert.resource == "synthetic-security-trail"
        assert alert.event_time == datetime(2026, 11, 1, 10, 10, tzinfo=UTC)
    assert alert.principal != alert.resource
    assert event == original
    alert.raw_detail["requestParameters"]["test"] = "output mutation"
    assert event == original
    event["detail"]["userIdentity"]["test"] = "input mutation"
    assert "test" not in alert.raw_detail["userIdentity"]


def test_redelivery_keeps_identity_independent_of_delivery_and_creation_time(event):
    first = normalize(event)
    event["id"] = "different-delivery-id"
    event["time"] = "2026-11-02T00:00:00Z"
    second = CloudTrailNormalizer(now=lambda: CREATED + timedelta(hours=1)).normalize(event)
    assert second.id == first.id
    assert second.event_time == first.event_time
    assert second.created_time != first.created_time
    event["detail"]["eventID"] = "different-cloudtrail-event"
    assert normalize(event).id != first.id


@pytest.mark.parametrize("source,event_source,action", [
    ("aws.iam", "iam.amazonaws.com", "ListUsers"),
    ("aws.iam", "iam.amazonaws.com", "StopLogging"),
    ("aws.cloudtrail", "cloudtrail.amazonaws.com", "CreateAccessKey"),
    ("aws.iam", "cloudtrail.amazonaws.com", "StopLogging"),
    ("aws.cloudtrail", "iam.amazonaws.com", "CreateAccessKey"),
    ("aws.s3", "iam.amazonaws.com", "CreateAccessKey"),
])
def test_mismatched_and_unselected_events_do_not_touch_storage(event, monkeypatch, source, event_source, action):
    event["source"] = source
    event["detail"]["eventSource"] = event_source
    event["detail"]["eventName"] = action
    # Unselected events do not need the fields required to build an alert.
    del event["detail"]["eventID"]
    factory = Mock()
    monkeypatch.setattr(entrypoint, "_alert_repository", factory)
    assert normalize(event) is None
    assert entrypoint.handler(event, None) == {"outcome": "ignored"}
    factory.assert_not_called()


def test_wrong_detail_type_is_ignored(event, monkeypatch):
    event["detail-type"] = "Other"
    factory = Mock()
    monkeypatch.setattr(entrypoint, "_alert_repository", factory)
    assert normalize(event) is None
    assert entrypoint.handler(event, None) == {"outcome": "ignored"}
    factory.assert_not_called()


@pytest.mark.parametrize("field", ["eventID", "eventName", "eventSource", "awsRegion"])
@pytest.mark.parametrize("value", [None, "", 42])
def test_malformed_selected_fields_rejected_before_storage(event, monkeypatch, field, value):
    if value is None:
        del event["detail"][field]
    else:
        event["detail"][field] = value
    factory = Mock()
    monkeypatch.setattr(entrypoint, "_alert_repository", factory)
    with pytest.raises(ValueError, match=field):
        entrypoint.handler(event, None)
    factory.assert_not_called()


@pytest.mark.parametrize("value", [None, "invalid", "2026-11-01T10:00:00", 42])
def test_selected_event_requires_its_own_valid_timestamp(event, monkeypatch, value):
    event["detail"]["eventTime"] = value
    factory = Mock()
    monkeypatch.setattr(entrypoint, "_alert_repository", factory)
    with pytest.raises(ValueError, match="eventTime"):
        entrypoint.handler(event, None)
    factory.assert_not_called()


@pytest.mark.parametrize("field,value", [
    ("detail", None), ("detail", []),
    ("userIdentity", None), ("userIdentity", []), ("userIdentity", {}),
    ("userIdentity", {"type": "IAMUser"}),
    ("requestParameters", []), ("requestParameters", "invalid"),
])
def test_malformed_objects_rejected_before_storage(event, monkeypatch, field, value):
    if field == "detail":
        event["detail"] = value
    else:
        event["detail"][field] = value
    factory = Mock()
    monkeypatch.setattr(entrypoint, "_alert_repository", factory)
    with pytest.raises(ValueError):
        entrypoint.handler(event, None)
    factory.assert_not_called()


def test_target_validation_and_implicit_iam_self_target(event):
    event["detail"]["requestParameters"] = {}
    if event["detail"]["eventName"] == "StopLogging":
        with pytest.raises(ValueError, match="requestParameters.name"):
            normalize(event)
    else:
        assert normalize(event).resource == "synthetic-security-admin"
        event["detail"]["requestParameters"] = {"userName": 42}
        with pytest.raises(ValueError, match="requestParameters.userName"):
            normalize(event)


def test_identity_fallback_does_not_use_target_as_caller(event):
    event["detail"]["userIdentity"] = {
        "type": "AssumedRole", "arn": "arn:aws:sts::123456789012:assumed-role/example/session"
    }
    assert normalize(event).principal == event["detail"]["userIdentity"]["arn"]
    event["detail"]["userIdentity"] = {"type": "AWSService", "invokedBy": "example.amazonaws.com"}
    assert normalize(event).principal == "example.amazonaws.com"


def test_creation_clock_is_utc_and_validated(event):
    local_time = datetime(2026, 11, 1, 6, tzinfo=timezone(timedelta(hours=-5)))
    assert CloudTrailNormalizer(now=lambda: local_time).normalize(event).created_time == CREATED
    with pytest.raises(ValueError, match="creation clock"):
        CloudTrailNormalizer(now=lambda: datetime(2026, 11, 1)).normalize(event)


@pytest.mark.parametrize("inserted,outcome", [(True, "inserted"), (False, "duplicate")])
def test_handler_stores_normalized_cloudtrail_alert(event, monkeypatch, inserted, outcome):
    repository = Mock()
    repository.store_if_absent.return_value = inserted
    monkeypatch.setattr(entrypoint, "_alert_repository", lambda: repository)
    assert entrypoint.handler(event, None) == {"alertId": normalize(event).id, "outcome": outcome}
    repository.store_if_absent.assert_called_once()
    stored_alert = repository.store_if_absent.call_args.args[0]
    assert stored_alert.raw_detail == event["detail"]
    assert stored_alert.principal == normalize(event).principal
    assert stored_alert.resource == normalize(event).resource


def test_handler_propagates_unexpected_storage_errors(event, monkeypatch):
    error = ClientError({"Error": {"Code": "AccessDeniedException"}}, "PutItem")
    repository = Mock()
    repository.store_if_absent.side_effect = error
    monkeypatch.setattr(entrypoint, "_alert_repository", lambda: repository)
    with pytest.raises(ClientError) as caught:
        entrypoint.handler(event, None)
    assert caught.value is error
