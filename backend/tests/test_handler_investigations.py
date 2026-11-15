"""Lambda entry point dispatch for investigations (no FastAPI needed: controller is faked)."""

from unittest.mock import Mock

import pytest

import handler as entrypoint


def http_event(method, path, body=None):
    event = {
        "version": "2.0",
        "rawPath": path,
        "requestContext": {"http": {"method": method}},
    }
    if body is not None:
        event["body"] = body
    return event


@pytest.fixture(autouse=True)
def clear_controller_cache():
    entrypoint._investigation_controller.cache_clear()
    yield
    entrypoint._investigation_controller.cache_clear()


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/investigations"),
        ("POST", "/investigations/"),
        ("GET", "/investigations/INV-abc123"),
    ],
)
def test_investigation_routes_go_to_the_controller(monkeypatch, method, path):
    controller = Mock()
    controller.handle.return_value = {"statusCode": 202}
    monkeypatch.setattr(entrypoint, "_investigation_controller", lambda: controller)
    event = http_event(method, path, '{"alertId":"A-1"}')

    assert entrypoint.handler(event, None) == {"statusCode": 202}
    controller.handle.assert_called_once_with(event)


def test_similar_paths_are_not_investigation_routes(monkeypatch):
    factory = Mock(side_effect=AssertionError("controller built for another route"))
    monkeypatch.setattr(entrypoint, "_investigation_controller", factory)
    with pytest.raises(ValueError, match="unsupported event"):
        entrypoint.handler(http_event("GET", "/investigationsX"), None)
    factory.assert_not_called()


def test_health_and_alerts_do_not_build_the_controller(monkeypatch):
    factory = Mock(side_effect=AssertionError("controller built"))
    monkeypatch.setattr(entrypoint, "_investigation_controller", factory)
    assert entrypoint.handler(http_event("GET", "/health"), None)["statusCode"] == 200
    factory.assert_not_called()


def test_controller_build_failure_is_a_503_and_is_retried(monkeypatch):
    import sys
    from types import SimpleNamespace

    attempts = Mock(side_effect=[RuntimeError("no table configured"), Mock()])
    # A stand-in module keeps this test independent of FastAPI.
    monkeypatch.setitem(sys.modules, "api.investigations",
                        SimpleNamespace(default_router=attempts))

    first = entrypoint.handler(http_event("GET", "/investigations/INV-1"), None)
    assert first["statusCode"] == 503
    assert "SERVICE_UNAVAILABLE" in first["body"]

    entrypoint.handler(http_event("GET", "/investigations/INV-1"), None)
    assert attempts.call_count == 2  # failures are not cached


def test_investigation_job_event_runs_the_agent(monkeypatch):
    import agent

    job = Mock(return_value={"investigationId": "INV-1", "status": "COMPLETED"})
    monkeypatch.setattr(agent, "handle_investigation_job", job)
    event = {"type": "investigation_job", "investigationId": "INV-1"}

    assert entrypoint.handler(event, None) == {
        "investigationId": "INV-1", "status": "COMPLETED"}
    job.assert_called_once_with(event)


def test_job_event_does_not_touch_alert_storage(monkeypatch):
    import agent

    monkeypatch.setattr(agent, "handle_investigation_job", Mock(return_value={}))
    repository = Mock(side_effect=AssertionError("alert storage touched"))
    monkeypatch.setattr(entrypoint, "_alert_repository", repository)
    entrypoint.handler({"type": "investigation_job", "investigationId": "INV-1"}, None)
    repository.assert_not_called()
