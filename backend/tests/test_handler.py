import json
from pathlib import Path
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError

import handler as entrypoint
from ingestion import FindingNormalizer


@pytest.fixture
def finding():
    return json.loads((Path(__file__).parent / "fixtures" / "guardduty_finding.json").read_text())


def test_health_does_not_initialize_storage(monkeypatch):
    repository_factory = Mock(side_effect=AssertionError("health touched storage"))
    monkeypatch.setattr(entrypoint, "_alert_repository", repository_factory)
    assert entrypoint.handler({
        "version": "2.0", "rawPath": "/health",
        "requestContext": {"http": {"method": "GET"}},
    }, None) == {
        "statusCode": 200, "headers": {"content-type": "application/json"},
        "body": '{"status":"ok"}',
    }
    repository_factory.assert_not_called()


@pytest.mark.parametrize("inserted,outcome", [(True, "inserted"), (False, "duplicate")])
def test_guardduty_routes_to_normalizer_and_repository(finding, monkeypatch, inserted, outcome):
    repository = Mock()
    repository.store_if_absent.return_value = inserted
    monkeypatch.setattr(entrypoint, "_alert_repository", lambda: repository)
    result = entrypoint.handler(finding, None)
    assert result == {"alertId": FindingNormalizer().normalize(finding).id, "outcome": outcome}
    repository.store_if_absent.assert_called_once()
    alert = repository.store_if_absent.call_args.args[0]
    assert alert.raw_detail == finding["detail"]


def test_unexpected_storage_error_propagates(finding, monkeypatch):
    error = ClientError({"Error": {"Code": "AccessDeniedException"}}, "PutItem")
    repository = Mock()
    repository.store_if_absent.side_effect = error
    monkeypatch.setattr(entrypoint, "_alert_repository", lambda: repository)
    with pytest.raises(ClientError) as caught:
        entrypoint.handler(finding, None)
    assert caught.value is error


def test_invalid_finding_does_not_initialize_storage(finding, monkeypatch):
    del finding["detail"]["arn"]
    repository_factory = Mock()
    monkeypatch.setattr(entrypoint, "_alert_repository", repository_factory)
    with pytest.raises(ValueError, match="arn"):
        entrypoint.handler(finding, None)
    repository_factory.assert_not_called()


@pytest.mark.parametrize("event", [None, {},
    {"source": "aws.cloudtrail", "detail-type": "AWS API Call via CloudTrail", "detail": {}},
    {"rawPath": "/other", "requestContext": {"http": {"method": "GET"}}},
])
def test_unsupported_events_are_not_reported_as_healthy(event):
    with pytest.raises(ValueError):
        entrypoint.handler(event, None)


@pytest.mark.parametrize("endpoint", ["", "http://host.docker.internal:4566"])
def test_repository_uses_configured_table_and_optional_local_endpoint(monkeypatch, endpoint):
    import boto3

    resource = Mock()
    factory = Mock(return_value=resource)
    monkeypatch.setattr(boto3, "resource", factory)
    monkeypatch.setenv("ALERTS_TABLE_NAME", "alertchain-alerts")
    monkeypatch.setenv("AWS_REGION", "us-east-2")
    monkeypatch.setenv("DYNAMODB_ENDPOINT_URL", endpoint)
    entrypoint._alert_repository.cache_clear()
    try:
        repository = entrypoint._alert_repository()
        factory.assert_called_once_with("dynamodb", region_name="us-east-2", endpoint_url=endpoint or None)
        resource.Table.assert_called_once_with("alertchain-alerts")
        assert repository is entrypoint._alert_repository()
    finally:
        entrypoint._alert_repository.cache_clear()
