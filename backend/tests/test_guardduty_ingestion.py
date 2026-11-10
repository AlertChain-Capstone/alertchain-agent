import copy
import json
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid5

import pytest

from domain.alerts import AlertStatus, NormalizedAlert, Severity
from ingestion import FindingNormalizer


CREATED = datetime(2026, 11, 1, 11, tzinfo=UTC)


@pytest.fixture
def finding():
    return json.loads((Path(__file__).parent / "fixtures" / "guardduty_finding.json").read_text())


def normalize(event):
    return FindingNormalizer(now=lambda: CREATED).normalize(event)


def test_maps_finding_fields_without_changing_input(finding):
    original = copy.deepcopy(finding)
    alert = normalize(finding)
    assert isinstance(alert, NormalizedAlert)
    assert alert.id == str(uuid5(NAMESPACE_URL, finding["detail"]["arn"]))
    assert UUID(alert.id).version == 5
    assert alert.event_name == finding["detail"]["type"]
    assert alert.severity is Severity.HIGH
    assert alert.status is AlertStatus.NEW
    assert alert.status.value == "New"
    assert alert.source == "Amazon GuardDuty"
    assert alert.principal == "sample-instance-role"
    assert alert.resource == "i-0123456789abcdef0"
    assert alert.region == "us-east-2"
    assert alert.event_time == datetime(2026, 11, 1, 10, tzinfo=UTC)
    assert alert.event_time.tzinfo is UTC
    assert alert.created_time == CREATED
    assert finding == original


def test_duplicate_deliveries_share_identity_but_different_findings_do_not(finding):
    first = normalize(finding)
    finding["id"] = "22222222-2222-4222-8222-222222222222"
    finding["time"] = "2026-11-02T00:00:00Z"
    second = FindingNormalizer(now=lambda: CREATED + timedelta(days=1)).normalize(finding)
    assert first.id == second.id
    assert first.created_time != second.created_time
    finding["detail"]["arn"] += "-different"
    assert normalize(finding).id != first.id


@pytest.mark.parametrize("value,expected", [
    (1, Severity.LOW), (3.999, Severity.LOW),
    (4, Severity.MEDIUM), (6.999, Severity.MEDIUM),
    (7, Severity.HIGH), (8.999, Severity.HIGH),
    (9, Severity.CRITICAL), (10, Severity.CRITICAL),
])
def test_severity_boundaries(finding, value, expected):
    finding["detail"]["severity"] = value
    assert normalize(finding).severity is expected


@pytest.mark.parametrize("value", [None, "7", "high", True, [], {},
                                      float("nan"), float("inf"), -float("inf"),
                                      0, 0.999, -1, 10.001, 10 ** 1000])
def test_rejects_invalid_severity(finding, value):
    finding["detail"]["severity"] = value
    with pytest.raises(ValueError, match="severity"):
        normalize(finding)


def test_rejects_missing_severity(finding):
    del finding["detail"]["severity"]
    with pytest.raises(ValueError, match="severity"):
        normalize(finding)


@pytest.mark.parametrize("remove_service", [False, True])
def test_event_time_falls_back_to_created_at(finding, remove_service):
    if remove_service:
        del finding["detail"]["service"]
    else:
        del finding["detail"]["service"]["eventFirstSeen"]
    finding["detail"]["createdAt"] = "2026-11-01T12:02:00+02:00"
    assert normalize(finding).event_time == datetime(2026, 11, 1, 10, 2, tzinfo=UTC)


def test_event_time_falls_back_to_envelope_time(finding):
    del finding["detail"]["service"]["eventFirstSeen"]
    del finding["detail"]["createdAt"]
    assert normalize(finding).event_time == datetime(2026, 11, 1, 10, 5, tzinfo=UTC)


def test_creation_clock_is_separate_and_normalized_to_utc(finding):
    clock_time = datetime(2026, 11, 1, 6, tzinfo=timezone(timedelta(hours=-5)))
    alert = FindingNormalizer(now=lambda: clock_time).normalize(finding)
    assert alert.created_time == CREATED
    assert alert.created_time.tzinfo is UTC
    assert alert.event_time != alert.created_time


def test_raw_detail_is_an_independent_deep_copy(finding):
    original = copy.deepcopy(finding["detail"])
    alert = normalize(finding)
    assert alert.raw_detail == original
    assert "detail-type" not in alert.raw_detail
    alert.raw_detail["resource"]["accessKeyDetails"]["userName"] = "changed-output"
    assert finding["detail"] == original
    finding["detail"]["service"]["eventLastSeen"] = "changed-input"
    assert alert.raw_detail["service"] == original["service"]


@pytest.mark.parametrize("event", [None, [], {},
    {"source": "aws.iam", "detail-type": "GuardDuty Finding"},
    {"source": "aws.guardduty", "detail-type": "Other"},
    {"source": "aws.guardduty", "detail-type": "GuardDuty Finding", "detail": []},
])
def test_rejects_invalid_envelope(event):
    with pytest.raises(ValueError):
        normalize(event)


@pytest.mark.parametrize("field", ["arn", "type", "region"])
@pytest.mark.parametrize("value", [None, "", 42])
def test_rejects_missing_or_invalid_required_detail_fields(finding, field, value):
    if value is None:
        del finding["detail"][field]
    else:
        finding["detail"][field] = value
    with pytest.raises(ValueError, match=field):
        normalize(finding)


def test_rejects_non_finding_arn(finding):
    finding["detail"]["arn"] = "arn:aws:iam::123456789012:user/test"
    with pytest.raises(ValueError, match="ARN"):
        normalize(finding)


@pytest.mark.parametrize("value", [None, "", "invalid", "2026-11-01T10:00:00", 42])
def test_invalid_first_seen_does_not_silently_use_fallback(finding, value):
    finding["detail"]["service"]["eventFirstSeen"] = value
    with pytest.raises(ValueError, match="eventFirstSeen"):
        normalize(finding)


def test_missing_all_event_timestamps_is_rejected(finding):
    del finding["detail"]["service"]
    del finding["detail"]["createdAt"]
    del finding["time"]
    with pytest.raises(ValueError, match="time"):
        normalize(finding)


@pytest.mark.parametrize("clock", [lambda: datetime(2026, 11, 1), lambda: None])
def test_rejects_invalid_creation_clock(finding, clock):
    with pytest.raises(ValueError, match="creation clock"):
        FindingNormalizer(now=clock).normalize(finding)


def test_optional_actor_and_resource_can_be_absent(finding):
    del finding["detail"]["resource"]
    alert = normalize(finding)
    assert alert.principal is None
    assert alert.resource is None


@pytest.mark.parametrize("field", ["resource", "service"])
def test_rejects_malformed_nested_objects(finding, field):
    finding["detail"][field] = []
    with pytest.raises(ValueError, match=field):
        normalize(finding)
