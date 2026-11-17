import base64
import json
from unittest.mock import Mock

import pytest

import handler
from domain.investigation import Evidence, InMemoryEvidenceRepository, InMemoryIncidentRepository
from infra.bedrock import BedrockClient
from services.ask import MAX_CONTEXT_CHARS, AskService, EvidenceContextBuilder
from services.incidents import IncidentQueryService
from support import FakeBedrockRuntime, final_response, tool_use_response


def endpoint(question="Which account was involved?", *, raw=None, encoded=False, method="POST"):
    event = {
        "rawPath": "/incidents/INC-1/questions", "requestContext": {"http": {"method": method}},
        "body": json.dumps({"question": question}) if raw is None else raw,
        "isBase64Encoded": encoded,
    }
    result = handler.handler(event, None)
    return result["statusCode"], json.loads(result["body"]) if result["body"] else None


def selected(*fields):
    return {"kind": "answer", "references": [{"id": evidence_id, "field": field}
                                             for evidence_id, field in fields]}


@pytest.fixture
def stored():
    incidents = InMemoryIncidentRepository()
    incidents.create({"investigation_id": "INV-1", "evidence_ids": ["E1", "E2", "FOREIGN"]})
    evidence = InMemoryEvidenceRepository()
    evidence.add(Evidence("E1", "INV-1", "get_related_events", "Account alpha was recorded.",
                          {"events": [{"actor": "alpha"}]}))
    evidence.add(Evidence("E2", "INV-1", "check_actor_baseline", "No baseline found.", {}))
    evidence.add(Evidence("UNCITED", "INV-1", "tool", "Not cited by the incident.", {}))
    evidence.add(Evidence("FOREIGN", "INV-2", "tool", "Private to a different investigation.", {}))
    return incidents, IncidentQueryService(incidents, evidence)


def wire(monkeypatch, queries, turns):
    runtime = FakeBedrockRuntime(turns)
    service = AskService(queries, BedrockClient(runtime_client=runtime))
    monkeypatch.setattr(handler, "_ask_service", lambda: service)
    return runtime


def test_returns_only_recorded_values_and_sends_only_incident_evidence(stored, monkeypatch):
    _, service = stored
    reply = selected(("E1", "raw/events/0/actor"), ("E2", "summary"))
    runtime = wire(monkeypatch, service, [final_response(json.dumps(reply))])
    status, body = endpoint()
    assert (status, body["kind"], body["citations"]) == (200, "answer", ["E1", "E2"])
    assert body["text"] == "[E1] raw/events/0/actor: alpha\n[E2] No baseline found."
    request, = runtime.requests
    assert "toolConfig" not in request
    user, = request["messages"]
    payload = json.loads(user["content"][0]["text"])
    assert user["role"] == "user" and payload["question"] == "Which account was involved?"
    assert set(payload["evidence"]) == {"E1", "E2"}
    assert "Private to a different investigation" not in json.dumps(request)


@pytest.mark.parametrize("reply", [
    {"kind": "limitation"}, selected(), selected(("E1", "summary"), ("FOREIGN", "summary")),
    selected(("E1", "raw/missing")), selected(("UNCITED", "source")),
    {**selected(("E1", "summary")), "text": "invented claim"},
    {"kind": "answer", "references": [{"id": [], "field": "summary"}]},
])
def test_unverified_model_output_is_withheld(stored, monkeypatch, reply):
    _, service = stored
    wire(monkeypatch, service, [final_response(json.dumps(reply))])
    status, body = endpoint()
    assert (status, body["kind"], body["citations"]) == (200, "limitation", [])
    assert "invented claim" not in body["text"]


@pytest.mark.parametrize("turn", [
    final_response("Malformed JSON"), final_response(json.dumps(selected(("E1", "summary"))), "max_tokens"),
    tool_use_response("get_related_events", {"actor": "other"}),
])
def test_invalid_partial_and_tool_request_responses_are_withheld(stored, monkeypatch, turn):
    _, service = stored
    runtime = wire(monkeypatch, service, [turn])
    assert endpoint()[1]["kind"] == "limitation"
    assert len(runtime.requests) == 1


def test_missing_incident_empty_evidence_and_foreign_question_skip_model(stored, monkeypatch):
    records, service = stored
    runtime = wire(monkeypatch, service, [])
    assert endpoint("Tell me about INC-200 instead")[1]["kind"] == "limitation"
    records.incidents[0]["evidence_ids"] = []
    assert endpoint()[1]["kind"] == "limitation"
    records.incidents.clear()
    assert endpoint()[0] == 404
    assert runtime.requests == []


def test_context_preserves_whole_values_and_stays_bounded():
    example = {"id": "E1", "source": "tool", "summary": "one summary",
               "raw": {"a/b": {"~score": 2}, "very long": "z" * 1001,
                       "wide": ["v" * 300 for _ in range(500)]}}
    context = EvidenceContextBuilder.build([{**example, "id": f"E{i}"} for i in range(30)])
    assert 0 < len(json.dumps(context, separators=(",", ":"))) <= MAX_CONTEXT_CHARS
    assert context["E0"]["raw/a~1b/~0score"] == "2"
    assert "raw/very long" not in context["E0"]


@pytest.mark.parametrize("raw,encoded", [
    ("{}", False), ("INC1", False), ("[]", False), ('{"question":" "}', False),
    ('{"question":"abc","evidence":[42]}', False), (json.dumps({"question": 27}), False),
    (json.dumps({"question": "q" * 1001}), False), (json.dumps({"question": "\ud800"}), False),
    ("&&", True),
])
def test_invalid_body_does_not_reach_question_service(monkeypatch, raw, encoded):
    factory = Mock()
    monkeypatch.setattr(handler, "_ask_service", factory)
    assert endpoint(raw=raw, encoded=encoded)[0] == 400
    factory.assert_not_called()


def test_base64_question_is_decoded_and_trimmed(stored, monkeypatch):
    _, service = stored
    runtime = wire(monkeypatch, service, [final_response('{"kind":"limitation"}')])
    raw = base64.b64encode(json.dumps({"question": "  Explain the evidence.  "}).encode()).decode()
    assert endpoint(raw=raw, encoded=True)[0] == 200
    sent = json.loads(runtime.requests[0]["messages"][0]["content"][0]["text"])
    assert sent["question"] == "Explain the evidence."


def test_gateway_failure_is_retryable_and_method_contract(stored, monkeypatch):
    _, service = stored
    runtime = wire(monkeypatch, service, [])
    assert endpoint(method="GET")[0] == 405
    assert endpoint(method="OPTIONS")[0] == 204
    assert not runtime.requests
    status, body = endpoint()
    assert (status, body["error"]["code"]) == (503, "SERVICE_UNAVAILABLE")
