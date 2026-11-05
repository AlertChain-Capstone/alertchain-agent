import json
import threading

import pytest

from agent import (
    LambdaSelfInvokeLauncher,
    LauncherError,
    LocalLauncher,
    handle_investigation_job,
    launcher_from_env,
)
from domain.investigation import Investigation, InvestigationStatus
from support import FakeBedrockRuntime, conclusion_json, final_response, make_runtime, tool_use_response


class StubLambdaClient:
    """Stands in for boto3.client("lambda"). Records invoke() calls."""

    def __init__(self, status_code=202, error=None):
        self.calls = []
        self._status_code = status_code
        self._error = error

    def invoke(self, **kwargs):
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        return {"StatusCode": self._status_code}


def test_lambda_launcher_invokes_itself_asynchronously(monkeypatch):
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "alertchain-api")
    client = StubLambdaClient()

    LambdaSelfInvokeLauncher(client=client).launch("INV-7")

    [call] = client.calls
    assert call["FunctionName"] == "alertchain-api"
    assert call["InvocationType"] == "Event"
    assert json.loads(call["Payload"]) == {"type": "investigation_job", "investigationId": "INV-7"}


def test_lambda_launcher_requires_function_name(monkeypatch):
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    with pytest.raises(LauncherError, match="AWS_LAMBDA_FUNCTION_NAME"):
        LambdaSelfInvokeLauncher(client=StubLambdaClient())


@pytest.mark.parametrize(
    ("client", "message"),
    [
        (StubLambdaClient(error=RuntimeError("AccessDeniedException")), "invoke failed: RuntimeError"),
        (StubLambdaClient(status_code=500), "status 500"),
    ],
)
def test_lambda_launcher_failures_raise_launcher_error(client, message):
    with pytest.raises(LauncherError, match=message):
        LambdaSelfInvokeLauncher(client=client, function_name="fn").launch("INV-7")


def test_local_launcher_runs_on_a_background_thread():
    ran_on = []
    done = threading.Event()

    def run(investigation_id):
        ran_on.append((investigation_id, threading.current_thread().name))
        done.set()

    LocalLauncher(run).launch("INV-8")

    assert done.wait(timeout=5)
    assert ran_on[0][0] == "INV-8"
    assert ran_on[0][1].startswith("investigation")


@pytest.mark.parametrize(
    ("env", "expected"),
    [
        ({}, LocalLauncher),
        ({"INVESTIGATION_LAUNCHER": "local", "AWS_LAMBDA_FUNCTION_NAME": "fn"}, LocalLauncher),
        ({"INVESTIGATION_LAUNCHER": "LAMBDA", "AWS_LAMBDA_FUNCTION_NAME": "fn"}, LambdaSelfInvokeLauncher),
        ({"AWS_LAMBDA_FUNCTION_NAME": "fn"}, LambdaSelfInvokeLauncher),  # unset inside Lambda
    ],
)
def test_launcher_from_env(env, expected):
    assert isinstance(launcher_from_env(lambda _: None, env), expected)


@pytest.mark.parametrize(
    "env",
    [{"INVESTIGATION_LAUNCHER": "sqs"}, {"INVESTIGATION_LAUNCHER": "lambda"}],
)
def test_launcher_from_env_rejects_bad_config(env):
    with pytest.raises(LauncherError):
        launcher_from_env(lambda _: None, env)


def _job(investigation_id="INV-9"):
    return {"type": "investigation_job", "investigationId": investigation_id}


def test_handle_investigation_job_runs_the_orchestrator():
    model = FakeBedrockRuntime([
        tool_use_response("get_related_events", {"alert_id": "A-1"}),
        final_response(conclusion_json(["INV-9-ev-1"])),
    ])
    rt = make_runtime(model)
    rt.investigations.save(Investigation(id="INV-9", alert_id="A-1"))

    result = handle_investigation_job(_job(), runtime=rt)

    assert result == {"investigationId": "INV-9", "status": "COMPLETED"}
    assert rt.investigations.get("INV-9").status is InvestigationStatus.COMPLETED
    assert len(model.requests) == 2


def test_handle_investigation_job_is_idempotent_for_redelivered_events():
    model = FakeBedrockRuntime([])
    rt = make_runtime(model)
    inv = Investigation(id="INV-9", alert_id="A-1")
    inv.escalate("already reviewed")
    rt.investigations.save(inv)

    result = handle_investigation_job(_job(), runtime=rt)

    assert result["status"] == "NEEDS_HUMAN_REVIEW"
    assert model.requests == []


def test_handle_investigation_job_missing_investigation_is_skipped():
    rt = make_runtime(FakeBedrockRuntime([]))
    assert handle_investigation_job(_job("INV-gone"), runtime=rt) == {
        "investigationId": "INV-gone", "status": None}


@pytest.mark.parametrize(
    "event",
    [
        {"type": "alert_ingest", "investigationId": "INV-9"},
        {"type": "investigation_job"},
        {"type": "investigation_job", "investigationId": "../../etc"},
        {"type": "investigation_job", "investigationId": 42},
    ],
)
def test_handle_investigation_job_rejects_malformed_events(event):
    rt = make_runtime(FakeBedrockRuntime([]))
    with pytest.raises(ValueError):
        handle_investigation_job(event, runtime=rt)


def test_handle_investigation_job_crash_marks_failed():
    rt = make_runtime(FakeBedrockRuntime([]))
    rt.investigations.save(Investigation(id="INV-9", alert_id="A-1"))

    def boom(_):
        raise KeyError("bug")

    rt.orchestrator.run = boom

    assert handle_investigation_job(_job(), runtime=rt)["status"] == "FAILED"
    assert rt.investigations.get("INV-9").status_reason == "internal error: KeyError"
