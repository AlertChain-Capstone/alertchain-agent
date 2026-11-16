"""InvestigationController: API Gateway v2 events against the real router (needs FastAPI)."""

import base64
import json

import pytest

pytest.importorskip("fastapi")

from agent import LauncherError  # noqa: E402
from api import InvestigationsRouter  # noqa: E402
from api.investigations_http import InvestigationController  # noqa: E402
from support import (  # noqa: E402
    FakeBedrockRuntime,
    conclusion_json,
    final_response,
    make_runtime,
    tool_use_response,
)

INV_ID = "INV-http-1"
EV1 = f"{INV_ID}-ev-1"


def event(method, path, body=None, base64_body=False):
    result = {
        "version": "2.0",
        "rawPath": path,
        "requestContext": {"http": {"method": method}},
    }
    if body is not None:
        raw = body if isinstance(body, str) else json.dumps(body)
        result["body"] = base64.b64encode(raw.encode()).decode() if base64_body else raw
        result["isBase64Encoded"] = base64_body
    return result


def make_controller(model=None, launcher_factory=None):
    model = model or FakeBedrockRuntime([
        tool_use_response("get_related_events", {"alert_id": "A-1"}, "tu-1"),
        final_response(conclusion_json([EV1])),
    ])
    runtime = make_runtime(model, launcher_factory)
    return InvestigationController(InvestigationsRouter.from_runtime(runtime, lambda: INV_ID))


def parse(result):
    assert result["headers"]["content-type"] == "application/json"
    return json.loads(result["body"])


def test_post_then_get_round_trip():
    controller = make_controller()

    started = controller.handle(event("POST", "/investigations", {"alertId": "A-1"}))
    assert started["statusCode"] == 202
    assert parse(started) == {"investigationId": INV_ID}

    found = controller.handle(event("GET", f"/investigations/{INV_ID}"))
    assert found["statusCode"] == 200
    body = parse(found)
    assert body["investigationId"] == INV_ID
    assert body["alertId"] == "A-1"
    assert body["status"] == "COMPLETED"
    assert body["conclusion"]["evidenceIds"] == [EV1]


def test_base64_body_is_decoded():
    controller = make_controller()
    result = controller.handle(
        event("POST", "/investigations", {"alertId": "A-1"}, base64_body=True))
    assert result["statusCode"] == 202


@pytest.mark.parametrize(
    "body",
    ['{"alertId": ""}', '{"alertId": "bad id!"}', "{}", "not json", '{"alertId": 7}'],
)
def test_invalid_start_body_is_a_400(body):
    result = make_controller().handle(event("POST", "/investigations", body))
    assert result["statusCode"] == 400
    assert parse(result)["error"]["code"] == "INVALID_REQUEST"


def test_unknown_alert_is_a_404():
    result = make_controller().handle(event("POST", "/investigations", {"alertId": "NOPE-1"}))
    assert result["statusCode"] == 404
    assert parse(result)["error"]["code"] == "NOT_FOUND"


def test_unknown_investigation_is_a_404():
    result = make_controller().handle(event("GET", "/investigations/INV-missing"))
    assert result["statusCode"] == 404


def test_invalid_investigation_id_is_a_400():
    result = make_controller().handle(event("GET", "/investigations/bad%20id"))
    assert result["statusCode"] == 400
    assert parse(result)["error"]["code"] == "INVALID_INVESTIGATION_ID"


@pytest.mark.parametrize(
    "method,path,allow",
    [("GET", "/investigations", "POST"), ("POST", "/investigations/INV-1", "GET")],
)
def test_wrong_method_is_a_405(method, path, allow):
    result = make_controller().handle(event(method, path))
    assert result["statusCode"] == 405
    assert result["headers"]["allow"] == allow


@pytest.mark.parametrize("path", ["/investigations", "/investigations/INV-1"])
def test_cors_preflight_is_a_204_without_side_effects(path):
    result = make_controller().handle(event("OPTIONS", path))
    assert result["statusCode"] == 204
    assert result["body"] == ""


def test_unknown_route_is_a_404():
    result = make_controller().handle(event("GET", "/investigations/INV-1/extra"))
    assert result["statusCode"] == 404


def test_launcher_failure_is_a_503_and_the_run_is_marked_failed():
    class BrokenLauncher:
        def launch(self, investigation_id):
            raise LauncherError("boom")

    controller = make_controller(launcher_factory=lambda run: BrokenLauncher())

    started = controller.handle(event("POST", "/investigations", {"alertId": "A-1"}))
    assert started["statusCode"] == 503
    assert parse(started)["error"]["code"] == "SERVICE_UNAVAILABLE"

    found = parse(controller.handle(event("GET", f"/investigations/{INV_ID}")))
    assert found["status"] == "FAILED"


def test_unexpected_error_is_a_503_not_an_exception():
    class Exploding:
        def start_investigation(self, body):
            raise RuntimeError("storage down")

    result = InvestigationController(Exploding()).handle(
        event("POST", "/investigations", {"alertId": "A-1"}))
    assert result["statusCode"] == 503
