from agent import StepLimiter
from domain.investigation import Confidence, InvestigationStatus, Severity
from support import (
    INVESTIGATION_ID,
    FakeBedrockRuntime,
    conclusion_json,
    final_response,
    make_harness,
    tool_use_response,
)

EV1, EV2, EV3 = (f"{INVESTIGATION_ID}-ev-{n}" for n in (1, 2, 3))


def test_tool_calls_then_final_answer_completes_with_cited_evidence():
    runtime = FakeBedrockRuntime([
        tool_use_response("get_related_events", {"alert_id": "A-1"}, "tu-1",
                          text="<thinking>Start with the alert and nearby events.</thinking>"),
        tool_use_response("check_actor_baseline",
                          {"actor": "alice.dev", "source_ip": "203.0.113.50",
                           "event_name": "CreateAccessKey"}, "tu-2"),
        tool_use_response("create_incident",
                          {"title": "Possible credential compromise: alice.dev",
                           "severity": "HIGH",
                           "summary": "New-IP login without MFA, then CreateAccessKey.",
                           "evidence_ids": [EV1, EV2]}, "tu-3"),
        final_response("<thinking>Evidence is consistent.</thinking>"
                       + conclusion_json([EV1, EV2, EV3])),
    ])
    h = make_harness(runtime)

    inv = h.run()

    assert inv.status is InvestigationStatus.COMPLETED
    assert inv.conclusion.severity is Severity.HIGH
    assert inv.conclusion.confidence is Confidence.HIGH
    assert inv.conclusion.evidence_ids == (EV1, EV2, EV3)
    assert len(inv.conclusion.attack_chain.stages) == 2

    # Every step is recorded: 3 tool calls + the final answer.
    assert [s.tool_name for s in inv.steps] == [
        "get_related_events", "check_actor_baseline", "create_incident", None]
    assert [s.step_no for s in inv.steps] == [1, 2, 3, 4]
    assert inv.steps[0].thought == "Start with the alert and nearby events."
    assert inv.steps[0].tool_output["evidence_id"] == EV1

    # Every tool result is Evidence.
    evidence = {e.id: e for e in h.evidence.list_for_investigation(INVESTIGATION_ID)}
    assert [evidence[i].source for i in (EV1, EV2, EV3)] == [
        "get_related_events", "check_actor_baseline", "create_incident"]
    baseline = evidence[EV2].raw["output"]
    assert baseline["ip_is_known"] is False and baseline["action_is_typical"] is False
    events = evidence[EV1].raw["output"]["related_events"]
    assert [e["event_name"] for e in events] == ["ConsoleLogin", "CreateAccessKey"]

    assert len(h.incidents.incidents) == 1
    assert h.incidents.incidents[0]["evidence_ids"] == [EV1, EV2]

    # Persisted state matches what run() returned.
    assert h.investigations.get(INVESTIGATION_ID) == inv

    # Requests sent to Bedrock: defaults, maxTokens 600, tool config, tool results with IDs.
    first, second = runtime.requests[0], runtime.requests[1]
    assert first["modelId"] == "us.amazon.nova-lite-v1:0"
    assert first["inferenceConfig"]["maxTokens"] == 600
    assert [t["toolSpec"]["name"] for t in first["toolConfig"]["tools"]] == h.tool_names
    tool_result = second["messages"][-1]["content"][0]["toolResult"]
    assert tool_result["toolUseId"] == "tu-1"
    assert tool_result["status"] == "success"
    assert tool_result["content"][0]["json"]["evidence_id"] == EV1


def test_step_limit_reached_needs_human_review():
    runtime = FakeBedrockRuntime(
        lambda i: tool_use_response("get_related_events", {"alert_id": "A-1"}, f"tu-{i}"))
    h = make_harness(runtime)

    inv = h.run()

    assert inv.status is InvestigationStatus.NEEDS_HUMAN_REVIEW
    assert "step limit of 6" in inv.status_reason
    assert len(runtime.requests) == 6
    assert len(inv.steps) == 6
    assert inv.conclusion is None
    assert h.investigations.get(INVESTIGATION_ID).status is InvestigationStatus.NEEDS_HUMAN_REVIEW


def test_timeout_needs_human_review():
    clock = {"t": 0.0}

    def advance():
        clock["t"] += 50.0  # each model call "takes" 50s

    runtime = FakeBedrockRuntime(
        lambda i: tool_use_response("get_related_events", {"alert_id": "A-1"}, f"tu-{i}"),
        on_call=advance)
    h = make_harness(runtime, lambda: StepLimiter(timeout_seconds=90, clock=lambda: clock["t"]))

    inv = h.run()

    assert inv.status is InvestigationStatus.NEEDS_HUMAN_REVIEW
    assert "timeout of 90s" in inv.status_reason
    assert len(runtime.requests) == 2


