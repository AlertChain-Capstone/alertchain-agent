"""Builds keyword arguments for bedrock-runtime `converse`."""

from __future__ import annotations

from typing import Any


class ConverseRequestBuilder:
    def __init__(self, model_id: str, max_tokens: int, temperature: float = 0.0) -> None:
        self.model_id = model_id
        self.max_tokens = max_tokens
        self.temperature = temperature

    def build(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tool_config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        request: dict[str, Any] = {
            "modelId": self.model_id,
            "system": [{"text": system}],
            "messages": messages,
            # Always explicit: leaving maxTokens unset reserves the model maximum.
            "inferenceConfig": {"maxTokens": self.max_tokens, "temperature": self.temperature},
        }
        if tool_config:
            request["toolConfig"] = tool_config
        return request
