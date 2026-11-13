import pytest

from infra.bedrock import (
    BedrockSettings,
    ConverseRequestBuilder,
    ModelResponseParser,
    ToolSchemaMapper,
    strip_thinking,
)


@pytest.mark.parametrize(
    ("raw", "visible", "thoughts"),
    [
        ("<thinking>check IP</thinking>Answer", "Answer", ["check IP"]),
        ("<thinking>a</thinking>x<thinking>b\nc</thinking> y", "x y", ["a", "b\nc"]),
        ("Answer <THINKING>upper</THINKING>", "Answer", ["upper"]),
        ("Partial answer <thinking>cut off by maxTok", "Partial answer", ["cut off by maxTok"]),
        ("No reasoning here", "No reasoning here", []),
        ("stray </thinking> tag", "stray  tag", []),
    ],
)
def test_strip_thinking(raw, visible, thoughts):
    assert strip_thinking(raw) == (visible, thoughts)


def test_parser_separates_thinking_text_and_tool_use():
    turn = ModelResponseParser().parse({
        "output": {"message": {"role": "assistant", "content": [
            {"text": "<thinking>Need related events.</thinking>"},
            {"toolUse": {"toolUseId": "tu-9", "name": "get_related_events",
                         "input": {"alert_id": "A-1"}}},
        ]}},
        "stopReason": "tool_use",
        "usage": {"inputTokens": 12, "outputTokens": 3},
    })
    assert turn.text == ""
    assert turn.thinking == "Need related events."
    assert turn.tool_uses[0].name == "get_related_events"
    assert turn.tool_uses[0].input == {"alert_id": "A-1"}
    assert (turn.input_tokens, turn.output_tokens) == (12, 3)
    # History keeps the original message unchanged.
    assert turn.assistant_message["content"][0]["text"].startswith("<thinking>")


def test_settings_defaults(monkeypatch):
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    monkeypatch.delenv("BEDROCK_REGION", raising=False)
    s = BedrockSettings.from_env()
    assert (s.model_id, s.region, s.max_tokens) == ("us.amazon.nova-lite-v1:0", "us-east-2", 600)


def test_settings_from_env(monkeypatch):
    monkeypatch.setenv("BEDROCK_MODEL_ID", "us.amazon.nova-lite-v1:0")
    monkeypatch.setenv("BEDROCK_REGION", "us-west-2")
    s = BedrockSettings.from_env()
    assert (s.model_id, s.region) == ("us.amazon.nova-lite-v1:0", "us-west-2")


def test_request_builder_and_schema_mapper():
    class Tool:
        name = "get_related_events"
        description = "d"
        input_schema = {"type": "object", "properties": {}}

    config = ToolSchemaMapper().to_tool_config([Tool()])
    req = ConverseRequestBuilder("m", 600).build("sys", [{"role": "user", "content": []}], config)
    assert req["modelId"] == "m"
    assert req["system"] == [{"text": "sys"}]
    assert req["inferenceConfig"] == {"maxTokens": 600, "temperature": 0.0}
    assert req["toolConfig"]["tools"][0]["toolSpec"]["inputSchema"] == {"json": Tool.input_schema}
    assert "toolConfig" not in ConverseRequestBuilder("m", 600).build("s", [], None)