def test_unknown_tool_returns_error_to_model_and_run_continues():
    runtime = FakeBedrockRuntime([
        tool_use_response("delete_user", {"user": "alice.dev"}, "tu-1"),
        tool_use_response("get_related_events", {"alert_id": "A-1"}, "tu-2"),
        final_response(conclusion_json([EV1])),
    ])
    h = make_harness(runtime)

    inv = h.run()

    # The model saw an error result for the unknown tool.
    error_result = runtime.requests[1]["messages"][-1]["content"][0]["toolResult"]
    assert error_result["toolUseId"] == "tu-1"
    assert error_result["status"] == "error"
    assert "unknown tool 'delete_user'" in error_result["content"][0]["text"]

    # Recorded as a step, but not as Evidence.
    assert inv.steps[0].tool_name == "delete_user"
    assert "unknown tool" in inv.steps[0].tool_output["error"]
    evidence = h.evidence.list_for_investigation(INVESTIGATION_ID)
    assert [e.id for e in evidence] == [EV1]
    assert evidence[0].source == "get_related_events"

    assert inv.status is InvestigationStatus.COMPLETED


def test_thinking_is_stripped_from_final_answer():
    # The thinking text contains braces: if it were not stripped, JSON extraction would fail.
    runtime = FakeBedrockRuntime([
        tool_use_response("get_related_events", {"alert_id": "A-1"}),
        final_response("<thinking>I will answer with the {json} object now.</thinking>\n"
                       + conclusion_json([EV1])),
    ])
    h = make_harness(runtime)

    inv = h.run()

    assert inv.status is InvestigationStatus.COMPLETED
    assert "<thinking>" not in inv.conclusion.summary
    assert inv.steps[-1].thought == "I will answer with the {json} object now."


def test_conclusion_without_citations_needs_human_review():
    runtime = FakeBedrockRuntime([
        tool_use_response("get_related_events", {"alert_id": "A-1"}),
        final_response(conclusion_json([], attack_chain=[])),
    ])
    inv = make_harness(runtime).run()

    assert inv.status is InvestigationStatus.NEEDS_HUMAN_REVIEW
    assert "cites no evidence" in inv.status_reason


def test_conclusion_citing_invented_evidence_needs_human_review():
    runtime = FakeBedrockRuntime([
        tool_use_response("get_related_events", {"alert_id": "A-1"}),
        final_response(conclusion_json([EV1, "INV-1-ev-99"])),
    ])
    inv = make_harness(runtime).run()

    assert inv.status is InvestigationStatus.NEEDS_HUMAN_REVIEW
    assert "INV-1-ev-99" in inv.status_reason


def test_non_json_final_answer_needs_human_review():
    runtime = FakeBedrockRuntime([final_response("Looks suspicious, please check.")])
    inv = make_harness(runtime).run()

    assert inv.status is InvestigationStatus.NEEDS_HUMAN_REVIEW
    assert inv.steps[-1].tool_name is None


def test_invalid_tool_input_returns_error_without_evidence():
    runtime = FakeBedrockRuntime([
        tool_use_response("get_related_events", {"alertId": "A-1"}),
        final_response("not json"),
    ])
    h = make_harness(runtime)
    h.run()

    result = runtime.requests[1]["messages"][-1]["content"][0]["toolResult"]
    assert result["status"] == "error"
    assert "missing required field" in result["content"][0]["text"]
    assert h.evidence.list_for_investigation(INVESTIGATION_ID) == []


def test_create_incident_rejects_unknown_evidence():
    runtime = FakeBedrockRuntime([
        tool_use_response("create_incident",
                          {"title": "x", "severity": "HIGH", "summary": "x",
                           "evidence_ids": ["INV-1-ev-7"]}),
        final_response("not json"),
    ])
    h = make_harness(runtime)
    h.run()

    result = runtime.requests[1]["messages"][-1]["content"][0]["toolResult"]
    assert result["status"] == "error"
    assert "unknown evidence IDs" in result["content"][0]["text"]
    assert h.incidents.incidents == []


def test_model_call_failure_marks_failed():
    class Boom:
        def converse(self, **_):
            raise RuntimeError("AccessDeniedException")

    from infra.bedrock import BedrockClient, BedrockSettings
    h = make_harness(FakeBedrockRuntime([]))
    h.orchestrator._llm = BedrockClient(BedrockSettings(), runtime_client=Boom())

    inv = h.run()

    assert inv.status is InvestigationStatus.FAILED
    assert "AccessDeniedException" in inv.status_reason
